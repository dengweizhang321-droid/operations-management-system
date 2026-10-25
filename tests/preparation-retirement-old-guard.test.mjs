/** Execute only the exact copied old guard, never the publication CLI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sha} from '../tools/main-prebuild-queue.mjs';
import {retirementGit} from '../tools/preparation-retirement-fs.mjs';
import {assertFrozenSource} from './fixtures/s05d-old-source-entry/frozen-main-source-sequential.mjs';
const oldGuardSha='b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6';
test('exact old guard accepts a stable private Git source and rejects changed commit, optional tree, or dirty bytes',async t=>{
 assert.equal(sha(await fs.readFile(new URL('./fixtures/s05d-old-source-entry/frozen-main-source-sequential.mjs',import.meta.url))),oldGuardSha);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'s05d-old-guard-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),hooks=path.join(root,'empty-hooks');await fs.mkdir(source);await fs.mkdir(hooks);
 const git=(cwd,args)=>retirementGit(cwd,args);await git(source,['init']);await git(source,['config','--local','core.hooksPath',hooks]);await git(source,['config','--local','commit.gpgsign','false']);await git(source,['config','user.name','Private Fixture']);await git(source,['config','user.email','private@example.invalid']);
 await fs.writeFile(path.join(source,'source.txt'),'approved');await git(source,['add','.']);await git(source,['commit','-m','approved']);
 const mainCommit=await git(source,['rev-parse','HEAD']),sourceTree=await git(source,['rev-parse','HEAD^{tree}']);
 assert.deepEqual(await assertFrozenSource({source,mainCommit,sourceTree},{git}),{commit:mainCommit,tree:sourceTree});
 await assert.rejects(assertFrozenSource({source,mainCommit,sourceTree:'0'.repeat(40)},{git}),/tree/);
 await fs.appendFile(path.join(source,'source.txt'),' dirty');await assert.rejects(assertFrozenSource({source,mainCommit},{git}),/未提交/);
 await git(source,['add','.']);await git(source,['commit','-m','different']);await assert.rejects(assertFrozenSource({source,mainCommit},{git}),/来源已变化/);
});
test('old sequential queries reject a changed tree but do not claim an atomic HEAD observation',async()=>{
 const mainCommit='a'.repeat(40),tree='b'.repeat(40),otherTree='c'.repeat(40),calls=[];
 const run=values=>assertFrozenSource({source:'private-controlled-observations',mainCommit},{git:async(_cwd,args)=>{calls.push(args);assert.ok(values.length);return values.shift();}});
 await assert.rejects(run([mainCommit,otherTree,tree]),/不属于批准提交/);
 calls.length=0;
 // HEAD may move to a different same-tree commit after the first probe. The
 // old guard still returns its first HEAD; later closure/CAS/boot must apply.
 assert.deepEqual(await run([mainCommit,tree,tree,'']),{commit:mainCommit,tree});
 assert.deepEqual(calls,[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['rev-parse',mainCommit+'^{tree}'],['status','--porcelain']]);
});
