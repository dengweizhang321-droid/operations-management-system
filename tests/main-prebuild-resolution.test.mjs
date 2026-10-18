import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {knownPreNativeRefusal,assertKnownRefusalTuple,privateRefusalResolutionAdapter,readKnownRefusalResolution} from '../tools/main-prebuild-resolution.mjs';
import {submitPreparation,durableCreate,canonical,sha,readQueueObject,drainPreparationQueue,ticketResult} from '../tools/main-prebuild-queue.mjs';
import {decodedControlCommand} from '../tools/main-prebuild-task.mjs';
const h=c=>c.repeat(64),git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pre-native-resolution-')),state=path.join(root,'state'),directory=path.join(state,'prebuild-queue-v2'),packet=path.join(root,'packet'),source=path.join(packet,'source');
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.writeFile(path.join(source,'tools/publish-main.mjs'),'// private native refusal fixture\n');git(source,['init','-q']);git(source,['add','.']);git(source,['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','private']);
 const target=git(source,['rev-parse','HEAD']),sourceTree=git(source,['rev-parse','HEAD^{tree}']),binding={configSha256:h('1'),bundleSha256:h('2')},ticket=await submitPreparation(directory,{origin:'manual',observedTarget:target,...binding});
 const live={mainCommit:'0'.repeat(40),head:{bindingSha256:h('3')},chainStateSha256:h('4'),djangoManifestSha256:h('5')},dispatch={version:'teruisi-main-prebuild-queue-v2',dispatchId:randomUUID(),requestId:ticket.requestId,mode:'prepare-only',...binding,selectedTarget:target,selection:{live,packet,targetCommit:target},tickets:[{requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:target}],dispatchedAt:new Date().toISOString(),deadlineUnixMs:1};
 const dispatchSha256=await durableCreate(path.join(directory,'dispatches',dispatch.dispatchId+'.json'),dispatch),unknown={version:dispatch.version,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'unknown',at:new Date().toISOString(),...binding,dispatchId:dispatch.dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:ticket.requestId,error:'original pre-native refusal'},resultSha256=await durableCreate(path.join(directory,'results',ticket.requestId+'.json'),unknown);
 await fs.mkdir(path.join(packet,'invocations'));await fs.mkdir(path.join(packet,'logs'));await fs.writeFile(path.join(packet,'logs/refusal.log'),'private administrator refusal');
 const request={mainCommit:target,predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256};await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));await fs.writeFile(path.join(packet,'release-scope-plan.json'),'{}');
 const k={dispatchId:dispatch.dispatchId,requestId:ticket.requestId,target,sourceTree,dispatchSha256,ticketSha256:ticket.ticketSha256,resultSha256,log:'refusal.log',logSha256:sha(await fs.readFile(path.join(packet,'logs/refusal.log'))),requestSha256:sha(JSON.stringify(request)),planSha256:sha('{}'),publisherSha256:sha(await fs.readFile(path.join(source,'tools/publish-main.mjs')))};
 const installId=randomUUID(),intent={bundleSha256:h('6'),configSha256:h('7')},intentFile=path.join(state,'control-upgrades',installId,'INTENT.json');await fs.mkdir(path.dirname(intentFile),{recursive:true});const intentSha256=await durableCreate(intentFile,intent);
 await fs.mkdir(path.join(state,'control-executions'));await fs.writeFile(path.join(state,'control-executions',randomUUID()+'.json'),JSON.stringify({version:'teruisi-main-control-execution-v2',commandLineSha256:h('8'),executableSha256:h('9'),bundleSha256:binding.bundleSha256,pid:4194303,createdAt:'2020-01-01T00:00:00Z'}));
 const control={config:{stateDirectory:state},state:{preparationTask:{},installId,intentSha256,...intent}},adapter=privateRefusalResolutionAdapter(directory,k),options={getLive:async()=>live,assertGeneration:async()=>{}};
 return {root,state,directory,packet,source,k,control,adapter,options,dispatch,dispatchSha256,ticket,binding};
}
test('exact refusal tuple does not accept another operation, target, or native terminal',()=>{
 const k=knownPreNativeRefusal,d={dispatchId:k.dispatchId,requestId:k.requestId,selectedTarget:k.target,mode:'prepare-only',tickets:[{requestId:k.requestId,ticketSha256:k.ticketSha256}],configSha256:h('1'),bundleSha256:h('2')},u={status:'unknown',dispatchId:k.dispatchId,dispatchSha256:k.dispatchSha256,requestId:k.requestId,selectedTarget:k.target,ticketSha256:k.ticketSha256,configSha256:h('1'),bundleSha256:h('2')};assert.doesNotThrow(()=>assertKnownRefusalTuple(d,u));for(const delta of [{status:'prepared'},{dispatchId:randomUUID()},{selectedTarget:'a'.repeat(40)},{dispatchSha256:h('0')}])assert.throws(()=>assertKnownRefusalTuple(d,{...u,...delta}));
});
test('private exact resolution preserves unknown and releases only its dispatch for a new final target',async t=>{
 const f=await fixture(t),original=await fs.readFile(path.join(f.directory,'results',f.ticket.requestId+'.json'));
 assert.equal((await f.adapter.close(f.control,f.options)).status,'closed-before-native');assert.equal((await f.adapter.close(f.control,f.options)).status,'already-closed-before-native');
 assert.deepEqual(await fs.readFile(path.join(f.directory,'results',f.ticket.requestId+'.json')),original);assert.equal((await ticketResult(f.directory,f.ticket.requestId,f.ticket.ticketSha256)).status,'unknown');
 const resolution=await f.adapter.read(f.dispatch,f.dispatchSha256);assert.equal(resolution.status,'closed-before-native');assert.equal(JSON.stringify(resolution).includes('nativeResult'),false);
 await fs.copyFile(path.join(f.directory,'resolutions',f.dispatch.dispatchId+'.json'),path.join(f.directory,'resolutions',knownPreNativeRefusal.dispatchId+'.json'));await assert.rejects(readKnownRefusalResolution(f.directory,{...f.dispatch,dispatchId:knownPreNativeRefusal.dispatchId},f.dispatchSha256));
 const current={configSha256:h('6'),bundleSha256:h('7')},next=await submitPreparation(f.directory,{origin:'manual',...current});let calls=0;
 await drainPreparationQueue(f.directory,{...current,resolutionReader:(_directory,dispatch,digest)=>f.adapter.read(dispatch,digest),observe:async()=>({targetCommit:'a'.repeat(40),live:f.dispatch.selection.live,packet:path.join(f.root,'final')}),prepare:async selected=>{calls++;assert.notEqual(selected.targetCommit,f.k.target);return {status:'already-current',targetCommit:selected.targetCommit,currentCommit:selected.targetCommit,publicationPerformed:false};}});
 assert.equal(calls,1);assert.equal((await ticketResult(f.directory,next.requestId,next.ticketSha256)).status,'current');assert.deepEqual(await fs.readFile(path.join(f.directory,'results',f.ticket.requestId+'.json')),original);
});
test('native marker, changed predecessor, original tamper, and actual multiply encoded late process block closure',async t=>{
 for(const kind of ['native','predecessor','tamper','encoded-late','execution-missing'])await t.test(kind,async t=>{
  const f=await fixture(t);let child;
  if(kind==='native')await fs.mkdir(path.join(f.packet,'publish-'+f.k.target.slice(0,12)));
  if(kind==='predecessor')f.options.getLive=async()=>({...f.dispatch.selection.live,mainCommit:'f'.repeat(40)});
  if(kind==='execution-missing'){const dir=path.join(f.state,'control-executions'),name=(await fs.readdir(dir))[0];await fs.writeFile(path.join(dir,name),JSON.stringify({bundleSha256:f.binding.bundleSha256,pid:4194303,createdAt:'2020-01-01T00:00:00Z'}));}
  if(kind==='tamper')await fs.appendFile(path.join(f.source,'tools/publish-main.mjs'),'// changed');
  if(kind==='encoded-late'){const inner=Buffer.from('powershell '+f.packet,'utf16le').toString('base64'),encoded=Buffer.from("[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('"+inner+"'))",'utf16le').toString('base64');assert.ok(decodedControlCommand(encoded).includes(f.packet.replaceAll('\\','/').toLowerCase()));child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',encoded],{windowsHide:true,stdio:'ignore'});await new Promise(r=>child.once('spawn',r));t.after(()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();}));}
  await assert.rejects(f.adapter.close(f.control,f.options));await assert.rejects(fs.access(path.join(f.directory,'resolutions',f.dispatch.dispatchId+'.json')),{code:'ENOENT'});
 });
});
