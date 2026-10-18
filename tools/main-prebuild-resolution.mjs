/** One exact pre-native administrator refusal. Original unknown is never rewritten. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {acquireQueueLock,readQueueObject,durableCreate,sha,canonical} from './main-prebuild-queue.mjs';
import {createHash} from 'node:crypto';
import {taskPowerShell,decodedControlCommand} from './main-prebuild-task.mjs';
const execute=promisify(execFile),exists=async file=>{try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export const knownPreNativeRefusal=Object.freeze({dispatchId:'e2a76305-5a58-4814-8418-a35270a55efe',requestId:'d4dbd5aa-56b0-4705-834b-d6ee7dff1c79',target:'4b733d1aed4bdc619adccb37debd61d57f1ce6fb',sourceTree:'14530af2f3e2aded71c6a06c25461538c975afcb',
 dispatchSha256:'d3fb28ce5a7f62c57c0be3d4d533d8eaa33f63ff1159332042ce3faed68649d2',ticketSha256:'9257a54490f074083525a9e2eeb83cd5139ce0092673973a7917ff74b45aabd9',resultSha256:'ac8b2ed476f023098ac1f7f291d48ab7da4012edd6b1d6204ac8d66a2b9f604f',
 requestSha256:'018141b5fa288e4f2f6806e5d5e1b5fd5faed34838a50199e5f66656a4b0718c',planSha256:'0d665f8766c8e63511ce97a73b1dc04f98365a2f9e58fcc2601ea992190858fb',publisherSha256:'2a79dc481b8a2fc26eee6ccc271854e739c0c3a5614ed19cb0d4dd7557a607f2',
 log:'release-2026-10-18T09-44-54.221Z-26cbf96e-b964-4529-908a-842a0a60904f.log',logSha256:'d3e598fa55e83240e2f0f472eb2b4e46af610a25795a05935c7cfc80a751bdc3'});
async function physical(file,directory=false){assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Resolution evidence redirected');const stat=await fs.lstat(file);assert.ok(!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile()&&stat.nlink===1),'Unsafe resolution evidence');return stat;}
async function bytes(file){const before=await physical(file),raw=await fs.readFile(file),after=await physical(file);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(before[key],after[key],'Resolution evidence changed');return raw;}
async function git(root,args){return (await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout.trim();}
export function assertKnownRefusalTuple(dispatch,unknown,k=knownPreNativeRefusal){
 assert.equal(dispatch.dispatchId,k.dispatchId);assert.equal(dispatch.requestId,k.requestId);assert.equal(dispatch.selectedTarget,k.target);assert.equal(dispatch.mode,'prepare-only');
 assert.equal(unknown.status,'unknown');assert.equal(unknown.dispatchId,k.dispatchId);assert.equal(unknown.dispatchSha256,k.dispatchSha256);assert.equal(unknown.requestId,k.requestId);assert.equal(unknown.selectedTarget,k.target);
 assert.equal(dispatch.tickets.length,1);assert.equal(dispatch.tickets[0].requestId,k.requestId);assert.equal(dispatch.tickets[0].ticketSha256,k.ticketSha256);
 assert.equal(unknown.ticketSha256,k.ticketSha256);assert.equal(unknown.bundleSha256,dispatch.bundleSha256);assert.equal(unknown.configSha256,dispatch.configSha256);
}
async function originalEvidence(directory,k=knownPreNativeRefusal){
 await physical(directory,true);
 const dispatch=await readQueueObject(path.join(directory,'dispatches',k.dispatchId+'.json')),ticket=await readQueueObject(path.join(directory,'tickets',k.requestId+'.json')),result=await readQueueObject(path.join(directory,'results',k.requestId+'.json'));
 assert.equal(dispatch.sha256,k.dispatchSha256);assert.equal(ticket.sha256,k.ticketSha256);assert.equal(result.sha256,k.resultSha256);assertKnownRefusalTuple(dispatch.value,result.value,k);
 const packet=dispatch.value.selection.packet,source=path.join(packet,'source');await physical(packet,true);await physical(source,true);
 assert.deepEqual((await fs.readdir(packet)).sort(),['invocations','logs','main-release-request.json','release-scope-plan.json','source'],'Native preparation/deployment artifacts exist; refusal cannot be closed');
 await physical(path.join(packet,'invocations'),true);assert.deepEqual(await fs.readdir(path.join(packet,'invocations')),[],'Original invocation has a result or new effect');
 await physical(path.join(packet,'logs'),true);assert.deepEqual(await fs.readdir(path.join(packet,'logs')),[k.log]);
 const files={'main-release-request.json':k.requestSha256,'release-scope-plan.json':k.planSha256,['logs/'+k.log]:k.logSha256,'source/tools/publish-main.mjs':k.publisherSha256};
 for(const [name,digest] of Object.entries(files))assert.equal(sha(await bytes(path.join(packet,...name.split('/')))),digest,'Original refusal evidence changed: '+name);
 assert.equal(await git(source,['rev-parse','HEAD']),k.target);assert.equal(await git(source,['rev-parse','HEAD^{tree}']),k.sourceTree);assert.equal(await git(source,['status','--porcelain']),'','Original source changed');
 const members=(await git(source,['ls-files','-z'])).split('\0').filter(Boolean),inventory=[];
 const tree=(await git(source,['ls-tree','-r','-z','HEAD'])).split('\0').filter(Boolean).map(line=>{const match=/^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert.ok(match,'Unsupported original source entry');return [match[2],match[1]];});assert.deepEqual(members.slice().sort(),tree.map(([name])=>name).sort());
 const objects=new Map(tree);for(const name of members){const raw=await bytes(path.join(source,...name.split('/'))),blob=content=>createHash('sha1').update(Buffer.from('blob '+content.length+'\0')).update(content).digest('hex');
  assert.ok(blob(raw)===objects.get(name)||(name.endsWith('.bat')&&blob(Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n')))===objects.get(name)),'Original source differs from committed Git object: '+name);inventory.push({path:name,sha256:sha(raw)});}
 const request=JSON.parse(await bytes(path.join(packet,'main-release-request.json')));assert.equal(request.mainCommit,k.target);assert.deepEqual(request.predecessorWorker,dispatch.value.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.value.selection.live.djangoManifestSha256);
 return {dispatch:dispatch.value,dispatchSha256:dispatch.sha256,ticketSha256:ticket.sha256,resultSha256:result.sha256,files,sourceInventorySha256:sha(canonical(inventory)),sourceTree:k.sourceTree};
}
async function noLateProcesses(directory,original){
 const stateDirectory=path.dirname(directory),executionDirectory=path.join(stateDirectory,'control-executions'),executions=[];
 await physical(executionDirectory,true);
 for(const name of await fs.readdir(executionDirectory)){assert.match(name,/^[a-f0-9-]{36}\.json$/);const raw=await bytes(path.join(executionDirectory,name)),value=JSON.parse(raw);if(value.bundleSha256===original.dispatch.bundleSha256)executions.push({file:name,sha256:sha(raw),pid:value.pid,createdAt:value.createdAt});}
 assert.ok(executions.length,'Original control execution evidence missing');
 const frames=[];
 for(let round=0;round<2;round++){
  const rows=await taskPowerShell(`@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath,@{Name='createdAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Depth 3 -Compress`);
  const normalize=s=>(s??'').replaceAll('\\','/').toLowerCase(),packet=normalize(original.dispatch.selection.packet),oldBundle=normalize(path.join(stateDirectory,'control-bundles',original.dispatch.bundleSha256));
  const related=new Map(),byPid=new Map(rows.map(row=>[row.ProcessId,row]));
  for(const row of rows){if(row.ProcessId===process.pid)continue;const command=decodedControlCommand(row.CommandLine);if(command.includes(packet)||command.includes(oldBundle))related.set(row.ProcessId,row);
   for(const execution of executions){if(row.ProcessId===execution.pid){assert.ok(row.createdAt,'Original controller creation identity unknown');if(Date.parse(row.createdAt)===Date.parse(execution.createdAt))related.set(row.ProcessId,row);}
    if(row.ParentProcessId===execution.pid){const parent=byPid.get(execution.pid),childBirth=Date.parse(row.createdAt),originalBirth=Date.parse(execution.createdAt);assert.ok(Number.isFinite(childBirth)&&Number.isFinite(originalBirth),'Potential original descendant identity unknown');if(childBirth>=originalBirth&&(!parent||Date.parse(parent.createdAt)===originalBirth||childBirth<Date.parse(parent.createdAt)))related.set(row.ProcessId,row);}}
  }
  for(let changed=true;changed;){changed=false;for(const row of rows)if(related.has(row.ParentProcessId)&&!related.has(row.ProcessId)){related.set(row.ProcessId,row);changed=true;}}
  for(const row of related.values())assert.ok(row.CommandLine&&row.ExecutablePath&&row.createdAt,'Related process metadata unknown');
  assert.equal(related.size,0,'Original preparation controller, encoded launcher or late descendant remains');
  frames.push({at:new Date().toISOString(),processSnapshotSha256:sha(canonical(rows)),noRelatedProcesses:true});if(round===0)await new Promise(r=>setTimeout(r,250));
 }
 return {executions,frames};
}
export async function readKnownRefusalResolution(directory,dispatch,dispatchSha256){return readResolution(directory,dispatch,dispatchSha256,knownPreNativeRefusal);}
async function readResolution(directory,dispatch,dispatchSha256,k){
 if(dispatch.dispatchId!==k.dispatchId)return null;
 const file=path.join(directory,'resolutions',dispatch.dispatchId+'.json');if(!await exists(file))return null;
 const resolution=(await readQueueObject(file)).value;
 assert.deepEqual(Object.keys(resolution).sort(),['at','control','original','processes','status','version']);assert.equal(resolution.version,'teruisi-main-pre-native-resolution-v1');assert.equal(resolution.status,'closed-before-native');
 assert.equal(dispatchSha256,k.dispatchSha256);assert.deepEqual(resolution.original,await originalEvidence(directory,k));
 assert.ok(resolution.processes.executions.length&&resolution.processes.frames.length===2&&resolution.processes.frames.every(f=>f.noRelatedProcesses===true));
 const control=resolution.control;assert.ok(/^[a-f0-9-]{36}$/.test(control.installId));
 const intent=JSON.parse(await bytes(path.join(path.dirname(directory),'control-upgrades',control.installId,'INTENT.json')));assert.equal(sha(await bytes(path.join(path.dirname(directory),'control-upgrades',control.installId,'INTENT.json'))),control.intentSha256);assert.equal(intent.bundleSha256,control.bundleSha256);assert.equal(intent.configSha256,control.configSha256);
 return resolution;
}
export async function inspectKnownPreNativeRefusal(directory){return originalEvidence(directory);}
export async function closeKnownPreNativeRefusal(binding,options={}){return closeRefusal(binding,options,knownPreNativeRefusal);}
export function privateRefusalResolutionAdapter(directory,k){
 const root=path.resolve(process.env.TEMP??process.env.TMP),relative=path.relative(root,path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Private test queue required');
 return {read:(dispatch,digest)=>readResolution(directory,dispatch,digest,k),close:(binding,options)=>{assert.equal(path.resolve(binding.config.stateDirectory,'prebuild-queue-v2'),path.resolve(directory));return closeRefusal(binding,options,k);}};
}
async function closeRefusal(binding,{getLive,assertGeneration}={},k){
 assert.ok(binding.state.preparationTask&&getLive&&assertGeneration,'Controlled close requires live predecessor verification');
 const directory=path.join(binding.config.stateDirectory,'prebuild-queue-v2'),unlock=await acquireQueueLock(directory);assert.ok(unlock,'Preparation queue busy; no resolution written');
 try{
  await assertGeneration();const original=await originalEvidence(directory,k),prior=await readResolution(directory,original.dispatch,original.dispatchSha256,k);if(prior)return {status:'already-closed-before-native',publicationPerformed:false};
  const live=await getLive(binding.config);assert.deepEqual(live,original.dispatch.selection.live,'Original predecessor changed; cannot close refusal');
  const processes=await noLateProcesses(directory,original);await assertGeneration();assert.deepEqual(await originalEvidence(directory,k),original,'Original evidence drifted before resolution');
  const record={version:'teruisi-main-pre-native-resolution-v1',status:'closed-before-native',at:new Date().toISOString(),original,processes,control:{installId:binding.state.installId,intentSha256:binding.state.intentSha256,bundleSha256:binding.state.bundleSha256,configSha256:binding.state.configSha256}};
  await fs.mkdir(path.join(directory,'resolutions'),{recursive:true});await durableCreate(path.join(directory,'resolutions',original.dispatch.dispatchId+'.json'),record);
  return {status:'closed-before-native',dispatchId:original.dispatch.dispatchId,originalStatus:'unknown',originalTargetPrepared:false,publicationPerformed:false};
 }finally{await unlock();}
}
