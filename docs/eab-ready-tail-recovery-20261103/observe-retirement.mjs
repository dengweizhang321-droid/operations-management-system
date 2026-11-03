/** Elevated read-only observer. Never imports the accounting adapter. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {fixedWitnessRoot,hash,fullCensusScript,writerTokenScript,observeWitnessRequest,readWitnessRecord,retirementNeedles,orderedOwners,assertRequestPath} from './retirement-witness.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function witnessBinding(r,program){
 const started=r.pins.find(x=>path.resolve(x.path)===path.resolve(r.paths.started)),failed=r.pins.find(x=>path.resolve(x.path)===path.resolve(r.paths.failed));
 return {mainCommit:r.mainCommit,recoveryId:r.recoveryId,originalAttempt:r.attempt,originalStartedSha256:started.sha256,originalFailureSha256:failed.sha256,installationSha256:r.installationSha256,bundleSha256:r.bundleSha256,nativeRoot:r.nativeRoot,program,observerScriptSha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),witnessModuleSha256:hash(await fs.readFile(path.join(here,'retirement-witness.mjs')))};
}
async function run(){
 const {values}=parseArgs({options:{request:{type:'string'},sha:{type:'string'}}});assert.ok(values.request&&/^[a-f0-9]{64}$/.test(values.sha??''));
 const recipeRaw=await fs.readFile(path.join(here,'EVIDENCE.json')),r=JSON.parse(recipeRaw);assert.equal(r.mainCommit,'eab998f81c984ee3d9e722bcd39f0f46a53a9820');assert.equal(r.recoveryId,'eab998f8-ready-tail-20261103');assert.equal(hash(await fs.readFile(process.execPath)),r.nodeSha256);
 assertRequestPath(fixedWitnessRoot,values.request);const request=(await readWitnessRecord(values.request)).value,program={...request.binding.program,relative:r.programRelative,sha256:hash(await fs.readFile(path.join(here,'recover-ready-tail.mjs'))),recipeSha256:hash(recipeRaw)},binding=await witnessBinding(r,program);assert.deepEqual(request.binding,binding);assert.deepEqual(request.needles,retirementNeedles(r));
 const original=JSON.parse(await fs.readFile(r.paths.started,'utf8')),owners=[original.publisherOwner],prior=path.join(r.stateDirectory,'accounting-recoveries',r.recoveryId,'invocations');let names=[];try{names=await fs.readdir(prior);}catch(e){if(e.code!=='ENOENT')throw e;}assert.ok(names.length<=64);for(const name of names){assert.match(name,/^[a-f0-9-]{36}$/);const started=(await readWitnessRecord(path.join(prior,name,'STARTED.json'))).value;assert.equal(started.recoveryId,r.recoveryId);assert.equal(started.programSha256,program.sha256);assert.equal(started.recipeSha256,program.recipeSha256);if(started.owner.processId!==request.writer.processId||started.owner.creationDate!==request.writer.creationDate)owners.push(started.owner);}assert.deepEqual(request.owners,orderedOwners(owners));
 for(const pin of r.pins.filter(x=>[r.paths.started,r.paths.failed,path.join(r.stateDirectory,'CONTROL-INSTALLATION.json')].some(p=>path.resolve(x.path)===path.resolve(p))))assert.equal(hash(await fs.readFile(pin.path)),pin.sha256);
 const taskFile=path.join(r.bundleRoot,'tools/main-prebuild-task.mjs'),pin=r.codePins.find(x=>path.resolve(x.path)===path.resolve(taskFile));assert.equal(hash(await fs.readFile(taskFile)),pin.sha256);const task=await import(pathToFileURL(taskFile));
 const result=await observeWitnessRequest(path.resolve(values.request),values.sha,{root:fixedWitnessRoot,binding,census:input=>task.taskPowerShell(fullCensusScript,input),writerToken:writerPid=>task.taskPowerShell(writerTokenScript,{writerPid}),observerIdentity:async()=>({...await task.currentPreparationIdentity(),processId:process.pid})});console.log(JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(JSON.stringify({status:'read-only-witness-blocked',error:String(e.stack??e),publicationPerformed:false}));process.exitCode=1;});
