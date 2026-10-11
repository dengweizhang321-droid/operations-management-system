import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp,mkdir,writeFile,rm,link,symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { canonicalJson,sha256Bytes,sha256Canonical,windowsPathSha256,workerSourceBindingVersion,workerSourceRoot,
  validateWorkerSourceBinding,readWorkerSourceBinding,assertBoundWorkerSourceLocation,verifyBoundWorkerSource,assertWorkerSourceBindingTuple,workerSourceRootForBatch } from '../tools/worker-local-release.mjs';
import { releaseBinding,rotationPlanPayload } from '../tools/worker-local-release-rotation.mjs';

const h=char=>char.repeat(64),predecessor=releaseBinding({releaseId:'20261010T014638Z-97833d2f2b7e7bc9',manifestSha256:h('1'),guardReceiptSha256:h('2')});
function inputs(){return {version:'teruisi-worker-preparation-identity-v1',sourceTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:1,sha256:h('3')},sourceInventorySha256:h('4'),nodeExecutableSha256:h('5'),runtimeConfigurationSha256:h('6'),environmentSha256:h('7'),externalNpmConfiguration:{userconfig:{pathSha256:h('8'),contentSha256:null},globalconfig:{pathSha256:h('9'),contentSha256:null}},toolchain:{nodeVersion:process.version,nodeExecutablePathSha256:h('a'),npmVersion:'11.0.0',npmPackageRootRelativePath:'node_modules/npm',npmPackageRootPathSha256:h('b'),npmCliRelativePath:'node_modules/npm/bin/npm-cli.js',npmCliPathSha256:h('c'),npmCliSha256:h('d'),npmPackageJsonRelativePath:'node_modules/npm/package.json',npmPackageJsonPathSha256:h('e'),npmPackageJsonSha256:h('f'),npmPackageTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:1,sha256:h('1')},npmCiArguments:['ci','--ignore-scripts=false','--no-audit','--no-fund']}};}
const seal=value=>{const raw=canonicalJson(value)+'\n';return {raw,sha256:sha256Bytes(Buffer.from(raw))};};
function fixture(sourceRoot='E:\\private-source-binding\\candidate'){return {version:workerSourceBindingVersion,sourceRoot,sourceRootPathSha256:windowsPathSha256(sourceRoot),predecessor,predecessorChainStateSha256:h('0'),identity:inputs()};}
test('exact source binding preserves the complete original identity; optional absence remains legacy',()=>{
  const value=fixture(),envelope=seal(value);assert.deepEqual(validateWorkerSourceBinding(envelope,{predecessor,predecessorChainStateSha256:h('0'),identity:value.identity}),value);
  assert.equal(assertWorkerSourceBindingTuple({manifest:{source:{}},plan:{},receipt:{}}),workerSourceRoot);
  assert.equal(workerSourceRootForBatch({binding:{}}),workerSourceRoot);
  const plan=rotationPlanPayload({createdAt:new Date().toISOString(),chain:{head:predecessor,successorCount:219,chainStateSha256:h('0')},candidate:predecessor,lineage:{},protectedEntrypoints:[{}]});
  assert.equal(Object.hasOwn(plan,'sourceBinding'),false);
});
for(const [label,mutate] of Object.entries({unknown:v=>v.flag=true,missing:v=>delete v.identity.environmentSha256,relative:v=>v.sourceRoot='..\\source',parent:v=>v.sourceRoot='D:\\',protected:v=>v.sourceRoot='d:\\TERUISI-runtime\\teruisi-worker-sales\\child',ancestor:v=>v.sourceRoot='D:\\teruisi-runtime',dot:v=>v.sourceRoot='E:\\private-source-binding\\..\\candidate',rootSha:v=>v.sourceRootPathSha256=h('0'),predecessor:v=>v.predecessor.bindingSha256=h('f'),inventory:v=>v.identity.sourceInventorySha256='bad',npmMissing:v=>delete v.identity.externalNpmConfiguration.globalconfig,identityExtra:v=>v.identity.cwd='unreviewed',circular:v=>v.workerPlanSha256=h('1')}))test('rejects malformed/forged source contract: '+label,()=>{
  const value=structuredClone(fixture());mutate(value);assert.throws(()=>validateWorkerSourceBinding(seal(value)));
});
test('separator-aware root exclusion admits a distinct same-prefix namespace',()=>{assert.equal(validateWorkerSourceBinding(seal(fixture('D:\\teruisi-runtime-fake\\candidate'))).sourceRoot,'D:\\teruisi-runtime-fake\\candidate');});
test('envelope byte and complete live identity/predecessor drift fail even when declared hashes are recomputed',()=>{
  const value=fixture(),envelope=seal(value);
  assert.throws(()=>validateWorkerSourceBinding({...envelope,raw:envelope.raw+' '}));
  assert.throws(()=>validateWorkerSourceBinding(seal({...value,identity:{...value.identity,environmentSha256:h('0')}}),{identity:value.identity}));
  for(const key of ['sourceInventorySha256','nodeExecutableSha256','runtimeConfigurationSha256','environmentSha256'])assert.throws(()=>validateWorkerSourceBinding(envelope,{identity:{...value.identity,[key]:h('0')}}));
  assert.throws(()=>validateWorkerSourceBinding(envelope,{predecessor:{...predecessor,manifestSha256:h('0')}}));
  assert.throws(()=>validateWorkerSourceBinding(envelope,{predecessorChainStateSha256:h('1')}));
});
test('manifest, plan, receipt and batch must select one identical source, never fallback',()=>{
  const value=fixture(),sourceBinding=seal(value),manifest={source:{sourceBinding,rootPathSha256:value.sourceRootPathSha256,tree:value.identity.sourceTree}},plan={sourceBinding,predecessor,predecessorChainStateSha256:h('0')},receipt={sourceBinding,identity:value.identity};
  assert.equal(assertWorkerSourceBindingTuple({sourceBinding,manifest,plan,receipt}),value.sourceRoot);
  for(const remove of ['manifest','plan','receipt']){const state=structuredClone({sourceBinding,manifest,plan,receipt});delete (remove==='manifest'?state.manifest.source:state[remove]).sourceBinding;assert.throws(()=>assertWorkerSourceBindingTuple(state));}
  const binding={sourceBindingSha256:sourceBinding.sha256,sourceSha256:value.identity.sourceTree.sha256,sourceInventorySha256:value.identity.sourceInventorySha256,predecessorSha256:predecessor.bindingSha256,toolchainSha256:sha256Canonical({node:value.identity.nodeExecutableSha256,toolchain:value.identity.toolchain}),configurationSha256:sha256Canonical({environment:value.identity.environmentSha256,runtime:value.identity.runtimeConfigurationSha256,npm:value.identity.externalNpmConfiguration})};
  assert.equal(workerSourceRootForBatch({sourceBinding,binding}),value.sourceRoot);
  for(const key of Object.keys(binding))assert.throws(()=>workerSourceRootForBatch({sourceBinding,binding:{...binding,[key]:h('0')}}));
  assert.throws(()=>workerSourceRootForBatch({binding}));
});
test('original file/path readers reject missing, changed, hard-linked or redirected binding inputs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-source-binding-')),source=path.join(root,'source'),input=path.join(root,'binding.json');
  try {
    await mkdir(source);const envelope=seal(fixture(source));await writeFile(input,envelope.raw);
    assert.deepEqual(await readWorkerSourceBinding(input,envelope.sha256),envelope);
    await assert.rejects(readWorkerSourceBinding(input,h('0')),/bytes changed/);
    await assert.rejects(readWorkerSourceBinding(path.join(root,'missing.json'),envelope.sha256));
    const alias=path.join(root,'binding-alias.json');await link(input,alias);await assert.rejects(readWorkerSourceBinding(input,envelope.sha256),/hard-linked/);await rm(alias);
    const redirected=path.join(root,'redirected');await symlink(source,redirected,'junction');await assert.rejects(assertBoundWorkerSourceLocation(redirected),/重解析|真实路径/);
    const code=path.join(source,'file.mjs');await writeFile(code,'export const fixed = true;');await link(code,path.join(source,'second.mjs'));
    await writeFile(path.join(source,'package.json'),'{}');await writeFile(path.join(source,'package-lock.json'),'{}');
    spawnSync('git',['init','-q',source],{windowsHide:true});
    await assert.rejects(verifyBoundWorkerSource(envelope),/hard-linked/);
  } finally {await rm(root,{recursive:true,force:true});}
});
for(const args of [ ['--source-binding','E:\\missing.json'],['--source-binding-sha256',h('1')],['--source-root','E:\\candidate'],['--source-binding','E:\\missing.json','--source-binding-sha256','bad'],['--source-binding','E:\\missing.json','--source-binding-sha256',h('1'),'--allow-test-runtime-root'] ])test('CLI rejects incomplete/path/test escape before preparation: '+args[0]+' '+args.at(-1),()=>{
  const result=spawnSync(process.execPath,['tools/worker-local-release-rotation.mjs','plan','--prepare-online',...args],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/binding|路径|测试覆盖|SHA-256/);
});
