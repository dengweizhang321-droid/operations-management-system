import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {publisherEnvironment} from '../tools/publish-latest-main.mjs';
test('real PS5 command discovery and COM shortcut agree only with canonical Windows PATH',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'publisher-command-path-'));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const code="$ErrorActionPreference='Stop';$taskFile="+q(path.join(root,'private.lnk'))+";$taskTarget=(Get-Command powershell.exe).Source;$taskShell=New-Object -ComObject WScript.Shell;$taskLink=$taskShell.CreateShortcut($taskFile);$taskLink.TargetPath=$taskTarget;$taskLink.Save();$taskRead=$taskShell.CreateShortcut($taskFile);@{matches=([string]$taskRead.TargetPath).Equals($taskTarget,[StringComparison]::OrdinalIgnoreCase);targetHash=(Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash}|ConvertTo-Json -Compress";
 const env=publisherEnvironment(process.env),args=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],host='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 const old=JSON.parse(execFileSync(host,args,{env:{...env,PATH:env.PATH.replaceAll('\\','/')},windowsHide:true,encoding:'utf8'}));
 const fixed=JSON.parse(execFileSync(host,args,{env,windowsHide:true,encoding:'utf8'}));
 assert.equal(old.matches,false);assert.equal(fixed.matches,true);assert.equal(old.targetHash,fixed.targetHash);assert.equal(env.PATH.includes('/'),false);
});
