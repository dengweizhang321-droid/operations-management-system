import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const executable='C:/Windows/System32/wsl.exe';
assert.ok(process.argv.length===2 || (process.argv.length===3 && process.argv[2]==='--root-metadata'));
const rootMetadata=process.argv[2]==='--root-metadata';
const run=(args,options={})=>{
  const result=spawnSync(executable,args,{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,...options});
  assert.equal(result.error,undefined,'WSL metadata transport failed');
  assert.equal(result.status,0,'WSL metadata command failed');return result;
};
const list=()=>{
  const raw=run(['--list','--running','--quiet']).stdout;
  const text=raw.includes(0)?raw.toString('utf16le'):raw.toString('utf8');
  return text.replace(/^\uFEFF/,'').split(/[\r\n]+/).map(v=>v.trim()).filter(Boolean).sort();
};
const before=list();
assert.deepEqual(before,['TERUISI-Pandas'],'Refuse to start or inspect an unaccounted distribution');
const source=await readFile(new URL('./probe-running-wsl.py',import.meta.url));
// Disable Python env/user-site/site startup hooks in any future invocation.
// The list sandwich is an observation, not an atomic distribution-epoch lock.
const response=run(['--distribution','TERUISI-Pandas','--user',rootMetadata?'root':'teruisi-pandas','--exec','/usr/bin/python3','-I','-S','-'],{input:source});
const result=JSON.parse(response.stdout.toString('utf8'));
assert.equal(result.productionActions,0);assert.equal(result.rawMetadataPersisted,false);
const after=list();assert.deepEqual(after,before,'WSL distribution inventory changed');
const output={sourceSha256:createHash('sha256').update(source).digest('hex'),metadataUser:rootMetadata?'root':'teruisi-pandas',before,after,...result};
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/'+(rootMetadata?'RUNNING_WSL_REFERENCE_DIAGNOSTIC_ROOT_V1.json':'RUNNING_WSL_REFERENCE_DIAGNOSTIC_V1.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({processesObserved:output.processesObserved,knownReferences:output.references.length,metadataErrors:output.metadataErrors.length,productionActions:0,metadataUser:output.metadataUser}));
