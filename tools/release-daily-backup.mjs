import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { safeRead, hash, canonical } from './release-impact.mjs';
import { writeOnce } from './release-batch.mjs';
import { runProcess } from './worker-local-release.mjs';
import { withRotationLock } from './worker-local-release-rotation.mjs';

export const schedulePath = 'D:\\.codex\\automations\\e\\automation.toml';
export const dailyProofRoot = 'D:\\teruisi-runtime\\django-sales\\audits\\release-daily-backup';
export async function scheduledBackup({ run = runProcess, root = dailyProofRoot, schedule = schedulePath, lock = withRotationLock } = {}) {
  const scheduleRaw = await safeRead(schedule);
  if (!/^status\s*=\s*"ACTIVE"\s*$/m.test(scheduleRaw.toString('utf8'))) throw new Error('Existing daily backup schedule is paused; no backup is started');
  return lock(async()=>{
  await mkdir(root,{recursive:true});
  for(const name of await readdir(root)) {
    if(name==='active.json')throw new Error('Previous scheduled backup is unresolved; reconcile its exact original ID before another run');
    if(!/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name))throw new Error('Invalid scheduled backup proof inventory');
    let previous;
    try{previous=JSON.parse(await safeRead(path.join(root,name,'result.json')));}
    catch(error){if(error.code==='ENOENT')throw new Error('Previous scheduled backup is unresolved');throw error;}
    if(previous.status!=='success')throw new Error('Previous scheduled backup is unresolved');
  }
  const id = `${new Date().toISOString().replace(/[-:.]/g,'')}-${randomUUID()}`;
  const dir = path.join(root,id);
  const scheduleSha256 = hash(scheduleRaw);
  await writeOnce(path.join(root,'active.json'),{id,scheduleSha256});
  await writeOnce(path.join(dir,'started.json'),{ id,status:'started',scheduleSha256,startedAt:new Date().toISOString() });
  let result;
  try {
    const operation = await run('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',[
      '-NoProfile','-NonInteractive','-File','D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1','-Action','Backup','-Execute',
    ],{ label:'scheduled original database backup',timeoutMs:30*60*1000 });
    const receipt = JSON.parse(operation.stdout.trim());
    if (receipt.status !== 'completed' || receipt.serviceStateChanged !== false || receipt.retention?.status !== 'completed'
      || hash(await safeRead(schedule)) !== scheduleSha256) throw new Error('Scheduled backup/archive/configuration not closed');
    result = { id,status:'success',scheduleSha256,completedAt:new Date().toISOString(),backupId:receipt.backupId,manifestSha256:receipt.manifestSha256,receiptSha256:hash(receipt) };
  } catch { result={ id,status:'unknown',scheduleSha256,completedAt:new Date().toISOString() }; }
  await writeOnce(path.join(dir,'result.json'),result);
  if (result.status !== 'success') throw new Error('Scheduled backup result unresolved; original audit must be reconciled, never replay automatically');
  await unlink(path.join(root,'active.json'));
  return result;
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) scheduledBackup().then(r=>console.log(canonical(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
