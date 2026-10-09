// Read-only production admission and recovery-evidence producer. No credentials
// are handled here: database access stays inside the installed original operator.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRead, safeFileDigest, hash, canonical, readSourceTree, sourceInventory, sourceTreeDigest, requireHash } from './release-impact.mjs';
import { verifyBatch, writeOnce, journalState, productionCommandArguments, productionCommandEnvironment } from './release-batch.mjs';
import { resolveEffectiveReleaseChain } from './worker-local-release-rotation.mjs';
import { workerPreparationIdentity, workerRuntimeRoot, workerSourceRoot, verifyPreparedWorkerCandidate, verifyWorkerReleaseProcessState, runProcess } from './worker-local-release.mjs';
import { schedulePath, dailyProofRoot } from './release-daily-backup.mjs';
import { admissionTimer } from './release-admission-timing.mjs';

const djangoRoot='D:\\teruisi-runtime\\django-sales';
const maintenance=path.join(djangoRoot,'app','tools','django-postgres-maintenance.ps1');
const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const archiveRoot='E:\\运营管理系统业务数据';
export async function runReadOnlyPowerShell(script,args,label) {
  const argv=['-NoProfile','-NonInteractive','-File',script,...args];
  return runProcess(shell,productionCommandArguments(shell,argv),{
    env:productionCommandEnvironment(shell),label});
}
async function verifyRestoreReceipt(target,expectedHash) {
  const parent=path.dirname(path.resolve(target));
  const permitted=[path.join(djangoRoot,'rehearsals','postgres-restore'),'E:\\TERUISI-Postgres-Rehearsals'];
  if(path.basename(target)!=='rehearsal-result.json'||!/^restore-[a-f0-9]{12}$/.test(path.basename(parent))
    ||!permitted.includes(path.dirname(parent)))throw new Error('Restore receipt is outside original protected rehearsal roots');
  const raw=await safeRead(target);
  if(expectedHash&&hash(raw)!==expectedHash)throw new Error('Original restore evidence changed');
  const sidecar=(await safeRead(`${target}.sha256`)).toString('ascii').trim();
  if(sidecar!==hash(raw))throw new Error('Original restore sidecar changed');
  return {raw,receipt:JSON.parse(raw)};
}
async function operator(action,args=[]) {
  const result=await runReadOnlyPowerShell(maintenance,['-Action',action,...args],'original read-only release admission');
  const receipt=JSON.parse(result.stdout.trim());
  if(receipt.status!=='completed'||receipt.serviceStateChanged!==false)throw new Error('Original admission operator did not pass');
  return receipt;
}
async function softwareIdentity() {
  const files={deploymentManifestSha256:path.join(djangoRoot,'app','deployment.json'),serviceConfigSha256:path.join(djangoRoot,'service.json'),serviceScriptSha256:path.join(djangoRoot,'app','tools','django-local-service.ps1'),operatorScriptSha256:maintenance,evidenceToolSha256:path.join(djangoRoot,'app','tools','postgres-consistent-backup.py'),pgDumpSha256:path.join(djangoRoot,'postgresql-17.11','bin','pg_dump.exe'),pgRestoreSha256:path.join(djangoRoot,'postgresql-17.11','bin','pg_restore.exe')};
  const identity={};for(const [name,target] of Object.entries(files))identity[name]=await safeFileDigest(target);
  return identity;
}
async function dailyStatus() {
  const config=await safeRead(schedulePath);
  const active=/^status\s*=\s*"ACTIVE"\s*$/m.test(config.toString('utf8'));
  let proof=null;
  try {
    const names=(await readdir(dailyProofRoot)).sort();
    if(names.length>10000)throw new Error('Daily proof inventory exceeds bound');
    const latest=names.at(-1);
    if(latest&&!/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(latest))throw new Error('Invalid daily proof path');
    if(latest)proof=JSON.parse(await safeRead(path.join(dailyProofRoot,latest,'result.json')));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return {scheduleSha256:hash(config),schedule:{active,lastResult:proof?.status??'unknown',lastSuccessAt:proof?.status==='success'?proof.completedAt:null},proof};
}
export async function collectRecoveryCurrent(evidence) {
  await verifyRestoreReceipt(evidence.restorePath,evidence.restoreReceiptSha256);
  if(path.dirname(path.resolve(evidence.backupDirectory))!==archiveRoot)throw new Error('Recovery point outside retained archive root');
  const verified=await operator('Verify',['-BackupDirectory',evidence.backupDirectory,'-ApprovedManifestSha256',evidence.manifestSha256]);
  const manifest=JSON.parse(await safeRead(path.join(evidence.backupDirectory,'backup-manifest.json')));
  const catalog=await operator('ReleaseEvidence');
  const software=await softwareIdentity();
  const daily=await dailyStatus();
  const status=await operator('Status');
  if(status.operationHistory?.unresolved?.length)throw new Error('Unresolved backup operation');
  const retention=await safeRead(path.join(djangoRoot,'run','backup-retention-v2.json'));
  const pointExists=verified.backupId===evidence.backupId;
  return {backupId:verified.backupId,manifestSha256:verified.manifestSha256,dumpSha256:verified.dumpSha256,pointExists,verifyStatus:'passed',retained:pointExists,
    schemaSha256:catalog.schemaSha256,rolesSha256:catalog.rolesSha256,environmentSha256:hash(software),operatorSha256:software.operatorScriptSha256,
    retentionSha256:hash(retention),scheduleSha256:daily.scheduleSha256,
    schedule:daily.proof?.scheduleSha256===daily.scheduleSha256?daily.schedule:{...daily.schedule,lastResult:'unknown'},
    sequencesValid:catalog.sequencesValid,softwareCompatible:canonical(software)===canonical(manifest.software)};
}
export async function makeRecoveryEvidence(backupDirectory,restorePath) {
  if(path.dirname(path.resolve(backupDirectory))!==archiveRoot)throw new Error('Recovery point outside fixed archive');
  const raw=await safeRead(path.join(backupDirectory,'backup-manifest.json'));
  const manifest=JSON.parse(raw),restored=await verifyRestoreReceipt(restorePath),restore=restored.receipt;
  if(restore.status!=='completed'||restore.backupManifestSha256!==hash(raw)||restore.dumpSha256!==manifest.dump.sha256
    ||restore.expectedContentSha256!==restore.restoredContentSha256||restore.restoredContentSha256!==manifest.evidence.contentSha256
    ||restore.profileRestoreVerified!==true||restore.sequenceHealthVerified!==true||restore.productionDatabaseTouched!==false
    ||restore.serviceStateChanged!==false||restore.cleanupStatus!=='isolated_data_removed')throw new Error('Incomplete exact independent restore receipt');
  const evidence={version:'teruisi-release-recovery-evidence-v1',backupDirectory,backupId:manifest.backupId,manifestSha256:hash(raw),dumpSha256:manifest.dump.sha256,
    backupCompletedAt:manifest.completedAt,restoredAt:restore.completedAt,restoreStatus:'passed',cleanupStatus:'passed',contentEqual:true,rolesEqual:true,permissionsEqual:true,migrationsEqual:true,sequencesValid:true,restorePath,restoreReceiptSha256:hash(restored.raw)};
  const current=await collectRecoveryCurrent(evidence);
  // The recovery point catalogue is authoritative for compatibility, not a
  // later source-tree assertion. Changed catalogue/roles invalidate reuse.
  const catalogue={catalog:manifest.profileEvidence.catalog,migrations:manifest.evidence.migrations.map(m=>[m.app,m.name])};
  evidence.schemaSha256=hash(catalogue);evidence.rolesSha256=hash(manifest.profileEvidence.roles);
  for(const key of ['environmentSha256','operatorSha256','retentionSha256','scheduleSha256'])evidence[key]=current[key];
  if(!current.softwareCompatible||current.schemaSha256!==evidence.schemaSha256||current.rolesSha256!==evidence.rolesSha256)throw new Error('Recovery environment/catalogue incompatible');
  return evidence;
}

export function requiresCompleteAdmission(phase,step) {
  return ['admission','drain','closeout'].includes(phase) || (phase==='switch' && (!step || ['worker-apply','StartWorker'].includes(step)));
}
export function requiresCompleteArtifact(phase,step) {
  return ['admission','drain','closeout'].includes(phase)||(phase==='switch'&&(!step||step==='worker-apply'));
}
export async function collectBatchAdmission(batch,testsPath,phase='admission',{session,step}={}) {
  const timer=admissionTimer();
  const measure=(stage,category,action)=>timer.measure(stage,category,action);
  try {
  await measure('classification','sealed-evidence',async()=>verifyBatch(batch,batch.batchSha256));
  requireHash(batch.binding.djangoPredecessorSha256,'Django predecessor');
  requireHash(batch.binding.djangoCandidateSha256,'Django candidate');
  const djangoCurrent=await measure('django-identity','dynamic-state',()=>safeFileDigest(path.join(djangoRoot,'app','deployment.json')));
  const state=await measure('journal','dynamic-state',()=>journalState(path.join(workerRuntimeRoot,'state','release-batches'),batch));
  const djangoSwitched=batch.operations.some(op=>op.kind==='django-deploy'&&state.latest.get(op.id)?.status==='passed');
  if(djangoCurrent!==(djangoSwitched?batch.binding.djangoCandidateSha256:batch.binding.djangoPredecessorSha256))throw new Error('Approved Django predecessor/candidate changed');
  if(batch.binding.djangoCandidateSha256!==batch.binding.djangoPredecessorSha256&&!djangoSwitched) {
    if(!/^[a-f0-9]{32}$/.test(batch.binding.djangoPreparedAppId??''))throw new Error('Missing precise Django preparation ID');
    const receiptRaw=await safeRead(path.join(djangoRoot,`app.prepare-${batch.binding.djangoPreparedAppId}.json`));
    if(hash(receiptRaw)!==batch.binding.djangoPreparedReceiptSha256)throw new Error('Django preparation receipt changed');
    const receipt=JSON.parse(receiptRaw);
    if(receipt.predecessorManifestSha256!==batch.binding.djangoPredecessorSha256||receipt.candidateManifestSha256!==batch.binding.djangoCandidateSha256)throw new Error('Django preparation no longer binds the batch');
  }
  requireHash(batch.binding.workerPlanSha256,'worker plan');
  const planRaw=await safeRead(path.join(workerRuntimeRoot,'state','worker-release-rotation-plans',`${batch.binding.workerPlanSha256}.json`));
  if(hash(planRaw)!==batch.binding.workerPlanSha256)throw new Error('Worker plan changed');
  const plan=JSON.parse(planRaw);
  const chain=await measure('effective-chain-and-guards','dynamic-state',()=>resolveEffectiveReleaseChain({verifyInstalledHead:true}));
  const predecessor=chain.head.bindingSha256===plan.predecessor.bindingSha256&&chain.chainStateSha256===plan.predecessorChainStateSha256;
  const successor=chain.head.bindingSha256===plan.candidate.bindingSha256&&chain.records.at(-1)?.value.approvedPlanSha256===batch.binding.workerPlanSha256;
  if(!predecessor&&!successor)throw new Error('Current production predecessor/successor is outside approved batch');
  const workerSwitched=batch.operations.some(op=>op.kind==='worker-apply'&&state.latest.get(op.id)?.status==='passed');
  if(workerSwitched?!successor:!predecessor)throw new Error('Worker state is not the confirmed phase predecessor/successor');
  if(plan.predecessor.bindingSha256!==batch.binding.predecessorSha256||plan.candidate.manifestSha256!==batch.binding.artifactSha256)throw new Error('Candidate plan differs from batch');
  const candidateRoot=path.join(workerRuntimeRoot,'releases',plan.candidate.releaseId);
  const manifestPath=path.join(candidateRoot,'deployment-manifest.json');
  const manifestRaw=await safeRead(manifestPath);
  if(hash(manifestRaw)!==batch.binding.artifactSha256)throw new Error('Candidate manifest changed');
  const manifest=JSON.parse(manifestRaw);
  const complete=requiresCompleteAdmission(phase,step);
  const identity=session
    ? await session.collect({approvedBatchSha256:batch.batchSha256,full:complete,measure})
    : await measure('source-and-toolchain-initial','mutable-input',()=>workerPreparationIdentity(workerSourceRoot));
  if(manifest.source.sourceFingerprint!==identity.sourceTree.sha256
    ||canonical(manifest.source.tree)!==canonical(identity.sourceTree))throw new Error('Prepared artifact does not belong to the current final source');
  const predecessorRoot=path.join(workerRuntimeRoot,'releases',plan.predecessor.releaseId,'source-snapshot');
  const before=await measure('predecessor-source','immutable-content',()=>readSourceTree(predecessorRoot));
  const tests=await measure('tests-evidence','sealed-evidence',async()=>JSON.parse(await safeRead(testsPath)));
  const binding={...batch.binding,sourceSha256:identity.sourceTree.sha256,sourceInventorySha256:identity.sourceInventorySha256,
    predecessorSourceSha256:sourceTreeDigest(before),predecessorInventorySha256:hash(sourceInventory(before)),dependencySha256:manifest.source.packageLockSha256,
    toolchainSha256:hash({node:identity.nodeExecutableSha256,toolchain:identity.toolchain}),configurationSha256:hash({environment:identity.environmentSha256,runtime:identity.runtimeConfigurationSha256,npm:identity.externalNpmConfiguration}),testsSha256:hash(tests)};
  await measure('worker-helper-process-identity','dynamic-state',()=>verifyWorkerReleaseProcessState({processPolicy:'stopped-or-exact-release',runtimeRoot:workerRuntimeRoot,manifestPath:chain.headManifestPath,releaseRoot:path.dirname(chain.headManifestPath)}));
  // Retain original admission/drain/closeout validation, plus actual apply.
  // No artifact check is removed or credited as a new cache saving. Original
  // apply/Start also enforce their own full payload/ACL/guard/receipt gates.
  if(requiresCompleteArtifact(phase,step))await measure('complete-artifact-and-head','immutable-content',()=>verifyPreparedWorkerCandidate({manifestPath,approvedManifestSha256:batch.binding.artifactSha256,
    expectedSourceD1PathSha256:chain.bootstrap.authority.sourceD1PathSha256,expectedPersistRootPathSha256:chain.bootstrap.authority.persistRootPathSha256,requireSalesRetiredCodeReceipt:true},async()=>{
    const ownVerifier=path.join(path.dirname(chain.headManifestPath),'tools','worker-local-release.mjs');
    await runProcess(process.execPath,[ownVerifier,'verify','--manifest',chain.headManifestPath,'--approved-manifest-sha256',chain.head.manifestSha256,
      '--expected-source-d1-path-sha256',chain.bootstrap.authority.sourceD1PathSha256,'--expected-persist-root-path-sha256',chain.bootstrap.authority.persistRootPathSha256,
      '--require-sales-retired-code-receipt','--process-policy','stopped-or-exact-release','--json'],{label:'exact immutable production head'});
    return {status:'exact-predecessor-or-approved-successor'};
  }));
  if(['acceptance','closeout'].includes(phase)) {
    const result=await measure('complete-status','dynamic-state',()=>runReadOnlyPowerShell('D:\\运营管理系统\\tools\\operations-system-control.ps1',['-Action','Status','-Json'],'original complete system readiness'));
    const status=JSON.parse(result.stdout.trim());
    if(status.state!=='Running'||status.backendState!=='Ready'||status.workerState!=='exact_release'||status.releaseId!==plan.candidate.releaseId
      ||Object.keys(status.components??{}).length!==12||Object.values(status.components).some(ready=>ready!==true))throw new Error('Complete original system readiness is not the approved successor');
  }
  const recovery=batch.recovery.mode==='reuse'?await measure('recovery-eligibility','dynamic-state',()=>collectRecoveryCurrent(batch.recoveryEvidence)):null;
  if(session)await session.recheck({measure});
  else if(canonical(identity)!==canonical(await measure('source-and-toolchain-final','mutable-input',()=>workerPreparationIdentity(workerSourceRoot))))throw new Error('Source/configuration/toolchain changed during live admission');
  return {batchSha256:batch.batchSha256,observedAtMs:Date.now(),binding,recovery,admissionStages:timer.result()};
  } catch(error) { error.admissionStages=timer.result();throw error; }
}
async function main(){
  const [command,...args]=process.argv.slice(2);
  if(command==='recovery') {const [backup,restore,output]=args;await writeOnce(output,await makeRecoveryEvidence(backup,restore));console.log(canonical({status:'prepared',output}));}
  else if(command==='collect'){const [batchPath,testsPath,,phase]=args;const spec=JSON.parse(await safeRead(batchPath));console.log(canonical(await collectBatchAdmission(spec.batch??spec,testsPath,phase??'admission')));}
  else throw new Error('Usage: release-batch-admission.mjs recovery <backup-dir> <restore.json> <output.json> | collect <batch.json> <tests.json> [--phase <phase>]');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
