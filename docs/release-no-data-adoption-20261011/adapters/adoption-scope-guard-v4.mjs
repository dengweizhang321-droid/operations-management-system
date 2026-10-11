// Task-specific read-only guard. No production mutation or generic release API.
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const [specPath,action,expectedPlanSha256,expectedManifestSha256]=process.argv.slice(2);
assert.ok(path.isAbsolute(specPath));
assert.ok(['pre-deploy','acceptance'].includes(action));
const spec=JSON.parse(await readFile(specPath)),batch=spec.batch;
assert.match(expectedPlanSha256,/^[a-f0-9]{64}$/);assert.match(expectedManifestSha256,/^[a-f0-9]{64}$/);
assert.equal(batch.binding.workerPlanSha256,expectedPlanSha256);assert.equal(batch.binding.artifactSha256,expectedManifestSha256);
const runtime='D:/teruisi-runtime/teruisi-worker-sales';
const planRaw=await readFile(path.join(runtime,'state/worker-release-rotation-plans',batch.binding.workerPlanSha256+'.json'));
assert.equal(digest(planRaw),batch.binding.workerPlanSha256);
const plan=JSON.parse(planRaw);
assert.match(plan.candidate.releaseId,/^[A-Za-z0-9_-]+$/);
const root=path.join(runtime,'releases',plan.candidate.releaseId),tools=path.join(root,'tools');
const impact=await import(pathToFileURL(path.join(tools,'release-impact.mjs')));
const {verifyBatch,journalState}=await import(pathToFileURL(path.join(tools,'release-batch.mjs')));
verifyBatch(batch,batch.batchSha256);
const {readToolsScopeApplication}=await import(pathToFileURL(path.join(tools,'release-batch-admission.mjs')));
const state=await journalState(path.join(runtime,'state/release-batches'),batch);
const deployed=batch.operations.some(op=>op.kind==='django-deploy'&&state.latest.get(op.id)?.status==='passed');
assert.equal(deployed,action==='acceptance');
const beforeRoot=path.join('D:/teruisi-runtime/django-sales',deployed?'app.previous':'app');
const afterRoot=path.join('D:/teruisi-runtime/django-sales',deployed?'app':`app.deploy-${batch.binding.djangoPreparedAppId}`);
const observedDjango={before:await readToolsScopeApplication(beforeRoot),after:await readToolsScopeApplication(afterRoot)};
const observedCf={beforeRaw:await impact.safeRead(path.join(beforeRoot,'.wrangler/cache/cf.json')),afterRaw:await impact.safeRead(path.join(afterRoot,'.wrangler/cache/cf.json'))};
impact.validateToolsNoMigrationScope({scopeValidation:batch.tests.scopeValidation,impact:batch.impact,impactProof:batch.impactProof,binding:batch.binding,batchVersion:batch.version,observedDjango,observedCf});
assert.equal(batch.recovery.mode,'full');
const apply=batch.operations.find(op=>op.kind==='worker-apply');
assert.equal(state.latest.get(apply.id)?.status,'passed');
if(action==='pre-deploy') {
  const recordPath='E:/codex-artifacts/release-no-data-adoption-20261011/APP_PREVIOUS_PRESERVED.json';
  const recordRaw=await impact.safeRead(recordPath),record=JSON.parse(recordRaw);
  const op=batch.operations.find(op=>op.id==='previous-reference-guard');
  assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(recordPath)&&f.sha256===digest(recordRaw)));
  const release=await import(pathToFileURL(path.join(tools,'worker-local-release.mjs')));
  assert.equal(digest(await impact.safeRead(path.join(record.source,'deployment.json'))),record.manifestSha256);
  assert.deepEqual(await release.hashTree(record.source),record.tree);
  assert.deepEqual(await release.hashTree(record.target),record.tree);
  const target=path.resolve(record.source).toLowerCase();
  const references=[];
  const isReference=v=>typeof v==='string'&&/^[A-Za-z]:[\\/]/.test(v)&&!/[\r\n]/.test(v)&&
    (path.resolve(v).toLowerCase()===target||path.resolve(v).toLowerCase().startsWith(target+path.sep));
  const mentionsTarget=v=>typeof v==='string'&&v.replaceAll('/','\\').toLowerCase().includes(target);
  const shortAlias=/(?:^|[\\/])[^\\/]*~[1-9][0-9]*(?:\.[^\\/]*)?(?:[\\/]|$)/i;
  async function physicalReference(token) {
    let candidate=path.win32.normalize(token);
    const missing=[];
    for(;;) {
      try {
        const existing=await realpath(candidate);
        // A missing long child still refers through its nearest real ancestor.
        // An unresolved short component cannot safely be expanded by guessing.
        if(shortAlias.test(missing.join('\\')))throw new Error('Unresolved short path');
        const physical=path.win32.join(existing,...missing).replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,'').toLowerCase();
        return physical===target||physical.startsWith(target+path.sep);
      } catch(error) {
        if(!['ENOENT','ENOTDIR'].includes(error.code))throw new Error('Cannot resolve a physical path reference; previous package replacement is blocked');
        const parent=path.win32.dirname(candidate);
        if(parent===candidate)throw new Error('Cannot resolve a physical path ancestor; previous package replacement is blocked');
        missing.unshift(path.win32.basename(candidate));candidate=parent;
      }
    }
  }
  async function inspectReferences(value,{commandLine=false}={}) {
    if(typeof value!=='string')return false;
    if(isReference(value)||mentionsTarget(value))return true;
    // Executable/working-directory/metadata fields are one complete path,
    // including spaces. Only CommandLine and Arguments use argument tokens.
    const single=value.replace(/^(?:"([^"]*)"|'([^']*)')$/,(_,a,b)=>a??b);
    const tokens=commandLine
      ? [...value.matchAll(/(?:^|[\s=,])(?:"([A-Za-z]:[\\/][^"]+)"|'([A-Za-z]:[\\/][^']+)'|([A-Za-z]:[\\/][^\s"']+))/g)].map(m=>m[1]??m[2]??m[3])
      : /^[A-Za-z]:[\\/]/.test(single)&&!/[\r\n]/.test(single)?[single]:[];
    for(const token of tokens)if(await physicalReference(token))return true;
    return false;
  }
  async function visitValue(v) {
    if(typeof v==='string')return /^[A-Za-z]:[\\/]/.test(v)&&!/[\r\n]/.test(v)?inspectReferences(v):false;
    if(v&&typeof v==='object')for(const child of Object.values(v))if(await visitValue(child))return true;
    return false;
  }
  let scanned=0;
  async function scan(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name),info=await lstat(file);
      assert.ok(!info.isSymbolicLink(),'Reference audit refuses redirected state');
      if(entry.isDirectory())await scan(file);
      else if(entry.name.endsWith('.json')) {
        assert.equal(info.nlink,1);assert.ok(info.size<=32*1024*1024,'State too large for complete bounded reference audit');
        const raw=await impact.safeRead(file);scanned++;
        if(await visitValue(JSON.parse(raw)))references.push({kind:'state-or-candidate',path:file});
      }
    }
  }
  for(const dir of [path.join(runtime,'state'),'D:/teruisi-runtime/django-sales/run'])await scan(dir);
  for(const entry of await readdir('D:/teruisi-runtime/django-sales'))if(/^app\.(prepare|deploy)-.*\.json$/.test(entry)) {
    const file=path.join('D:/teruisi-runtime/django-sales',entry);scanned++;
    if(await visitValue(JSON.parse(await impact.safeRead(file))))references.push({kind:'prepared-candidate',path:file});
  }
  const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  const psHash=digest(await impact.safeRead(ps));
  assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(ps)&&f.sha256===psHash));
  const query="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $OutputEncoding=[Console]::OutputEncoding; [pscustomobject]@{processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine);tasks=@(Get-ScheduledTask | ForEach-Object {[pscustomobject]@{identity=$_.TaskPath+$_.TaskName;actions=@($_.Actions | Select-Object Execute,Arguments,WorkingDirectory)}})} | ConvertTo-Json -Depth 6 -Compress";
  const nativeEnvironment={...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'};
  const capture=spawnSync(ps,['-NoProfile','-NonInteractive','-Command',query],{windowsHide:true,encoding:'utf8',env:nativeEnvironment,timeout:60_000,maxBuffer:8*1024*1024});
  assert.equal(capture.status,0,'Process reference audit failed');
  const current=JSON.parse(capture.stdout);
  assert.ok(Array.isArray(current.processes)&&Array.isArray(current.tasks),'Incomplete process/task reference audit');
  for(const p of current.processes)if(await inspectReferences(p.CommandLine,{commandLine:true})||await inspectReferences(p.ExecutablePath))references.push({kind:'process',processId:p.ProcessId});
  for(const task of current.tasks)for(const a of task.actions)if(await inspectReferences(a.Execute)||await inspectReferences(a.Arguments,{commandLine:true})||await inspectReferences(a.WorkingDirectory)){references.push({kind:'scheduled-task',identitySha256:digest(task.identity)});break;}
  assert.deepEqual(references,[],'Existing previous package remains referenced; do not deploy or delete it');
  assert.equal((await journalState(path.join(runtime,'state/release-batches'),batch)).previous,state.previous,'WAL changed during previous-package guard');
  console.log(JSON.stringify({status:'passed',action,preservationVerified:true,referenceFilesScanned:scanned,currentReferences:0,productionWrites:0}));
} else {
  console.log(JSON.stringify({status:'passed',action,businessCodeUnchanged:true,migrationAndDependenciesUnchanged:true,businessWriteCodeUnchanged:true,qualifiedLiveInventoryVerified:true,productionWrites:0}));
}
