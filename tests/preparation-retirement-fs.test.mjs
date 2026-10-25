import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {retirementEntity,readRetirementWorktrees,relocateRetirementObject,inventoryRetirementTree} from '../tools/preparation-retirement-fs.mjs';
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trimEnd();
async function root(t){const r=await fs.mkdtemp(path.join(os.tmpdir(),'s05d-retire-fs-'));t.after(()=>fs.rm(r,{recursive:true,force:true}));return r;}
test('registered locked source uses native Git relocation with unchanged refs, tracked bytes and no reference hook event',async t=>{
 const r=await root(t),repository=path.join(r,'repository'),source=path.join(r,'source'),archive=path.join(r,'archive'),destination=path.join(archive,'source'),actions=path.join(r,'actions');await fs.mkdir(repository);await fs.mkdir(archive);
 git(repository,['init','--quiet','--initial-branch=main']);git(repository,['config','user.name','private']);git(repository,['config','user.email','private@example.invalid']);await fs.writeFile(path.join(repository,'source.txt'),'original source bytes\n');git(repository,['add','.']);git(repository,['-c','commit.gpgsign=false','commit','--quiet','-m','private source']);git(repository,['worktree','add','--quiet','--detach',source]);git(repository,['worktree','lock','--reason','Manual latest-main release source; keep while package is in use',source]);
 const event=path.join(r,'ref-events.log').replaceAll('\\','/'),hooks=path.join(repository,'.git','hooks');assert.ok(!event.includes("'"));await fs.writeFile(path.join(hooks,'reference-transaction'),"#!/bin/sh\nprintf '%s\\n' \"$1\" >> '"+event+"'\n",{mode:0o755});const refs=git(repository,['show-ref']),raw=await fs.readFile(path.join(source,'source.txt')),registration=(await readRetirementWorktrees(repository)).find(x=>x.path===source),expected=await retirementEntity(source);
 const options={repository,source,destination,expected,kind:'git-worktree',registration,protection:{authority:'owned-retirement-source-v1',attachmentManaged:false},actionDirectory:actions,intentSha256:'a'.repeat(64)};
 const firstResult=await relocateRetirementObject(options);assert.equal(await retirementEntity(source),null);assert.deepEqual(await fs.readFile(path.join(destination,'source.txt')),raw);assert.equal(git(repository,['show-ref']),refs);assert.equal(await fs.stat(event).then(()=>true,()=>false),false);const after=(await readRetirementWorktrees(repository)).find(x=>x.path===destination);assert.equal(after.HEAD,registration.HEAD);assert.match(after.locked,/Retired preparation source/);
 assert.deepEqual(await relocateRetirementObject(options),firstResult,'Same-intent reentry returns the existing immutable result bytes');
});
test('unknown ownership, identity drift and competing destination refuse without moving a source',async t=>{
 const r=await root(t),source=path.join(r,'source'),destination=path.join(r,'archive');await fs.mkdir(source);const expected=await retirementEntity(source),base={repository:r,source,destination,expected,kind:'git-worktree',registration:{},actionDirectory:path.join(r,'actions'),intentSha256:'b'.repeat(64)};await assert.rejects(relocateRetirementObject(base),/ownership/);assert.ok(await retirementEntity(source));
 await fs.mkdir(destination);await assert.rejects(relocateRetirementObject({...base,kind:'directory'}),/both original and archive/);assert.ok(await retirementEntity(source));
});
test('bounded archive inventory reads full bytes and rejects an unqualified hard link',async t=>{
 const r=await root(t),tree=path.join(r,'tree');await fs.mkdir(tree);await fs.writeFile(path.join(tree,'file'),'preserved');const a=await inventoryRetirementTree(tree);assert.equal(a.files.length,1);assert.equal(a.bytes,9);await fs.link(path.join(tree,'file'),path.join(r,'external'));await assert.rejects(inventoryRetirementTree(tree),/multi-link/);
});
