// ONLY existing-point/current metadata reads. No Backup/Restore/Install/execute.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sha, validateRecovery } from './validators.mjs';
const own=path.dirname(fileURLToPath(import.meta.url)), begin=performance.now();
const directory='E:/运营管理系统业务数据/daily-20261009T114230Z-7117da1c1055';
const restore='E:/TERUISI-Postgres-Rehearsals/restore-4088f7ed4793/rehearsal-result.json';
const raw=await readFile(path.join(directory,'backup-manifest.json')), manifest=JSON.parse(raw);
assert.equal(sha(raw),'c3def80e40bf8ebad3e0d3e3a2c09a64b2d4d99bd6cf95d48c41b7b12ff62400');
const contract={djangoManifestSha256:'237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9',profile:manifest.profileEvidence.profile,
  database:manifest.database,software:manifest.software,evidenceTables:Object.keys(manifest.evidence.tables).sort(),profileTables:Object.keys(manifest.profileEvidence.tables).sort(),
  catalogKeys:Object.keys(manifest.profileEvidence.catalog).sort(),roleKeys:Object.keys(manifest.profileEvidence.roles).sort()};
validateRecovery({manifestRaw:raw,manifestSidecar:await readFile(path.join(directory,'backup-manifest.json.sha256')),
  restoreRaw:await readFile(restore),restoreSidecar:await readFile(restore+'.sha256'),manifestSha256:sha(raw),dumpSha256:manifest.dump.sha256,
  contentSha256:manifest.evidence.contentSha256,backupId:manifest.backupId,rehearsalId:'4088f7ed4793',rehearsalPort:55591,contract});
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9';
const {makeRecoveryEvidence,runReadOnlyPowerShell}=await import(pathToFileURL(candidate+'/tools/release-batch-admission.mjs'));
const evidence=await makeRecoveryEvidence(directory,restore);
const permissionProbes=[];
for(const {port,pathname} of [{port:8071,pathname:'/api/customer-service/conversations'},{port:8101,pathname:'/api/access-control/users'}]) {
  const response=await fetch(`http://127.0.0.1:${port}`+pathname,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  // This is one genuine unsigned transport boundary, not the role/scope matrix.
  const body=await response.json();
  permissionProbes.push({port,pathname,status:response.status,code:body.code??body.error?.code??null});
  assert.equal(response.status,401);
  assert.equal(body.code??body.error?.code,'authentication_required');
}
const status=await runReadOnlyPowerShell(path.resolve('D:/运营管理系统/tools/operations-system-control.ps1'),['-Action','Status','-Json'],'fresh exact original readiness',{timeoutMs:60000});
const value=JSON.parse(status.stdout);
const receipt={status:'captured-readonly',observedAt:new Date().toISOString(),elapsedMs:performance.now()-begin,contract,
  retainedPointEvidence:evidence,permissionProbes,currentReadiness:value,productionWriteTestPerformed:false,productionActionsPerformed:false,
  nativeSchedulerLatest:'unknown',recoveryFastPathEligible:false,existingPointIsNotNewBatchBackup:true};
await writeFile(path.join(own,'../evidence/batch-v2-readonly-preparation.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,elapsedMs:receipt.elapsedMs,evidenceTables:contract.evidenceTables.length,profileTables:contract.profileTables.length,
  unsignedGetDenied:true,nativeSchedulerLatest:'unknown',productionActionsPerformed:false}));
