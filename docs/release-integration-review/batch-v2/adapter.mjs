// The original engine invokes these sealed adapters only after exact approval.
// Imported as a module it performs no operation. No new lifecycle owner exists.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, open, readdir, lstat } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sha, canonical, validateRecovery, compareFullRecovery, validateHistoricalAudit,
  closeNaturalObservations, validateNaturalObservation, validateWatchdogTask } from './validators.mjs';

export async function saveOriginal(root, name, bytes, read = readFile) {
  const target=path.resolve(root,name);assert.ok(target.startsWith(path.resolve(root)+path.sep));
  const handle=await open(target,'wx').catch(async error=>{
    if(error.code!=='EEXIST')throw error;
    assert.deepEqual(await read(target),bytes);return null;
  });
  if(handle){try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
}
export async function auditInventory(roots, digestFile) {
  const files=[];
  async function walk(root,dir,mode) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      assert.ok(!entry.isSymbolicLink());
      if(entry.name==='active.json'&&dir===root)continue; // separate mutable owner; never a history record
      const filename=path.join(dir,entry.name);
      if(entry.isDirectory()) {
        if(mode==='published-recovery-receipts'&&dir!==root)continue;
        await walk(root,filename,mode);
      } else {
        if(mode==='published-recovery-receipts'&&!/^(?:rehearsal-result\.json(?:\.sha256)?|.*(?:failure|receipt|result).*\.json(?:\.sha256)?)$/i.test(entry.name))continue;
        if(mode==='audit-records'&&!/\.(?:jsonl?|sha256|log|txt|md|xml|yml|yaml)$/i.test(entry.name))continue;
        const before=await lstat(filename,{bigint:true}),digest=await digestFile(filename),after=await lstat(filename,{bigint:true});
        for(const key of ['size','mtimeNs','ctimeNs','ino','dev'])assert.equal(before[key],after[key]);
        assert.ok(before.size<=BigInt(Number.MAX_SAFE_INTEGER));
        files.push({root,path:filename,bytes:Number(before.size),sha256:digest});
      }
    }
  }
  for(const item of roots){const root=typeof item==='string'?item:item.path;await walk(root,root,typeof item==='string'?'full-root':item.mode);}
  return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}

export async function preserveRecovery(context,args) {
  const [phase,directory,manifestSha256,id,port]=args;
  assert.ok(['pre','post'].includes(phase));
  assert.equal(path.dirname(path.resolve(directory)),path.resolve('E:/运营管理系统业务数据'));
  const spec=JSON.parse(await context.safeRead(path.join(context.root,'approved-batch.json')));
  const {journalState,verifyBatch}=await import(pathToFileURL(path.join(context.h.immutableCandidateRoot,'tools/release-batch.mjs')));
  verifyBatch(spec.batch,spec.batch.batchSha256);
  const state=await journalState(context.h.journalRoot,spec.batch),backup=state.latest.get('backup-'+phase);
  assert.equal(backup.status,'passed');
  const {dumpSha256,contentSha256,backupId}=backup.outputs;
  assert.equal(backup.outputs.backupDirectory,directory);assert.equal(backup.outputs.manifestSha256,manifestSha256);
  assert.equal(path.basename(directory),backupId);
  const manifestPath=path.join(directory,'backup-manifest.json'), restorePath=path.resolve(`E:/TERUISI-Postgres-Rehearsals/restore-${id}/rehearsal-result.json`);
  const input={manifestRaw:await context.safeRead(manifestPath),manifestSidecar:await context.safeRead(manifestPath+'.sha256'),
    restoreRaw:await context.safeRead(restorePath),restoreSidecar:await context.safeRead(restorePath+'.sha256'),
    manifestSha256,dumpSha256,contentSha256,backupId,rehearsalId:id,rehearsalPort:Number(port),contract:context.h.profileContract};
  const verified=validateRecovery(input);
  assert.equal(await context.digestFile(path.join(directory,'teruisi-sales.dump')),dumpSha256);
  for(const [name,raw] of [[`${phase}-backup-manifest.json`,input.manifestRaw],[`${phase}-backup-manifest.json.sha256`,input.manifestSidecar],
    [`${phase}-restore.json`,input.restoreRaw],[`${phase}-restore.json.sha256`,input.restoreSidecar]])await saveOriginal(context.root,name,raw);
  return {status:'passed',fullRecoveryMetadataPreserved:true,originalRestoreSha256:verified.originalRestoreSha256,
    policySyntaxEquivalenceVerified:verified.restore.policySyntaxEquivalenceVerified??null,originalProfileIsInPreservedManifest:true};
}

export async function runAdapter(action, context, args=[]) {
  const {h,root,safeRead,digestFile}=context;
  if(action==='preserve-recovery')return preserveRecovery(context,args);
  if(action==='deep-recovery-comparison') {
    assert.equal(args.length,2);
    const beforeRaw=await safeRead(path.join(root,'pre-backup-manifest.json')),afterRaw=await safeRead(path.join(root,'post-backup-manifest.json'));
    assert.equal(sha(beforeRaw),args[0]);assert.equal(sha(afterRaw),args[1]);
    const before=JSON.parse(beforeRaw),after=JSON.parse(afterRaw);
    return {...compareFullRecovery(before,after,h.profileContract),productionWriteTestPerformed:false,
      isolatedPermissionRegressionPassed:h.ownerTests.status==='passed',ownerBytesBound:true,coverage:'Two exact consistent PostgreSQL public snapshots; no same-cutoff or non-PG claim'};
  }
  if(action==='historical-audits') {
    const baseline=JSON.parse(await safeRead(path.join(root,'historical-audit-sha.json')));
    const current=await auditInventory(baseline.roots,digestFile);
    const result={...validateHistoricalAudit(baseline,current,h.historicalCaptureSha256),scope:baseline.scope};
    await saveOriginal(root,'historical-audit-after.json',Buffer.from(canonical(result)+'\n'));
    return result;
  }
  if(action==='resources') {
    const resources=JSON.parse(await safeRead(path.join(root,'resource-inventory.json')));
    let checked=0;
    for(const [uri,expected] of Object.entries(resources)) {
      assert.match(uri,/^\/[A-Za-z0-9_./-]+$/);assert.ok(!uri.includes('..'));
      const response=await fetch('http://127.0.0.1:3000'+uri,{redirect:'manual',signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),expected);checked++;
    }
    assert.ok(checked>0);
    return {status:'passed',resourcesVerified:true,checked,productionWrites:0};
  }
  if(action==='unsigned-permission-denials') {
    const observations=[];
    for(const [port,uri] of [[8071,'/api/customer-service/conversations'],[8101,'/api/access-control/users']]) {
      const response=await fetch(`http://127.0.0.1:${port}${uri}`,{redirect:'manual',signal:AbortSignal.timeout(20000)});
      const body=await response.json();assert.equal(response.status,401);assert.equal(body.code??body.error?.code,'authentication_required');
      observations.push({port,path:uri,status:401,code:'authentication_required'});
    }
    assert.equal(await digestFile('D:/teruisi-runtime/django-sales/app/deployment.json'),h.djangoManifestSha256);
    return {status:'passed',liveUnsignedReaderGetDenied:true,isolatedRoleAndScopeMatrixPassed:h.ownerTests.status==='passed',
      originalOwnerManifestVerified:true,observations,productionWriteTestPerformed:false};
  }
  if(action==='watchdog-install') {
    // Mandatory active owner + approved WAL + this started operation. This
    // guard does not manufacture human approval and is never used in prepare.
    const spec=JSON.parse(await safeRead(path.join(root,'approved-batch.json'))), batch=spec.batch;
    const active=JSON.parse(await safeRead(path.join(h.journalRoot,'active.json')));
    assert.equal(active.id,batch.id);assert.equal(active.batchSha256,batch.batchSha256);
    const {journalState,verifyBatch}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/release-batch.mjs')));
    verifyBatch(batch,batch.batchSha256);const state=await journalState(h.journalRoot,batch);
    assert.ok(state.events.some(e=>e.status==='approved'));assert.equal(state.latest.get('install-reviewed-watchdog')?.status,'started');
    const begin=Date.now();let task;
    do { task=await context.readTask();if(task.state!=='Running')break;await new Promise(resolve=>setTimeout(resolve,1000)); }while(Date.now()-begin<120000);
    validateWatchdogTask(task,h.watchdog.before);
    // Original source/launcher hash is unchanged: require this existing,
    // reviewed binary before calling Install; no compiler path is admitted.
    assert.equal(await digestFile(h.watchdog.launcherPath),h.watchdog.after.launcherSha256);
    // No automatic retry of the actual installer. File protocol/preserve and
    // the original Execute/installer are retained for this mutating command.
    const {runProcess}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/worker-local-release.mjs')));
    const script=path.resolve(h.immutableCandidateRoot,'source-snapshot/tools/operations-system-watchdog.ps1');
    const out=await runProcess(h.watchdog.powerShellPath,['-NoProfile','-NonInteractive','-File',script,'-Action','Install','-Execute'],
      {timeoutMs:600000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'exact approved original watchdog Install'});
    const result=JSON.parse(out.stdout);assert.equal(result.status,'installed');assert.equal(result.task,'TERUISI Operations Watchdog');
    const installed=JSON.parse(await safeRead('D:/teruisi-runtime/operations-watchdog/installation.json'));
    for(const key of ['scriptSha256','transportSha256','launcherSourceSha256','launcherSha256'])assert.equal(installed[key],h.watchdog.after[key]);
    assert.equal(await digestFile('D:/teruisi-runtime/operations-watchdog/operations-system-watchdog.ps1'),h.watchdog.after.scriptSha256);
    assert.equal(await digestFile('D:/teruisi-runtime/operations-watchdog/process-deadline.ps1'),h.watchdog.after.transportSha256);
    assert.equal(await digestFile(h.watchdog.launcherPath),h.watchdog.after.launcherSha256);
    const observed=await context.readTask();assert.equal(observed.exists,true);assert.equal(observed.enabled,true);
    assert.equal(observed.configurationSha256,h.watchdog.before.configurationSha256);
    assert.equal(observed.actionSha256,h.watchdog.after.actionSha256);
    await saveOriginal(root,'watchdog-install-result.json',Buffer.from(canonical({original:result,installed,task:observed})+'\n'));
    return {status:'passed',originalWatchdogInstallationBound:true,existingTaskActionUpdatedAndStarted:true,manualNotificationTest:false};
  }
  if(action==='natural-watchdog') {
    const after=Date.now(),observations=[],seen=new Set();
    const desired=await safeRead('D:/teruisi-runtime/django-sales/run/django-supervisor-desired-state.json');
    const expected={after,releaseId:h.workerPlan.candidateReleaseId,fence:sha(desired)};
    while(Date.now()-after<300000&&observations.length<2) {
      const raw=await safeRead('D:/teruisi-runtime/operations-watchdog/latest.json'),digest=sha(raw);
      if(!seen.has(digest)) {
        seen.add(digest);
        const name=`natural-observed-${seen.size}`;
        // Retain every newly seen byte sequence before parsing or classifying.
        await saveOriginal(root,name+'.json',raw);
        await saveOriginal(root,name+'.json.sha256',Buffer.from(digest+'\n'));
        await saveOriginal(root,name+'-seen.json',Buffer.from(canonical({seenAt:new Date(Date.now()).toISOString(),sha256:digest})+'\n'));
        const value=JSON.parse(raw),instant=Date.parse(value.at);
        assert.ok(typeof value.at==='string'&&Number.isFinite(instant),'Unclassifiable observation cannot be skipped');
        if(instant<=after) {
          assert.equal(seen.size,1,'A newly observed stale record after baseline cannot count as healthy or be ignored');
          await saveOriginal(root,name+'-classification.json',Buffer.from(canonical({classification:'initial-pre-observation-baseline',counted:false})+'\n'));
        } else {
        const record={raw,sha256:digest};observations.push(record);
        // Validate every observed fresh snapshot now; do not discard failures
        // and hunt for two later successes. Native unobserved-run coverage is
        // not claimed by this sampling adapter or by C's daily reader.
        validateNaturalObservation(value,expected);
        }
      }
      if(observations.length<2)await new Promise(resolve=>setTimeout(resolve,5000));
    }
    assert.equal(await digestFile('D:/teruisi-runtime/django-sales/run/django-supervisor-desired-state.json'),expected.fence);
    return closeNaturalObservations(observations,expected);
  }
  throw Error('Unknown sealed adapter action');
}

async function main() {
  const [action,input,...args]=process.argv.slice(2),root=path.resolve(input);
  assert.equal(path.dirname(root),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
  assert.match(path.basename(root),/^(AB|ABC)-v2-[a-z0-9-]{8,70}$/);
  const h=JSON.parse(await readFile(path.join(root,'candidate-handoff.json')));
  assert.equal(h.version,'task-d-exact-batch-preparation-v2');
  const {safeRead,safeFileDigest}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/release-impact.mjs')));
  const taskScript=path.join(root,'read-watchdog-task.ps1');
  const readTask=async()=>{
    const {runProcess}=await import(pathToFileURL(path.join(h.immutableCandidateRoot,'tools/worker-local-release.mjs')));
    const value=await runProcess(h.watchdog.powerShellPath,['-NoProfile','-NonInteractive','-File',taskScript],
      {timeoutMs:60000,outputProtocol:'direct-exit-files',cleanup:'direct',label:'exact original task metadata read'});
    return JSON.parse(value.stdout);
  };
  console.log(canonical(await runAdapter(action,{root,h,safeRead,digestFile:safeFileDigest,readTask},args)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.name+': sealed assertion/operation failed');process.exitCode=1;});
