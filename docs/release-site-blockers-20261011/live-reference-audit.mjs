// Proposed external guard collector. No saved inventory input or fallback path.
import {readFile,writeFile,lstat,realpath,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const evidenceRoot='E:/codex-artifacts/release-site-blockers-20261011';
const pins=Object.freeze({
 'live-os-instance-policy.mjs':'ab2aaf2fbd51f480dc69ece07bd739bce26a6bd2873299f6eb0df28c73738b36',
 'live-wsl-policy.mjs':'83c30ab48fe6768a13d8f8f3df91d694ad14aa21a0a4cea7d2db4bd52e128279',
 'system-wsl-verifier.mjs':'96a975a02c010e1b018f2c00c9b345b2a602ff2581b5e7916fab050e23ca8819',
 'live-wsl-host-policy.mjs':'0abd0bc9b2b3af5bec26e5ccc924690ae75f68615ab8b9a3994d13fd74c4ecc8',
 'Collect-LiveWslHostAssociation.ps1':'667200760cbaea60ceeb75b20a328341889b293703c29541236d72e3e9a303f1',
 'collect-live-wsl.py':'81c2d00aec02bdc303ccb530182216d441be4f8abc79dfc443882c7492eece5d',
 'Collect-LiveProcessIdentity.ps1':'280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12',
 'Probe-ResidualProcessMetadataV2.ps1':'6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9'
});
const sha=b=>createHash('sha256').update(b).digest('hex');
function identity(s){return [s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');}
async function physical(file){for(let at=path.resolve(file);;){assert.ok(!(await lstat(at)).isSymbolicLink(),'Redirected guard path');assert.equal((await realpath(at)).toLowerCase(),at.toLowerCase(),'Guard path alias');const next=path.dirname(at);if(next===at)break;at=next;}}
async function pinned(name,root){const file=path.join(root,name);await physical(file);const before=await lstat(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n);const raw=await readFile(file);assert.equal(identity(await lstat(file,{bigint:true})),identity(before));assert.equal(sha(raw),pins[name],name+' drift');return raw;}
function run(exe,args,input,timeout=120000){const r=spawnSync(exe,args,{input,windowsHide:true,timeout,maxBuffer:8*1024*1024,env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'}});if(r.error||r.status!==0){const error=new Error('Live metadata transport or process failed');error.captureFailure={exitCode:r.status,errorCode:r.error?.code??null,stderrSha256:sha(r.stderr??Buffer.alloc(0)),requiresAdministrator:(r.stderr?.toString('utf8')??'').includes('Live guard requires its approved administrator execution identity')};throw error;}return r.stdout;}
function parse(raw){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
const nativeBootstrap=String.raw`$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Live guard requires its approved administrator execution identity; no elevation is attempted'}
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
$text=[Console]::In.ReadToEnd();if($text.Length -gt 1048576){throw 'Source envelope too large'};$p=$text|ConvertFrom-Json
function Get-LiveSourceHash([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
if($p.inventorySha -cne '280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12' -or $p.nativeSha -cne '6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9'){throw 'Wrong fixed source binding'}
$a=[Convert]::FromBase64String($p.inventory);$b=[Convert]::FromBase64String($p.native)
if((Get-LiveSourceHash $a) -cne $p.inventorySha -or (Get-LiveSourceHash $b) -cne $p.nativeSha){throw 'Captured source drift'}
if($p.runId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid evidence identifier'}
$dir='E:\codex-artifacts\release-site-blockers-20261011\_live-reference-observations'
$at=$dir;while($at){$i=Get-Item -LiteralPath $at -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected evidence directory'};$next=[IO.Path]::GetDirectoryName($at);if($next -eq $at){break};$at=$next}
$inventory=@(& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($a))) -OutputPath (Join-Path $dir ($p.runId+'-inventory-summary.json'))) -join [Environment]::NewLine
$native=@(& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath (Join-Path $dir ($p.runId+'-native.json'))) -join [Environment]::NewLine
[pscustomobject]@{inventory=($inventory|ConvertFrom-Json);native=($native|ConvertFrom-Json)}|ConvertTo-Json -Depth 14 -Compress
`;
const hostBootstrap=String.raw`$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Live guard requires its approved administrator execution identity; no elevation is attempted'}
$text=[Console]::In.ReadToEnd();if($text.Length -gt 1048576){throw 'Host source envelope too large'};$p=$text|ConvertFrom-Json
if($p.runId -notmatch '^[a-f0-9-]{36}$' -or $p.phase -cnotin @('before','after')){throw 'Invalid host evidence identity'}
$b=[Convert]::FromBase64String($p.source);$s=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
if($hash -cne '667200760cbaea60ceeb75b20a328341889b293703c29541236d72e3e9a303f1'){throw 'Host implementation drift'}
$dir='E:\codex-artifacts\release-site-blockers-20261011\_live-reference-observations';$at=$dir
while($at){$i=Get-Item -LiteralPath $at -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected evidence path'};$next=[IO.Path]::GetDirectoryName($at);if($next -eq $at){break};$at=$next}
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath (Join-Path $dir ($p.runId+'-'+$p.phase+'-host.json'))
`;
export async function runLiveReferenceAudit({inspectProcessReference,inspectReferences,sourceRoot}){
 assert.equal(typeof inspectProcessReference,'function');assert.equal(typeof inspectReferences,'function');
 assert.ok(path.isAbsolute(sourceRoot));const root=path.resolve(sourceRoot);
 const runId=randomUUID(),dir=path.join(evidenceRoot,'_live-reference-observations');await physical(evidenceRoot);await mkdir(dir,{recursive:true});await physical(dir);
 const record={version:'teruisi-proposed-live-reference-audit-v1',runId,at:new Date().toISOString(),status:'started',stages:[],references:[],unknown:[],classified:[],departed:[],productionActions:0,rawProcessMetadataPersisted:false};
 const save=async suffix=>writeFile(path.join(dir,runId+'-'+suffix+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 await save('started');
 try{
  const captured={};for(const name of Object.keys(pins))captured[name]=await pinned(name,root);
  const nativePolicy=await import('data:text/javascript;base64,'+captured['live-os-instance-policy.mjs'].toString('base64'));
  const guestPolicy=await import('data:text/javascript;base64,'+captured['live-wsl-policy.mjs'].toString('base64'));
  const systemWsl=await import('data:text/javascript;base64,'+captured['system-wsl-verifier.mjs'].toString('base64'));
  const hostPolicy=await import('data:text/javascript;base64,'+captured['live-wsl-host-policy.mjs'].toString('base64'));
  record.stages.push('implementation-closure-pinned');
  const sourceEnvelope=Buffer.from(JSON.stringify({runId,inventory:captured['Collect-LiveProcessIdentity.ps1'].toString('base64'),inventorySha:pins['Collect-LiveProcessIdentity.ps1'],native:captured['Probe-ResidualProcessMetadataV2.ps1'].toString('base64'),nativeSha:pins['Probe-ResidualProcessMetadataV2.ps1']}));
  const frame=parse(run('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(nativeBootstrap,'utf16le').toString('base64')],sourceEnvelope));
  assert.equal(frame.native?.version,'astra-residual-process-metadata-v2');assert.equal(frame.native.isAdministrator,true);assert.equal(frame.native.productionActions,0);assert.equal(frame.native.baselineSha256,'4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69');
  assert.deepEqual(frame.native.records.map(n=>n.processId),[236,280,1700,6548,53880]);
  const current=frame.inventory;assert.ok(Array.isArray(current.processes)&&current.processes.length<=4096&&Array.isArray(current.tasks)&&current.tasks.length<=4096);
  assert.equal(current.summary?.version,'teruisi-live-process-identity-v1');record.inventorySummary=current.summary;
  assert.equal(new Set(current.processes.map(p=>p.ProcessId)).size,current.processes.length,'Duplicate live PID');
  for(const native of frame.native.records){const actor=current.processes.find(p=>p.ProcessId===native.processId);assert.ok(actor,'Reviewed instance absent from live inventory');assert.equal(native.identityStable,true);assert.equal(native.instanceMatchesBaseline,true);assert.equal(native.cimCreationUtc,actor.cimCreationUtc);}
  record.stages.push('live-native-and-cim-collected');let needsGuest=false;
  for(const process of current.processes){
   try{
    if(process.identityStable===false&&['pid-absent','same-instance-exited'].includes(process.departureProof?.kind)){record.departed.push(nativePolicy.validateKernelDeparture(process));continue;}
    // Run references before any metadata-absence exception can be considered.
    if(await inspectReferences(process.ExecutablePath)||await inspectReferences(process.CommandLine,{commandLine:true})){record.references.push({kind:'process',processId:process.ProcessId});continue;}
    assert.equal(process.identityStable,true,'CIM instance changed');
    const finding=await inspectProcessReference(process);if(!finding)continue;
    if(finding.kind!=='process-unknown'){record.references.push(finding);continue;}
    const native=frame.native.records.find(n=>n.processId===process.ProcessId);
    const classified=nativePolicy.classifyBoundOsInstance(process,native,finding);
    if(classified.kind==='requires-wsl-supplement')needsGuest=true;else record.classified.push(classified);
   }catch(error){record.unknown.push({kind:'process-unknown',processId:process.ProcessId,reasonSha256:sha(error.message)});}
  }
  for(const task of current.tasks){assert.ok(Array.isArray(task.actions));for(const action of task.actions){try{if(await inspectReferences(action.Execute)||await inspectReferences(action.Arguments,{commandLine:true})||await inspectReferences(action.WorkingDirectory)){record.references.push({kind:'scheduled-task',identitySha256:sha(task.identity)});break;}}catch{record.unknown.push({kind:'scheduled-task-unknown',identitySha256:sha(task.identity)});break;}}}
  const cwd=current.selectedCwd;try{assert.equal(cwd?.processId,47936);assert.equal(cwd.readable,true);assert.equal(cwd.identityStable,true);const actor=current.processes.find(p=>p.ProcessId===47936);assert.ok(actor?.identityStable===true&&typeof actor.cimCreationUtc==='string'&&actor.cimCreationUtc.length>0);assert.equal(cwd.cimCreationUtc,actor.cimCreationUtc);assert.match(cwd.CurrentDirectory,/^[A-Za-z]:[\\/]/);assert.ok(!/[\r\n\0]/.test(cwd.CurrentDirectory));if(await inspectReferences(cwd.CurrentDirectory))record.references.push({kind:'selected-cwd',processId:47936});}catch{record.unknown.push({kind:'selected-cwd-unknown',processId:47936});}
  if(needsGuest){
   function collectHost(phase){return parse(run('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(hostBootstrap,'utf16le').toString('base64')],Buffer.from(JSON.stringify({runId,phase,source:captured['Collect-LiveWslHostAssociation.ps1'].toString('base64')}))));}
   const hostBefore=collectHost('before');assert.equal(hostBefore.record?.status,'association-metadata-collected-not-admission','Live host association before guest query remains unproven');
   const systemLease=await systemWsl.verifyPinnedSystemWsl({recordPath:path.join(evidenceRoot,'SYSTEM_WSL_IDENTITY_V1.json'),collectorPath:path.join(root,'Collect-SystemWslIdentity.ps1')});
   function running(){const b=run('C:/Windows/System32/wsl.exe',['--list','--running','--quiet'],undefined,30000);return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().split(/[\r\n]+/).filter(Boolean).sort();}
   assert.deepEqual(running(),['TERUISI-Pandas']);
   const guest=parse(run('C:/Windows/System32/wsl.exe',['--distribution','TERUISI-Pandas','--user','root','--exec','/usr/bin/python3','-I','-S','-'],captured['collect-live-wsl.py'],30000));
   record.guestObservation=guestPolicy.summarizeGuestShape(guest);record.stages.push('guest-metadata-collected');await save('guest-observed');
   assert.deepEqual(running(),['TERUISI-Pandas']);
   await systemWsl.assertSystemWslUnchanged(systemLease);record.systemWslIdentity={sha256:systemLease.sha256,evidencePath:systemLease.evidencePath};
   const checked=await guestPolicy.checkGuestMetadataReferences(guestPolicy.validateLiveGuestShape(guest),inspectReferences);
   record.references.push(...checked.references.map(r=>({kind:'guest-reference',...r})));record.guest={epoch:checked.epoch,btimeDiagnostic:checked.btimeDiagnostic,processCount:checked.processCount};
   record.stages.push('guest-shape-and-references-checked');
   const hostAfter=collectHost('after');const association=hostPolicy.validateLiveWslAssociation(hostBefore,hostAfter,checked.epoch);
   record.hostAssociation={...association,beforeEvidence:path.join(dir,runId+'-before-host.json'),afterEvidence:path.join(dir,runId+'-after-host.json')};
   record.classified.push({kind:'reviewed-live-wsl-instance',processId:53880,runtimeId:association.runtimeId});record.stages.push('live-host-guest-association-checked');
  }
  else record.unknown.push({kind:'reviewed-vmmem-shape-not-established',processId:53880});
  record.status=record.references.length||record.unknown.length?'blocked':'passed';await save('result');return record;
 }catch(error){record.status='blocked';record.failure={name:error.name,messageSha256:sha(error.message),captureFailure:error.captureFailure??null};try{await save('failure');}catch(saveError){error.saveFailure={name:saveError.name,code:saveError.code};}error.liveAudit={runId,stages:record.stages,failure:record.failure};throw error;}
}
