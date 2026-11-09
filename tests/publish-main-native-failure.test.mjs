import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writeNativePreparationFailure} from '../tools/publish-main-native-failure.mjs';
import {readNativePreparationFailure} from '../tools/publish-latest-main.mjs';
import {nativePreparationFailureVersion} from '../tools/main-prebuild-queue.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'publish-main-native-failure-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const packet=path.join(root,'a1b2c3d4e5f6-11112222-33334444');
 const preparationOut=path.join(packet,'publish-aaaaaaaaaaaa','preparation');
 await fs.mkdir(preparationOut,{recursive:true});
 await fs.mkdir(path.join(packet,'invocations'),{recursive:true});
 const mainCommit='a'.repeat(40);
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify({mainCommit}));
 const resultFile=path.join(packet,'invocations',randomUUID()+'.json');
 return {root,packet,preparationOut,resultFile,mainCommit};
}

test('writes a valid teruisi-native-preparation-failure-v1 terminal that the queue consumer accepts',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 const receiptPath=path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json');
 await fs.writeFile(receiptPath,JSON.stringify({at:new Date().toISOString(),mainCommit:f.mainCommit,phase:'构建前端',error:'fixture native rejection',maintenanceStarted:false,automaticRetry:false},null,2)+'\n',{flag:'wx'});
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,true);
 const terminal=await readNativePreparationFailure(f.resultFile,f.packet);
 assert.ok(terminal,'the queue consumer must accept the produced result file');
 assert.equal(terminal.kind,'native-preparation-failed');
 assert.equal(terminal.phase,'构建前端');
});

test('writes nothing when no new FAILED receipt appeared (process vanished before writing one)',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false);
 await assert.rejects(fs.access(f.resultFile),{code:'ENOENT'});
});

test('writes nothing when a pre-existing receipt from an earlier attempt is the only one present',async t=>{
 const f=await fixture(t);
 // Simulate a stale FAILED-*.json left by an earlier, unrelated attempt that
 // existed BEFORE this invocation started; beforeNames already contains it.
 const stale=path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json');
 await fs.writeFile(stale,JSON.stringify({phase:'old',error:'old failure'})+'\n',{flag:'wx'});
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false,'a receipt that predates this invocation must never be attributed to it');
 await assert.rejects(fs.access(f.resultFile),{code:'ENOENT'});
});

test('writes nothing when more than one new receipt appeared (ambiguous attribution)',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 await fs.writeFile(path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify({phase:'a',error:'a'})+'\n',{flag:'wx'});
 await fs.writeFile(path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify({phase:'b',error:'b'})+'\n',{flag:'wx'});
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false);
 await assert.rejects(fs.access(f.resultFile),{code:'ENOENT'});
});

test('writes nothing when the new receipt is missing phase or error (malformed, never trusted)',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 await fs.writeFile(path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify({error:'missing phase'})+'\n',{flag:'wx'});
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false);
});

test('writes nothing when preparationOut cannot be read (evidence missing or directory gone)',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 await fs.rm(f.preparationOut,{recursive:true,force:true});
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false);
});

test('error text is truncated to 1600 chars before being written, matching the native receipt convention',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 const longError='x'.repeat(5000);
 await fs.writeFile(path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify({phase:'构建前端',error:longError})+'\n',{flag:'wx'});
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,true);
 const document=JSON.parse(await fs.readFile(f.resultFile,'utf8'));
 assert.equal(document.error.length,1600);
 const terminal=await readNativePreparationFailure(f.resultFile,f.packet);
 assert.ok(terminal);
});

test('never writes when resultFile already exists (refuses to overwrite)',async t=>{
 const f=await fixture(t);
 const beforeNames=new Set(await fs.readdir(f.preparationOut));
 await fs.writeFile(path.join(f.preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify({phase:'构建前端',error:'fixture'})+'\n',{flag:'wx'});
 await fs.writeFile(f.resultFile,'{"foreign":true}');
 const wrote=await writeNativePreparationFailure({preparationOut:f.preparationOut,beforeNames,resultFile:f.resultFile,mainCommit:f.mainCommit,nativePreparationFailureVersion});
 assert.equal(wrote,false);
 assert.equal(await fs.readFile(f.resultFile,'utf8'),'{"foreign":true}');
});
