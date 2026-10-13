import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const host of ['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','pwsh.exe'])test(`fixed recovery order and failure containment: ${host}`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teruisi-recovery-sequence-'));
 try{const env={...process.env};if(host.toLowerCase().includes('windowspowershell'))env.PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
 const r=spawnSync(host,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/startup-recovery-sequence-fixture.ps1'),'-Source',path.join(root,'tools/startup-recovery-sequence.ps1'),'-OutputRoot',dir],{encoding:'utf8',env,timeout:30000});
 assert.equal(r.status,0,r.stderr+r.stdout);const result=JSON.parse(r.stdout.trim());assert.equal(result.cases,14);assert.equal(result.productionMutations,0);assert.equal(fs.readdirSync(dir).length,14);
 }finally{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'teruisi-recovery-sequence-'));fs.rmSync(dir,{recursive:true});}
});
