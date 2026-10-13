import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011';
const hash=b=>createHash('sha256').update(b).digest('hex');
const handoffRaw=await readFile(root+'/ASTRA_LIVE_GUARD_CORE_HANDOFF_V4.json');
assert.equal(hash(handoffRaw),process.argv[2],'Final independent handoff pin required');
const handoff=JSON.parse(handoffRaw),entries=[...handoff.files.map(f=>({path:f.path,sha256:f.sha256}))];
const qualifier=fileURLToPath(new URL('./run-live-reference-qualification-v2.mjs',import.meta.url));
entries.push({path:qualifier,sha256:hash(await readFile(qualifier))});
const source='E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs';entries.push({path:source,sha256:hash(await readFile(source))});
const node='C:/Program Files/nodejs/node.exe';entries.push({path:node,sha256:hash(await readFile(node))});
for(const pin of entries)assert.equal(hash(await readFile(pin.path)),pin.sha256);
const packet={version:'teruisi-live-reference-readonly-qualification-v1',createdAt:new Date().toISOString(),
 windowsSid:'S-1-5-21-815909789-107973518-1379257801-1001',productionApproved:false,qualifier,node,entries,
 scope:'Same authorized process/task/cwd, five native OS instances and existing WSL/HCS metadata interfaces, specialized Windows WSL tool identity. Only redacted audit writes; no batch/lifecycle/backup/restore/business actions. Updated validators accept the observed optional HCS null field and exact known namespace subsets.'};
const packetBytes=Buffer.from(JSON.stringify(packet,null,2)+'\n'),packetSha=hash(packetBytes);
const bootstrap=`$ErrorActionPreference='Stop'
function Get-QualificationBytesSha([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$b=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\LIVE_REFERENCE_READONLY_QUALIFICATION_V2.json')
if((Get-QualificationBytesSha $b) -cne '${packetSha}'){throw 'Readonly qualification packet drift'}
$p=[Text.Encoding]::UTF8.GetString($b)|ConvertFrom-Json
$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved same-SID admin token required'}
if($p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Readonly mode required'}
$held=@();try{
foreach($e in $p.entries){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Readonly closure changed'}}
foreach($name in @(Get-ChildItem Env:|Where-Object {$_.Name -like 'NODE_*'})) {[Environment]::SetEnvironmentVariable($name.Name,$null,'Process')}
$env:PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'
& $p.node $p.qualifier
if($LASTEXITCODE -ne 0){throw 'Readonly live qualification refused; original failure retained'}
}finally{foreach($f in $held){$f.Dispose()}}
`;
await writeFile(root+'/LIVE_REFERENCE_READONLY_QUALIFICATION_V2.json',packetBytes,{flag:'wx'});
await writeFile(root+'/LIVE_REFERENCE_READONLY_BOOTSTRAP_V2.ps1',bootstrap,{flag:'wx'});
await writeFile(root+'/LIVE_REFERENCE_READONLY_BINDING_V2.json',JSON.stringify({packetSha256:packetSha,bootstrapSha256:hash(bootstrap),productionApproved:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({packetSha256:packetSha,closure:entries.length,productionApproved:false}));
