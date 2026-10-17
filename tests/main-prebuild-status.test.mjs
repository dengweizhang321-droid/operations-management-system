import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPreparationStatus,watchPreparation,popupCommand} from '../tools/main-prebuild-status.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-status-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config={stateDirectory:path.join(root,'state'),releaseDirectory:path.join(root,'packets')};await fs.mkdir(config.stateDirectory);
 const target='a'.repeat(40),packet=path.join(config.releaseDirectory,'a-packet'),attempt=path.join(packet,'publish-'+target.slice(0,12)),preparation=path.join(attempt,'preparation');await fs.mkdir(preparation,{recursive:true});
 const request={mainCommit:target,latestMainRelease:true,components:['worker']};
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));
 const pointerFile=path.join(config.stateDirectory,'LATEST-PREPARED.json');await fs.writeFile(pointerFile,JSON.stringify({targetCommit:target,packet}));
 const receipt={version:'teruisi-main-preparation-v1',requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),sourceIdentity:{commit:target,tree:'b'.repeat(40)},workerPlan:{},djangoPackage:null};
 const ready=()=>fs.writeFile(path.join(preparation,'PREPARED.json'),JSON.stringify(receipt));
 return {root,config,target,packet,attempt,preparation,pointerFile,receipt,ready,options:{getLatest:async()=>target}};
}
test('absent pointer, old target and no preparation cannot display ready',async t=>{
 const f=await fixture(t);assert.equal((await readPreparationStatus(f.config,f.options)).status,'waiting');
 await f.ready();assert.equal((await readPreparationStatus(f.config,{getLatest:async()=>'c'.repeat(40)})).status,'waiting');
 await fs.unlink(f.pointerFile);assert.equal((await readPreparationStatus(f.config,f.options)).status,'waiting');
});
test('shows incomplete and failed records without changing any original files',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.preparation,'PREPARING.json'),'original');
 assert.equal((await readPreparationStatus(f.config,f.options)).status,'preparing');
 await fs.writeFile(path.join(f.preparation,'FAILED-original.json'),'original');assert.equal((await readPreparationStatus(f.config,f.options)).status,'failed');
 await f.ready();assert.equal((await readPreparationStatus(f.config,f.options)).status,'failed','a later reuse failure must override the retained PREPARED marker');
 assert.equal(await fs.readFile(path.join(f.preparation,'PREPARING.json'),'utf8'),'original');
});
test('ready is bound to exact request, commit and component receipts',async t=>{
 const f=await fixture(t);await f.ready();const result=await readPreparationStatus(f.config,f.options);assert.equal(result.status,'prepared');assert.equal(result.publicationPerformed,false);
 const original=structuredClone(f.receipt);
 for(const change of [()=>f.receipt.requestSha256='0'.repeat(64),()=>f.receipt.sourceIdentity.commit='c'.repeat(40),()=>f.receipt.workerPlan=null]){
  f.receipt.requestSha256=original.requestSha256;f.receipt.sourceIdentity=structuredClone(original.sourceIdentity);f.receipt.workerPlan={};
  change();await f.ready();await assert.rejects(readPreparationStatus(f.config,f.options));
 }
});
test('a new local main arriving during ready sampling cannot display old main ready',async t=>{
 const f=await fixture(t);await f.ready();let calls=0;
 const result=await readPreparationStatus(f.config,{getLatest:async()=>++calls===1?f.target:'c'.repeat(40)});assert.equal(result.status,'waiting');assert.equal(result.targetCommit,'c'.repeat(40));
});
for(const record of ['STARTED.json','FAILED-new.json'])test('a terminal record arriving while PREPARED is read suppresses completion: '+record,async t=>{
 const f=await fixture(t);await f.ready();const original=fs.readFile.bind(fs);
 t.mock.method(fs,'readFile',async(...args)=>{const raw=await original(...args);if(path.basename(String(args[0]))==='PREPARED.json')await fs.writeFile(path.join(record.startsWith('FAILED')?f.preparation:f.attempt,record),'original late record');return raw;});
 const result=await readPreparationStatus(f.config,f.options);assert.equal(result.status,record.startsWith('FAILED')?'failed':'attention');
});
for(const record of ['STARTED.json','FAILED-ref-read.json'])test('a terminal record arriving during the main-ref recheck suppresses completion: '+record,async t=>{
 const f=await fixture(t);await f.ready();let calls=0;
 const result=await readPreparationStatus(f.config,{getLatest:async()=>{if(++calls===2)await fs.writeFile(path.join(record.startsWith('FAILED')?f.preparation:f.attempt,record),'original late record');return f.target;}});
 assert.equal(result.status,record.startsWith('FAILED')?'failed':'attention');
});
test('unknown deployment overrides a prepared package; success is only a historical record',async t=>{
 const f=await fixture(t);await f.ready();await fs.writeFile(path.join(f.attempt,'STARTED.json'),'unknown');assert.equal((await readPreparationStatus(f.config,f.options)).status,'attention');
 await fs.writeFile(path.join(f.attempt,'SUCCESS.json'),JSON.stringify({mainCommit:f.target,status:'deployed_and_ready'}));assert.equal((await readPreparationStatus(f.config,f.options)).status,'published-record');
});
test('packet outside release root is rejected',async t=>{
 const f=await fixture(t);await fs.writeFile(f.pointerFile,JSON.stringify({targetCommit:f.target,packet:f.root}));await assert.rejects(readPreparationStatus(f.config,f.options));
});
test('watch waits across main changes, notifies exact completed version once and never publishes',async()=>{
 const states=[{status:'queued',targetCommit:'a'.repeat(40)},{status:'preparing',targetCommit:'b'.repeat(40)},{status:'prepared',targetCommit:'b'.repeat(40),publicationPerformed:false}];
 let sleeps=0;const notices=[],lines=[];
 const result=await watchPreparation({}, {readState:async()=>states.shift(),sleep:async()=>{sleeps++;},notify:async state=>notices.push(state),write:s=>lines.push(s)});
 assert.equal(sleeps,2);assert.equal(notices.length,1);assert.equal(notices[0].targetCommit,'b'.repeat(40));assert.equal(result.publicationPerformed,false);assert.match(lines[0],/不打包、不发布/);
});
test('partial pointer read is never success; notification failure cannot change prepared state',async()=>{
 let n=0;const lines=[];
 const result=await watchPreparation({}, {readState:async()=>{if(n++===0)throw Error('partial write');return {status:'prepared',targetCommit:'a'.repeat(40)};},sleep:async()=>{},notify:async()=>{throw Error('desktop unavailable');},write:s=>lines.push(s)});
 assert.equal(result.status,'prepared');assert.match(lines.join('\n'),/不能判定打包完成/);assert.match(lines.join('\n'),/提醒未启动/);
});
test('one-shot and published-record observations never launch a popup',async()=>{
 for(const options of [{once:true},{readState:async()=>({status:'published-record'})}])await watchPreparation({}, {readState:async()=>({status:'prepared'}),notify:async()=>assert.fail('unexpected notification'),write:()=>{},...options});
});
test('desktop command only shows a local message with a validated commit, never a release command',()=>{
 const command=popupCommand({status:'prepared',targetCommit:'a'.repeat(40)}),code=Buffer.from(command.args.at(-1),'base64').toString('utf16le');
 assert.match(code,/WScript.Shell/);assert.match(code,/打包完成/);assert.match(code,/手动发布/);assert.doesNotMatch(code,/Start-Process|Invoke-Expression|\.bat['"]|deploy-only/);
 assert.throws(()=>popupCommand({status:'queued',targetCommit:'a'.repeat(40)}));assert.throws(()=>popupCommand({status:'prepared',targetCommit:"';evil"}));
});
