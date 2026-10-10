import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const shell of ['powershell.exe','pwsh.exe'])test(`original backend-ready Start guard and adapter control flow (${shell})`,{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File','tests/release-no-data-backend-start.test.ps1'],{encoding:'utf8',windowsHide:true,timeout:60_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stdout,/PASS:/);
});
