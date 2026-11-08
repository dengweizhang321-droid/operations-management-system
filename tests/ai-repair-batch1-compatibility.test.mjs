import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {aiRepairBatch1Qualification as qualification} from '../tools/verify-release-candidate.mjs';

const artifacts='D:/codex-artifacts/ai-repair-batch1-20261107';
const image='sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d';
const runnerSource='fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08';
const labels={'teruisi.pi.workspace':'2','teruisi.pi.native-capabilities':'1','teruisi.pi.local-restore':'1'};
const pins={
 'python-syntax.json':'a3bb59b7b377b0fbaaab442a29a380926c62feddffb92da6c3ae423abdbec30b',
 'types-baseline.json':'ed9ca544879b064a83c580f7040b2a77ff96142a79340529893801599329fe82',
 'types-candidate.json':'b412e05e1cda767442407508b01edd631893cfbb0dd0c90050ca968e9f2704b8',
 'types-comparison-final.json':'850d7173bd49669746835521d2dfcaa132cce473f2d95499f748a438320a3ac0',
 'pi/W2-SOURCE.json':'260f62c6524ecdba8960ad3e47d451ba23241f85762f683cd9572675a0d7cb2a',
 'pi/W2-publisher.log':'cc58be428b667afdf234ea8b217c363160b137bc8457087eaeb904eb253d1b2f',
 'pi/W2-isolated-image-proof.json':'bb1f80a27e8e4ec5b6dbc62e1f64e5ee3f47c5877c9d2a8a9279e6157c7838a9',
 'pi/W2-isolated-image-build.log':'66bbba648136f3df92c453d009a5442d78f9f71552410100cff73a44ff040f2e',
 'pi/W2-R1-SOURCE.json':'4639edd8d6afab4724a13ffe8eacaf7391ccb3f7ff7c314a4c9db556f0e40103',
 'pi/W2-REVIEW.json':'4e6bbfe559b840779d8131c1f22e3e20f52d6002ec0cf32d0f9c1758e80c3e21',
 'pi/W1-REVIEW.json':'6a724291e7bdf278cdf8366b55ef20450e5fbe0fd97c928122609662607000ba',
 'pi/native-eca65643bedb.json':'b72ab0168cc6958a55e105115148c994f43701cc6c17bd72d67c9b0a9d41f8c1',
 'pi/W2-R1-real-django-v3.log':'46eca66a7a9f5efad95326c2cd9930d5a4885c2c6cc5298747c5583237743bf0',
 'pi/native-ea3f4e91d0cd.json':'e7452851b82969ce65c95b896765e589a8a445de1b5e57219e3d3958ab2d306b',
 'g02-pi-native-v3/NATIVE.json':'72c6f98b3a9959a225bab96dcf16e7622157834c41abb64c9819150e97622fc7',
 'g02-pi-native-v3/stdout.log':'68e6dff907d4bacb4e22b18c431dbd83b8423216fb6fcfe98d72db26598d436a',
 'g02-pi-native-v3/stderr.log':'b280c454d6f559e56eb3f5ed39f3ba084b8d1744a3ff7fe016b21ff86dea1aca',
};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const git=(...args)=>execFileSync('git',args,{windowsHide:true,maxBuffer:8*1024*1024});
const baseline=file=>git('show',qualification.base+':'+file);
const evidence=async(file,expected=pins[file])=>{
 assert.match(expected??'',/^[a-f0-9]{64}$/);
 const absolute=path.join(artifacts,file);
 const raw=await fs.readFile(absolute);
 assert.equal(sha(raw),expected,'原始证据摘要不符 '+file);
 return {raw,reference:{path:absolute,sha256:expected}};
};
const json=raw=>JSON.parse(raw.toString('utf8'));
const sourceSha=async file=>sha(await fs.readFile(file));
const rawSha=async file=>[file,await sourceSha(file)];

async function importClosure(entries,read){
 const found=new Set(),queue=[...entries];
 while(queue.length){
  const file=queue.shift();
  if(found.has(file))continue;
  found.add(file);
  const source=(await read(file)).toString('utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
   const next=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[2]));
   if(next.endsWith('.mjs'))queue.push(next);
  }
 }
 return [...found].sort();
}

async function imageFiles(root){
 const files=[];
 for(const entry of await fs.readdir(root,{withFileTypes:true})){
  if(['__pycache__','node_modules'].includes(entry.name))continue;
  const name=path.posix.join(root,entry.name);
  assert.ok(entry.isDirectory()||entry.isFile(),'镜像上下文包含特殊文件 '+name);
  files.push(...(entry.isDirectory()?await imageFiles(name):[name]));
 }
 return files;
}

test('fixed AI repair sources, publication closure and original evidence',async()=>{
 const roots=['tools/publish-prepared-main.mjs','tools/publish-main-resume.mjs'];
 const closure=await importClosure(roots,file=>fs.readFile(file));
 assert.deepEqual(closure,await importClosure(roots,baseline),'发布入口新增了未审依赖');
 for(const file of closure.filter(file=>!roots.includes(file)))assert.equal(await sourceSha(file),sha(baseline(file)),file);
 const publisher=await import('../tools/publish-prepared-main.mjs');
 const resume=await import('../tools/publish-main-resume.mjs');
 assert.equal(typeof publisher.verifyPreparedPiImageSelection,'function');
 assert.equal(typeof resume.resumeProtocol,'string');
 const controllers=['tools/worker-local-service.ps1','tools/operations-system-control.ps1','tools/operations-system-service.ps1',
  'tools/django-local-service.ps1','tools/django-runtime-supervisor.ps1','tools/django-ai.ps1','tools/manual-maintenance-continuation.mjs'];
 for(const file of controllers)assert.equal(await sourceSha(file),sha(baseline(file)),'启动/维护控制器原始字节变化 '+file);

 const read=async file=>json((await evidence(file)).raw);
 const typed=await read('types-comparison-final.json');
 const tsBase=await read('types-baseline.json'),tsCandidate=await read('types-candidate.json');
 assert.deepEqual([typed.baselineCount,typed.candidateCount,typed.added,typed.removed],[167,167,[],[]]);
 assert.deepEqual(tsBase.diagnostics,tsCandidate.diagnostics);
 assert.equal(tsBase.baseline,qualification.base);
 assert.equal(tsCandidate.baseline,qualification.base);
 const approvedTypeScript=git('diff','--name-only','-z',qualification.base,qualification.app).toString('utf8').split('\0')
  .filter(file=>/\.tsx?$/.test(file)).sort();
 assert.deepEqual(typed.files.map(member=>member.path).sort(),approvedTypeScript);
 for(const member of typed.files)assert.equal(await sourceSha(member.path),member.sha256,'TypeScript 来源漂移 '+member.path);
 const syntax=await read('python-syntax.json');
 const approvedPython=git('diff','--name-only','-z',qualification.base,qualification.app).toString('utf8').split('\0').filter(file=>file.endsWith('.py'));
 assert.deepEqual([...syntax.files].sort(),approvedPython.sort());
 assert.equal(syntax.count,approvedPython.length);
 assert.equal(syntax.status,'passed');
 // The original syntax list has no raw-byte binding. A targeted parse of
 // only those files fills that gap without rerunning app test suites.
 execFileSync(process.env.TERUISI_AI_BATCH1_PYTHON??'python',['-B','-c',
  'import ast,pathlib,sys\nfor file in sys.argv[1:]: ast.parse(pathlib.Path(file).read_bytes(), filename=file)',...approvedPython],{windowsHide:true});

 const runtimeFiles=(await Promise.all(['containers/pi-agent','backend/pi_runner/bundled_skills'].map(imageFiles))).flat().sort();
 assert.equal(runtimeFiles.length,63);
 const inputs=Object.fromEntries(await Promise.all(runtimeFiles.map(rawSha)));
 const build=await read('pi/W2-isolated-image-proof.json');
 assert.equal(build.inputsSha256,sha(Buffer.from(JSON.stringify(inputs))));
 assert.equal(build.runtimeLockSha256,inputs['containers/pi-agent/runtime-lock.json']);
 assert.equal(build.packageLockSha256,inputs['containers/pi-agent/package-lock.json']);
 assert.equal(build.image,image);
 assert.deepEqual(build.labels,labels);
 assert.equal(build.sourceCommit,null);
 assert.equal(build.sourceTree,null);
 const buildLog=(await evidence('pi/W2-isolated-image-build.log')).raw.toString('utf8');
 assert.ok(buildLog.includes(image)&&buildLog.includes(build.inputsSha256));
 const dockerfile=(await fs.readFile('containers/pi-agent/Dockerfile','utf8')).split(/\r?\n/);
 for(const copy of dockerfile.filter(line=>line.startsWith('COPY '))){
  const members=copy.split(/\s+/).slice(1,-1).filter(item=>!item.startsWith('--'));
  for(const member of members.filter(item=>!item.startsWith('.pi-build/'))){
   assert.ok(member in inputs||runtimeFiles.some(file=>file.startsWith(member+'/')),'镜像COPY来源缺项 '+member);
  }
 }

 const reviewed=await read('pi/W2-SOURCE.json');
 for(const file of [...roots,'tests/publish-prepared-main.test.mjs']){
  assert.equal(await sourceSha(file),reviewed.files[file]);
 }
 const orchestration=(await evidence('pi/W2-publisher.log')).raw.toString('utf8');
 assert.match(orchestration,/tests 118[\s\S]*pass 118[\s\S]*fail 0/);
 const finalPi=await read('pi/W2-R1-SOURCE.json');
 for(const [file,expected] of Object.entries(finalPi.files)){
  if(!file.startsWith('docs/'))assert.equal(await sourceSha(file),expected,'Pi 最终原件来源漂移 '+file);
 }
 assert.equal(finalPi.runnerSourceSha256,runnerSource);
 assert.equal(finalPi.candidateImage,image);
 assert.equal((await read('pi/W1-REVIEW.json')).status,'passed');
 assert.equal((await read('pi/W2-REVIEW.json')).status,'source-review-passed');
 for(const file of ['pi/native-eca65643bedb.json','pi/native-ea3f4e91d0cd.json']){
  const native=await read(file);
  assert.ok(native.tests.length&&native.tests.every(item=>item.status===0&&item.cleanup===0));
 }
 const realDjango=await evidence('pi/W2-R1-real-django-v3.log',finalPi.evidence['W2-R1-real-django-v3.log']);
 assert.ok(realDjango.raw.toString('utf8').includes('"realDockerUpgrade": true'));

 const native=await read('g02-pi-native-v3/NATIVE.json');
 const nativeStdout=await evidence('g02-pi-native-v3/stdout.log');
 const nativeStderr=await evidence('g02-pi-native-v3/stderr.log');
 const {fixtureSha256,gitArchiveSha256,process:nativeProcess,...nativeOriginal}=native;
 assert.deepEqual(nativeOriginal,json(nativeStdout.raw));
 assert.deepEqual(nativeProcess,{exitCode:0,stdoutSha256:nativeStdout.reference.sha256,stderrSha256:nativeStderr.reference.sha256});
 assert.equal(fixtureSha256,await sourceSha('tests/ai-repair-batch1-pi-native-start.py'));
 assert.equal(gitArchiveSha256,sha(git('archive',qualification.app,'backend/pi_runner')));
 assert.deepEqual([native.commit,native.tree,native.runnerSourceSha256,native.image,native.labels],
  [qualification.app,qualification.tree,runnerSource,image,labels]);
 assert.equal(native.status,'passed');
 assert.equal(native.emptyLedgerOnly,true);
 assert.equal(native.productionTouched,false);
 assert.match(native.namespace,/^pi-test-g02-[a-f0-9]{16}$/);
 assert.deepEqual(native.cleanup,{namespaceEmpty:true,portFree:true,processesExited:true,privateDirectoryRemoved:true});
 assert.deepEqual(native.records.map(record=>record.start),[1,2]);
 for(const record of native.records){
  assert.deepEqual(record.argv,[native.python,'-B','-m','pi_runner.server','--config',native.config,'--port',String(native.port)]);
  assert.equal(record.listenPortWasFree,true);
  assert.equal(record.termination.exitCode,0);
  assert.equal(record.termination.signal,'SIGTERM');
  assert.ok(record.termination.target.pid>0&&record.termination.target.procStartTicks>0);
  assert.deepEqual(record.signedHealth,{version:1,image,sourceSha256:runnerSource,namespace:native.namespace,activeCount:0,
   unresolvedCount:0,unsafeUnknownCount:0,unknownStoppedVerifiedCount:0,closing:false});
 }
 const [first,second]=native.records.map(record=>record.ledgerAfterExit);
 assert.deepEqual([first.path,first.device,first.inode],[second.path,second.device,second.inode]);
 assert.deepEqual([first.signedHealthNonceCount,second.signedHealthNonceCount],[1,2]);
 assert.notEqual(native.records[0].termination.target.pid,native.records[1].termination.target.pid);

 const references=files=>files.map(file=>({path:path.join(artifacts,file),sha256:pins[file]}));
 const output={
  frozenPublisherClosure:closure,unchangedControllers:await Promise.all(controllers.map(async file=>({path:file,sha256:await sourceSha(file)}))),
  imageInputs:{count:runtimeFiles.length,sha256:build.inputsSha256,image,labels},
  reusedEvidence:[
   {kind:'typescript-comparison',artifacts:references(['types-baseline.json','types-candidate.json','types-comparison-final.json']),
    baseline:tsCandidate.baseline,originalSourceHead:null,typescriptVersion:tsCandidate.typescriptVersion,originalExitCode:null,
    baselineDiagnostics:167,candidateDiagnostics:167,newDiagnostics:0,scope:'original changed TypeScript bytes; existing diagnostics remain'},
   {kind:'python-syntax-list',artifacts:references(['python-syntax.json']),originalStatus:syntax.status,originalSourceSha256:null,originalExitCode:null,
    supplementalExactSourceParseCount:approvedPython.length,scope:'original list matched; targeted AST parse performed on frozen Python inputs'},
   {kind:'pi-image-build',artifacts:references(['pi/W2-isolated-image-proof.json','pi/W2-isolated-image-build.log']),
    originalSourceCommit:build.sourceCommit,originalSourceTree:build.sourceTree,originalExitCode:null,image,
    scope:'actual isolated rootless build, 63 frozen context inputs; no formal PREPARED'},
   {kind:'publisher-orchestration',artifacts:references(['pi/W2-publisher.log','pi/W2-SOURCE.json','pi/W2-REVIEW.json']),
    originalTestsPassed:118,originalExitCode:null,scope:'prepare/resume fixtures, simulated native effects, unchanged entry and dependency bytes'},
   {kind:'pi-lifecycle-specialists',artifacts:references(['pi/W1-REVIEW.json','pi/W2-REVIEW.json','pi/W2-R1-SOURCE.json',
     'pi/native-eca65643bedb.json','pi/W2-R1-real-django-v3.log','pi/native-ea3f4e91d0cd.json']),
    runnerSourceSha256:finalPi.runnerSourceSha256,scope:'private rootless Docker and Django HMAC evidence, model replies synthetic'},
   {kind:'pi-runner-native-main',artifacts:references(['g02-pi-native-v3/NATIVE.json','g02-pi-native-v3/stdout.log','g02-pi-native-v3/stderr.log']),
    originalCommit:native.commit,originalTree:native.tree,originalExitCode:nativeProcess.exitCode,
    scope:'two original native main starts and signed readiness on the same empty isolated ledger; exact SIGTERM and cleanup'},
  ],
  scopedNativeEvidence:{piRunner:native},
 };
 if(process.env.TERUISI_AI_BATCH1_EVIDENCE_OUTPUT){
  await fs.writeFile(process.env.TERUISI_AI_BATCH1_EVIDENCE_OUTPUT,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
 }
});
