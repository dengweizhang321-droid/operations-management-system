// Task-specific read-only guard. No production mutation or generic release API.
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
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
assert.equal(batch.recovery.mode,'targeted-first-adoption');
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
  // A missing command line is unknown for an interpreter or managed actor.
  // Only exact native Windows identities have a narrow missing-command exception.
  const interpreterNames=new Set(['node.exe','python.exe','pythonw.exe','powershell.exe','pwsh.exe','cmd.exe','cscript.exe','wscript.exe','mshta.exe','dotnet.exe','java.exe','javaw.exe','w3wp.exe','workerd.exe','bash.exe','wsl.exe','rundll32.exe','regsvr32.exe']);
  const nativeWindowsNames=new Set(['svchost.exe','services.exe','lsass.exe','wininit.exe','winlogon.exe','csrss.exe','smss.exe','dwm.exe','fontdrvhost.exe']);
  const managedRoots=['d:\\teruisi-runtime','d:\\运营管理系统','d:\\运营管理系统-sales-django-release','d:\\.codex\\worktrees','d:\\codex-isolated'];
  const atOrBelow=(value,root)=>value===root||value.startsWith(root+'\\');
  async function inspectProcessReference(p) {
    const pid=p?.ProcessId;
    const unknown=reason=>({kind:'process-unknown',processId:Number.isSafeInteger(pid)?pid:null,reason});
    if(!p||typeof p!=='object'||Array.isArray(p)||!Number.isSafeInteger(pid)||pid<0
      ||!Number.isSafeInteger(p.SessionId)||p.SessionId<0)return unknown('invalid-process-identity');
    if(typeof p.Name!=='string'||!p.Name.trim()||/[\\/\r\n]/.test(p.Name))return unknown('missing-or-invalid-name');
    if(p.ExecutablePath!=null&&typeof p.ExecutablePath!=='string'||p.CommandLine!=null&&typeof p.CommandLine!=='string')return unknown('invalid-path-or-command-type');
    const name=p.Name.toLowerCase(),hasExe=typeof p.ExecutablePath==='string'&&p.ExecutablePath.trim().length>0,hasCommand=typeof p.CommandLine==='string'&&p.CommandLine.trim().length>0;
    // Kernel pseudo-process identities have no user-mode executable or argv.
    if(((pid===0&&name==='system idle process')||(pid===4&&name==='system'))&&p.SessionId===0&&!hasExe&&!hasCommand)return null;
    if(pid===0||pid===4)return unknown('inconsistent-kernel-identity');
    if(!hasExe||! /^[A-Za-z]:[\\/]/.test(p.ExecutablePath)||/[\r\n]/.test(p.ExecutablePath))return unknown('missing-or-invalid-executable');
    if(path.win32.basename(p.ExecutablePath).toLowerCase()!==name)return unknown('name-executable-mismatch');
    let physical;
    try {physical=(await realpath(path.win32.normalize(p.ExecutablePath))).replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,'').toLowerCase();}
    catch {return unknown('executable-identity-unreadable');}
    if(atOrBelow(physical,target))return {kind:'process',processId:pid};
    const related=interpreterNames.has(name)||managedRoots.some(root=>atOrBelow(physical,root));
    if(!hasCommand) {
      if(related)return unknown('related-command-unreadable');
      const native=['c:\\windows\\system32\\','c:\\windows\\syswow64\\'].some(prefix=>physical===prefix+name);
      if(nativeWindowsNames.has(name)&&native)return null;
      return unknown('unproven-native-command-unreadable');
    }
    if(await inspectReferences(p.CommandLine,{commandLine:true})||await inspectReferences(p.ExecutablePath))return {kind:'process',processId:pid};
    return null;
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
  const psHash=await impact.safeFileDigest(ps);
  assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(ps)&&f.sha256===psHash));
  const sourceRoot=path.dirname(fileURLToPath(import.meta.url));
  for(const name of ['live-reference-audit.mjs','live-os-instance-policy.mjs','live-wsl-policy.mjs','system-wsl-verifier.mjs','live-wsl-host-policy.mjs','Collect-LiveWslHostAssociation.ps1','collect-live-wsl.py','Collect-LiveProcessIdentity.ps1','Probe-ResidualProcessMetadataV2.ps1','Collect-SystemWslIdentity.ps1']){
    const file=path.join(sourceRoot,name),hash=digest(await impact.safeRead(file));
    assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(file)&&f.sha256===hash),'Live guard implementation missing from approved operation closure');
  }
  const systemRecord='E:/codex-artifacts/release-site-blockers-20261011/SYSTEM_WSL_IDENTITY_V1.json';
  const systemRecordHash=digest(await impact.safeRead(systemRecord));
  assert.equal(systemRecordHash,'0979916bc362a459f8f2bd30aa807d985eaa4eeab9f9b6d203bce50debc77d69');
  assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(systemRecord)&&f.sha256===systemRecordHash));
  for(const [name,expected] of [
    ['ADMIN_REFERENCE_DIAGNOSTIC_V1.json','4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69'],
    ['ADMIN_RESIDUAL_METADATA_V2.json','0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6'],
    ['WSL_HOST_ASSOCIATION_ADMIN_V1.json','f11f84beed8e8f6645c19929f74fdd7ee88a2827dea93e72b2d2286e836eb1c4']
  ]){const file=path.join('E:/codex-artifacts/release-site-blockers-20261011',name);assert.equal(digest(await impact.safeRead(file)),expected);assert.ok(op.command.files.some(f=>path.resolve(f.path)===path.resolve(file)&&f.sha256===expected));}
  const auditRaw=await impact.safeRead(path.join(sourceRoot,'live-reference-audit.mjs'));
  assert.equal(digest(auditRaw),'984dbfdad743ad28cc106d60878ae4ea00cc5d68550fb0bc0256c0e246e87b64');
  const {runLiveReferenceAudit}=await import('data:text/javascript;base64,'+auditRaw.toString('base64'));
  const liveAudit=await runLiveReferenceAudit({inspectProcessReference,inspectReferences,sourceRoot});
  references.push(...liveAudit.references,...liveAudit.unknown);
  assert.equal(liveAudit.status,'passed','Live reference audit remains blocked; no saved receipt bypass');
  assert.deepEqual(references,[],'Existing previous package remains referenced; do not deploy or delete it');
  assert.equal((await journalState(path.join(runtime,'state/release-batches'),batch)).previous,state.previous,'WAL changed during previous-package guard');
  console.log(JSON.stringify({status:'passed',action,preservationVerified:true,referenceFilesScanned:scanned,currentReferences:0,productionWrites:0}));
} else {
  console.log(JSON.stringify({status:'passed',action,businessCodeUnchanged:true,migrationAndDependenciesUnchanged:true,businessWriteCodeUnchanged:true,qualifiedLiveInventoryVerified:true,productionWrites:0}));
}
