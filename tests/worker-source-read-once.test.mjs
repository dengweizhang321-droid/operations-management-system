import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, writeFile, readFile, open, rm, link, symlink, lstat, utimes, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashTree, hashRelativeFiles, hashRelativeFilesWithInventory, sha256Canonical, treeHashReadBatchBytes, treeHashReadConcurrency } from '../tools/worker-local-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function legacy(root, names) {
  const digest = createHash('sha256'), inventory = Object.create(null);
  for (const relative of [...names].sort((a,b)=>a < b ? -1 : a > b ? 1 : 0)) {
    const name = Buffer.from(relative.replaceAll('\\','/')), bytes = await readFile(path.join(root,relative));
    const nameLength = Buffer.alloc(4), contentLength = Buffer.alloc(8);
    nameLength.writeUInt32BE(name.length); contentLength.writeBigUInt64BE(BigInt(bytes.length));
    digest.update(nameLength).update(name).update(contentLength).update(bytes);
    inventory[name.toString()] = hash(bytes);
  }
  return {tree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:names.length,sha256:digest.digest('hex')},inventory};
}
async function fixture(action) {
  const root = await mkdtemp(path.join(tmpdir(),'worker-source-read-once-'));
  try { await action(root); }
  finally { assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir())); await rm(root,{recursive:true,force:true}); }
}
// Instrument only native file transport in a private copy of the original
// module. Source selection, validation, byte hashing and scheduling stay real.
async function instrument(root) {
  const key = 'workerDigestTest'+randomUUID().replaceAll('-','');
  const state = {opens:new Map(),reads:new Map(),wholeReads:[],active:0,maxActive:0,maxRead:0,afterRead:null};
  state.open = async (target,...args) => {
    const handle = await open(target,...args);
    state.opens.set(target,(state.opens.get(target)??0)+1);
    state.active++; state.maxActive=Math.max(state.maxActive,state.active);
    return {stat:()=>handle.stat(),close:async()=>{try{await handle.close();}finally{state.active--; }},read:async(...readArgs)=>{
      state.maxRead=Math.max(state.maxRead,readArgs[2]);
      const result=await handle.read(...readArgs);
      if(result.bytesRead)state.reads.set(target,(state.reads.get(target)??0)+result.bytesRead);
      if(state.afterRead)await state.afterRead(target,result);
      return result;
    }};
  };
  state.readFile = async (target,...args) => {state.wholeReads.push(target);return readFile(target,...args);};
  state.sourceRoot=root;
  globalThis[key]=state;
  let source=await readFile(new URL('../tools/worker-local-release.mjs',import.meta.url),'utf8');
  source=source.replace(/\n  open,\r?\n/,'\n  open as nativeOpen,\n').replace(/\n  readFile,\r?\n/,'\n  readFile as nativeReadFile,\n');
  source+=`\nconst {open,readFile}=globalThis[${JSON.stringify(key)}];\nexport {validateTree};\n`;
  // Native npm discovery is unrelated to source-read reuse. Replace just its
  // identity inputs, so this fixture never reads a real user's npm configuration.
  const provenance={nodeVersion:process.version,nodeExecutablePathSha256:hash('node'),npmVersion:'fixture',npmPackageRootRelativePath:'npm',npmPackageRootPathSha256:hash('root'),npmCliRelativePath:'npm/cli',npmCliPathSha256:hash('cli'),npmCliSha256:hash('cli-bytes'),npmPackageJsonRelativePath:'npm/package.json',npmPackageJsonPathSha256:hash('package'),npmPackageJsonSha256:hash('package-bytes'),npmPackageTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:1,sha256:hash('tree')},npmCiArguments:[]};
  source=source.replace('const toolchain = await resolveBundledNpmToolchain();',`const toolchain = {nodeExecutablePath:process.execPath,npmCliPath:'private-fixture',provenance:${JSON.stringify(provenance)}};`);
  source=source.replace('const result = await runProcess(toolchain.nodeExecutablePath, [toolchain.npmCliPath, "config", "get", key], { cwd: sourceRoot, label: "npm configuration identity" });','const result = {stdout:path.join(sourceRoot,"missing-"+key)};');
  source=source.replace('const identity=await workerPreparationIdentity(value.sourceRoot);','const identity=await workerPreparationIdentity(value.sourceRoot,globalThis['+JSON.stringify(key)+'].devVars);');
  await writeFile(path.join(root,'native-isolation.mjs'),await readFile(new URL('../tools/native-isolation.mjs',import.meta.url)));
  const target=path.join(root,'instrumented.mjs');await writeFile(target,source);
  const api=await import(pathToFileURL(target));
  return {api,state,dispose:()=>{delete globalThis[key];}};
}
async function corpus(root) {
  const files={'z.txt':'last','B.txt':'upper','a.txt':'lower','中文.txt':'多字节\0文字','empty':'','binary':Buffer.from([0,255,1,2,128]),'nested/part':'inside'};
  for(const [name,bytes] of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);}
  return Object.keys(files).reverse();
}
// Run the original node_modules packing statement against private real trees.
// Keep the copy and validation implementations in the production module.
async function dependencyPacker() {
  const source = await readFile(new URL('../tools/worker-local-release.mjs', import.meta.url), 'utf8');
  const operations = source.split(/\r?\n/).filter(line => /^\s*await (?:cp|rename)\(path\.join\(buildRoot, "node_modules"\), path\.join\(releaseStage, "node_modules"\)/.test(line));
  assert.equal(operations.length, 1, 'expected one original dependency packing operation');
  return new (Object.getPrototypeOf(async function() {}).constructor)('cp', 'rename', 'path', 'buildRoot', 'releaseStage', operations[0]);
}
test('dependency packing preserves source and exact nested bytes; final validation rejects changed or missing output',()=>fixture(async root=>{
  const buildRoot=path.join(root,'build'),releaseStage=path.join(root,'release'),source=path.join(buildRoot,'node_modules'),destination=path.join(releaseStage,'node_modules');
  await mkdir(source,{recursive:true});await mkdir(releaseStage);await corpus(source);
  const expected=await hashTree(source),pack=await dependencyPacker(),{api,dispose}=await instrument(root);
  try {
    await pack(cp,rename,path,buildRoot,releaseStage);
    assert.deepEqual(await hashTree(source),expected);
    assert.deepEqual(await hashTree(destination),expected);
    await api.validateTree(destination,expected,'copied node_modules');
    await writeFile(path.join(destination,'z.txt'),'evil');
    await assert.rejects(api.validateTree(destination,expected,'copied node_modules'),/manifest/);
    await cp(path.join(source,'z.txt'),path.join(destination,'z.txt'));
    await rm(path.join(destination,'nested','part'));
    await assert.rejects(api.validateTree(destination,expected,'copied node_modules'),/manifest/);
  } finally {dispose();}
}));
test('dependency packing refuses existing files without overwriting their bytes',()=>fixture(async root=>{
  const buildRoot=path.join(root,'build'),releaseStage=path.join(root,'release'),source=path.join(buildRoot,'node_modules'),destination=path.join(releaseStage,'node_modules');
  await mkdir(source,{recursive:true});await mkdir(destination,{recursive:true});
  await writeFile(path.join(source,'package.json'),'source');await writeFile(path.join(destination,'package.json'),'existing');
  const pack=await dependencyPacker();
  await assert.rejects(pack(cp,rename,path,buildRoot,releaseStage),error=>error.code==='ERR_FS_CP_EEXIST');
  assert.equal(await readFile(path.join(destination,'package.json'),'utf8'),'existing');
  assert.equal(await readFile(path.join(source,'package.json'),'utf8'),'source');
}));
test('combined source hashes match the original byte protocol and per-file inventory exactly',()=>fixture(async root=>{
  const names=await corpus(root),expected=await legacy(root,names);
  assert.deepEqual(await hashRelativeFilesWithInventory(root,names),expected);
  assert.deepEqual(expected.tree,await hashRelativeFiles(root,names));
  assert.deepEqual(await hashRelativeFilesWithInventory(root,[]),await legacy(root,[]));
}));
test('source identity reads every tracked and untracked source once; the next call rereads and sees changed bytes',()=>fixture(async root=>{
  const sourceRoot=path.join(root,'source');await mkdir(sourceRoot);await writeFile(path.join(sourceRoot,'package.json'),'{}');await writeFile(path.join(sourceRoot,'package-lock.json'),'{}');await writeFile(path.join(sourceRoot,'untracked.txt'),'first');
  execFileSync('git',['init','-q'],{cwd:sourceRoot,windowsHide:true});execFileSync('git',['add','package.json','package-lock.json'],{cwd:sourceRoot,windowsHide:true});
  const config=path.join(root,'test.vars');await writeFile(config,'SYNTHETIC=1');
  const {api,state,dispose}=await instrument(root);
  try {
    const first=await api.workerPreparationIdentity(sourceRoot,config);
    for(const name of ['package.json','package-lock.json','untracked.txt']){const target=path.join(sourceRoot,name);assert.equal(state.opens.get(target),1);assert.equal(state.reads.get(target),(await lstat(target)).size);assert.ok(!state.wholeReads.includes(target));}
    await writeFile(path.join(sourceRoot,'untracked.txt'),'other');
    const second=await api.workerPreparationIdentity(sourceRoot,config);
    assert.notEqual(first.sourceTree.sha256,second.sourceTree.sha256);assert.notEqual(first.sourceInventorySha256,second.sourceInventorySha256);
    assert.equal(state.opens.get(path.join(sourceRoot,'untracked.txt')),2);
  } finally {dispose();}
}));
test('bound snapshot validation uses the same read for tree and inventory and rejects tampering',()=>fixture(async root=>{
  const sourceRoot=path.join(root,'snapshot');await mkdir(sourceRoot);const names=await corpus(sourceRoot),expected=await legacy(sourceRoot,names);
  const {api,state,dispose}=await instrument(root);
  try {
    const actual=await api.validateTree(sourceRoot,expected.tree,'source snapshot',undefined,true);
    assert.equal(sha256Canonical(actual.inventory),sha256Canonical(expected.inventory));
    for(const name of names)assert.equal(state.opens.get(path.join(sourceRoot,name)),1);
    await writeFile(path.join(sourceRoot,'z.txt'),'evil');await assert.rejects(api.validateTree(sourceRoot,expected.tree,'source snapshot',undefined,true),/manifest/);
  } finally {dispose();}
}));
test('bound source reads bytes once per call and fresh calls reject same-size restored-mtime changes',()=>fixture(async root=>{
  const sourceRoot=path.join(root,'bound');await mkdir(sourceRoot);
  for(const [name,bytes] of Object.entries({'package.json':'{}','package-lock.json':'{}','source.txt':'first'}))await writeFile(path.join(sourceRoot,name),bytes);
  execFileSync('git',['init','-q',sourceRoot],{windowsHide:true});
  const config=path.join(root,'private.vars');await writeFile(config,'SYNTHETIC=1');
  const {api,state,dispose}=await instrument(root);state.devVars=config;
  try{
    const identity=await api.workerPreparationIdentity(sourceRoot,config),predecessor={version:'teruisi-local-worker-release-binding-v1',releaseId:'20261010T014638Z-97833d2f2b7e7bc9',manifestSha256:hash('manifest'),guardReceiptSha256:hash('guard')};
    predecessor.bindingSha256=api.sha256Canonical(predecessor);
    const value={version:api.workerSourceBindingVersion,sourceRoot,sourceRootPathSha256:api.windowsPathSha256(sourceRoot),predecessor,predecessorChainStateSha256:hash('chain'),identity};
    const raw=api.canonicalJson(value)+'\n',envelope={raw,sha256:hash(raw)};
    state.opens.clear();state.reads.clear();state.wholeReads.length=0;
    assert.deepEqual((await api.verifyBoundWorkerSource(envelope)).identity,identity);
    for(const name of ['package.json','package-lock.json','source.txt']){
      const file=path.join(sourceRoot,name);assert.equal(state.opens.get(file),1);assert.equal(state.reads.get(file),(await lstat(file)).size);assert.ok(!state.wholeReads.includes(file));
    }
    const file=path.join(sourceRoot,'source.txt'),before=await lstat(file);await writeFile(file,'other');await utimes(file,before.atime,before.mtime);
    await assert.rejects(api.verifyBoundWorkerSource(envelope),/identity changed/);
    assert.equal(state.opens.get(file),2);
  }finally{dispose();}
}));
test('source additions or deletions during a controlled identity read are rejected',async()=>{
  for(const mode of ['add','delete'])await fixture(async root=>{
    const sourceRoot=path.join(root,'source');await mkdir(sourceRoot);
    for(const name of ['package.json','package-lock.json','source.txt'])await writeFile(path.join(sourceRoot,name),'{}');
    execFileSync('git',['init','-q',sourceRoot],{windowsHide:true});const config=path.join(root,'private.vars');await writeFile(config,'SYNTHETIC=1');
    const {api,state,dispose}=await instrument(root);let changed=false;
    state.afterRead=async(file,result)=>{if(changed||file!==path.join(sourceRoot,'source.txt')||!result.bytesRead)return;changed=true;if(mode==='add')await writeFile(path.join(sourceRoot,'new.txt'),'new');else await rm(file);};
    try{await assert.rejects(api.workerPreparationIdentity(sourceRoot,config),/inventory changed|ENOENT|changed/);}finally{dispose();}
  });
});
test('source path escape, nonregular object, hardlink and junction ancestor are rejected',()=>fixture(async root=>{
  const source=path.join(root,'source');await mkdir(source);await writeFile(path.join(source,'file'),'private');
  for(const name of ['../outside','nested/../../outside','D:/outside','\\\\server\\share','file:stream','./file'])await assert.rejects(hashRelativeFilesWithInventory(source,[name]),/路径越界/);
  await mkdir(path.join(source,'directory'));await assert.rejects(hashRelativeFilesWithInventory(source,['directory']),/普通文件/);
  await link(path.join(source,'file'),path.join(root,'alias'));await assert.rejects(hashRelativeFilesWithInventory(source,['file']),/single-link/);await rm(path.join(root,'alias'));
  const junction=path.join(root,'junction');await symlink(source,junction,'junction');await assert.rejects(hashRelativeFilesWithInventory(junction,['file']),/重解析|真实路径/);
}));
test('content, inode, length and link-count changes during reading all fail closed',async()=>{
  for(const mode of ['content','replacement','growth','truncate','hardlink'])await fixture(async root=>{
    const target=path.join(root,'file');await writeFile(target,'first');const before=await lstat(target);
    const {api,state,dispose}=await instrument(root);let changed=false;
    state.afterRead=async(file,result)=>{if(file!==target||!result.bytesRead||changed)return;changed=true;
      if(mode==='content'){await writeFile(target,'other');await utimes(target,before.atime,before.mtime);}
      else if(mode==='replacement'){await rename(target,target+'.old');await writeFile(target,'first');}
      else if(mode==='growth')await writeFile(target,'first plus new bytes');
      else if(mode==='truncate')await writeFile(target,'');
      else await link(target,target+'.alias');
    };
    try{await assert.rejects(api.hashRelativeFilesWithInventory(root,['file']),/changed/);assert.equal(state.active,0);}finally{dispose();}
  });
});
test('large files stream bounded chunks; small batches keep the original concurrency bound',()=>fixture(async root=>{
  const target=path.join(root,'large');const handle=await open(target,'w');
  try{await handle.truncate(treeHashReadBatchBytes+1024*1024+17);}finally{await handle.close();}
  const names=['large'];for(let i=0;i<40;i++){const name='small-'+String(i).padStart(2,'0');await writeFile(path.join(root,name),'small');names.push(name);}
  const expected=await legacy(root,names),{api,state,dispose}=await instrument(root);
  try{assert.deepEqual(await api.hashRelativeFilesWithInventory(root,names),expected);assert.equal(state.reads.get(target),treeHashReadBatchBytes+1024*1024+17);assert.equal(state.opens.get(target),1);assert.ok(state.maxRead<=1024*1024);assert.ok(state.maxActive>1&&state.maxActive<=treeHashReadConcurrency);assert.equal(state.active,0);assert.equal(state.wholeReads.length,0);}finally{dispose();}
}));
