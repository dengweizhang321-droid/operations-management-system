// Pin the waiting transport now, so the human can confirm its UAC before resting.
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import path from'node:path';import assert from'node:assert/strict';
const base='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',root=base+'resume2/',sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(base+'ASTRA_BACKUP_RECONCILIATION_HANDOFF_V2.json');assert.equal(sha(raw),'f16146e153f9020495bd252b7ab530b4619c023d04189b39d156fdd359c193dc');const h=JSON.parse(raw);
const eraw=await readFile(base+'ASTRA_ENV_RESUME_HANDOFF_V1.json');assert.equal(sha(eraw),'12b48404b6fabfbf1fcbf6991b0545d08694c210fc4421c25ef2e709e305fc96');const e=JSON.parse(eraw);
const wrapper=fileURLToPath(new URL('./wait-approved-backup-resume.mjs',import.meta.url));
const files=[...h.files.filter(f=>!f.path.endsWith('.test.mjs')), ...e.files.filter(f=>['exact-env-transport.mjs','env-dpapi.ps1'].includes(path.basename(f.path))),h.proof,
{path:wrapper,sha256:sha(await readFile(wrapper))},
{path:'C:/Program Files/nodejs/node.exe',sha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'},
{path:root+'ENV_CIPHER_MANIFEST.json',sha256:'f7d33310ff19b7d705a49abb56a6882de6707e61e06bef11fc20303c4184d8ea'},
{path:base+'APPROVAL.json',sha256:'dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a'},
{path:'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',sha256:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'},
{path:'E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',sha256:'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99'},
{path:base+'reconciliation-v3/BINDING.json',sha256:'8e17ef49bf22aa0f936dc11f97b58e89598d7b6078272804f48f1105a883ae00'}];
for(const f of files)assert.equal(sha(await readFile(f.path)),f.sha256);
const binding={version:'fixed-wait-original-f15-resume-v1',files,wrapper,cipherManifestSha256:'f7d33310ff19b7d705a49abb56a6882de6707e61e06bef11fc20303c4184d8ea'};
const braw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bsha=sha(braw);await writeFile(root+'WAIT_BINDING.json',braw,{flag:'wx'});
const boot=`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'};if(@(Get-ChildItem Env: | Where-Object {$_.Name -match '^NODE_'}).Count -ne 0){throw 'NODE environment forbidden'};$held=@();try{
$bf=[IO.File]::Open('${root}WAIT_BINDING.json',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$bf;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($bf))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne '${bsha}'){throw 'Wait binding drift'};$bf.Position=0;$r=[IO.StreamReader]::new($bf);$p=$r.ReadToEnd()|ConvertFrom-Json
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne $e.sha256){throw 'Wait closure drift'}}
Set-Location -LiteralPath 'D:/.codex/worktrees/release-site-blockers/运营管理系统'
& 'C:/Program Files/nodejs/node.exe' $p.wrapper $p.cipherManifestSha256
if($LASTEXITCODE -ne 0){throw 'Wait or resume refused; preserve owner/gates/WAL'}
}finally{foreach($f in $held){$f.Dispose()}}\n`;
await writeFile(root+'WAIT_BOOTSTRAP.ps1',boot,{flag:'wx'});await writeFile(root+'WAIT_BOOTSTRAP_BINDING.json',JSON.stringify({bindingSha256:bsha,bootstrapSha256:sha(boot),closure:files.length},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({bindingSha256:bsha,bootstrapSha256:sha(boot),closure:files.length}));
