/** One dispatch, no fetch, no preparation, no publication. All writes are create-only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {acquireQueueLock,acquireQueueSubmissionLock,readPreparationQueueInventory,readQueueObject,canonical,sha,durableCreate,abandonPreparationDispatch} from './main-prebuild-queue.mjs';

const hex=/^[a-f0-9]{64}$/,id=/^[a-f0-9-]{36}$/,commit=/^[a-f0-9]{40}$/;
export const abandonmentRequestVersion='teruisi-abandon-only-request-v1',abandonmentResultVersion='teruisi-abandon-only-result-v1';
export function reconciliationGeneration(binding){return {installId:binding.state.installId,stateSha256:binding.stateSha256,bundleSha256:binding.state.bundleSha256,configSha256:binding.state.configSha256};}
function validateRequest(value,name){
 assert.deepEqual(Object.keys(value).sort(),['at','bundleSha256','configSha256','dispatchId','dispatchSha256','installId','mode','originalResultSha256','packet','selectedTarget','stateSha256','version']);
 assert.equal(value.version,abandonmentRequestVersion);assert.equal(value.mode,'abandon-only');assert.equal(value.dispatchId+'.json',name);
 assert.ok(id.test(value.dispatchId)&&id.test(value.installId)&&commit.test(value.selectedTarget)&&typeof value.packet==='string'&&path.isAbsolute(value.packet)&&Number.isFinite(Date.parse(value.at)));
 for(const field of ['dispatchSha256','originalResultSha256','stateSha256','bundleSha256','configSha256'])assert.match(value[field]??'',hex);
}
function assertTarget(request,inventory){
 const read=inventory.dispatches.find(item=>item.value.dispatchId===request.dispatchId);assert.ok(read,'Reconciliation dispatch absent');
 const dispatch=read.value;assert.equal(read.sha256,request.dispatchSha256,'Reconciliation dispatch changed');
 assert.equal(dispatch.selectedTarget,request.selectedTarget);assert.equal(dispatch.selection.packet,request.packet);
 assert.equal(sha(Buffer.from(canonical(inventory.terminals.get(dispatch.requestId)))),request.originalResultSha256,'Reconciliation original result changed');
 assert.ok(dispatch.tickets.every(ref=>inventory.terminals.get(ref.requestId)?.status==='unknown'),'Reconciliation needs complete original unknown results');
 return read;
}
function assertGenerationBinding(request,generation){for(const field of ['installId','stateSha256','bundleSha256','configSha256'])assert.equal(request[field],generation?.[field],'Reconciliation control generation changed: '+field);}
async function entries(directory,leaf){
 let names;try{names=await fs.readdir(path.join(directory,leaf));}catch(error){if(error.code==='ENOENT')return [];throw error;}
 assert.ok(names.every(name=>name.endsWith('.json')&&id.test(name.slice(0,-5))),'Malformed reconciliation namespace');return names.sort();
}
export async function readReconciliationInventory(directory){
 const requests=[],results=new Map();
 for(const name of await entries(directory,'reconciliation-requests')){const read=await readQueueObject(path.join(directory,'reconciliation-requests',name));validateRequest(read.value,name);requests.push(read);}
 for(const name of await entries(directory,'reconciliation-results')){
  const read=await readQueueObject(path.join(directory,'reconciliation-results',name)),value=read.value,request=requests.find(item=>item.value.dispatchId+'.json'===name);assert.ok(request,'Orphan reconciliation result');
  assert.equal(value.version,abandonmentResultVersion);assert.equal(value.dispatchId,request.value.dispatchId);assert.equal(value.requestSha256,request.sha256);assert.equal(value.publicationPerformed,false);assert.equal(value.preparationPerformed,false);
  assert.ok(['abandoned','already-abandoned','refused','unknown'].includes(value.status)&&Number.isFinite(Date.parse(value.at)));
  const success=['abandoned','already-abandoned'].includes(value.status);
  assert.deepEqual(Object.keys(value).sort(),['version','dispatchId','requestSha256','status','at','publicationPerformed','preparationPerformed',...(success?['abandonmentSha256']:['error'])].sort());
  if(success){
   assert.match(value.abandonmentSha256??'',hex);const inventory=await readPreparationQueueInventory(directory);assertTarget(request.value,inventory);
   const abandoned=inventory.abandonments.get(value.dispatchId);assert.ok(abandoned,'Completed reconciliation abandonment absent');assert.equal(abandoned.sha256,value.abandonmentSha256);
  }else assert.equal(typeof value.error,'string');results.set(value.dispatchId,read);
 }
 return {requests,results,pending:requests.filter(item=>!results.has(item.value.dispatchId))};
}
/** The high side submits exact evidence only. No preparation ticket is created. */
export async function submitAbandonOnlyRequest(directory,{generation,dispatchId,dispatchSha256,originalResultSha256,selectedTarget,packet,assertGeneration=async()=>{}}){
 const request={version:abandonmentRequestVersion,mode:'abandon-only',...generation,dispatchId,dispatchSha256,originalResultSha256,selectedTarget,packet,at:new Date().toISOString()};
 validateRequest(request,dispatchId+'.json');const unlock=await acquireQueueLock(directory);assert.ok(unlock,'Queue busy; reconciliation not submitted');
 try{
  await assertGeneration();const inventory=await readPreparationQueueInventory(directory);assertTarget(request,inventory);
  const existing=await readReconciliationInventory(directory);assert.ok(existing.pending.length<=1,'Multiple pending reconciliations');
  const prior=existing.requests.find(item=>item.value.dispatchId===dispatchId);
  if(prior){assert.deepEqual({...prior.value,at:request.at},request,'Existing reconciliation has different exact bindings');return {status:existing.results.has(dispatchId)?'completed':'pending',request:prior,result:existing.results.get(dispatchId)?.value??null,wakeRequired:!existing.results.has(dispatchId)};}
  assert.equal(existing.pending.length,0,'Another reconciliation is pending');
  await fs.mkdir(path.join(directory,'reconciliation-requests'),{recursive:true});
  const requestSha256=await durableCreate(path.join(directory,'reconciliation-requests',dispatchId+'.json'),request);
  return {status:'submitted',request:{value:request,sha256:requestSha256},result:null,wakeRequired:true};
 }finally{await unlock();}
}
/** Caller owns the original queue lock. Every result returns directly to the Task. */
export async function consumeAbandonOnlyRequest(directory,{generation,assertGeneration,admitPreparation,abandonment,invalidateRetirementScope,retirementScope}){
 const requests=await readReconciliationInventory(directory);assert.ok(requests.pending.length<=1,'Multiple pending reconciliations; preparation refused');
 if(!requests.pending.length)return null;
 const requestRead=requests.pending[0],request=requestRead.value;let outcome,submissionUnlock,writeStarted=false;
 try{
  await assertGeneration();assertGenerationBinding(request,generation);await admitPreparation();
  submissionUnlock=await acquireQueueSubmissionLock(directory);assert.ok(submissionUnlock,'Queue submission is busy; abandon-only refused');
  const inventory=await readPreparationQueueInventory(directory),dispatchRead=assertTarget(request,inventory);
  const assertNoPending=inventory=>assert.equal(inventory.tickets.filter(item=>!inventory.terminals.has(item.value.requestId)).length,0,'Pending preparation tickets prevent abandon-only reconciliation');
  assertNoPending(inventory);assert.ok(abandonment,'Explicit S05d abandonment policy required');
  const result=await abandonPreparationDispatch(directory,dispatchRead,inventory,{...abandonment,retirementScope,beforeWrite:async()=>{
   await assertGeneration();assertGenerationBinding(request,generation);
   const fresh=await readPreparationQueueInventory(directory);assertTarget(request,fresh);assertNoPending(fresh);
   assert.equal((await readQueueObject(path.join(directory,'reconciliation-requests',request.dispatchId+'.json'))).sha256,requestRead.sha256,'Reconciliation request changed');
   await invalidateRetirementScope('abandon-only-write');
   writeStarted=true;
  }});
  outcome={status:result.status,abandonmentSha256:result.record.sha256};
 }catch(error){outcome={status:writeStarted?'unknown':'refused',error:String(error.message)};}finally{await submissionUnlock?.();}
 await invalidateRetirementScope('abandon-only-result');await fs.mkdir(path.join(directory,'reconciliation-results'),{recursive:true});
 const result={version:abandonmentResultVersion,dispatchId:request.dispatchId,requestSha256:requestRead.sha256,...outcome,at:new Date().toISOString(),publicationPerformed:false,preparationPerformed:false};
 await durableCreate(path.join(directory,'reconciliation-results',request.dispatchId+'.json'),result);return result;
}
