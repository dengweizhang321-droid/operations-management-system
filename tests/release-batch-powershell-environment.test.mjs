import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { productionCommandEnvironment, productionCommandArguments, runApprovedOperation } from '../tools/release-batch.mjs';
import { safeFileDigest } from '../tools/release-impact.mjs';
import { runReadOnlyPowerShell } from '../tools/release-batch-admission.mjs';

const host = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const modules = path.win32.join(path.win32.dirname(host), 'Modules');
test('PS5 child uses its system modules, removes inherited library-only flags and preserves its parent', () => {
  const parent = { PSModulePath: 'poison', psmodulepath: 'second-poison',
    TERUISI_DJANGO_SERVICE_LIBRARY_ONLY: '1', teruisi_django_maintenance_library_only: '1',
    KEEP_RUNTIME_VALUE: 'synthetic', PATH: process.env.PATH };
  const before = { ...parent };
  const child = productionCommandEnvironment(host,parent);
  assert.deepEqual(parent,before);
  assert.equal(child.PSModulePath,modules);
  assert.equal(child.psmodulepath,undefined);
  assert.equal(child.TERUISI_DJANGO_SERVICE_LIBRARY_ONLY,undefined);
  assert.equal(child.teruisi_django_maintenance_library_only,undefined);
  assert.equal(child.KEEP_RUNTIME_VALUE,'synthetic');
  assert.equal(child.PATH,parent.PATH);
});
test('actual readonly admission caller uses the same safe native transport', {skip:process.platform!=='win32',timeout:90000}, async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-release-ps5-admission-'));
  try {
    const file=path.join(root,'readonly 中文.ps1');
    await writeFile(file,'\uFEFF'+String.raw`param([string]$Action,[switch]$Json)
$ErrorActionPreference='Stop'
$null=Microsoft.PowerShell.Security\Get-Acl -LiteralPath $PSScriptRoot
[ordered]@{status='completed';action=$Action;label='运营管理系统';serviceStateChanged=$false} | ConvertTo-Json -Compress
`,'utf8');
    const parent=process.env.PSModulePath;
    const result=await runReadOnlyPowerShell(file,['-Action','Status','-Json'],'isolated readonly admission fixture');
    assert.deepEqual(JSON.parse(result.stdout.trim()),{status:'completed',action:'Status',label:'运营管理系统',serviceStateChanged:false});
    assert.equal(process.env.PSModulePath,parent);
  } finally {
    assert.equal(path.dirname(root),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('teruisi-release-ps5-admission-'));
    await rm(root,{recursive:true,force:true});
  }
});
test('Node and non-system shell commands retain their exact approved environment', () => {
  const parent={PSModulePath:'unchanged',TERUISI_DJANGO_SERVICE_LIBRARY_ONLY:'1'};
  assert.equal(productionCommandEnvironment(process.execPath,parent),parent);
  assert.equal(productionCommandEnvironment('D:/private/powershell.exe',parent),parent);
  const args=['tools/read.mjs','literal'];
  assert.equal(productionCommandArguments(process.execPath,args),args);
});
test('PS5 transport binds File argv as data and rejects ambiguous parameter syntax', () => {
  const file="D:\\合成目录\\quote' file.ps1",value="中文 '$() ` literal";
  const argv=['-NoProfile','-NonInteractive','-File',file,'-Value',value,'-Execute'];
  const result=productionCommandArguments(host,argv);
  const boot=Buffer.from(result[3],'base64').toString('utf16le');
  assert.deepEqual(result.slice(0,3),['-NoProfile','-NonInteractive','-EncodedCommand']);
  assert.equal(boot.includes(value),false);
  const payload=JSON.parse(Buffer.from(boot.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1],'base64').toString('utf8'));
  assert.deepEqual(payload,{file,parameters:{Value:value,Execute:true}});
  assert.throws(()=>productionCommandArguments(host,['-Command','arbitrary']),/reviewed File/);
  assert.throws(()=>productionCommandArguments(host,['-NoProfile','-NonInteractive','-File','relative.ps1']),/reviewed File/);
  assert.throws(()=>productionCommandArguments(host,[...argv,'-value','other']),/duplicate/);
  assert.throws(()=>productionCommandArguments(host,argv.concat('positional')),/Invalid/);
});
test('actual approved runner survives a PS7-polluted parent while original PS5 ACL command fails', {skip:process.platform!=='win32',timeout:90000}, async () => {
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-release-ps5-env-'));
  const file=path.join(root,"probe 运营 ' file.ps1");
  const literal="中文 '$() ` literal";
  const original={...process.env};
  try {
    const candidates=(original.PSModulePath??'').split(';');
    let incompatible;
    for(const dir of candidates) {
      if(!/powershell[\\/]Modules$/i.test(dir)||/WindowsPowerShell/i.test(dir))continue;
      try {await access(path.join(dir,'Microsoft.PowerShell.Security','Microsoft.PowerShell.Security.psd1'));incompatible=dir;break;}catch{}
    }
    assert.ok(incompatible,'This Windows integration fixture needs the actual installed PS7 module directory');
    await writeFile(file,'\uFEFF'+String.raw`param([string]$Value,[switch]$Execute)
$ErrorActionPreference='Stop'
$null=Microsoft.PowerShell.Security\Get-Acl -LiteralPath $PSScriptRoot
$flags=[bool]($env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -or $env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY)
[ordered]@{status='passed';psMajor=$PSVersionTable.PSVersion.Major;libraryFlagsPresent=$flags;label='运营管理系统';value=$Value;execute=$Execute.IsPresent} | ConvertTo-Json -Compress
`,'utf8');
    const dirty={...original,PSModulePath:incompatible,TERUISI_DJANGO_SERVICE_LIBRARY_ONLY:'1',TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY:'1'};
    const baseline=spawnSync(host,['-NoProfile','-NonInteractive','-File',file],{env:dirty,windowsHide:true,encoding:'utf8',timeout:30000});
    assert.notEqual(baseline.status,0,'Polluted PS5 baseline must actually fail');
    assert.match(baseline.stderr,/CouldNotAutoLoadModule|Get-Acl/);
    process.env.PSModulePath=incompatible;
    process.env.TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';
    process.env.TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1';
    const op={id:'actual-ps5-readonly-fixture',kind:'command',phase:'acceptance',mutating:false,covers:['permissions'],
      command:{executable:host,args:['-NoProfile','-NonInteractive','-File',file,'-Value',literal,'-Execute'],cwd:root,timeoutMs:30000,
        files:[{path:host,sha256:await safeFileDigest(host)},{path:file,sha256:await safeFileDigest(file)}]},
      assertions:[{path:'status',equals:'passed'},{path:'psMajor',equals:5},{path:'libraryFlagsPresent',equals:false},{path:'label',equals:'运营管理系统'},{path:'value',equals:literal},{path:'execute',equals:true}]};
    const result=await runApprovedOperation(op,{batch:{id:'isolated-ps5-environment'},lease:null,state:{latest:new Map()}});
    assert.equal(result.status,'passed');
    assert.equal(process.env.PSModulePath,incompatible);
    assert.equal(process.env.TERUISI_DJANGO_SERVICE_LIBRARY_ONLY,'1');
    const failFile=path.join(root,'throw.ps1');
    await writeFile(failFile,'\uFEFF'+`Write-Output '{"status":"passed"}'; throw 'synthetic-script-failure'\n`,'utf8');
    const failed={...op,command:{...op.command,args:['-NoProfile','-NonInteractive','-File',failFile],
      files:[op.command.files[0],{path:failFile,sha256:await safeFileDigest(failFile)}]},assertions:[{path:'status',equals:'passed'}]};
    await assert.rejects(runApprovedOperation(failed,{batch:{id:'isolated-ps5-failure'},lease:null,state:{latest:new Map()}}),/exit=1/);
    await writeFile(failFile,'\uFEFF'+`Write-Output '{"status":"passed"}'; exit 9\n`,'utf8');
    failed.command.files[1].sha256=await safeFileDigest(failFile);
    await assert.rejects(runApprovedOperation(failed,{batch:{id:'isolated-ps5-exit'},lease:null,state:{latest:new Map()}}),e=>e.processEvidence.exitCode===9);

  } finally {
    for(const key of ['PSModulePath','TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY']) {
      if(Object.hasOwn(original,key))process.env[key]=original[key];else delete process.env[key];
    }
    assert.equal(path.dirname(root),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('teruisi-release-ps5-env-'));
    await rm(root,{recursive:true,force:true});
  }
});
test('original nested lifecycle adapter also preserves Unicode through its native child', {skip:process.platform!=='win32',timeout:90000}, async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-release-ps5-nested-'));
  try {
    const fake=path.join(root,'fake.ps1'),manifest=path.join(root,'deployment.json'),wrapper=path.join(root,'release-lifecycle-step.ps1');
    await writeFile(fake,'\uFEFF'+String.raw`param([string]$Action,[switch]$Json)
$ErrorActionPreference='Stop'
$null=Microsoft.PowerShell.Security\Get-Acl -LiteralPath $PSScriptRoot
[ordered]@{status='passed';label='运营管理系统';echoAction=$Action} | ConvertTo-Json -Compress
`,'utf8');
    await writeFile(manifest,'{}','utf8');
    const source=await (await import('node:fs/promises')).readFile(new URL('../tools/release-lifecycle-step.ps1',import.meta.url),'utf8');
    const fixture=source.replace(/\$installedDjango='[^']*'/,`$installedDjango='${fake.replaceAll("'","''")}'`).replace(/\$deployment='[^']*'/,`$deployment='${manifest.replaceAll("'","''")}'`);
    await writeFile(wrapper,fixture,'utf8');
    await writeFile(path.join(root,'process-deadline.ps1'),await (await import('node:fs/promises')).readFile(new URL('../tools/process-deadline.ps1',import.meta.url)));
    const op={id:'nested-ps5-lifecycle-fixture',kind:'lifecycle',phase:'acceptance',step:'AggregateStatus',mutating:false,covers:['components'],
      command:{executable:host,args:['-NoProfile','-NonInteractive','-File',wrapper,'-Step','AggregateStatus'],cwd:root,timeoutMs:30000,
        files:[{path:host,sha256:await safeFileDigest(host)},{path:wrapper,sha256:await safeFileDigest(wrapper)},{path:path.join(root,'process-deadline.ps1'),sha256:await safeFileDigest(path.join(root,'process-deadline.ps1'))}]},
      assertions:[{path:'status',equals:'completed'},{path:'aggregate.label',equals:'运营管理系统'},{path:'aggregate.echoAction',equals:'AggregateStatus'}]};
    assert.equal((await runApprovedOperation(op,{batch:{id:'isolated-nested-ps5'},lease:null,state:{latest:new Map()}})).status,'passed');
  } finally {
    assert.equal(path.dirname(root),path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('teruisi-release-ps5-nested-'));
    await rm(root,{recursive:true,force:true});
  }
});
