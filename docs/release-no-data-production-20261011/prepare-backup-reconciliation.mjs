// Root seals a single fixed reconciliation; this preparation performs no production action.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',out=base+'reconciliation/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const handoffRaw=await readFile(base+'ASTRA_BACKUP_RECONCILIATION_HANDOFF_V2.json');
assert.equal(hash(handoffRaw),'f16146e153f9020495bd252b7ab530b4619c023d04189b39d156fdd359c193dc');
const handoff=JSON.parse(handoffRaw),runner=handoff.files.find(f=>f.path.endsWith('/reconcile-backup-once.mjs'));
const files=[...handoff.files.filter(f=>f.path.endsWith('/reconcile-backup-once.mjs')||f.path.endsWith('/backup-reconcile-bootstrap.mjs')),handoff.proof,
 {path:'C:/Program Files/nodejs/node.exe',sha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'},
 {path:'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',sha256:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'},
 {path:'E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',sha256:'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99'},
 {path:base+'APPROVAL.json',sha256:'dfd9e3dc69b61c1fb7761fa058d5ee66a519782de1d8d830b28a57df29be835a'},
 {path:base+'BACKUP_VERIFY_RESULT.json',sha256:'bf44a9dcc86e39ca1a7f83de006e98ab95e645dd16aa091cebe201961d6578c0'},
 {path:base+'BACKUP_VERIFY_STDOUT.json',sha256:'d37d3cfdf15c623881feddbe8b775a88ef740f4bf3c8ac222bb3d604195d98c5'},
 {path:'D:/teruisi-runtime/django-sales/audits/postgres-operations/70abd23809cc4817a589d663e6635fc2.json',sha256:'a520fd1b96e5510701c05ebd077a60c8d5bd7f85d74d8890d9e8348ee568c26c'}];
for(const f of files)assert.equal(hash(await readFile(f.path)),f.sha256);
await mkdir(out,{recursive:true});
const binding={version:'root-fixed-backup-reconciliation-v2',files,runner:runner.path,proof:handoff.proof};
const raw=Buffer.from(JSON.stringify(binding,null,2)+'\n'),bindingSha=hash(raw);await writeFile(out+'BINDING.json',raw,{flag:'wx'});
const boot=`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'}
$held=@();try{
$bf=[IO.File]::Open('${out}BINDING.json',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$bf;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($bf))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne '${bindingSha}'){throw 'Binding drift'};$bf.Position=0;$r=[IO.StreamReader]::new($bf);$p=$r.ReadToEnd()|ConvertFrom-Json
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Reconciliation closure drift'}}
$started=[DateTime]::UtcNow.ToString('o');& 'C:/Program Files/nodejs/node.exe' $p.runner $p.proof.path $p.proof.sha256 1> '${out}STDOUT.log' 2> '${out}STDERR.log';$code=$LASTEXITCODE
[pscustomobject]@{startedAt=$started;finishedAt=[DateTime]::UtcNow.ToString('o');exitCode=$code;bindingSha256='${bindingSha}'}|ConvertTo-Json|Set-Content -LiteralPath '${out}FINISHED.json' -Encoding UTF8
if($code -ne 0){throw 'Fixed reconciliation refused; preserve all state'}
}finally{foreach($f in $held){$f.Dispose()}}
`;
await writeFile(out+'BOOTSTRAP.ps1',boot,{flag:'wx'});
await writeFile(out+'BOOTSTRAP_BINDING.json',JSON.stringify({bindingSha256:bindingSha,bootstrapSha256:hash(boot)},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,bindingSha256:bindingSha,bootstrapSha256:hash(boot)}));
