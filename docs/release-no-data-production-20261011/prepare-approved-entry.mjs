import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',hash=b=>createHash('sha256').update(b).digest('hex');await mkdir(root,{recursive:true});
const specPath='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',raw=await readFile(specPath);assert.equal(hash(raw),'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');const spec=JSON.parse(raw);
const approval={version:'teruisi-exact-human-production-approval-v1',humanApproved:true,humanMessage:'批准',approvalRecordedAt:'2026-10-11T15:25:28Z',timestampBasis:'First explicit approval observation clock after the human reply; not claimed exact UI click time',batchSha256:spec.batch.batchSha256,specPath,specSha256:hash(raw),scope:'Exact sealed 19 operations: one pre Backup, one same-point isolated Restore, original switch/acceptance/closeout; no post Backup/Restore or schedule change',context:'Human reply to final exact scope FINAL_PRODUCTION_SCOPE.md and batch f15d06a159…ca110f; UAC remains OS identity confirmation only'};
const approvalRaw=Buffer.from(JSON.stringify(approval,null,2)+'\n'),approvalSha=hash(approvalRaw);await writeFile(root+'APPROVAL.json',approvalRaw,{flag:'wx'});
const runner=fileURLToPath(new URL('./run-approved-batch.mjs',import.meta.url)),node='C:/Program Files/nodejs/node.exe';
const files=[{path:runner,sha256:hash(await readFile(runner))},{path:root+'APPROVAL.json',sha256:approvalSha},{path:specPath,sha256:hash(raw)},{path:spec.execution.entryPath,sha256:spec.execution.entrySha256},{path:node,sha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'}];for(const f of files)assert.equal(hash(await readFile(f.path)),f.sha256);
const binding={version:'teruisi-approved-production-transport-binding-v1',windowsSid:'S-1-5-21-815909789-107973518-1379257801-1001',batchSha256:approval.batchSha256,approvalSha256:approvalSha,runner,node,workingDirectory:'D:/\.codex/worktrees/release-site-blockers/运营管理系统',files};
const bindingRaw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bindingSha=hash(bindingRaw);await writeFile(root+'TRANSPORT_BINDING.json',bindingRaw,{flag:'wx'});
const bootstrap=`$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact approved administrator identity required'}
function Get-TransportHash([byte[]]$bytes){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$raw=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\production-f15d06a\\TRANSPORT_BINDING.json')
if((Get-TransportHash $raw) -cne '${bindingSha}'){throw 'Approved transport binding drift'}
$p=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json;$held=@()
try {foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Approved transport input bytes changed'}}
foreach($e in @(Get-ChildItem Env:|Where-Object{$_.Name -like 'NODE_*'})){[Environment]::SetEnvironmentVariable($e.Name,$null,'Process')}
$env:PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'
Set-Location -LiteralPath $p.workingDirectory
& $p.node $p.runner $p.approvalSha256
if($LASTEXITCODE -ne 0){throw 'Approved batch blocked; retain exact original owner, maintenance, drain and WAL'}
}finally{foreach($f in $held){$f.Dispose()}}
`;
await writeFile(root+'BOOTSTRAP.ps1',bootstrap,{flag:'wx'});await writeFile(root+'BOOTSTRAP_BINDING.json',JSON.stringify({batchSha256:approval.batchSha256,approvalSha256:approvalSha,transportSha256:bindingSha,bootstrapSha256:hash(bootstrap)},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({approvalSha256:approvalSha,bootstrapSha256:hash(bootstrap),closure:files.length}));
