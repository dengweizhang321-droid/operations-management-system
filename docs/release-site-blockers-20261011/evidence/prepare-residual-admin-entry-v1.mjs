import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const hash=b=>createHash('sha256').update(b).digest('hex');
const originalRaw=await readFile(root+'/ADMIN_READONLY_PACKET_V2.json');
assert.equal(hash(originalRaw),'9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38');
const script=path.resolve(fileURLToPath(new URL('./Probe-ResidualProcessMetadataV2.ps1',import.meta.url)));
const baselinePath=root+'/ADMIN_REFERENCE_DIAGNOSTIC_V1.json';
assert.equal(hash(await readFile(baselinePath)),'4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69');
const packet={version:'teruisi-five-process-readonly-packet-v1',preparedAt:new Date().toISOString(),
  windowsSid:JSON.parse(originalRaw).windowsSid,productionApproved:false,
  originalPacketSha256:hash(originalRaw),baselineSha256:hash(await readFile(baselinePath)),
  script:{path:script,sha256:hash(await readFile(script))},
  outputPath:root+'/ADMIN_RESIDUAL_METADATA_V2.json',
  scope:['Five fixed PID instances from exact baseline; OpenProcess 0x1000 only, extended-basic and protection-level metadata',
    'Only exact same-instance System32 LsaIso/NgcIso image metadata, file hash and built-in Authenticode signature',
    'No Debug privilege, remote memory, injection, termination, services, batch, backup/restore, scheduler or business writes',
    'Create-only redacted output in fixed E audit root; diagnosis does not grant production admission'],
  requiresExistingAdministrator:true};
const raw=Buffer.from(JSON.stringify(packet,null,2)+'\n'),packetSha=hash(raw);
const bootstrap=`$ErrorActionPreference='Stop'
function H([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$r=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\ADMIN_RESIDUAL_PACKET_V1.json')
if((H $r) -cne '${packetSha}'){throw 'Packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
if($p.version -cne 'teruisi-five-process-readonly-packet-v1' -or $p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Wrong mode'}
$i=[Security.Principal.WindowsIdentity]::GetCurrent()
if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Use the existing approved administrator PowerShell; no automatic elevation'}
function P($v){$c=[IO.Path]::GetFullPath($v);while($c){$x=Get-Item -LiteralPath $c -Force;if(($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected path'};$a=[IO.Path]::GetDirectoryName($c);if($a -eq $c){break};$c=$a}}
if([IO.Path]::GetFullPath($p.outputPath) -cne 'E:\\codex-artifacts\\release-site-blockers-20261011\\ADMIN_RESIDUAL_METADATA_V2.json'){throw 'Output scope changed'}
P ([IO.Path]::GetDirectoryName($p.outputPath));if(Test-Path -LiteralPath $p.outputPath){throw 'Create-only output exists'}
P $p.script.path
$f=[IO.File]::Open($p.script.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$b=[IO.File]::ReadAllBytes($p.script.path);if((H $b) -cne $p.script.sha256){throw 'Script drift'};$env:PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules';& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath $p.outputPath}finally{$f.Dispose()}
`;
const encoded=Buffer.from(bootstrap,'utf16le').toString('base64');
const entry=`@echo off\r\necho TERUISI FIVE-PROCESS READ-ONLY TYPE AUDIT\r\necho Requires your existing administrator PowerShell. No production release or service action.\r\n"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ${encoded}\r\necho.\r\necho Keep errors. Fixed audit result: E:\\codex-artifacts\\release-site-blockers-20261011\\ADMIN_RESIDUAL_METADATA_V2.json\r\npause\r\n`;
assert.ok(entry.length<7900,'Visible entry command too long');
await writeFile(root+'/ADMIN_RESIDUAL_PACKET_V1.json',raw,{flag:'wx'});
await writeFile(root+'/ADMIN_RESIDUAL_BOOTSTRAP_V1.ps1',bootstrap,{flag:'wx'});
await writeFile(root+'/RUN_READONLY_RESIDUAL_AUDIT.cmd',entry,{flag:'wx'});
await writeFile(root+'/ADMIN_RESIDUAL_ENTRY_V1.json',JSON.stringify({packetSha256:packetSha,scriptSha256:packet.script.sha256,entrySha256:hash(entry),bootstrapSha256:hash(bootstrap),commandCharacters:entry.length,status:'prepared-not-executed',productionApproved:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({packetSha256:packetSha,commandCharacters:entry.length,status:'prepared-not-executed'}));
