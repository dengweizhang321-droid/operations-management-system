// Preparation only. Original candidate/approval/batch and full environment binding remain fixed.
import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';import path from'node:path';
const base='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',out=base+'resume2/',hash=b=>createHash('sha256').update(b).digest('hex');
const hraw=await readFile(base+'ASTRA_BACKUP_RECONCILIATION_HANDOFF_V2.json');assert.equal(hash(hraw),'f16146e153f9020495bd252b7ab530b4619c023d04189b39d156fdd359c193dc');const h=JSON.parse(hraw);
const eraw=await readFile(base+'ASTRA_ENV_RESUME_HANDOFF_V1.json');assert.equal(hash(eraw),'12b48404b6fabfbf1fcbf6991b0545d08694c210fc4421c25ef2e709e305fc96');const e=JSON.parse(eraw);
const helpers=['exact-env-transport.mjs','env-dpapi.ps1'].map(n=>{const f=e.files.find(f=>path.basename(f.path)===n);assert.ok(f);return f;});
const code=h.files.filter(f=>!f.path.endsWith('.test.mjs')).concat(helpers);for(const f of code)assert.equal(hash(await readFile(f.path)),f.sha256);
const node={path:'C:/Program Files/nodejs/node.exe',sha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'};assert.equal(hash(await readFile(node.path)),node.sha256);await mkdir(out,{recursive:true});
const stage=process.argv[2];assert.ok(['capture','resume'].includes(stage));
const quote=s=>s.replaceAll("'","''");
if(stage==='capture'){
 const original=e.files.find(f=>path.basename(f.path)==='capture-approved-env.mjs');assert.ok(original);const raw=await readFile(original.path);assert.equal(hash(raw),original.sha256);
 const clone=raw.toString().replace('production-f15d06a/resume1/','production-f15d06a/resume2/');assert.notEqual(clone,raw.toString());
 const target=path.join(path.dirname(original.path),'capture-backup-resume-env.mjs');await writeFile(target,clone,{flag:'wx'});
 const files=[...helpers,node,{path:target,sha256:hash(clone)}];
 const boot=`$ErrorActionPreference='Stop';$held=@();try{foreach($e in @(${files.map(f=>`[pscustomobject]@{path='${quote(f.path)}';sha256='${f.sha256}'}`).join(',')})){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne $e.sha256){throw 'Capture closure drift'}};& '${node.path}' '${quote(target)}';if($LASTEXITCODE -ne 0){throw 'Exact environment capture refused'}}finally{foreach($f in $held){$f.Dispose()}}\n`;
 await writeFile(out+'CAPTURE_NORMAL.ps1',boot,{flag:'wx'});console.log(JSON.stringify({stage,bootstrapSha256:hash(boot),captureSha256:hash(clone)}));
}else{
 assert.equal(process.argv.length,4);const head=process.argv[3];assert.match(head,/^[0-9a-f]{64}$/);
 const eventRaw=await readFile('D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011/000010.json');assert.equal(JSON.parse(eventRaw).eventSha256,head);
 const cipher=await readFile(out+'ENV_CIPHER_MANIFEST.json'),cipherSha=hash(cipher);
 const files=[...code,node,h.proof,{path:out+'ENV_CIPHER_MANIFEST.json',sha256:cipherSha},
 {path:base+'APPROVAL.json',sha256:'dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a'},
 {path:'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',sha256:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'},
 {path:'E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',sha256:'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99'},
 {path:base+'reconciliation-v3/FINISHED.json',sha256:hash(await readFile(base+'reconciliation-v3/FINISHED.json'))},
 {path:'D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011/000010.json',sha256:hash(eventRaw)}];
 for(const f of files)assert.equal(hash(await readFile(f.path)),f.sha256);
 const binding={version:'root-exact-env-backup-resume-v2',files,node:node.path,runner:code.find(f=>f.path.endsWith('/run-approved-backup-resume.mjs')).path,cipherManifestSha256:cipherSha,head};
 const raw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bindingSha=hash(raw);await writeFile(out+'TRANSPORT_BINDING.json',raw,{flag:'wx'});
 const boot=`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'};$held=@();try{
if(@(Get-ChildItem Env: | Where-Object {$_.Name -match '^NODE_'}).Count -ne 0){throw 'NODE environment forbidden'}
$bf=[IO.File]::Open('${out}TRANSPORT_BINDING.json',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$bf;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($bf))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne '${bindingSha}'){throw 'Transport binding drift'};$bf.Position=0;$r=[IO.StreamReader]::new($bf);$p=$r.ReadToEnd()|ConvertFrom-Json
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne $e.sha256){throw 'Resume2 closure drift'}}
Set-Location -LiteralPath 'D:/\.codex/worktrees/release-site-blockers/运营管理系统'
& $p.node $p.runner $p.cipherManifestSha256 $p.head
if($LASTEXITCODE -ne 0){throw 'Resume2 refused; preserve owner/gates/WAL'}
}finally{foreach($f in $held){$f.Dispose()}}\n`;
 await writeFile(out+'BOOTSTRAP.ps1',boot,{flag:'wx'});await writeFile(out+'BOOTSTRAP_BINDING.json',JSON.stringify({bindingSha256:bindingSha,bootstrapSha256:hash(boot),cipherManifestSha256:cipherSha,head,closure:files.length},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({stage,bindingSha256:bindingSha,bootstrapSha256:hash(boot),head}));
}
