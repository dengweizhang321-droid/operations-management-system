import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readNativePreparationFailure} from '../tools/publish-latest-main.mjs';
// S05d native side: a failing --prepare-only entry leaves one structured result
// in its validated --result-file; deploy mode never writes it. Spawns a child
// node process, so it must run outside the AI sandbox.
const a='a'.repeat(40),tools=['publish-main.mjs','publish-main-progress.mjs','publish-main-known-resume.mjs','publish-main-command.mjs'];
async function fixture(t,request){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-preparation-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const packet=path.join(root,'packet'),source=path.join(packet,'source');await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.mkdir(path.join(packet,'invocations'));
 for(const name of tools)await fs.copyFile(new URL('../tools/'+name,import.meta.url),path.join(source,'tools',name));
 await fs.writeFile(path.join(packet,'main-release-request.json'),request);
 const run=(...args)=>spawnSync(process.execPath,[path.join(source,'tools/publish-main.mjs'),...args],{cwd:source,encoding:'utf8',windowsHide:true,timeout:60000});
 return {root,packet,source,run,resultFile:path.join(packet,'invocations',randomUUID()+'.json')};
}
test('unreadable request still yields an honest prepare-only failure with an unbound target',async t=>{
 const f=await fixture(t,'{');const child=f.run('--prepare-only','--result-file',f.resultFile);assert.equal(child.status,1);
 const value=JSON.parse(await fs.readFile(f.resultFile,'utf8'));
 assert.deepEqual({...value,error:undefined},{version:'teruisi-native-preparation-failure-v1',status:'preparation-failed',mainCommit:null,publicationPerformed:false,publicationStarted:false,maintenanceStarted:false,phase:'native-entry',error:undefined,failureReceipt:null});
 assert.equal((await readNativePreparationFailure(f.resultFile,f.packet))?.kind,'native-preparation-failed');
});
test('a readable request binds the target; deploy mode and an outside result path write nothing',async t=>{
 const f=await fixture(t,JSON.stringify({latestMainRelease:true,mainCommit:a}));
 assert.equal(f.run('--prepare-only','--result-file',f.resultFile).status,1);
 const value=JSON.parse(await fs.readFile(f.resultFile,'utf8'));assert.equal(value.mainCommit,a);assert.equal(value.phase,'native-entry');
 const terminal=await readNativePreparationFailure(f.resultFile,f.packet);assert.equal(terminal.resultFile,path.resolve(f.resultFile));
 const deploy=path.join(f.packet,'invocations',randomUUID()+'.json');assert.equal(f.run('--deploy-only','--result-file',deploy).status,1);await assert.rejects(fs.access(deploy),{code:'ENOENT'});
 const outside=path.join(f.root,randomUUID()+'.json');assert.equal(f.run('--prepare-only','--result-file',outside).status,1);await assert.rejects(fs.access(outside),{code:'ENOENT'});
 assert.deepEqual((await fs.readdir(f.packet)).filter(name=>name.startsWith('publish-')),[],'prepare-only failure never creates a publication attempt');
});
