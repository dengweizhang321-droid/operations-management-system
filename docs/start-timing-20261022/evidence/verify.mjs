// Reproduce only this candidate's isolated tests, build and read-only boundaries.
// Run from the b1 worktree root; never invokes a production lifecycle action.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const dir=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const host='D:/teruisi-runtime/tools/pwsh/pwsh.exe';
const env={...process.env,PATH:path.dirname(host)+';'+process.env.PATH};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sources=['tools/worker-local-service.ps1','tools/operations-system-control.ps1','tests/start-timing.test.ps1','tests/start-timing-observation.test.ps1','tests/start-timing.test.mjs','tests/dingtalk-startup.test.ts','tests/operations-system-control.test.ts'];
const summary={at:new Date().toISOString(),base:spawnSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).stdout.trim(),sourceSha256:Object.fromEntries(sources.map(p=>[p,hash(p)])),checks:[]};
const parse="$ErrorActionPreference='Stop';foreach($file in @('tools/worker-local-service.ps1','tools/operations-system-control.ps1','tests/start-timing.test.ps1')){$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$null,[ref]$errors);if($errors.Count){throw ($errors|Out-String)}};Write-Output 'PowerShell parse passed'";
const commands=[
 ['targeted','node',['--test','tests/start-timing.test.mjs']],
 ['regression','node',['--import','tsx','--test','tests/dingtalk-startup.test.ts','tests/operations-system-control.test.ts']],
 ['boundary','node',['tools/check-django-production-boundary.mjs']],
 ['parse-ps5','powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(parse,'utf16le').toString('base64')]],
 ['parse-ps7',host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(parse,'utf16le').toString('base64')]],
 ['build',process.env.ComSpec||'C:/Windows/System32/cmd.exe',['/d','/s','/c','npm run build']],
 ['diff-check','git',['diff','--check']],
];
for(const [name,executable,args] of commands){
 const start=Date.now();const r=spawnSync(executable,args,{env,windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
 for(const kind of ['stdout','stderr'])writeFileSync(path.join(dir,name+'.'+kind+'.log'),r[kind]??Buffer.alloc(0));
 const row={name,command:executable+' '+args.join(' '),exitCode:r.status,signal:r.signal,elapsedMilliseconds:Date.now()-start,error:r.error?.message??null,stdoutSha256:hash(path.join(dir,name+'.stdout.log')),stderrSha256:hash(path.join(dir,name+'.stderr.log'))};
 summary.checks.push(row);writeFileSync(path.join(dir,'verification.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(name+': exit='+r.status+' elapsedMs='+row.elapsedMilliseconds);
 if(r.status!==0){process.exitCode=1;break;}
}
