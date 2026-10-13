import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=await readFile(root+'/ADMIN_RESIDUAL_PACKET_V2.json');
assert.equal(sha(original),'bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0');
assert.equal(sha(await readFile(root+'/ADMIN_RESIDUAL_METADATA_V2.json')),'0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6');
const scriptPath=fileURLToPath(new URL('./Probe-WslHostAssociation.ps1',import.meta.url));
const packet={version:'teruisi-wsl-host-readonly-packet-v1',preparedAt:new Date().toISOString(),
 windowsSid:JSON.parse(original).windowsSid,productionApproved:false,requiresExistingAdministrator:true,
 originalPacketSha256:sha(original),baselineSha256:'0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6',
 script:{path:scriptPath,sha256:sha(await readFile(scriptPath))},outputPath:root+'/WSL_HOST_ASSOCIATION_ADMIN_V1.json',
 scope:['Existing HCS enumeration twice (query operation handles only, no VM handles or VM action)',
 'Only fixed vmmem53880 and parentvmwp7788 process metadata, 0x1000; bound birth, actual image, command GUID shape in memory',
 'Only exact System32 vmwp.exe pinned hash and Authenticode signature; platform trust/revocation may follow system settings',
 'Create-only redacted E audit result, no raw command persistence',
 'No Debug, remote memory, injection, process/service/WSL lifecycle, maintenance, batch execution, backup/restore, scheduler or business operation']};
const raw=Buffer.from(JSON.stringify(packet,null,2)+'\n'),packetSha=sha(raw);
const bootstrap=`$ErrorActionPreference='Stop'
function Get-HostPacketBytesSha256([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$r=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\WSL_HOST_READONLY_PACKET_V2.json')
if((Get-HostPacketBytesSha256 $r) -cne '${packetSha}'){throw 'Host packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
if($p.version -cne 'teruisi-wsl-host-readonly-packet-v1' -or $p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Wrong packet mode'}
$i=[Security.Principal.WindowsIdentity]::GetCurrent()
if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Existing administrator PowerShell required; no automatic elevation'}
function Assert-HostPacketPhysicalPath($v){$c=[IO.Path]::GetFullPath($v);while($c){$x=Get-Item -LiteralPath $c -Force;if(($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected host audit path'};$a=[IO.Path]::GetDirectoryName($c);if($a -eq $c){break};$c=$a}}
if([IO.Path]::GetFullPath($p.outputPath) -cne 'E:\\codex-artifacts\\release-site-blockers-20261011\\WSL_HOST_ASSOCIATION_ADMIN_V1.json'){throw 'Output outside scope'}
Assert-HostPacketPhysicalPath ([IO.Path]::GetDirectoryName($p.outputPath));if(Test-Path -LiteralPath $p.outputPath){throw 'Create-only output exists'}
$baseline=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\ADMIN_RESIDUAL_METADATA_V2.json');if((Get-HostPacketBytesSha256 $baseline) -cne $p.baselineSha256){throw 'Approved baseline drift'}
Assert-HostPacketPhysicalPath $p.script.path
$f=[IO.File]::Open($p.script.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$b=[IO.File]::ReadAllBytes($p.script.path);if((Get-HostPacketBytesSha256 $b) -cne $p.script.sha256){throw 'Host source drift'};$env:PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules';& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath $p.outputPath}finally{$f.Dispose()}
`;
const cmd=`@echo off\r\necho TERUISI READ-ONLY WSL HOST ASSOCIATION\r\necho Existing administrator window only. No production release, restart, backup or restore.\r\n"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(bootstrap,'utf16le').toString('base64')}\r\necho.\r\necho Keep all errors. Result: E:\\codex-artifacts\\release-site-blockers-20261011\\WSL_HOST_ASSOCIATION_ADMIN_V1.json\r\npause\r\n`;
assert.ok(cmd.length<7900);
await writeFile(root+'/WSL_HOST_READONLY_PACKET_V2.json',raw,{flag:'wx'});
await writeFile(root+'/WSL_HOST_READONLY_BOOTSTRAP_V2.ps1',bootstrap,{flag:'wx'});
await writeFile(root+'/RUN_READONLY_WSL_HOST_AUDIT_V2.cmd',cmd,{flag:'wx'});
await writeFile(root+'/WSL_HOST_READONLY_ENTRY_V2.json',JSON.stringify({packetSha256:packetSha,scriptSha256:packet.script.sha256,bootstrapSha256:sha(bootstrap),entrySha256:sha(cmd),commandCharacters:cmd.length,status:'prepared-not-executed',productionApproved:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({packetSha256:packetSha,commandCharacters:cmd.length,status:'prepared-not-executed'}));
