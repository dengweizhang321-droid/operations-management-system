import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const sha='9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38';
const packetRaw=await readFile(root+'/ADMIN_READONLY_PACKET_V2.json');
if(createHash('sha256').update(packetRaw).digest('hex')!==sha)throw Error('Approved packet drift');
const bootstrap=`$ErrorActionPreference='Stop'
$r=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\ADMIN_READONLY_PACKET_V2.json')
$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($r))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
if($h -cne '${sha}'){throw 'Readonly packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
$f=[IO.File]::Open([string]$p.launcher.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $p.launcher.sha256){throw 'Readonly launcher drift'};& $p.launcher.path -PacketSha256 '${sha}' -Launch}finally{$f.Dispose()}
Write-Host 'Readonly request dispatched. No release, restart, backup or restore was requested.'
`;
const encoded=Buffer.from(bootstrap,'utf16le').toString('base64');
const command=`@echo off\r\necho TERUISI READ-ONLY ADMIN AUDIT\r\necho This reads process metadata only. It does NOT publish or restart services.\r\necho Approve the Windows administrator dialog if it appears.\r\n"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -EncodedCommand ${encoded}\r\necho.\r\necho Keep any error message. Audit results are written under E:\\codex-artifacts\\release-site-blockers-20261011\r\npause\r\n`;
if(command.length>7900)throw Error('Visible cmd exceeds conservative Windows shell bound');
await writeFile(root+'/RUN_READONLY_ADMIN_AUDIT.cmd',command,{flag:'wx'});
await writeFile(root+'/VISIBLE_ENTRY_BOOTSTRAP.ps1',bootstrap,{flag:'wx'});
await writeFile(root+'/VISIBLE_ENTRY_MANIFEST.json',JSON.stringify({version:'teruisi-user-visible-readonly-entry-v1',at:new Date().toISOString(),packetSha256:sha,entrySha256:createHash('sha256').update(command).digest('hex'),bootstrapSha256:createHash('sha256').update(bootstrap).digest('hex'),commandCharacters:command.length,scope:'Same approved packet; visible console and standard UAC only; no expanded operation permissions.',productionActions:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'prepared',commandCharacters:command.length,packetUnchanged:true}));
