import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateNativeToolsUpdate,successor512NativeToolsPins,codeOnlyNativeToolsPins} from '../tools/install-main-prebuild.mjs';
import {canonical,sha,assertFixedInstaller0038NoReplay,installer0038Originals,assertInstaller0038Packet,readFixedInstallerCheckRejection0038Resolution,validateInstaller0038Observation,validateInstaller0038LiveEvidence,schemaCensusProjection,fixedInstallerCheckRejection0038 as fixed} from '../tools/main-prebuild-queue.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),state=fixed.state,configSha=fixed.configSha256;
async function privateRoot(t){const base=path.join(root,'tmp');await fs.mkdir(base,{recursive:true});const p=await fs.mkdtemp(path.join(base,'installer0038-control-'));t.after(async()=>{assert.ok(path.resolve(p).startsWith(root+path.sep));await fs.rm(p,{recursive:true,force:true});});return p;}
test('exact native v2 retains all v1 tools except the unique reviewed successor literal',async t=>{
 const p=await privateRoot(t),beforeFiles=Object.fromEntries(Object.entries(codeOnlyNativeToolsPins).map(([n,pin])=>[n,pin.after])),afterFiles=Object.fromEntries(Object.entries(successor512NativeToolsPins).map(([n,pin])=>[n,pin.after])),before=path.join(p,'native-tools',sha(Buffer.from(canonical(beforeFiles)))),after=path.join(p,'native-tools',sha(Buffer.from(canonical(afterFiles))));
 await fs.mkdir(path.join(before,'tools'),{recursive:true});await fs.mkdir(path.join(after,'tools'),{recursive:true});
 for(const name of Object.keys(afterFiles)){const raw=await fs.readFile(path.join(state,'native-tools',sha(Buffer.from(canonical(beforeFiles))),name));assert.equal(sha(raw),beforeFiles[name]);await fs.writeFile(path.join(before,name),raw);let candidate=raw;if(name.endsWith('rotation.mjs')){const text=raw.toString();assert.equal(text.split('const maximumSuccessors = 256;').length,2);candidate=Buffer.from(text.replace('const maximumSuccessors = 256;','const maximumSuccessors = 512;'));assert.deepEqual(Buffer.from(candidate.toString().replace('const maximumSuccessors = 512;','const maximumSuccessors = 256;')),raw);}assert.equal(sha(candidate),afterFiles[name]);await fs.writeFile(path.join(after,name),candidate);}
 const config={stateDirectory:p,nativeToolsSource:before,unrelated:'preserved'},update={version:'teruisi-successor-512-native-tools-update-v2',oldConfigSha256:configSha,nativeToolsSource:after};assert.deepEqual(await validateNativeToolsUpdate(update,config,configSha),{...config,nativeToolsSource:after});
 for(const change of [{version:'teruisi-code-only-native-tools-update-v1'},{version:'unknown'},{extra:true},{nativeToolsSource:path.join(p,'arbitrary')}])await assert.rejects(validateNativeToolsUpdate({...update,...change},config,configSha));
 await assert.rejects(validateNativeToolsUpdate({...update,oldConfigSha256:'a'.repeat(64)},config,'a'.repeat(64)),/exact installed publisher/);await assert.rejects(validateNativeToolsUpdate(update,{...config,nativeToolsSource:path.join(p,'source')},configSha),/predecessor/);
 const file=path.join(after,'tools/worker-local-release.mjs'),raw=await fs.readFile(file);await fs.appendFile(file,'\n');await assert.rejects(validateNativeToolsUpdate(update,config,configSha),/candidate bytes/);await fs.writeFile(file,raw);
 await fs.writeFile(path.join(after,'tools/extra.mjs'),'extra');await assert.rejects(validateNativeToolsUpdate(update,config,configSha),/member set/);await fs.unlink(path.join(after,'tools/extra.mjs'));
 const predecessor=path.join(before,'tools/worker-local-release-rotation.mjs'),old=await fs.readFile(predecessor);await fs.appendFile(predecessor,'\n');await assert.rejects(validateNativeToolsUpdate(update,config,configSha),/predecessor bytes/);await fs.writeFile(predecessor,old);
 assert.deepEqual(await validateNativeToolsUpdate(update,config,configSha),{...config,nativeToolsSource:after});
});
test('0038 complete original await/import closure is exact and corruption rejects',async()=>{
 const original=await installer0038Originals();assert.equal(original.objects.size,99);const mapping=new Map(Object.entries(original.files).map(([file,digest])=>[path.resolve(file),original.objects.get(digest)]));
 for(const target of [path.join(state,'prebuild-queue-v2/results',fixed.requestId+'.json'),path.join(fixed.packet,'source/tools/pi_native_candidate.py'),path.join(fixed.packet,'source/tools/jackyun_audit_catalog.py'),path.join(state,'control-bundles',fixed.bundleSha256,'tools/main-schema-release.mjs')])await assert.rejects(installer0038Originals({read:async file=>{const raw=mapping.get(path.resolve(file));assert.ok(raw);return path.resolve(file)===path.resolve(target)?Buffer.concat([raw,Buffer.from('\n')]):raw;}}),/original changed/);
 assert.equal(await readFixedInstallerCheckRejection0038Resolution(path.join(root,'private-queue'),original.dispatch,original.terminal),false);
 assert.equal(await readFixedInstallerCheckRejection0038Resolution(path.join(state,'prebuild-queue-v2'),{...original.dispatch,dispatchId:'00000000-0000-0000-0000-000000000000'},original.terminal),false);
 await assert.rejects(readFixedInstallerCheckRejection0038Resolution(path.join(state,'prebuild-queue-v2'),{...original.dispatch,selectedTarget:'0'.repeat(40)},original.terminal));
 await assert.rejects(readFixedInstallerCheckRejection0038Resolution(path.join(state,'prebuild-queue-v2'),original.dispatch,{...original.terminal,error:'changed'}));
});
test('0038 packet preserves source and empty schema effects; rejects new native/request members and redirects',async t=>{
 const p=await privateRoot(t);await fs.mkdir(path.join(p,'source'));await fs.mkdir(path.join(p,'schema'));assert.equal((await assertInstaller0038Packet({packet:p})).schemaDirectoryCreated,true);
 await fs.writeFile(path.join(p,'schema/evidence.json'),'{}');await assert.rejects(assertInstaller0038Packet({packet:p}),/schema binding has effects/);await fs.unlink(path.join(p,'schema/evidence.json'));
 await fs.writeFile(path.join(p,'main-release-request.json'),'{}');await assert.rejects(assertInstaller0038Packet({packet:p}),/gained a request/);await fs.unlink(path.join(p,'main-release-request.json'));
 await fs.rmdir(path.join(p,'schema'));await fs.symlink(path.join(p,'source'),path.join(p,'schema'),'junction');await assert.rejects(assertInstaller0038Packet({packet:p}));await fs.unlink(path.join(p,'schema'));
});
function observation(){const at='2026-10-20T12:00:00.000Z',writer={processId:20001,creationDate:at,commandLine:'node private writer',executablePath:'C:/Program Files/nodejs/node.exe'},observer={...writer,processId:20002,commandLine:'node private observer'},rows=[writer,observer].map((r,i)=>({...r,parentProcessId:i+100,name:'node.exe'})),r={version:fixed.version,dispatchId:fixed.dispatchId,phase:'final',nonce:'a'.repeat(32),at,epoch:{id:'00000000-0000-0000-0000-000000000000',startedAt:at,writerPid:writer.processId},deadlineUnixMs:Date.parse(at)+1200000,writer,writerToken:{sid:'private',elevated:false,integrityRid:8192,sessionId:1},sourceIdentity:{commit:'a'.repeat(40),tree:'b'.repeat(40),status:''},operatorSource:root,operatorSha256:'c'.repeat(64),adoptionSha256:'d'.repeat(64),task:{},staticSha256:'e'.repeat(64)},o={version:fixed.version,requestSha256:sha(Buffer.from(canonical(r))),nonce:r.nonce,phase:r.phase,at:'2026-10-20T12:00:01.000Z',dynamicStartedAt:at,writer,observer,observerToken:{...r.writerToken,elevated:true,integrityRid:12288},operatorSha256:r.operatorSha256,adoptionSha256:r.adoptionSha256,staticSha256:r.staticSha256,taskState:3,taskInstances:0,census:schemaCensusProjection(rows),relatedControllers:[],originalActorAbsent:true};return {r,o};}
test('0038 witness rejects stale, wrong privilege/task/generation, actor-present and altered identities',()=>{
 const {r,o}=observation();assert.equal(validateInstaller0038Observation(o,r),o);
 for(const edit of [v=>v.nonce='b'.repeat(32),v=>v.requestSha256='0'.repeat(64),v=>v.at='2026-10-20T12:02:01.000Z',v=>v.observerToken.elevated=false,v=>v.observerToken.sessionId=2,v=>v.taskState=4,v=>v.taskInstances=1,v=>v.adoptionSha256='f'.repeat(64),v=>v.staticSha256='f'.repeat(64),v=>v.relatedControllers=[123],v=>v.originalActorAbsent=false,v=>v.census.push({processId:7544,parentProcessId:0,name:'node.exe',creationDate:'2026-10-20T04:05:59.1478630Z',commandLineSha256:'0'.repeat(64),executablePathSha256:'1'.repeat(64),controlCandidate:true}),v=>v.census[0].creationDate='2026-10-20T11:00:00.000Z']){const v=structuredClone(o);edit(v);assert.throws(()=>validateInstaller0038Observation(v,r));}
 const bad=structuredClone(r);bad.writerToken.elevated=true;assert.throws(()=>validateInstaller0038Observation(o,bad));
});

test('0038 live evidence rejects fake SUCCESS and mixed Worker/Django/source bindings',()=>{
 const success={status:'deployed_and_ready',mainCommit:fixed.liveCommit,workerRelease:'exact-live-release',workerManifestSha256:'a'.repeat(64),djangoManifestSha256:'b'.repeat(64),source:fixed.liveSource,sourceTree:'c'.repeat(40)},worker={source:{sourceBinding:{raw:JSON.stringify({sourceRoot:fixed.liveSource})},tree:{sha256:'d'.repeat(64),fileCount:1}}},django={sourceRoot:fixed.liveSource},live={successSha256:fixed.liveSuccessSha256,head:{releaseId:success.workerRelease,manifestSha256:success.workerManifestSha256},workerManifestSha256:success.workerManifestSha256,djangoManifestSha256:success.djangoManifestSha256,source:fixed.liveSource,sourceIdentity:{commit:fixed.liveCommit,tree:success.sourceTree,status:''},chainStateSha256:'e'.repeat(64),sourceTree:worker.source.tree};
 assert.equal(validateInstaller0038LiveEvidence(live,success,worker,django),true);
 for(const edit of [v=>v.live.successSha256='f'.repeat(64),v=>v.success.status='prepared',v=>v.success.mainCommit=fixed.target,v=>v.live.sourceIdentity.status=' M changed',v=>v.live.head.manifestSha256='f'.repeat(64),v=>v.worker.source.sourceBinding.raw=JSON.stringify({sourceRoot:root}),v=>v.django.sourceRoot=root,v=>v.live.sourceTree={...v.live.sourceTree,sha256:'f'.repeat(64)}]){const v=structuredClone({live,success,worker,django});edit(v);assert.throws(()=>validateInstaller0038LiveEvidence(v.live,v.success,v.worker,v.django));}
});

test('0038 permanent no-replay applies only to its exact queue/target',()=>{
 assert.throws(()=>assertFixedInstaller0038NoReplay(path.join(fixed.state,'prebuild-queue-v2'),{targetCommit:fixed.target}),/permanently terminated/);
 assert.doesNotThrow(()=>assertFixedInstaller0038NoReplay(path.join(fixed.state,'prebuild-queue-v2'),{targetCommit:'a'.repeat(40)}));
 assert.doesNotThrow(()=>assertFixedInstaller0038NoReplay(path.join(root,'private-queue'),{targetCommit:fixed.target}));
});

test('0038 PID reuse accepts only children born strictly after the proven reused parent',()=>{
 const {r,o}=observation(),parent={processId:7544,parentProcessId:100,name:'node.exe',creationDate:'2026-10-20T11:00:00.000Z',commandLineSha256:'0'.repeat(64),executablePathSha256:'1'.repeat(64),controlCandidate:true},child={...parent,processId:7545,parentProcessId:7544,creationDate:'2026-10-20T11:00:01.000Z'};
 const good=structuredClone(o);good.census.push(parent,child);assert.equal(validateInstaller0038Observation(good,r),good);
 for(const birth of ['2026-10-20T04:06:00.000Z',parent.creationDate,null,'invalid']){const bad=structuredClone(o);bad.census.push(parent,{...child,creationDate:birth});assert.throws(()=>validateInstaller0038Observation(bad,r));}
 const absent=structuredClone(o);absent.census.push(child);assert.throws(()=>validateInstaller0038Observation(absent,r));
 const original=structuredClone(o);original.census.push({...parent,creationDate:'2026-10-20T04:05:59.1478630Z'},child);assert.throws(()=>validateInstaller0038Observation(original,r));
});
