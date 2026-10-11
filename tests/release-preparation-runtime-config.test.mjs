import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {watch,readFileSync,writeFileSync,utimesSync,lstatSync,realpathSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,lstat,link,symlink,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import * as impact from '../tools/release-impact.mjs';
import * as worker from '../tools/worker-local-release.mjs';
const raw=readFileSync(new URL('../tools/release-preparation-evidence.mjs',import.meta.url),'utf8');
const body=raw.split(/\r?\n/).filter(line=>!line.startsWith('import ')).join('\n').replace(/^export /gm,'');
function load(fixedPath,extra={}) {
 // Only the fixed configuration constant is rebased to a private fixture.
 // All native filesystem/reparse and source/npm validators are original code.
 const context={path,watch,lstat,readFile,readFileSync,lstatSync,realpathSync,...impact,...worker,workerDevVarsSource:fixedPath,performance,structuredClone,setImmediate,...extra};
 return new Function(...Object.keys(context),body+';return {readSessionRuntimeConfiguration,createPreparationEvidenceSession};')(...Object.values(context));
}
async function fixture(action) {
 const root=await mkdtemp(path.join(tmpdir(),'session-hardlink-config-'));assert.equal(path.dirname(root),path.resolve(tmpdir()));
 try {const fixed=path.join(root,'.dev.vars');await writeFile(fixed,'SYNTHETIC_TEST_VALUE=first\n');await link(fixed,path.join(root,'release.vars'));await action({root,fixed,...load(fixed)});}
 finally {assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true});}
}
test('fixed canonical source accepts real hardlinks with bracketed byte and inode identity',()=>fixture(async({fixed,readSessionRuntimeConfiguration:read})=>{
 await assert.rejects(impact.safeRead(fixed),/Unsafe/);
 const result=await read(fixed);assert.equal(result.runtime,impact.hash('SYNTHETIC_TEST_VALUE=first\n'));assert.equal(result.runtimeFile.nlink,'2');assert.equal(result.runtimeFile.ino,String((await lstat(fixed,{bigint:true})).ino));
}));
test('ordinary source, npm and a different configuration hardlink remain rejected',()=>fixture(async({root,fixed,readSessionRuntimeConfiguration:read})=>{
 for(const name of ['view.ts','.npmrc','other.vars']){const file=path.join(root,name);await link(fixed,file);await assert.rejects(read(file),/Unsafe/);await assert.rejects(impact.safeRead(file),/Unsafe/);}
}));
test('single-link test configuration uses original strict reader',()=>fixture(async({root,readSessionRuntimeConfiguration:read})=>{
 const other=path.join(root,'test.vars');await writeFile(other,'SYNTHETIC=2');assert.deepEqual(await read(other),{runtime:impact.hash('SYNTHETIC=2'),runtimeFile:null});
}));
test('fixed configuration under a real junction ancestor is rejected',()=>fixture(async({root})=>{
 const actual=path.join(root,'actual');await mkdir(actual);const value=path.join(actual,'.dev.vars');await writeFile(value,'private');const redirect=path.join(root,'redirect');await symlink(actual,redirect,'junction');
 const target=path.join(redirect,'.dev.vars');await assert.rejects(load(target).readSessionRuntimeConfiguration(target));
}));
test('fixed path must remain a regular file',()=>fixture(async({root})=>{
 const directory=path.join(root,'directory');await mkdir(directory);await assert.rejects(load(directory).readSessionRuntimeConfiguration(directory));
}));
test('configuration write through sibling hardlink during read is rejected even with restored mtime',()=>fixture(async({root,fixed})=>{
 const before=await lstat(fixed);let called=false;
 const readFileDuring=target=>{const value=readFileSync(target);if(!called){called=true;writeFileSync(path.join(root,'release.vars'),'SYNTHETIC_TEST_VALUE=other\n');utimesSync(fixed,before.atime,before.mtime);}return value;};
 await assert.rejects(load(fixed,{readFileSync:readFileDuring}).readSessionRuntimeConfiguration(fixed),/changed while reading/);
}));
test('same bytes with a replaced inode or changed link count cannot become the same snapshot',()=>fixture(async({root,fixed,readSessionRuntimeConfiguration:read})=>{
 const first=await read(fixed),bytes=await readFile(fixed);await unlink(fixed);await writeFile(fixed,bytes);const replaced=await read(fixed);
 assert.equal(first.runtime,replaced.runtime);assert.notEqual(first.runtimeFile.ino,replaced.runtimeFile.ino);
 await link(fixed,path.join(root,'another-link'));const linked=await read(fixed);assert.notDeepEqual(linked.runtimeFile,replaced.runtimeFile);
}));
test('original helper policy does not authorize hardlinks on the production-named basename elsewhere',()=>fixture(async({root,fixed})=>{
 const source=path.join(root,'different-source');await mkdir(source);const other=path.join(source,'.dev.vars');await link(fixed,other);await assert.rejects(load(fixed).readSessionRuntimeConfiguration(other),/Unsafe/);
}));
test('native full identity/session collect and recheck support the private fixed hardlink, then reject mutation',()=>fixture(async({root,fixed,createPreparationEvidenceSession:create})=>{
 const source=path.join(root,'source');await mkdir(source);await writeFile(path.join(source,'display.txt'),'private source');await writeFile(path.join(source,'package.json'),'{"name":"private-fixture"}');await writeFile(path.join(source,'package-lock.json'),'{"lockfileVersion":3}');execFileSync('git',['init','-q'],{cwd:source});execFileSync('git',['add','display.txt','package.json','package-lock.json'],{cwd:source});
 const original=await worker.workerPreparationIdentity(source,fixed);assert.equal(original.runtimeConfigurationSha256,impact.hash(await readFile(fixed)));
 const session=create({batchSha256:'a'.repeat(64),sourceRoot:source});
 try {const identity=await session.collect({approvedBatchSha256:'a'.repeat(64),full:true});assert.equal(identity.runtimeConfigurationSha256,original.runtimeConfigurationSha256);await session.recheck();await writeFile(path.join(root,'release.vars'),'SYNTHETIC_TEST_VALUE=changed\n');await assert.rejects(session.recheck(),/changed|invalidated|session baseline/);}
 finally {session.dispose();}
}));

async function eventFixture(action) {
 return fixture(async({root,fixed})=>{
  const source=path.join(root,'source');await mkdir(source);await writeFile(path.join(source,'view.txt'),'private source');
  const targets={userconfig:path.join(root,'user.npmrc'),globalconfig:path.join(root,'global.npmrc')};
  const npmRoot=path.join(path.dirname(process.execPath),'node_modules','npm'),npmPackage=path.join(npmRoot,'package.json'),tree={algorithm:'private-toolchain-seam',fileCount:1,sha256:'b'.repeat(64)};
  const callbacks=[];let reads=0,initialReadBeforeWatch=false;
  const nativeRead=target=>{if(path.resolve(target)===fixed)reads++;return readFileSync(target);};
  // Unrelated expensive toolchain/native npm resolution is controlled here;
  // configuration filesystem operations and the session state machine are real.
  const seam={readFileSync:nativeRead,watch:(directory,options,callback)=>{if(!callbacks.length)initialReadBeforeWatch=reads>0;const record={directory,options,callback,errors:null};callbacks.push(record);return{on:(_name,fn)=>{record.errors=fn;},close:()=>{}};},
   hashTree:async()=>tree,safeFileDigest:async()=> 'c'.repeat(64),safeRead:async target=>path.resolve(target)===npmPackage?Buffer.from('{}'):impact.safeRead(target)};
  const identify=async()=>{const files=await impact.readSourceTree(source);return{sourceTree:{sha256:impact.sourceTreeDigest(files)},sourceInventorySha256:impact.hash(impact.sourceInventory(files)),nodeExecutableSha256:'c'.repeat(64),toolchain:{npmPackageTree:tree},runtimeConfigurationSha256:impact.hash(await readFile(fixed)),environmentSha256:worker.preparationEnvironmentSha256(process.env),externalNpmConfiguration:Object.fromEntries(Object.entries(targets).map(([k,p])=>[k,{pathSha256:worker.windowsPathSha256(p),contentSha256:null}]))};};
  const session=load(fixed,seam).createPreparationEvidenceSession({batchSha256:'a'.repeat(64),sourceRoot:source,identify,execute:async(_exe,args)=>({stdout:targets[args.at(-1)]})});
  try {await session.collect({approvedBatchSha256:'a'.repeat(64),full:true});const config=callbacks.find(v=>path.resolve(v.directory)===root),sourceWatch=callbacks.find(v=>path.resolve(v.directory)===source),npm=callbacks.find(v=>path.resolve(v.directory)===npmRoot);
   assert.ok(initialReadBeforeWatch);await action({session,config,sourceWatch,npm,fixed,root,reads:()=>reads});
  }finally{session.dispose();}
 });
}
test('exact fixed change remains synchronous and validates full bytes before clearing pending',()=>eventFixture(async({session,config,fixed,reads})=>{
 readFileSync(fixed);config.callback('change','.dev.vars');const before=reads();assert.equal(session.assertStable(),undefined);assert.equal(reads(),before+1);await session.recheck();
}));
for(const [event,name]of [['rename','.dev.vars'],['change',null],['change','.dev.vars/unknown']])test('unqualified configuration event stays irreversible: '+event+'/'+name,()=>eventFixture(async({session,config,reads})=>{
 config.callback(event,name);config.callback('change','.dev.vars');const before=reads();assert.throws(()=>session.assertStable(),/Inputs changed/);assert.equal(reads(),before);await assert.rejects(session.collect({approvedBatchSha256:'a'.repeat(64),full:true}),/Inputs changed/);
}));
for(const kind of ['sourceWatch','npm'])test(kind+' invalidation cannot be cleared by valid configuration pending',()=>eventFixture(async value=>{
 value[kind].callback('change','changed.txt');value.config.callback('change','.dev.vars');const before=value.reads();assert.throws(()=>value.session.assertStable(),/Inputs changed/);assert.equal(value.reads(),before);
}));
test('changed config bytes cannot be accepted by pending or a new full collect in the same session',()=>eventFixture(async({session,config,fixed,root})=>{
 const original=await readFile(fixed);await writeFile(path.join(root,'release.vars'),'DIFFERENT=1');config.callback('change','.dev.vars');assert.throws(()=>session.assertStable(),/baseline/);await writeFile(fixed,original);await assert.rejects(session.collect({approvedBatchSha256:'a'.repeat(64),full:true}),/Inputs changed/);
}));
test('same bytes with changed inode or link count cannot clear pending',async()=>{
 for(const change of ['inode','link'])await eventFixture(async({session,config,fixed,root})=>{if(change==='inode'){const bytes=await readFile(fixed);await unlink(fixed);await writeFile(fixed,bytes);}else await link(fixed,path.join(root,'extra-link'));config.callback('change','.dev.vars');assert.throws(()=>session.assertStable(),/baseline/);assert.throws(()=>session.assertStable(),/Inputs changed/);});
});
test('watch errors remain sticky and dispose never refreshes baseline',()=>eventFixture(async({session,config,reads})=>{
 config.errors(new Error('watch failed'));config.callback('change','.dev.vars');const before=reads();assert.throws(()=>session.assertStable(),/Inputs changed/);assert.equal(reads(),before);session.dispose();assert.throws(()=>session.assertStable(),/disposed/);
}));
