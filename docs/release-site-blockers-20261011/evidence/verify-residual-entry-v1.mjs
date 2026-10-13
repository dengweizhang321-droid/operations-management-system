import {readFile,writeFile,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const hash=b=>createHash('sha256').update(b).digest('hex');
const packetRaw=await readFile(root+'/ADMIN_RESIDUAL_PACKET_V1.json');
assert.equal(hash(packetRaw),'cea94364113ca5f7904313a15e10c3b73e59341fa1e257ba104f5ff8ba1b5d7e');
const packet=JSON.parse(packetRaw),manifest=JSON.parse(await readFile(root+'/ADMIN_RESIDUAL_ENTRY_V1.json'));
const bootstrap=await readFile(root+'/ADMIN_RESIDUAL_BOOTSTRAP_V1.ps1');
const entry=await readFile(root+'/RUN_READONLY_RESIDUAL_AUDIT.cmd');
assert.equal(hash(bootstrap),manifest.bootstrapSha256);assert.equal(hash(entry),manifest.entrySha256);
assert.equal(hash(await readFile(packet.script.path)),packet.script.sha256);assert.equal(manifest.packetSha256,hash(packetRaw));
assert.equal(packet.productionApproved,false);assert.equal(packet.requiresExistingAdministrator,true);
const encoded=/ -EncodedCommand ([A-Za-z0-9+/=]+)\r?\n/.exec(entry.toString())[1];
assert.equal(Buffer.from(encoded,'base64').toString('utf16le'),bootstrap.toString('utf8'));
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const role=spawnSync(ps,['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{windowsHide:true,encoding:'utf8',timeout:10000});
assert.equal(role.status,0);assert.equal(role.stdout.trim(),'False','Do not execute actual diagnostic under an administrator token as a test');
const result=spawnSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:128*1024});
assert.notEqual(result.status,0);assert.match(result.stderr,/Use the existing approved administrator PowerShell/);
await assert.rejects(lstat(packet.outputPath),{code:'ENOENT'});
const report={version:'residual-entry-verification-v1',packetSha256:hash(packetRaw),scriptSha256:packet.script.sha256,entrySha256:hash(entry),
 exactEncodedSource:true,ordinaryTokenRefused:true,diagnosticOutputAbsent:true,nativeTargetQueriesByBootstrap:0,
 productionActions:0,scope:'Real ordinary-token refusal before diagnostic invocation; not an administrator capture or a production gate test.'};
await writeFile(root+'/ADMIN_RESIDUAL_ENTRY_VERIFICATION_V1.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
