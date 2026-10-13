import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBatchVersion,assertAuditAdoptionBinding,validateAuditOperations,makeBatch,verifyBatch,executeBatch} from '../tools/release-batch.mjs';
import {hash,sourceInventory,sourceTreeDigest,requirements} from '../tools/release-impact.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {workerSourceRoot} from '../tools/worker-local-release.mjs';

function fixture() {
  const binding={jackyunAuditOperationId:'a'.repeat(32),maintenanceId:'b'.repeat(32),djangoPreparedAppId:'c'.repeat(32),djangoPreparedReceiptSha256:'d'.repeat(64)};
  const life=step=>({id:step.toLowerCase(),step,kind:step==='DeployApp'?'django-deploy':'lifecycle',phase:'switch',command:{args:['-Step',step,...(step==='EnterMaintenance'?['-KeepPostgres']:[]),...(step==='DeployApp'?['-IntegrationOperationId',binding.jackyunAuditOperationId,'-CandidateSourceRoot',workerSourceRoot]:[])]}});
  const phase=name=>({id:name,phase:name,kind:name.startsWith('backup')?'backup':'restore',command:{args:[]}});
  const action=(name,when)=>({id:name.toLowerCase(),kind:'migration-addition',phase:when,command:{args:['-AdditionKind','JackyunAudit','-OperationId',binding.jackyunAuditOperationId,'-MaintenanceId',binding.maintenanceId,'-SourceRoot',workerSourceRoot,'-Execute','-Action',name,...(name==='Plan'?['-PreparedAppId',binding.djangoPreparedAppId,'-PreparedAppSha256',binding.djangoPreparedReceiptSha256]:[]),...(name!=='Install'?['-BackupDirectory',`{receipt:backup-${name==='Plan'?'pre':'post'}:backupDirectory}`,'-BackupManifestSha256',`{receipt:backup-${name==='Plan'?'pre':'post'}:manifestSha256}`,'-RestoreResultPath',`{receipt:restore-${name==='Plan'?'pre':'post'}:restoreResultPath}`,'-RestoreResultSha256',`{receipt:restore-${name==='Plan'?'pre':'post'}:restoreResultSha256}`]:[])]}});
  return {version:auditBatchVersion,binding,impact:{level:'strict'},recovery:{mode:'full'},operations:[life('EnterMaintenance'),life('StopWorker'),phase('backup-pre'),phase('restore-pre'),action('Plan','switch'),{id:'apply',kind:'worker-apply'},life('DeployApp'),life('HardenAcl'),action('Install','switch'),phase('backup-post'),phase('restore-post'),action('Finalize','migration-finalize'),life('ExitMaintenance'),life('StartWorker')]};
}
test('finite adoption enforces maintenance, both exact recovery points, finalization before startup',()=>validateAuditOperations(fixture()));
test('legacy batches remain legacy and cannot silently gain migration permission',()=>{
  assertAuditAdoptionBinding({command:{args:['-IntegrationOperationId','legacy']}},{binding:{}});
  const b=fixture();b.version='teruisi-release-batch-v3';assert.throws(()=>validateAuditOperations(b));
  assert.throws(()=>assertAuditAdoptionBinding({kind:'migration-addition'}, {binding:{}}));
});
for(const [name,change] of Object.entries({
  earlyStart:b=>{b.operations.splice(8,0,b.operations.pop());},
  duplicate:b=>b.operations.push(structuredClone(b.operations[8])),
  noFinalize:b=>b.operations.splice(11,1),
  stopPostgres:b=>b.operations[0].command.args.pop(),
  wrongBackup:b=>b.operations[11].command.args[b.operations[11].command.args.indexOf('-BackupDirectory')+1]='{receipt:backup-pre:backupDirectory}',
  unknownRestore:b=>b.operations[4].command.args[b.operations[4].command.args.indexOf('-RestoreResultPath')+1]='latest.json',
  wrongOwner:b=>b.operations[8].command.args[b.operations[8].command.args.indexOf('-OperationId')+1]='f'.repeat(32),
  wrongSource:b=>b.operations[6].command.args[b.operations[6].command.args.indexOf('-CandidateSourceRoot')+1]='D:\\other',
  wrongPrepared:b=>b.operations[4].command.args[b.operations[4].command.args.indexOf('-PreparedAppId')+1]='f'.repeat(32),
  repeatedArgument:b=>b.operations[8].command.args.push('-OperationId','a'.repeat(32)),
  rollbackAsInstall:b=>b.operations[8].command.args[b.operations[8].command.args.indexOf('-Action')+1]='Reconcile',
  downgraded:b=>b.recovery.mode='not-required',
}))test(`rejects ${name}`,()=>{const b=fixture();change(b);assert.throws(()=>validateAuditOperations(b));});

function sealedFixture() {
  const b=fixture(), h='1'.repeat(64), before={'tools/a.py':'# before'},after={'tools/a.py':'# after'};
  const tests={status:'passed',sourceSha256:sourceTreeDigest(after),artifactSha256:h,checks:requirements.strict.tests};
  Object.assign(b.binding,{sourceSha256:sourceTreeDigest(after),predecessorSourceSha256:sourceTreeDigest(before),sourceInventorySha256:hash(sourceInventory(after)),predecessorInventorySha256:hash(sourceInventory(before)),dependencySha256:h,configurationSha256:h,toolchainSha256:h,artifactSha256:h,testsSha256:hash(tests),predecessorSha256:h,workerPlanSha256:h,djangoCandidateSha256:h,djangoPredecessorSha256:h});
  for(const op of b.operations) {
    op.mutating=true;op.assertions=[];
    if(op.step){
      op.phase=op.step==='EnterMaintenance'?'drain':op.step==='StopWorker'?'quiesce':['ExitMaintenance','StartWorker'].includes(op.step)?'migration-finalize':'switch';
      if(op.step==='EnterMaintenance')op.assertions.push({path:'drainConfirmed',equals:true});
      op.command.args.unshift('-File','D:/isolated/tools/release-lifecycle-step.ps1');
      op.command.args.push('-MaintenanceId',b.binding.maintenanceId);
      if(op.step==='StartWorker')op.command.args.push('-ExpectedWorkerManifestSha256',h,'-ExpectedDjangoManifestSha256',h);
      if(op.step==='DeployApp')op.command.args.push('-PreparedAppId',b.binding.djangoPreparedAppId,'-PreparedAppSha256',b.binding.djangoPreparedReceiptSha256);
      op.command.files=[{path:'D:/isolated/tools/release-lifecycle-step.ps1',sha256:h},{path:'D:/isolated/tools/process-deadline.ps1',sha256:h}];
    }else if(op.kind==='migration-addition'){
      op.command.args.unshift('-File','D:/isolated/tools/bi-app-adopt.ps1');op.command.files=[{path:'D:/isolated/tools/bi-app-adopt.ps1',sha256:h}];
    }else if(['backup','restore'].includes(op.kind)){
      const suffix=op.phase.endsWith('pre')?'pre':'post';
      op.command.args=['-File','D:/isolated/tools/django-postgres-maintenance.ps1','-Action',op.kind==='backup'?'Backup':'RestoreRehearsal','-Execute'];
      op.command.files=[{path:'D:/isolated/tools/django-postgres-maintenance.ps1',sha256:h}];
      op.assertions=[{path:'status',equals:'completed'},{path:'serviceStateChanged',equals:false}];
      if(op.kind==='restore'){
        op.backupOperationId=`backup-${suffix}`;op.command.args.push('-ConfirmedIsolatedRestore','-BackupDirectory',`{receipt:backup-${suffix}:backupDirectory}`,'-ApprovedManifestSha256',`{receipt:backup-${suffix}:manifestSha256}`);
        op.assertions.push({path:'productionDatabaseTouched',equals:false},{path:'cleanupStatus',equals:'isolated_data_removed'},{path:'profileRestoreVerified',equals:true},{path:'sequenceHealthVerified',equals:true});
      }
    }else{op.phase='switch';op.planSha256=h;}
  }
  b.operations.unshift({id:'prepare',phase:'prepare',kind:'worker-plan',mutating:false,planSha256:h});
  b.operations.push({id:'acceptance',phase:'acceptance',mutating:false,covers:requirements.strict.acceptance},{id:'closeout',phase:'closeout',mutating:false});
  return makeBatch({...b,id:'audit-isolated-fixture',before,after,tests,acceptance:requirements.strict.acceptance,rollback:{application:'compatible successor',compatibility:'audit columns retained',failureState:'retain maintenance and exact owner'}});
}
test('sealed batch executes the protected order and stops on unknown install without replay',async()=>{
  const b=sealedFixture();verifyBatch(b,b.batchSha256);
  const root=await mkdtemp(path.join(tmpdir(),'audit-batch-'));const called=[];
  const options={batch:b,approved:b.batchSha256,root,lock:async f=>f({}),collectCurrent:async()=>({binding:b.binding}),run:async op=>{called.push(op.id);if(op.id==='install')throw new Error('simulated response loss');return {status:'passed'};}};
  try {
    await assert.rejects(executeBatch(options),/unknown/);
    assert.equal(called.at(-1),'install');assert.ok(!called.includes('startworker'));
    const count=called.length;await assert.rejects(executeBatch(options),/Unknown\/interrupted/);assert.equal(called.length,count);
  }finally{await rm(root,{recursive:true,force:true});}
});
for(const shell of ['powershell.exe','pwsh.exe'])test(`original Django audit dispatch and request isolation in ${shell}`,()=>{
  const script=String.raw`
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SERVICE__',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse failed'}
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-NoUnapprovedProtectedAiMigration'},$true)
Invoke-Expression $fn.Extent.Text
$RuntimeRoot='D:\teruisi-runtime\django-sales';$Python='private-python';$BackendRoot='D:\private\backend'
$IntegrationEvidencePath='D:\private\review.json';$IntegrationEvidenceSha256='a'*64;$IntegrationOperationId='b'*32
$script:active=$false;$script:plan=$false;$script:proof='verified';$script:invocations=@()
function Test-Path([string]$LiteralPath,$PathType){
 if($LiteralPath -eq $IntegrationEvidencePath){return $true}
 if($LiteralPath -like '*jackyun_audit_addition.py'){return $true}
 if($LiteralPath -like '*jackyun-audit-addition-active.json'){return $script:active}
 if($LiteralPath -like '*jackyun-audit-additions*plan.json'){return $script:plan}
 return $false
}
function Read-JsonFile {return @{version='teruisi-jackyun-audit-addition-v1'}}
function Invoke-BoundedNativeProcess($Exe,$Arguments,$Working){$script:invocations+=,@($Arguments);return @{}}
function ConvertFrom-UniqueNativeJson {return @{status=$script:proof}}
Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
if($script:invocations[-1][1] -cne 'admission' -or $script:invocations[-1] -notcontains $IntegrationEvidenceSha256){throw 'Admission binding absent'}
$IntegrationEvidencePath='';$script:plan=$true
Assert-NoUnapprovedProtectedAiMigration 'DeployApp'
if($script:invocations[-1][1] -cne 'deployment' -or $script:invocations[-1] -notcontains $IntegrationOperationId){throw 'Plan deployment binding absent'}
$script:active=$true
Assert-NoUnapprovedProtectedAiMigration 'Django migrate'
if($script:invocations[-1][1] -cne 'release'){throw 'Ordinary startup bypassed receipt gate'}
$script:proof='blocked';$rejected=$false
try{Assert-NoUnapprovedProtectedAiMigration 'Django migrate'}catch{$rejected=$true}
if(-not $rejected){throw 'Blocked evidence admitted'}
$ast=[Management.Automation.Language.Parser]::ParseFile('__ADOPT__',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'adopt parse failed'}
$capture=$ast.EndBlock.Statements | Where-Object {$_.Extent.Text.StartsWith('$biRequest=')}
foreach($Action in @('Plan','Install','Reconcile','Finalize')){
 $AdditionKind='JackyunAudit';$SourceRoot='D:\private';$OperationId='b'*32;$MaintenanceId='c'*32;$Execute=[switch]$true
 Invoke-Expression $capture.Extent.Text
 $Action='Status';$Execute=[switch]$false;$AdditionKind='BiErpGoal'
 if(-not $biRequest.Execute -or $biRequest.Action -ceq 'Status' -or $biRequest.AdditionKind -cne 'JackyunAudit'){throw 'Dot-source parameter clobber not isolated'}
}
Write-Output 'passed'
`.replace('__SERVICE__',path.resolve('tools/django-local-service.ps1').replaceAll("'","''")).replace('__ADOPT__',path.resolve('tools/bi-app-adopt.ps1').replaceAll("'","''"));
  const r=spawnSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/passed/);
});
