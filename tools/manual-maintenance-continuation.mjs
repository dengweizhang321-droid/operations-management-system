/** One finite bridge for the installed pre-wait controllers; never a publisher retry. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const firstMaintenancePredecessor=Object.freeze({
 releaseId:'20261017T082953Z-c9da1765d84847d4',
 workerManifestSha256:'91a0cdce3cd59457ab3be2ae7366411fb975e1ebd07203119ff380ee568655f1',
 djangoManifestSha256:'622cb632fdf9408bfb6dc641422602a0e741aeea18d09c65f39480d203069d1a',
 workerScriptSha256:'8ef6d09c23f780657d74e8c591dea543713410783ce2d5fdf165f2093db51a1d',
 djangoScriptSha256:'2a4d3629d1f80b824ad247ef4b4ce810632090586b87be3686432f5b6aea98e0',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
const root='D:\\teruisi-runtime\\django-sales';
const hash=/^[a-f0-9]{64}$/;
// Reviewed installed native Stop capability, including its actual call site and
// 45-second receipt/control/ack contract. This is a predecessor qualification,
// not a fixed publication target or a permission to retry a failed attempt.
export const nativePiWorkspacePredecessor=Object.freeze({
 releaseId:'20261018T112936Z-f51e4f3671a64cd3',workerManifestSha256:'9eb5a75ac7d377c786bfc0fdb0ef6c0d8129698cf82e416fccfc07fbdb449fd7',
 djangoManifestSha256:'ca9c731a0843e7e01d8300f6190bca1377114f228ad5b17c16113e4028a582a9',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',djangoScriptSha256:'d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'0ab14dcbd889aacdf0d44847d59b4fd30a4bd5b02e836e6cf77d08eafe5d3d68',
 candidateAiScriptSha256:'64b2a5fe8f85a0c73463ef0f93ad1e983faa6b690bbb2e3e6b1ab041c6b9acdd'
});
// Exact current predecessor -> Pi business candidate. Full controller hashes
// qualify the unchanged lifecycle call sites, not merely a helper's presence.
export const nativePiBusinessPredecessor=Object.freeze({
 releaseId:'20261019T130904Z-6b816a5085c6a13e',
 workerManifestSha256:'70d5019b78836129779bbe51539cb0ae427da5ada550b2f901bddce28b0214af',
 djangoManifestSha256:'00058feaf2c93cd0de55a6e269dc67d73bfd1c659d72a5ea1720073a5615180b',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',
 djangoScriptSha256:'cfd1e942a0b55f5eb8aa3be484db5ece565ec39c6e6aa93ed0aea633b8936e85',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd',
 djangoAiScriptSha256:'64b2a5fe8f85a0c73463ef0f93ad1e983faa6b690bbb2e3e6b1ab041c6b9acdd',
 candidateAiScriptSha256:'3b0ae6c09b1bc49aa12fed622208fee711a387726ede709b2cd421fa1b04cad5',
 candidateDjangoScriptSha256:'d884882af114840ff1b0061c57439556cfc6a8fd7d0a751896363dd59eecde5d'
});
// PiNative deliberately adds its 153 gate to django-local-service.ps1 without
// changing django-ai.ps1. This reviewed candidate hash is the only same-AI
// generation in which the candidate local-service may differ from the
// installed one; any other drift still fails closed.
// S04a (2026-10-22) re-registers that generation for the A1 gate fix
// (988810cf..559e64fd, 1 file +25 -3): Assert-WranglerRuntimeFacts is split out
// of Assert-WranglerRuntimeCli as a pure JSON fact check, and the app-tree
// manifest caller uses it instead of spawning `wrangler --version`. The diff
// touches no maintenance enter/exit, maintenance lock, drain, STARTED/SUCCESS
// receipt, worker stop, process-tree termination or signal handling, and adds
// no external process. Evidence: docs/施工/S04a.md.
export const piNativeCandidateDjangoScriptSha256='65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61';
// A项 (2026-10-25) registers the descendant-verification fix. Unlike the
// entries above, this diff DOES touch process-tree walking, so it is stated
// plainly rather than claimed inert: Get-VerifiedProcessDescendants gains two
// guard lines (+13 lines total, all additions, no original line changed or
// removed) that skip an enumerated child whose CreationDate is missing or
// precedes its claimed parent's. Windows recycles PIDs, so ParentProcessId
// equality alone admitted reused-PID phantoms; the 2026-10-24 r3 incident
// stalled Django Stop for ~26 minutes when PID 14720 (readertray.exe, metadata
// unreadable) named stale parent 11412. Both guards only ever REMOVE a
// candidate from the descendant set via `continue`; they never add one, never
// widen what gets terminated, and never relax an existing assertion. The
// identity re-check at :2632, the root PID-reuse checks in
// Stop-VerifiedProcessTree, maintenance enter/exit, the maintenance lock,
// drain, STARTED/SUCCESS receipts, worker stop and signal handling are all
// untouched, and no external process is added. CreationDate is read off the
// CIM row rather than through Get-ProcessCreation because that helper casts to
// [datetime] and throws on a null — precisely the phantom case this must
// survive. Same-kind [datetime] comparison verified against live CIM rows and
// ISO-8601 snapshot strings (no timezone skew). Evidence:
// D:\teruisi-ops\release-20261025\A项-停服务误认进程-审查证据.md.
export const aDescendantCreationGuardDjangoScriptSha256='4ba1fcaf3cd1568a64098a9d2d32039f850ec2db1da4f81aa97fa3ab9530723a';
// Sales154 (d95852dd): these reviewed controller bytes add the schema-addition
// admission gate and include its three verifier modules in PrepareApp's copy list.
// A successful Sales154 gate returns before the Pi153 PowerShell branch in
// Assert-NoUnapprovedProtectedAiMigration. Pi153 lifecycle proofs are fully
// retained through sales_preflight_addition.parent_proof ->
// pi_native_addition._verify_active_with_base, plus the exact Sales-only delta.
// The independent integration_release_gate.py database invocation before migrate
// remains in place with its database protections. Keep the older descendant-guard
// qualification for the transition.
// Review and authorization: docs/sales154-controller-qualification-20261029/REPORT.md.
export const sales154SchemaAdditionDjangoScriptSha256='98028cb49195b7b145c74fdb5205e949e6152d065ce926265cd5773e8b00580b';
// B项 (2026-10-25) registers the worker controller that reports the real
// failure cause in -Json mode. The terminal catch block used to write only the
// fixed string 'Worker lifecycle result requires exact reconciliation' to
// stderr and dropped $_.Exception.Message entirely, so a -Json caller saw a
// generic failure with no cause — the reason the 2026-10-24 r2/r3 incidents
// took extra diagnosis. The non-Json branch had always printed that text.
// The reconciliation contract is preserved byte for byte: the stdout JSON key
// set is identical to the baseline (status / processEvidence / startupPhases /
// failedStartPhase), so every consumer parsing that line is unaffected. The
// cause is added to stderr ONLY and deliberately kept out of stdout, because
// publish-main.mjs:136 persists stdout verbatim to <label>.stdout.log (the
// repository already tracks ~100 such logs) while this project's own rule in
// release-readonly-retry.mjs forbids persisting arbitrary messages; some
// throws embed a bounded supervisor stderr tail. stderr keeps exactly the
// exposure the non-Json branch has always had. Nothing in maintenance
// enter/exit, the
// maintenance lock, drain, STARTED/SUCCESS receipts, worker start/stop
// sequencing, process-tree termination or signal handling is touched; no
// external process is added; no assertion is relaxed and no new failure path
// is introduced (this code runs only after a failure already happened).
export const bWorkerJsonFailureCauseScriptSha256='1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e';
// S05a (2026-10-22): qualification is per controller, never one shared
// exception. A controller name owns only its own reviewed candidate hashes; an
// unregistered name or an unlisted hash for a registered name still fails
// closed, and a candidate identical to the installed bytes needs no entry.
// The worker hash below is B1 `codex/start-timing-20261022` (2dd8f23f)
// tools/worker-local-service.ps1: startup phase budgets/observation plus an
// independent DingTalk startup observer. Evidence: docs/施工/S05a.md.
export const piNativeCandidateControllerSha256=Object.freeze({
 'django-local-service.ps1':Object.freeze([piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256]),
 'worker-local-service.ps1':Object.freeze(['83705551d9a9b2f3d2948d7b7eb8b41f3c6cfae5a8747949ffd8d6e3a4ee7058',bWorkerJsonFailureCauseScriptSha256]),
 'process-deadline.ps1':Object.freeze([])
});
export function assertMaintenanceControllerGeneration({name,installedSha,expected,candidateSha}){
 if(installedSha===expected)return;
 const qualified=piNativeCandidateControllerSha256[name];
 if(qualified&&qualified.includes(candidateSha))return;
 assert.equal(installedSha,expected,'实际原生控制器代际与候选不一致：'+name);
}
export const piMaintenancePredecessor=Object.freeze({
 releaseId:'20261018T081823Z-282cee340c57bf41',workerManifestSha256:'120911425367ef3a451c40f7a9842f3c1e39fc99b38cfd602b011ae3ed0733fc',
 djangoManifestSha256:'a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',
 djangoScriptSha256:'d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2',
 djangoAiScriptSha256:'fc767f83a175642da0922db29770400e50a73d0ca00c56ba840a87d97725455b',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
export function isPiMaintenancePredecessor(head,djangoManifestSha256){
 const k=piMaintenancePredecessor;return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
// Q14 (2026-10-25): one exact installed -> candidate django-ai.ps1 pair, never a
// general exception. The candidate (33043e9d) changes only
// Assert-DingTalkScreenshotProfile and adds Test-AppContainerReadOnlyAce; the
// verifier (dingtalkScreenshotAclOnly) proves by syntax tree that every other
// function and every top-level statement is byte-identical, so the reviewed Pi
// stop protocol (Wait-PiWorkerExit / Stop-PiRuntime) is untouched. Only the
// whole-file hashes are consumed here; the function hashes belong to the
// verifier. A one-bit difference on either side, or the reverse direction,
// leaves the pair unregistered and fails closed. Evidence:
// docs/release-qual-dingtalk-screenshot-acl-20261025/REPORT.md.
export const dingtalkScreenshotAclQualification=Object.freeze({
 installedAiSha256:'f97cf7e2bc532407cdf86501de57097ce6e4f626eaf68f73ee6ab308532e0e73',
 candidateAiSha256:'55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba',
 assertProfileBeforeSha256:'e960f78453d3a08aea1d7e4299f5ccbf51c905189a5516132fa7660311abb61c',
 assertProfileAfterSha256:'a12db3ee9ef8834fedc871df5700a7e7fa820d815ee60ef70cf98364e4cec789',
 appContainerAceSha256:'801fd43a50668ae3b6f274353efd0adaec9db3ffb1936dc41ac79f81a6ab4f16'
});
export function isDingTalkScreenshotAclPair(installedAiSha256,candidateAiSha256){
 const q=dingtalkScreenshotAclQualification;
 return installedAiSha256===q.installedAiSha256&&candidateAiSha256===q.candidateAiSha256;
}
export const maintenanceSourceNames=['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs','manual-maintenance-process.psm1','manual-maintenance-preflight.ps1'];
/** Read-only static admission; the native engine still rechecks dynamic facts. */
export async function maintenanceReadiness({source,head,djangoManifestSha256,installed='D:/teruisi-runtime/django-sales/app',runtime='D:/teruisi-runtime/teruisi-worker-sales',sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex')}={}){
 const sourcePins={};for(const name of maintenanceSourceNames)sourcePins[name]=await sha(path.join(source,'tools',name));
 const pins=Object.entries(sourcePins).map(([relative,sha256])=>({root:'source',relative,sha256}));
 const pin=async(root,relative,base,expected)=>{const sha256=await sha(path.join(base,relative));if(expected!==undefined)assert.equal(sha256,expected,'维护资格核验后工具发生变化');pins.push({root,relative,sha256});return sha256;};
 await pin('django','app/deployment.json',path.dirname(installed),djangoManifestSha256);
 for(const name of ['worker-local-service.ps1','process-deadline.ps1'])await pin('worker',`releases/${head.releaseId}/tools/${name}`,runtime);
 await pin('worker',`releases/${head.releaseId}/deployment-manifest.json`,runtime,head.manifestSha256);
 await pin('django','app/tools/django-local-service.ps1',path.dirname(installed));
 const assertPredecessorPins=k=>{
  for(const [root,relative,expected] of [['django','app/deployment.json',k.djangoManifestSha256],['django','app/tools/django-local-service.ps1',k.djangoScriptSha256],['worker',`releases/${head.releaseId}/deployment-manifest.json`,k.workerManifestSha256],['worker',`releases/${head.releaseId}/tools/worker-local-service.ps1`,k.workerScriptSha256],['worker',`releases/${head.releaseId}/tools/process-deadline.ps1`,k.workerTransportSha256]])assert.equal(pins.find(p=>p.root===root&&p.relative===relative)?.sha256,expected,'维护前驱资格与最初读取字节不一致');
 };
 const finish=async route=>{
  const result={version:'manual-maintenance-readiness-v1',preparedAt:new Date().toISOString(),releaseId:head.releaseId,route,sourcePins,pins,piWorkerReceiptSha256:null,piConfigurationSha256:null};
  for(const [field,relative] of [['piWorkerReceiptSha256','run/django-ai-pi-worker.pid.json'],['piConfigurationSha256','config/pi-agent.json']]){
   const file=path.join(path.dirname(installed),relative);
   try{await fs.access(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   result[field]=await sha(file);
   if(field==='piWorkerReceiptSha256'){
    const raw=await fs.readFile(file);assert.equal(createHash('sha256').update(raw).digest('hex'),result[field],'Pi ownership changed during readiness read');
    const pi=JSON.parse(raw);assert.equal(pi.version,2);assert.equal(pi.service,'django-ai-pi-worker');
    assert.ok(Number.isSafeInteger(pi.processId)&&pi.processId>0&&pi.processId<=2147483647);
    for(const name of ['creationDate','executablePath','commandLine'])assert.ok(typeof pi[name]==='string'&&pi[name]);
    result.piWorkerIdentity=pi;
   }
  }
  return result;
 };
 assert.equal(await sha(path.join(installed,'deployment.json')),djangoManifestSha256,'维护前Django前驱变化');
 const known=isPiMaintenancePredecessor(head,djangoManifestSha256)?piMaintenancePredecessor:isFirstMaintenancePredecessor(head,djangoManifestSha256)?firstMaintenancePredecessor:null;
 if(known){
  assertPredecessorPins(known);
  for(const [name,expected] of [['worker-local-service.ps1',known.workerScriptSha256],['process-deadline.ps1',known.workerTransportSha256]])assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'tools',name)),expected,'维护恢复前驱工具不适用：'+name);
  assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'deployment-manifest.json')),known.workerManifestSha256);
  assert.equal(await sha(path.join(installed,'tools/django-local-service.ps1')),known.djangoScriptSha256);
  if(known===piMaintenancePredecessor){
   assert.equal(await sha(path.join(installed,'tools/django-ai.ps1')),known.djangoAiScriptSha256);
   const file=path.join(path.dirname(installed),'run/django-ai-pi-worker.pid.json');
   const piWorkerReceiptSha256=await sha(file),raw=await fs.readFile(file);
   assert.equal(createHash('sha256').update(raw).digest('hex'),piWorkerReceiptSha256,'Pi ownership changed during readiness read');
   const piWorkerIdentity=JSON.parse(raw);
   assert.equal(piWorkerIdentity.version,2);assert.equal(piWorkerIdentity.service,'django-ai-pi-worker');
   assert.ok(Number.isSafeInteger(piWorkerIdentity.processId)&&piWorkerIdentity.processId>0);
   for(const name of ['creationDate','executablePath','commandLine'])assert.ok(typeof piWorkerIdentity[name]==='string'&&piWorkerIdentity[name]);
   const piConfigurationSha256=await sha(path.join(path.dirname(installed),'config/pi-agent.json'));
   await pin('django','app/tools/django-ai.ps1',path.dirname(installed),known.djangoAiScriptSha256);
   return {...await finish('pi19db'),piWorkerReceiptSha256,piWorkerIdentity,piConfigurationSha256};
  }
  return finish('legacy');
 }
 // Once this exact observer has been adopted, ordinary successors use native
 // Stop. Unknown controller generations cannot silently enter maintenance.
 const candidate=await fs.readFile(path.join(source,'tools/django-ai.ps1'),'utf8');
 const helper=candidate.replaceAll('\r\n','\n').split('function Wait-PiWorkerExit')[1]?.split('\nfunction Stop-PiRuntime')[0];
 assert.equal(createHash('sha256').update(('function Wait-PiWorkerExit'+(helper??'')).trimEnd()).digest('hex'),'4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3','没有适用于实际前驱的维护恢复材料');
 const stop=candidate.replaceAll('\r\n','\n').split('function Stop-PiRuntime')[1]?.split('\nfunction Read-PandasConfig')[0];
 assert.equal(createHash('sha256').update(('function Stop-PiRuntime'+(stop??'')).trimEnd()).digest('hex'),'49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6','Pi Stop调用、45秒和receipt/control/ack合同未在已审资格内');
 const installedAi=await sha(path.join(installed,'tools/django-ai.ps1')),candidateAi=await sha(path.join(source,'tools/django-ai.ps1'));
 // Q14: the exact DingTalk-screenshot ACL pair keeps the installed Pi stop
 // protocol, so it is judged like the same-AI generation: every other
 // controller must still be the installed bytes or a registered candidate.
 const dingtalkAcl=installedAi!==candidateAi&&isDingTalkScreenshotAclPair(installedAi,candidateAi);
 for(const [name,root,relative] of [['worker-local-service.ps1','worker',`releases/${head.releaseId}/tools/worker-local-service.ps1`],['process-deadline.ps1','worker',`releases/${head.releaseId}/tools/process-deadline.ps1`],['django-local-service.ps1','django','app/tools/django-local-service.ps1']]){
  const expected=await pin('source',name,path.join(source,'tools'));
  if(installedAi===candidateAi||dingtalkAcl)assertMaintenanceControllerGeneration({name,installedSha:pins.find(p=>p.root===root&&p.relative===relative)?.sha256,expected,candidateSha:await sha(path.join(source,'tools',name))});
 }
 if(dingtalkAcl){
  // The installed bytes must still be the qualified ones and still carry the
  // reviewed Pi exit-observation and Stop protocol (the candidate was checked above).
  const actual=await fs.readFile(path.join(installed,'tools/django-ai.ps1'));
  assert.equal(createHash('sha256').update(actual).digest('hex'),installedAi,'维护资格核验后工具发生变化');
  const text=actual.toString('utf8').replaceAll('\r\n','\n');
  for(const [start,end,expected] of [['Wait-PiWorkerExit','Stop-PiRuntime','4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3'],['Stop-PiRuntime','Read-PandasConfig','49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6']]){
   const body=text.split('function '+start)[1]?.split('\nfunction '+end)[0];
   assert.equal(createHash('sha256').update(('function '+start+(body??'')).trimEnd()).digest('hex'),expected,'实际前驱Pi停止协议不在已审兼容资格内');
  }
 }
 if(!dingtalkAcl&&installedAi!==candidateAi){
  const b=nativePiBusinessPredecessor;
  const k=head?.releaseId===b.releaseId?b:nativePiWorkspacePredecessor;
  assertPredecessorPins(k);
  assert.equal(head?.releaseId,k.releaseId,'没有适用于实际前驱的原生Stop能力资格');assert.equal(head?.manifestSha256,k.workerManifestSha256);assert.equal(djangoManifestSha256,k.djangoManifestSha256);
  for(const [name,expected] of [['worker-local-service.ps1',k.workerScriptSha256],['process-deadline.ps1',k.workerTransportSha256]])assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'tools',name)),expected);
  assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'deployment-manifest.json')),k.workerManifestSha256);
  assert.equal(await sha(path.join(installed,'tools/django-local-service.ps1')),k.djangoScriptSha256);
  assert.equal(installedAi,k.djangoAiScriptSha256,'实际前驱缺少已验证的Pi退出观察器');assert.equal(candidateAi,k.candidateAiScriptSha256,'候选Pi控制器不在已审兼容资格内');
  if(k===b){
   for(const [name,expected] of [['worker-local-service.ps1',k.workerScriptSha256],['process-deadline.ps1',k.workerTransportSha256],['django-local-service.ps1',k.candidateDjangoScriptSha256]])assert.equal(sourcePins[name]??pins.find(p=>p.root==='source'&&p.relative===name)?.sha256,expected,'候选生命周期控制器不在已审兼容资格内：'+name);
   const actual=await fs.readFile(path.join(installed,'tools/django-ai.ps1'));
   assert.equal(createHash('sha256').update(actual).digest('hex'),installedAi,'维护资格核验后工具发生变化');
   const text=actual.toString('utf8').replaceAll('\r\n','\n');
   for(const [start,end,expected] of [['Wait-PiWorkerExit','Stop-PiRuntime','4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3'],['Stop-PiRuntime','Read-PandasConfig','49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6']]){
    const body=text.split('function '+start)[1]?.split('\nfunction '+end)[0];
    assert.equal(createHash('sha256').update(('function '+start+(body??'')).trimEnd()).digest('hex'),expected,'实际前驱Pi停止协议不在已审兼容资格内');
   }
  }
 }
 await pin('django','app/tools/django-ai.ps1',path.dirname(installed),installedAi);
 await pin('source','django-ai.ps1',path.join(source,'tools'),candidateAi);
 return finish('native-exit-observer');
}
export function assertPiMaintenanceContinuation(snapshot,admission,{requireFresh=true}={}){
 assert.equal(snapshot.version,'manual-maintenance-pi-continuation-v1');
 for(const [key,value] of Object.entries(piMaintenancePredecessor))assert.equal(snapshot[key],value);
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);
 for(const field of ['sourceBound','rotationOwnerBound','originalActorBound','originalActorExited','piStopBound','piWorkerAbsent','workerReceiptAbsent','postgresPreservedReady','nativeStopIdentityGatePreserved'])assert.equal(snapshot[field],true,field);
 assert.deepEqual(snapshot.controlParticipants,[]);assert.deepEqual(snapshot.downstreamEffects,[]);
 assert.match(snapshot.piStopBinding?.controlSha256??'',hash);assert.match(snapshot.piStopBinding?.ackSha256??'',hash);
 assert.ok(Number.isFinite(Date.parse(snapshot.at)),'独立观察时间无效');
 if(requireFresh)assert.ok(Date.now()-Date.parse(snapshot.at)>=0&&Date.now()-Date.parse(snapshot.at)<120000,'独立观察已过期');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,admission.maintenanceId);assert.equal(record.keepPostgres,true);assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.ok(snapshot.maintenance.drainedStopped===undefined||typeof snapshot.maintenance.drainedStopped==='boolean');
 if(snapshot.maintenance.drainedStopped===true){assert.equal(snapshot.fullNativeStopScopeVerified,true);assert.equal(snapshot.durableCompleteCommit,true);return 'coordinate-completed';}
 assert.equal(snapshot.fullNativeStopScopeVerified,false);return 'enter-same-id-once';
}
export async function continuePiMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 await recheck();const expected={...admission,admissionSha256,originalFailureSha256};
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256,'-Route','pi19db'];
 const observed=await step('独立核实Pi维护',script,'Check',extra);
 assertPiMaintenanceContinuation(observed.snapshot,expected);assert.match(observed.observationSha256??'',hash);
 assert.equal(path.dirname(path.resolve(observed.observationPath)),path.resolve(admission.attempt));
 assert.match(path.basename(observed.observationPath),/^maintenance-pi-observation-[a-f0-9]{32}\.json$/);
 await recheck();
 const result=await step('续接Pi维护',script,'EnterMaintenance',[...extra,'-ObservationPath',observed.observationPath,'-ObservationSha256',observed.observationSha256]);
 assert.equal(result.observationSha256,observed.observationSha256,'续接未绑定原独立观察');
 // before records admission at the native call boundary, not a new observation
 // after a potentially long native Stop. The PS adapter checked freshness there.
 assert.equal(result.continuationDecision,assertPiMaintenanceContinuation(result.before,expected,{requireFresh:false}));
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
export function isFirstMaintenancePredecessor(head,djangoManifestSha256){
 const k=firstMaintenancePredecessor;
 return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
export function assertFirstMaintenanceContinuation(snapshot,admission){
 const k=firstMaintenancePredecessor;
 assert.equal(snapshot.version,'manual-maintenance-continuation-v1');
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 for(const [key,value] of Object.entries(k))assert.equal(snapshot[key],value,'限定前驱变化：'+key);
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);assert.match(snapshot.maintenanceId??'',/^[a-f0-9]{32}$/);
 assert.equal(snapshot.sourceBound,true);assert.equal(snapshot.rotationOwnerBound,true);assert.equal(snapshot.originalActorBound,true);
 assert.equal(snapshot.originalActorExited,true);assert.deepEqual(snapshot.controlParticipants,[],'原控制参与者仍在或身份未知');
 assert.equal(snapshot.fullNativeStopScopeVerified,true,'完整原停止范围未验证');
 assert.equal(snapshot.workerStatus?.state,'stopped');assert.equal(snapshot.workerStatus?.releaseId,k.releaseId);assert.equal(snapshot.workerStatus?.manifestSha256,k.workerManifestSha256);
 assert.equal(snapshot.workerReceiptAbsent,true);assert.deepEqual(snapshot.applicationProcesses,[]);assert.equal(snapshot.postgresPreservedReady,true);
 assert.deepEqual(snapshot.downstreamEffects,[],'已有后续发布动作');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,snapshot.maintenanceId);assert.equal(typeof record.runtimeRoot,'string');
  assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());assert.equal(record.keepPostgres,true);
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.equal(typeof snapshot.pandasConfigured,'boolean');
 if(snapshot.pandasConfigured){assert.equal(snapshot.pandas?.distribution,'TERUISI-Pandas');assert.equal(snapshot.pandas?.user,'teruisi-pandas');assert.equal(snapshot.pandas?.unit,'teruisi-pandas.service');assert.equal(snapshot.pandas?.activeState,'inactive');assert.equal(snapshot.pandas?.subState,'dead');assert.equal(snapshot.pandas?.mainPid,0);assert.equal(snapshot.pandas?.controlPid,0);assert.deepEqual(snapshot.pandas?.containers,[]);}
 const stopped=snapshot.maintenance.drainedStopped;
 assert.ok(stopped===undefined||typeof stopped==='boolean','drainedStopped类型不正确');
 if(stopped===true){assert.equal(snapshot.durableCompleteCommit,true,'原完成提交证据缺失');return 'coordinate-completed';}
 assert.equal(snapshot.durableCompleteCommit,false,'原提交与维护对象矛盾');
 return 'enter-same-id-once';
}

export async function continueFirstMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 // The caller keeps its original rotation lease and call stack. A new publisher
 // invocation still rejects STARTED without SUCCESS before reaching this code.
 await recheck();
 const expected={...admission,admissionSha256,originalFailureSha256};
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256];
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const snapshot=await step('核实首次维护',script,'Check',extra);
 const decision=assertFirstMaintenanceContinuation(snapshot,expected);
 await recheck();
 const result=await step('续接首次维护',script,'EnterMaintenance',extra);
 assert.equal(result.continuationDecision,decision);assertFirstMaintenanceContinuation(result.before,expected);
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
