/** Only the fixed G02 profile runs this private proof; it never starts a service. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {aiRepairBatch2Adapter,aiRepairBatch2Reviewed,aiRepairBatch2Qualification,assertAiRepairBatch2Bytes,
 candidateCompatibilityProfile,comparePandasRotationInventoryOnly,pandasRotationPackageEntries,windowsPowerShellEnvironment} from '../tools/verify-release-candidate.mjs';
import {maintenanceReadiness,maintenanceSourceNames} from '../tools/manual-maintenance-continuation.mjs';
import {pandasArguments} from '../tools/publish-main-pandas.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const artifacts='D:/codex-artifacts/ai-repair-batch2-20261108';
const baseline=aiRepairBatch2Qualification.base;
const read=file=>fs.readFile(path.join(source,file));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:source,windowsHide:true,maxBuffer:16*1024*1024});
const gitRead=file=>git('show',baseline+':'+file);
const changes=Object.entries({...aiRepairBatch2Reviewed,...aiRepairBatch2Adapter}).map(([path,status])=>({path,status}));
const reviewed=Object.keys(aiRepairBatch2Reviewed);
const pins=Object.freeze({
 'types-comparison.json':'2eb089ac5367212955cf77eb92b793c0fb76cf3bbf6386eb634019c92a382cbf',
 'types-final.log':'8c3983d782235e50313ca5f746cdb292ff92b61146885c00b108d2327f4c59de',
 'w5/r1/W5-R1-REVIEW.json':'503e092b664784bebf7ba9cca936c91b32544a6e1c25cd09596bbc549bda42c8',
 'w6b/W6B-REVIEW.json':'d32f03a1775c7ab3b91618021f0b1733ec1474b18a5559a61a215e2f86ae0dac',
 'w8/W8-REVIEW.json':'5ea8451165cf0a3421922e14e17a93238d4385cd1f90c86dc74dd6f2bfbe2317',
 'w9/W9-REVIEW.json':'abe32f72eefe97b666fd24494c5be79e74a6251e76de555fde368624d6f2a75d',
 'environment/IMAGE.json':'66f865b9da47f2a5f14660dace2da3265402d4aa3c84fc3413c03c467ea91546',
 'w6r/native-run-05.stdout':'ed13edf7c8032c898ad9d2af95222cf0c4b8f6a09c961539229fe959716fcb93',
 'w6r/native-run-05.stderr':'b280c454d6f559e56eb3f5ed39f3ba084b8d1744a3ff7fe016b21ff86dea1aca',
 'w6r/native-rehearsal-observed.json':'1fd28207a4aeeb49ffae2a7e63fc279e2fd572a0bd1ed62d6c78ec641c750ea2',
 'w6r/windows-startup-seam.txt':'a85976093d526461f2788be62e08c0b0a36e6e4915997d61dfdb42a614e96c5f',
 'w6r/windows-ps-fixture-01.txt':'8ab74e89dad6957b7b58f5023940fd23dc337fbfec96c4dea6888d016025a43c',
 'w6r/windows-startup-seam-cleanup.json':'4ae66d4057bdb63dc8eb8380ca29f4ee29f4a7ba05cc55a3741ce0b0577e842b',
 'w6r/W6R-runtime-freeze.json':'5c64aa4e82ee967c3b9bf63e8b9e5aeea4055c68c781b3216227583be4732863',
});
async function original(file){
 const absolute=path.join(artifacts,file),raw=await fs.readFile(absolute),sha256=sha(raw);
 assert.equal(sha256,pins[file],'原件漂移：'+file);
 return {raw,path:absolute,sha256};
}
const parse=raw=>JSON.parse(raw.toString('utf8'));
async function privateRoot(t){
 const base=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(base,'g02-batch2-'));
 t.after(async()=>{
  assert.equal(path.dirname(await fs.realpath(root)),base);
  assert.ok(path.basename(root).startsWith('g02-batch2-'));
  await fs.rm(root,{recursive:true});
 });
 return root;
}

test('batch 2 profile refuses wrong base, unknown path, omission, deletion, rename and byte drift',async()=>{
 const accepts=(rows,baseCommit=baseline)=>candidateCompatibilityProfile(rows,{baseCommit}).aiRepairBatch2Only===true;
 assert.ok(accepts(changes));
 assert.ok(accepts([...changes,{path:'docs/ai-repair-batch2-20261108/HANDOFF.md',status:'A'}]));
 assert.equal(accepts(changes,'0'.repeat(40)),false);
 for(const rows of [
  changes.slice(1),
  [...changes,{path:'tools/unknown-batch2-module.mjs',status:'A'}],
  [...changes,{path:'docs/ai-repair-batch2-20261108/removed.md',status:'D'}],
  [...changes,{path:'tests/renamed.mjs',before:'tests/original.mjs',status:'R100'}],
  [...changes,changes[0]],
 ]){
  assert.equal(accepts(rows),false);
  assert.ok(candidateCompatibilityProfile(rows,{baseCommit:baseline}).unsupported.length>0);
 }
 const payload=await Promise.all(changes.filter(change=>change.path!=='tools/verify-release-candidate.mjs')
  .map(async ({path:file})=>({path:file,sha256:sha(await read(file))})));
 assertAiRepairBatch2Bytes(payload);
 assert.throws(()=>assertAiRepairBatch2Bytes([{...payload[0],sha256:'0'.repeat(64)},...payload.slice(1)]),/字节/);
 assert.throws(()=>assertAiRepairBatch2Bytes(payload.slice(1)),/缺少/);
 const local='tools/django-local-service.ps1',prior=gitRead(local).toString('utf8'),next=(await read(local)).toString('utf8');
 assert.ok(comparePandasRotationInventoryOnly(prior,next));
 assert.equal(comparePandasRotationInventoryOnly(prior,next.replace(pandasRotationPackageEntries[0],'not-the-operator.py')),false);
});

test('batch 2 maintenance only admits the directional predecessor pair with the original Worker bridge',async t=>{
 const root=await privateRoot(t),installed=path.join(root,'django/app'),runtime=path.join(root,'worker'),candidate=path.join(root,'candidate');
 const releaseId='batch2-private-predecessor',release=path.join(runtime,'releases',releaseId);
 const ai='django-ai.ps1',django='django-local-service.ps1',worker='worker-local-service.ps1',transport='process-deadline.ps1';
 await Promise.all([installed,release,candidate].map(folder=>fs.mkdir(path.join(folder,'tools'),{recursive:true})));
 for(const [folder,names] of [[installed,[ai,django]],[release,[worker,transport]]])
  for(const name of names)await fs.writeFile(path.join(folder,'tools',name),gitRead('tools/'+name));
 for(const name of [...maintenanceSourceNames,ai,django,worker,transport])
  await fs.writeFile(path.join(candidate,'tools',name),await read('tools/'+name));
 const dm=Buffer.from('private Django predecessor'),wm=Buffer.from('private Worker predecessor');
 await fs.writeFile(path.join(installed,'deployment.json'),dm);
 await fs.writeFile(path.join(release,'deployment-manifest.json'),wm);
 const run=()=>maintenanceReadiness({source:candidate,head:{releaseId,manifestSha256:sha(wm)},djangoManifestSha256:sha(dm),installed,runtime});
 const result=await run();
 assert.equal(result.route,'native-exit-observer');
 for(const name of [ai,django,worker,transport])assert.equal(result.pins.find(pin=>pin.root==='source'&&pin.relative===name)?.sha256,sha(await read('tools/'+name)));
 for(const [folder,name] of [[installed,django],[candidate,django],[release,worker],[candidate,transport],[installed,ai],[candidate,ai]]){
  const file=path.join(folder,'tools',name),raw=await fs.readFile(file);
  await fs.writeFile(file,Buffer.concat([raw,Buffer.from('\r\n# private unknown generation\r\n')]));
  await assert.rejects(run,/Pandas|前驱|资格/);
  await fs.writeFile(file,raw);
 }
 for(const name of [ai,django]){
  await fs.writeFile(path.join(installed,'tools',name),await read('tools/'+name));
  await fs.writeFile(path.join(candidate,'tools',name),gitRead('tools/'+name));
 }
 await assert.rejects(run,/前驱|资格/);
});

async function relativeClosure(entries,readFile){
 const seen=new Set(),queue=[...entries];
 while(queue.length){
  const file=queue.shift();
  if(seen.has(file))continue;
  seen.add(file);
  const text=(await readFile(file)).toString('utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
   const target=path.posix.join(path.posix.dirname(file),match[2]);
   assert.match(target,/^tools\/[^/]+\.mjs$/,'意外发布导入：'+target);
   queue.push(target);
  }
 }
 return [...seen].sort();
}
async function packageDigest(paths,readFile){
 const hash=createHash('sha256');
 for(const file of paths.filter(name=>/^backend\/pandas_runner\/(?!test_)[^/]+\.py$/.test(name)).sort()){
  hash.update(path.posix.basename(file)+'\0').update(await readFile(file));
 }
 return hash.digest('hex');
}

test('batch 2 frozen source, actual PowerShell entry and pinned original evidence',async t=>{
 const output=process.env.TERUISI_AI_BATCH2_EVIDENCE_OUTPUT,python=process.env.TERUISI_AI_BATCH2_PYTHON;
 const shells=[process.env.TERUISI_AI_BATCH2_PS5,process.env.TERUISI_AI_BATCH2_PS7];
 assert.ok(output&&python&&shells.every(Boolean),'此检查由第二批固定G02入口派发');
 const roots=['tools/publish-prepared-main.mjs','tools/publish-main-resume.mjs'];
 const before=await relativeClosure(roots,gitRead),after=await relativeClosure(roots,read);
 assert.deepEqual(after.filter(file=>!before.includes(file)),['tools/publish-main-pandas.mjs']);
 assert.deepEqual(before.filter(file=>!after.includes(file)),[]);
 for(const file of before.filter(file=>!reviewed.includes(file)&&!(file in aiRepairBatch2Adapter)))
  assert.equal(sha(await read(file)),sha(gitRead(file)),file);
 assert.equal(typeof (await import('../tools/publish-prepared-main.mjs')).publishPreparedMain,'function');
 assert.equal(typeof (await import('../tools/publish-main-resume.mjs')).resumeMainPublication,'function');
 const py=reviewed.filter(file=>file.endsWith('.py'));
 execFileSync(python,['-B','-c','import ast,sys; from pathlib import Path; [ast.parse(Path(f).read_bytes(), filename=f) for f in sys.argv[1:]]',...py],{cwd:source,timeout:30000,windowsHide:true});

 const runtime=await privateRoot(t),controller=path.join(source,'tools/django-ai.ps1');
 const prepared={preparedAppId:'b'.repeat(32),preparedAppSha256:'d'.repeat(64),sourceCommit:'a'.repeat(40),configured:true,registeredPlanSha256:'c'.repeat(64)};
 const owner={maintenanceId:'e'.repeat(32),ownerPid:4321};
 const cases=[
  ['PreparePandasRotation','Invoke-PandasRotationPreparation $false',undefined,false],
  ['PandasRotationCheck','Invoke-PandasRotationPreparation $true',undefined,true],
  ['SwitchPandasRotation','Invoke-PandasRotationSwitch',owner,true],
  ['CompletePandasRotation','Complete-PandasRotation',owner,true],
 ];
 for(const [index,shell] of shells.entries()){
  const invoke=(action,args)=>spawnSync(shell,['-NoProfile','-NonInteractive','-File',path.join(source,'tests/ai-repair-batch2-powershell-entry.ps1'),
   '-Controller',controller,'-PrivateRoot',runtime,'-RequestedAction',action],{cwd:source,windowsHide:true,encoding:'utf8',timeout:30000,
    env:{...(index===0?windowsPowerShellEnvironment(process.env):process.env),TERUISI_AI_BATCH2_PANDAS_ARGS:JSON.stringify(args)}});
  for(const [action,dispatch,operation,configured] of cases){
   const child=invoke(action,pandasArguments({...prepared,configured},operation));
   assert.equal(child.status,17,child.error?.message??child.stderr);
   assert.deepEqual(JSON.parse(child.stdout),{action,runtime,binding:{
    preparedAppId:prepared.preparedAppId,preparedAppSha256:prepared.preparedAppSha256,sourceCommit:prepared.sourceCommit,
    registeredPlanSha256:configured?prepared.registeredPlanSha256:'',maintenanceId:operation?.maintenanceId??'',publicationOwnerPid:operation?.ownerPid??0,
   },json:true,dispatch:'Invoke-WithServiceMutex { '+dispatch+' }'});
  }
  const bad=invoke('SwitchPandasRotation',pandasArguments(prepared,{...owner,ownerPid:'invalid'}));
  assert.equal(bad.status,1,bad.error?.message??bad.stderr);
  assert.equal(bad.stdout.trim(),'');
  // Windows PowerShell can hard-wrap parameter names on deep checkout paths.
  const diagnostic=bad.stderr.replace(/\r?\n/g,'');
  assert.match(diagnostic,/PandasPublicationOwnerPid/);
  assert.match(diagnostic,/System\.Int32/);
  assert.deepEqual(await fs.readdir(runtime),[],'参数夹具不得产生运行文件');
 }

 const reusedEvidence=[];
 const typed=await original('types-comparison.json'),typeLog=await original('types-final.log');
 const types=parse(typed.raw);
 assert.equal(types.baselineCommit,baseline);
 assert.deepEqual([types.baselineDiagnostics,types.candidateDiagnostics,types.added,types.removed,types.fullTypecheckPassed],[167,167,[],[],false]);
 assert.equal(types.candidateLogSha256,typeLog.sha256);
 const typeBasePath='D:/codex-artifacts/ai-repair-batch1-20261107/types-baseline.json';
 const typeBaseSha=sha(await fs.readFile(typeBasePath));
 assert.equal(types.baselineEvidenceSha256,typeBaseSha);
 const typedCommit='f64a8cca65b6a77b8c4a800725eff0dc1f5b19bc';
 for(const file of reviewed.filter(file=>/\.tsx?$/.test(file)))
  assert.equal(sha(await read(file)),sha(git('show',typedCommit+':'+file)),'类型检查后来源变化：'+file);
 const reference=({path,sha256})=>({path,sha256});
 reusedEvidence.push({kind:'typescript-diagnostic-comparison',scope:'Baseline diagnostics retained; zero added or removed. Full typecheck did not pass.',
  artifacts:[reference(typed),reference(typeLog),{path:typeBasePath,sha256:typeBaseSha}]});
 for(const [file,key,status] of [
  ['w5/r1/W5-R1-REVIEW.json','commit','passed'],
  ['w6b/W6B-REVIEW.json','sourceCommit','passed_source_and_synthetic_real_container_evidence'],
  ['w8/W8-REVIEW.json','codeCommitReportedByCoordinator','passed'],
  ['w9/W9-REVIEW.json','reviewedCommit','passed'],
 ]){
  const receipt=await original(file),record=parse(receipt.raw),commit=record[key];
  assert.equal(record.status,status);
  assert.match(commit,/^[0-9a-f]{8,40}$/);
  git('merge-base','--is-ancestor',commit,'HEAD');
  reusedEvidence.push({kind:'independent-work-package-review',status,commit,artifacts:[reference(receipt)]});
 }
 const imageEvidence=await original('environment/IMAGE.json'),observed=await original('w6r/native-rehearsal-observed.json');
 const stdout=await original('w6r/native-run-05.stdout'),stderr=await original('w6r/native-run-05.stderr');
 const runtimeFreeze=await original('w6r/W6R-runtime-freeze.json'),frozen=parse(runtimeFreeze.raw);
 for(const [file,digest] of Object.entries(frozen.filesSha256))if(!file.startsWith('docs/'))
  assert.equal(sha(await read(file)),digest,'W6R原件来源漂移：'+file);
 for(const name of ['native05Exit','windowsUnconfiguredNativeExit','windowsStartupSeamExit'])assert.equal(frozen.checks[name],0);
 for(const file of ['native-run-05.stdout','native-run-05.stderr','native-rehearsal-observed.json',
  'windows-startup-seam.txt','windows-ps-fixture-01.txt','windows-startup-seam-cleanup.json'])
  assert.equal(frozen.evidenceSha256[file],pins['w6r/'+file]);
 const native=parse(observed.raw),image=parse(imageEvidence.raw);
 assert.equal(native.nativeRun.exitCode,0);
 assert.equal(native.nativeRun.stdoutSha256,stdout.sha256);
 assert.equal(native.nativeRun.stderrSha256,stderr.sha256);
 assert.equal(native.distro,'Codex-AI-Batch2-20261108');
 assert.equal(image.distro,native.distro);
 assert.equal(native.port,18129);
 assert.equal(native.zeroListener,true);
 assert.equal(native.zeroContainers,true);
 for(const [file,digest] of Object.entries(native.sourceSha256))assert.equal(sha(await read(file)),digest,file);
 assert.deepEqual(Object.keys(native.sourceSha256).sort(),['tests/pandas-broker-rotation-native.py','tools/pandas_broker_rotation_linux.py']);
 const [happy,intent,reload]=stdout.raw.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.deepEqual([happy.scenario,intent.scenario,reload.scenario],['happy','intent','reload']);
 assert.equal(happy.image,image.image);
 assert.equal(happy.rootlessUser,1000);
 for(const key of ['zeroContainers','sameLedgerReplayRejected','repeatCompletionReused'])assert.equal(happy[key],true);
 for(const failure of [intent,reload]){
  assert.equal(failure.preservedIntent,true);
  assert.equal(failure.replayRejected,true);
 }
 for(const name of ['happy','intent','reload']){
  const state=native.units[name];
  assert.equal(state.unit,'teruisi-pandas-w6r-'+name+'.service');
  assert.deepEqual(state.status,{MainPID:'0',ActiveState:'inactive',SubState:'dead',NeedDaemonReload:'no'});
 }
 const publicReceipts=native.units.happy.originalPublicReceipts,switched=publicReceipts['switched.json'],completed=publicReceipts['result.json'];
 assert.deepEqual([switched.status,switched.switched,switched.started],['switched_stopped',true,false]);
 assert.deepEqual([completed.status,completed.completed,completed.postconditionsVerified],['ready_verified',true,true]);
 for(const key of ['image','intentSha256','maintenanceId','predecessorSourceSha256','preparedAppId','preparedAppSha256',
  'publicationOwnerPid','registeredPlanSha256','sourceCommit','sourceSha256'])assert.equal(switched[key],completed[key]);
 assert.equal(completed.startupReceiptSha256,happy.startupReceiptSha256);
 assert.equal(completed.sourceSha256,happy.successor);
 assert.equal(completed.predecessorSourceSha256,happy.predecessor);
 assert.equal(completed.image,happy.image);
 const oldFiles=git('ls-tree','-rz','--name-only',baseline,'--','backend/pandas_runner').toString('utf8').split('\0');
 const newFiles=(await fs.readdir(path.join(source,'backend/pandas_runner'))).map(name=>'backend/pandas_runner/'+name);
 assert.equal(await packageDigest(oldFiles,gitRead),happy.predecessor);
 assert.equal(await packageDigest(newFiles,read),happy.successor);
 assert.deepEqual([happy.predecessor,happy.successor],[frozen.predecessorBroker,frozen.successorBroker]);
 assert.notEqual(happy.predecessor,happy.successor);
 assert.deepEqual(native.realJournalStages.map(stage=>stage.stage).sort(),happy.realDiagnosticStages);
 assert.ok(native.realJournalStages.every(stage=>stage.status==='ok'));
 const seamProof=await original('w6r/windows-startup-seam.txt'),unconfiguredProof=await original('w6r/windows-ps-fixture-01.txt');
 const seamCleanup=await original('w6r/windows-startup-seam-cleanup.json');
 assert.deepEqual(parse(seamCleanup.raw),{unit:'teruisi-pandas-w6r-windows-seam.service',
  state:{MainPID:'0',ActiveState:'inactive',SubState:'dead'},zeroListener:true,zeroContainers:true});
 const seam=parse(seamProof.raw),absent=JSON.parse(unconfiguredProof.raw.toString('utf8').trim().split(/\r?\n/).at(-1));
 assert.deepEqual(seam.nativeCalls,['setup','startup-check','start','identity','status-probe','self-test','identity','complete','complete']);
 assert.equal(seam.windowsKeepaliveAndPublicationLeaseFixture,true);
 assert.equal(seam.repeatCompletionReused,true);
 assert.ok(seam.actualPowerShellFunctions.includes('Start-PandasSandbox')&&seam.actualPowerShellFunctions.includes('Complete-PandasRotation'));
 assert.ok(Number.isInteger(seam.startup.processIdentity.pid)&&seam.startup.processIdentity.pid>0);
 assert.equal(seam.startup.switch.sourceSha256,happy.successor);
 assert.equal(seam.startup.switch.intentSha256,seam.completed.intentSha256);
 assert.deepEqual([seam.startup.signedStatus.status,seam.startup.signedStatus.selfTest,seam.startup.signedStatus.image],['ready',false,happy.image]);
 assert.deepEqual([seam.startup.signedSelfTest.status,seam.startup.signedSelfTest.selfTest,seam.startup.signedSelfTest.image],['ready',true,happy.image]);
 assert.deepEqual([seam.completed.status,seam.completed.completed,seam.completed.postconditionsVerified],['ready_verified',true,true]);
 assert.ok(absent.closureVerified&&absent.removedConfiguredPlanRejected&&absent.checked.checked);
 assert.deepEqual([absent.prepared.prepared,absent.prepared.started,absent.prepared.configured,absent.prepared.sourceSha256],[true,false,false,happy.successor]);
 await fs.writeFile(output,JSON.stringify({reusedEvidence,frozenPublisherClosure:{before,after,
  scope:'Frozen publisher and resume module closure; added helper verified separately in actual Django package. Existing installed inventory gap remains.'},
  scopedNativeEvidence:{pandasBroker:{status:'passed',scope:'Private root/systemd and UID 1000 Broker rotation, original signed probes, retained ledger and exact stopped cleanup; actual Windows Pandas start/completion functions with keepalive, lease and deployment guards simulated. Full Windows lifecycle not executed.',
   distro:native.distro,port:native.port,image:happy.image,predecessorSourceSha256:happy.predecessor,sourceSha256:happy.successor,
   startupReceiptSha256:happy.startupReceiptSha256,nativeRun:native.nativeRun,
   artifacts:[runtimeFreeze,imageEvidence,observed,stdout,stderr,seamProof,seamCleanup,unconfiguredProof].map(reference)}}},null,2)+'\n',{flag:'wx'});
});
