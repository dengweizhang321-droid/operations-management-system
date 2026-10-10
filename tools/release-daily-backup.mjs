import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { safeRead, hash, canonical } from './release-impact.mjs';
import { writeOnce, productionCommandArguments, productionCommandEnvironment } from './release-batch.mjs';
import { runProcess, processDeadline, safeProcessEvidence } from './worker-local-release.mjs';
import { withRotationLock } from './worker-local-release-rotation.mjs';

export const schedulePath = 'D:\\.codex\\automations\\e\\automation.toml';
export const dailyProofRoot = 'D:\\teruisi-runtime\\django-sales\\audits\\release-daily-backup';
const attemptVersion = 'teruisi-daily-backup-attempt-v2';
const activeSchedule = raw => /^status\s*=\s*"ACTIVE"\s*$/m.test(raw.toString('utf8'));
export async function scheduledBackup({ run = runProcess, root = dailyProofRoot, schedule = schedulePath, lock = withRotationLock,
  timeoutMs = 30 * 60 * 1000 } = {}) {
  const deadlineUnixMs = processDeadline(timeoutMs);
  const id = `${new Date().toISOString().replace(/[-:.]/g,'')}-${randomUUID()}`;
  const dir = path.join(root,id);
  let stage = 'schedule', scheduleSha256 = null, resultWritten = false, processEvidence = null;
  const remaining = () => {
    const value = deadlineUnixMs - Date.now();
    if (value < 1) throw new Error('Scheduled backup deadline exhausted');
    return value;
  };
  const startAttempt = () => writeOnce(path.join(dir,'started.json'),{
    attemptVersion,id,status:'started',deadlineUnixMs,startedAt:new Date().toISOString(),
  });
  let scheduleRaw;
  try {
    scheduleRaw = await safeRead(schedule);
  } catch {
    // A missing/unreadable latest schedule must not expose an older success.
    await startAttempt();
    await writeOnce(path.join(dir,'result.json'),{attemptVersion,id,status:'unknown',stage,deadlineUnixMs,completedAt:new Date().toISOString()});
    throw new Error('Scheduled backup configuration unavailable; exact reconciliation required');
  }
  if (!activeSchedule(scheduleRaw)) throw new Error('Existing daily backup schedule is paused; no backup is started');
  scheduleSha256 = hash(scheduleRaw);
  // Record this invocation before attempting the shared rotation lock. A new
  // lock/initialization failure cannot be hidden by yesterday's success.
  await startAttempt();
  try {
    remaining(); stage = 'lock';
    return await lock(async()=>{
    remaining(); stage = 'inventory';
    await mkdir(root,{recursive:true}); remaining();
    for(const name of await readdir(root)) {
      if (name === id) continue;
      if(name==='active.json')throw new Error('Previous scheduled backup is unresolved; reconcile its exact original ID before another run');
      if(!/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name))throw new Error('Invalid scheduled backup proof inventory');
      const previous=JSON.parse(await safeRead(path.join(root,name,'result.json'))); remaining();
      if(previous.status!=='success')throw new Error('Previous scheduled backup is unresolved');
      const previousStart=JSON.parse(await safeRead(path.join(root,name,'started.json'))); remaining();
      if(previous.attemptVersion!==attemptVersion||previousStart.attemptVersion!==attemptVersion
        ||previous.id!==name||previousStart.id!==name||!Number.isSafeInteger(previousStart.deadlineUnixMs)
        ||previous.deadlineUnixMs!==previousStart.deadlineUnixMs||!Number.isFinite(Date.parse(previous.completedAt))
        ||Date.parse(previous.completedAt)>=previousStart.deadlineUnixMs)throw new Error('Previous scheduled backup closure is unproven');
      try {await safeRead(path.join(root,name,'failure.json'));throw new Error('Previous scheduled backup has an unresolved late failure');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await writeOnce(path.join(root,'active.json'),{id,scheduleSha256}); remaining();
    stage = 'spawn-admission';
    const fresh = await safeRead(schedule); remaining();
    if (!activeSchedule(fresh) || hash(fresh) !== scheduleSha256) throw new Error('Scheduled backup configuration changed before execution');
    const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const args=[
      '-NoProfile','-NonInteractive','-File','D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1','-Action','Backup','-Execute',
    ];
    stage = 'operator';
    const operation = await run(shell,productionCommandArguments(shell,args),{
      label:'scheduled original database backup',timeoutMs:remaining(),deadlineUnixMs,
      env:productionCommandEnvironment(shell),outputProtocol:'direct-exit-files',cleanup:'preserve',
    });
    processEvidence=safeProcessEvidence(operation.processEvidence); remaining(); stage = 'receipt';
    const receipt = JSON.parse(operation.stdout.trim());
    remaining();
    if (receipt.status !== 'completed' || receipt.serviceStateChanged !== false || receipt.retention?.status !== 'completed'
      || typeof receipt.backupId !== 'string' || !/^[a-z0-9-]{1,150}$/i.test(receipt.backupId)
      || !/^[a-f0-9]{64}$/.test(receipt.manifestSha256 ?? '')
      || hash(await safeRead(schedule)) !== scheduleSha256) throw new Error('Scheduled backup/archive/configuration not closed');
    remaining(); stage = 'result';
    const result = { attemptVersion,id,status:'success',scheduleSha256,deadlineUnixMs,completedAt:new Date().toISOString(),backupId:receipt.backupId,manifestSha256:receipt.manifestSha256,receiptSha256:hash(receipt),processEvidence };
    await writeOnce(path.join(dir,'result.json'),result); resultWritten=true; remaining();
    stage = 'ownership-release';
    const active=JSON.parse(await safeRead(path.join(root,'active.json'))); remaining();
    if(active.id!==id || active.scheduleSha256!==scheduleSha256)throw new Error('Scheduled backup ownership changed');
    await unlink(path.join(root,'active.json')); remaining();
    return result;
    });
  } catch(error) {
    // Preserve append-only results, and invalidate any late success explicitly.
    // The admission reader treats either marker or a retained owner as unknown.
    await writeOnce(path.join(dir,resultWritten?'failure.json':'result.json'),{
      attemptVersion,id,status:'unknown',scheduleSha256,deadlineUnixMs,stage,completedAt:new Date().toISOString(),
      processEvidence:processEvidence ?? safeProcessEvidence(error.processEvidence),
    });
    throw new Error('Scheduled backup result unresolved; original audit must be reconciled, never replay automatically');
  }
}

export async function readScheduledBackupStatus({root=dailyProofRoot,schedule=schedulePath}={}) {
  const config=await safeRead(schedule), scheduleSha256=hash(config);
  let proof=null;
  try {
    const inventory=await readdir(root);
    if(inventory.length>10000)throw new Error('Daily proof inventory exceeds bound');
    const owned=inventory.includes('active.json');
    const names=inventory.filter(name=>name!=='active.json').sort();
    const latest=names.at(-1);
    if(latest&&!/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(latest))throw new Error('Invalid daily proof path');
    if(latest) {
      const start=JSON.parse(await safeRead(path.join(root,latest,'started.json')));
      proof=JSON.parse(await safeRead(path.join(root,latest,'result.json')));
      let failed=false;
      try {await safeRead(path.join(root,latest,'failure.json'));failed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(owned||failed||proof.attemptVersion!==attemptVersion||start.attemptVersion!==attemptVersion
        ||proof.id!==latest||start.id!==latest||proof.scheduleSha256!==scheduleSha256
        ||!Number.isSafeInteger(start.deadlineUnixMs)||proof.deadlineUnixMs!==start.deadlineUnixMs
        ||!Number.isFinite(Date.parse(proof.completedAt))||Date.parse(proof.completedAt)>=start.deadlineUnixMs)proof=null;
    }
  }catch(error){if(error.code!=='ENOENT')throw error;proof=null;}
  // Wrapper journals cannot witness a scheduler failure before this entrypoint
  // was invoked (or an audit initialization failure with no writable receipt).
  // A trusted latest native scheduler result is not yet available. Keep the
  // recovery fast path closed; never upgrade an older wrapper success to it.
  return {scheduleSha256,schedule:{active:activeSchedule(config),lastResult:'unknown',lastSuccessAt:null,
    wrapperLastResult:proof?.status??'unknown',latestAttemptCoverageVerified:false},proof};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) scheduledBackup().then(r=>console.log(canonical(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
