// Seal transport code only; original batch/spec/approval remain unchanged.
import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';import path from'node:path';
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',out=root+'resume1/',hash=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(process.argv[2]);assert.equal(hash(raw),process.argv[3]);const handoff=JSON.parse(raw);
const names=['exact-env-transport.mjs','env-dpapi.ps1','capture-approved-env.mjs','run-approved-env-resume.mjs','resume-admission-state.mjs'];
const code=names.map(name=>{const file=handoff.files.find(f=>path.basename(f.path)===name);assert.ok(file,name+' missing from frozen handoff');return {path:file.path,sha256:file.sha256};});
for(const f of code)assert.equal(hash(await readFile(f.path)),f.sha256);
const node='C:/Program Files/nodejs/node.exe',nodeSha='9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de';assert.equal(hash(await readFile(node)),nodeSha);await mkdir(out,{recursive:true});
const stage=process.argv[4];assert.ok(['capture','resume'].includes(stage));
if(stage==='capture'){
 const captured=code.filter(f=>!f.path.endsWith('run-approved-env-resume.mjs')&&!f.path.endsWith('resume-admission-state.mjs')).concat({path:node,sha256:nodeSha});
 const boot=`$ErrorActionPreference='Stop';$held=@();try{
foreach($e in @(${captured.map(f=>`[pscustomobject]@{path='${f.path.replaceAll("'","''")}';sha256='${f.sha256}'}`).join(',')})){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Frozen capture closure changed'}}
& '${node}' '${code.find(f=>f.path.endsWith('capture-approved-env.mjs')).path}'
if($LASTEXITCODE -ne 0){throw 'Exact normal environment capture refused'}
}finally{foreach($f in $held){$f.Dispose()}}
`;
 await writeFile(out+'CAPTURE_NORMAL.ps1',boot,{flag:'wx'});console.log(JSON.stringify({stage,bootstrapSha256:hash(boot),originalEnvironmentMustMatch:'bc79f88a7e7b963179fe029dccf2f605f1bad855ad29873b58d43dfb96aac609'}));
}else{
 const cipherRaw=await readFile(out+'ENV_CIPHER_MANIFEST.json'),cipherSha=hash(cipherRaw),approval=root+'APPROVAL.json',spec='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',entry='E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs';
 const files=[...code,{path:node,sha256:nodeSha},{path:out+'ENV_CIPHER_MANIFEST.json',sha256:cipherSha},{path:approval,sha256:'dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a'},{path:spec,sha256:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'},{path:entry,sha256:'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99'},...await Promise.all(['FINISHED.json','DIRECT_PROCESS.json'].map(async n=>({path:root+n,sha256:hash(await readFile(root+n))})))];
 for(const f of files)assert.equal(hash(await readFile(f.path)),f.sha256);
 const binding={version:'exact-env-same-batch-resume-transport-v1',batchSha256:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',handoffSha256:hash(raw),files,node,runner:code.find(f=>f.path.endsWith('run-approved-env-resume.mjs')).path,cipherManifestSha256:cipherSha};
 const bindingRaw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bindingSha=hash(bindingRaw);await writeFile(out+'TRANSPORT_BINDING.json',bindingRaw,{flag:'wx'});
 const boot=`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact approved administrator identity required'}
$raw=[IO.File]::ReadAllBytes('E:\\codex-artifacts\\release-site-blockers-20261011\\production-f15d06a\\resume1\\TRANSPORT_BINDING.json');$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($raw))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne '${bindingSha}'){throw 'Frozen resume binding changed'};$p=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json;$held=@();try{
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Resume closure changed'}}
Set-Location -LiteralPath 'D:\\.codex\\worktrees\\release-site-blockers\\运营管理系统'
& $p.node $p.runner $p.cipherManifestSha256
if($LASTEXITCODE -ne 0){throw 'Same batch resume blocked; preserve owner/gates/WAL'}
}finally{foreach($f in $held){$f.Dispose()}}
`;
 await writeFile(out+'BOOTSTRAP.ps1',boot,{flag:'wx'});await writeFile(out+'BOOTSTRAP_BINDING.json',JSON.stringify({bindingSha256:bindingSha,bootstrapSha256:hash(boot),cipherManifestSha256:cipherSha,closure:files.length},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({stage,bootstrapSha256:hash(boot),closure:files.length}));
}
