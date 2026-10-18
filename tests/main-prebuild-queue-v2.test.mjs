import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {submitPreparation,drainPreparationQueue,ticketResult,queuePipe,canonical,sha} from '../tools/main-prebuild-queue.mjs';
import {acquirePreparationRotationLock} from '../tools/worker-local-release-rotation.mjs';
const h=c=>c.repeat(64),a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),binding={configSha256:h('1'),bundleSha256:h('2')};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-v2-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));return root;}
const submit=(root,target=null,origin='hook')=>submitPreparation(root,{...binding,observedTarget:target,origin});
const selection=(root,target)=>({targetCommit:target,packet:path.join(root,'packet-'+target),live:{mainCommit:'0'.repeat(40),head:{bindingSha256:h('3')},djangoManifestSha256:h('4'),chainStateSha256:h('5')}});
async function prepared(selected){
 const packet=selected.packet,request={mainCommit:selected.targetCommit,predecessorWorker:selected.live.head,predecessorDjangoSha256:selected.live.djangoManifestSha256,components:['worker']};
 const file=path.join(packet,'publish-'+selected.targetCommit.slice(0,12),'preparation/PREPARED.json');await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));
 const bytes=JSON.stringify({version:'teruisi-main-preparation-v1',requestSha256:sha(JSON.stringify(request)),sourceIdentity:{commit:selected.targetCommit,tree:'6'.repeat(40)},workerPlan:{id:'private'},djangoPackage:null});
 await fs.writeFile(file,bytes);
 return {status:'prepared-only',mainCommit:selected.targetCommit,publicationPerformed:false,preparationFile:file,preparationSha256:sha(bytes)};
}
test('manual and hooks share one real kernel consumer, coalesce only undispatched targets',async t=>{
 const root=await fixture(t),first=await submit(root,a,'manual');let target=a,calls=0,second,third;
 const result=await drainPreparationQueue(root,{...binding,observe:async()=>selection(root,target),prepare:async selected=>{
  calls++;if(calls===1){second=await submit(root,b);third=await submit(root,c,'manual');target=c;
   assert.equal((await drainPreparationQueue(root,{...binding,observe:()=>assert.fail('parallel observe'),prepare:()=>assert.fail('parallel once')})).status,'queued');}
  return prepared(selected);
 }});
 assert.equal(calls,2);assert.equal(result.handled,3);
 assert.equal((await ticketResult(root,first.requestId,first.ticketSha256)).selectedTarget,a);
 assert.equal((await ticketResult(root,second.requestId,second.ticketSha256)).status,'superseded');
 assert.equal((await ticketResult(root,third.requestId,third.ticketSha256)).status,'prepared');
});
test('unknown native result and a later same-target event never replay preparation',async t=>{
 const root=await fixture(t),ticket=await submit(root,a);let calls=0;
 const callbacks={...binding,observe:async()=>selection(root,a),prepare:async()=>{calls++;throw Error('native child result unknown');}};
 await drainPreparationQueue(root,callbacks);assert.equal((await ticketResult(root,ticket.requestId,ticket.ticketSha256)).status,'unknown');
 const later=await submit(root,a);await drainPreparationQueue(root,callbacks);assert.equal(calls,1);assert.equal((await ticketResult(root,later.requestId,later.ticketSha256)).status,'blocked');
});
test('truncated canonical prepared cannot turn an unknown dispatch into a replay permit',async t=>{
 const root=await fixture(t),ticket=await submit(root,a);let calls=0;
 const callbacks={...binding,observe:async()=>selection(root,a),prepare:async()=>{calls++;throw Error('unknown');}};
 await drainPreparationQueue(root,callbacks);
 await fs.writeFile(path.join(root,'results',ticket.requestId+'.json'),canonical({version:'teruisi-main-prebuild-queue-v2',requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'prepared'}));
 await submit(root,a);await assert.rejects(drainPreparationQueue(root,callbacks),/schema/);assert.equal(calls,1);
});
test('missing dispatch dependency does not turn a retained unknown terminal into absence',async t=>{
 const root=await fixture(t),ticket=await submit(root,a);let calls=0;
 const callbacks={...binding,observe:async()=>selection(root,a),prepare:async()=>{calls++;throw Error('unknown');}};
 await drainPreparationQueue(root,callbacks);const result=await ticketResult(root,ticket.requestId,ticket.ticketSha256);
 await fs.rename(path.join(root,'dispatches',result.dispatchId+'.json'),path.join(root,'preserved-dispatch.json'));
 await submit(root,a);await assert.rejects(drainPreparationQueue(root,callbacks),error=>error.code==='ENOENT');assert.equal(calls,1);
});
test('native preparation receipt, dispatch tuple, config and code drift reject completion',async t=>{
 const root=await fixture(t),ticket=await submit(root,a);
 await drainPreparationQueue(root,{...binding,observe:async()=>selection(root,a),prepare:prepared});
 const resultFile=path.join(root,'results',ticket.requestId+'.json'),original=await fs.readFile(resultFile),value=JSON.parse(original);
 for(const key of ['dispatchSha256','selectedTarget','configSha256','bundleSha256']){
  const mutated={...value,[key]:key==='selectedTarget'?b:h('9')};await fs.writeFile(resultFile,canonical(mutated));
  await assert.rejects(ticketResult(root,ticket.requestId,ticket.ticketSha256));
 }
 await fs.writeFile(resultFile,original);await fs.appendFile(value.nativeResult.preparationFile,' ');
 await assert.rejects(ticketResult(root,ticket.requestId,ticket.ticketSha256),/receipt changed/);
});
test('generation change, partial dispatch and unknown filename fail before once',async t=>{
 for(const mode of ['generation','partial','filename']){
  const root=await fixture(t);await submit(root,a);let calls=0;
  if(mode==='partial')await fs.writeFile(path.join(root,'dispatches',randomUUID()+'.json'),'{');
  if(mode==='filename')await fs.writeFile(path.join(root,'dispatches','interrupted.tmp'),'partial');
  await assert.rejects(drainPreparationQueue(root,{...binding,assertGeneration:async()=>{if(mode==='generation')throw Error('generation changed');},observe:async()=>selection(root,a),prepare:async()=>{calls++;}}));assert.equal(calls,0);
 }
});
test('crash before dispatch remains queued; after durable dispatch becomes unknown without once replay',async t=>{
 for(const stage of ['before-dispatch','after-dispatch','before-prepare']){
  const root=await fixture(t);await submit(root,a);const marker=path.join(root,'effect');
  const module=new URL('../tools/main-prebuild-queue.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs/promises';import{drainPreparationQueue}from ${JSON.stringify(module)};await drainPreparationQueue(${JSON.stringify(root)},{...${JSON.stringify(binding)},observe:async()=>(${JSON.stringify(selection(root,a))}),prepare:async()=>{await fs.writeFile(${JSON.stringify(marker)},'effect');throw Error('unknown');},onStage:async stage=>{if(stage===${JSON.stringify(stage)})process.exit(19);}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});assert.equal(await new Promise(resolve=>child.once('exit',resolve)),19);
  let calls=0;await drainPreparationQueue(root,{...binding,observe:async()=>selection(root,a),prepare:async selected=>{calls++;return prepared(selected);}});
  assert.equal(calls,stage==='before-dispatch'?1:0);await assert.rejects(fs.access(marker));
 }
});
test('real native lock waits only before callback, default remains fail-fast',async t=>{
 const pipe='\\\\.\\pipe\\TERUISI.Test.Rotation.'+randomUUID(),server=createServer(socket=>socket.destroy());await new Promise(resolve=>server.listen(pipe,resolve));t.after(()=>{try{server.close();}catch{}});
 await assert.rejects(acquirePreparationRotationLock(pipe),/EADDRINUSE/);
 setTimeout(()=>server.close(),20);
 const unlock=await acquirePreparationRotationLock(pipe,{requestId:h('a'),deadlineUnixMs:Date.now()+3000});await unlock();
 const next=await acquirePreparationRotationLock(pipe);await next();
});
test('deadline crossing at listen delivery and diagnostic exceptions both release acquired lock',async()=>{
 let now=0,released=0;
 await assert.rejects(acquirePreparationRotationLock('private',{requestId:h('a'),deadlineUnixMs:10},{now:()=>now,listen:async()=>{now=11;return async()=>{released++;};}}),error=>error.code==='ROTATION_WAIT_EXPIRED_NO_CALLBACK'&&error.evidence.callbackEntered===false);
 assert.equal(released,1);now=0;
 await assert.rejects(acquirePreparationRotationLock('private',{requestId:h('a'),deadlineUnixMs:10},{now:()=>now,listen:async()=>async()=>{released++;},log:()=>{throw Error('diagnostic failure');}}),/diagnostic failure/);assert.equal(released,2);
 let attempts=0;
 await assert.rejects(acquirePreparationRotationLock('private',{requestId:h('a'),deadlineUnixMs:10},{now:()=>now,listen:async()=>{attempts++;const error=Error('denied');error.code='EACCES';throw error;}}),/EACCES/);assert.equal(attempts,1);
});
test('only the same full predecessor selection and control generation expose retained preparation',async t=>{
 for(const change of ['same','chain','config','bundle']){
  const root=await fixture(t);await submit(root,a);const original=selection(root,a);
  await drainPreparationQueue(root,{...binding,observe:async()=>original,prepare:prepared});
  const next=structuredClone(original),nextBinding={...binding};
  if(change==='chain')next.live.chainStateSha256=h('9');
  if(change==='config')nextBinding.configSha256=h('9');
  if(change==='bundle')nextBinding.bundleSha256=h('9');
  await submitPreparation(root,{...nextBinding,origin:'hook',observedTarget:a});
  let exposed;
  await drainPreparationQueue(root,{...nextBinding,observe:async()=>next,prepare:async(selected,dispatch,reusable)=>{exposed=reusable;return prepared(selected);}});
  assert.equal(Boolean(exposed),change==='same',change);
 }
});
