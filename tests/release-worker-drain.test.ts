import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
for(const shell of ['powershell.exe','pwsh.exe'])test(`Worker-only release drains through the original engine (${shell})`,{skip:process.platform!=='win32'},async()=>{
  const scratch=await mkdtemp(path.join(tmpdir(),'teruisi-worker-drain-'));
  try {
    const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File','tests/release-worker-drain.test.ps1','-Scratch',scratch],{encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stdout,/PASS:/);
  }finally{await rm(scratch,{recursive:true,force:true});}
});
