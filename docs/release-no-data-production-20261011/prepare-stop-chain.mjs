// Seal complete external closure before a single Windows UAC request.
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const dir=fileURLToPath(new URL('.',import.meta.url)),base='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',sha=b=>createHash('sha256').update(b).digest('hex'),stage=process.argv[2];assert.ok(['capture','seal'].includes(stage));
const hraw=await readFile(base+'ASTRA_STOP_RECONCILIATION_HANDOFF_V2.json');assert.equal(sha(hraw),'c78892a59f9add63d83d0060c25147eb175d452c7a822aa4be47dfc0f5180cf8');const h=JSON.parse(hraw);for(const f of h.files)assert.equal(sha(await readFile(f.path)),f.sha256);assert.equal(sha(await readFile(h.intent.path)),h.intent.sha256);
const eraw=await readFile(base+'ASTRA_ENV_RESUME_HANDOFF_V1.json');assert.equal(sha(eraw),'12b48404b6fabfbf1fcbf6991b0545d08694c210fc4421c25ef2e709e305fc96');const e=JSON.parse(eraw),helpers=e.files.filter(f=>['exact-env-transport.mjs','env-dpapi.ps1','reconcile-backup-once.mjs'].includes(path.basename(f.path)));
const node={path:'C:/Program Files/nodejs/node.exe',sha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'};for(const f of helpers)assert.equal(sha(await readFile(f.path)),f.sha256);assert.equal(sha(await readFile(node.path)),node.sha256);
if(stage==='capture'){
 const capture=path.join(dir,'capture-stop-resume-env.mjs'),files=[...helpers,node,{path:capture,sha256:sha(await readFile(capture))}];
 const boot=`$ErrorActionPreference='Stop';$held=@();try{foreach($e in @(${files.map(f=>`[pscustomobject]@{path='${f.path.replaceAll("'","''")}';sha256='${f.sha256}'}`).join(',')})){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne $e.sha256){throw 'Capture closure drift'}};& '${node.path}' '${capture.replaceAll("'","''")}';if($LASTEXITCODE -ne 0){throw 'Original environment capture failed'}}finally{foreach($f in $held){$f.Dispose()}}\n`;
 await writeFile(base+'resume3/CAPTURE_NORMAL.ps1',boot,{flag:'wx'});console.log(JSON.stringify({stage,sha256:sha(boot)}));
}else{
 const cipher=base+'resume3/ENV_CIPHER_MANIFEST.json',cipherSha=sha(await readFile(cipher));
 const newNames=['run-stop-chain.mjs','run-approved-stop-resume.mjs','resume-stopped-state.mjs','reconcile-backup-once.mjs'];const newFiles=await Promise.all(newNames.map(async n=>({path:path.join(dir,n),sha256:sha(await readFile(path.join(dir,n)))})));
 const files=[...h.files,...helpers,...newFiles,node,h.intent,{path:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',sha256:'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5'},{path:cipher,sha256:cipherSha},
 {path:base+'APPROVAL.json',sha256:'dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a'},
 {path:'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',sha256:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'},
 {path:'E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',sha256:'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99'}];
 for(const n of ['resume2/FINISHED.json','resume2/DIRECT_PROCESS.json'])files.push({path:base+n,sha256:sha(await readFile(base+n))});
 for(const f of files)assert.equal(sha(await readFile(f.path)),f.sha256);
 const binding={version:'fixed-stop-and-original-resume3-v1',files,reconcile:h.files.find(f=>path.basename(f.path)==='reconcile-stopped-worker-once.mjs').path,intent:h.intent,resume:path.join(dir,'run-approved-stop-resume.mjs'),chain:path.join(dir,'run-stop-chain.mjs'),cipherManifestSha256:cipherSha,cwd:'D:/.codex/worktrees/release-site-blockers/运营管理系统'};
 const raw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bindingSha=sha(raw);await writeFile(base+'resume3/CHAIN_BINDING_V3.json',raw,{flag:'wx'});
 // ASCII bootstrap; Unicode paths are decoded explicitly from the held UTF-8 binding.
 const boot=`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact administrator required'};if(@(Get-ChildItem Env: | Where-Object {$_.Name -match '^NODE_'}).Count -ne 0){throw 'NODE environment forbidden'};$held=@();try{
$bf=[IO.File]::Open('${base}resume3/CHAIN_BINDING_V3.json',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$bf;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($bf))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne '${bindingSha}'){throw 'Chain binding drift'};$bf.Position=0;$r=[IO.StreamReader]::new($bf,[Text.UTF8Encoding]::new($false,$true));$p=$r.ReadToEnd()|ConvertFrom-Json
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($v -cne $e.sha256){throw 'Stop/resume closure drift'}}
Set-Location -LiteralPath $p.cwd
& 'C:/Program Files/nodejs/node.exe' $p.chain '${base}resume3/CHAIN_BINDING_V3.json' '${bindingSha}'
if($LASTEXITCODE -ne 0){throw 'Stop or original resume blocked; preserve all state'}
}finally{foreach($f in $held){$f.Dispose()}}\n`;
 assert.ok([...boot].every(c=>c.charCodeAt(0)<128));await writeFile(base+'resume3/BOOTSTRAP_V3.ps1',boot,{flag:'wx'});await writeFile(base+'resume3/BOOTSTRAP_BINDING_V3.json',JSON.stringify({bindingSha256:bindingSha,bootstrapSha256:sha(boot),closure:files.length,cipherManifestSha256:cipherSha},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({stage,bindingSha256:bindingSha,bootstrapSha256:sha(boot),closure:files.length}));
}
