import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {durableCreate} from '../tools/main-prebuild-queue.mjs';
import {retirementIntentVersion,retirementBanVersion,retirementDirectory,assertRetirementAdmission} from '../tools/preparation-retirement-admission.mjs';
import {prepareLatestMainOnce,observeLatestMain,prepareLatestMain} from '../tools/publish-latest-main.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retirement-admission-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config={repository:path.join(root,'repo'),stateDirectory:path.join(root,'state'),releaseDirectory:path.join(root,'packets')},dispatchId=randomUUID(),target='a'.repeat(40),directory=retirementDirectory(config,dispatchId);await fs.mkdir(directory,{recursive:true});const intentSha256=await durableCreate(path.join(directory,'INTENT.json'),{version:retirementIntentVersion,binding:{dispatchId,selectedTarget:target}});await durableCreate(path.join(directory,'TARGET-BAN.json'),{version:retirementBanVersion,intentSha256,selectedTarget:target,forbidTargetReplay:true});const live={mainCommit:'b'.repeat(40),source:path.join(root,'live-source'),head:{bindingSha256:'1'.repeat(64)},djangoManifestSha256:'2'.repeat(64)},packet=path.join(config.releaseDirectory,target.slice(0,12)+'-11111111-22222222');return {root,config,directory,target,live,packet};}
test('pending retirement blocks observation before fetch and direct fixed preparation before source/worktree creation',async t=>{
 const f=await fixture(t);let gitCalls=0,planCalls=0;const options={git:async()=>{gitCalls++;return f.target;},getLive:async()=>f.live,makePlan:()=>{planCalls++;throw Error('must not plan');}};
 await assert.rejects(observeLatestMain(f.config,options),/retirement is incomplete/);await assert.rejects(prepareLatestMain(f.config,options),/retirement is incomplete/);await assert.rejects(prepareLatestMainOnce(f.config,{targetCommit:f.target,live:f.live,packet:f.packet},options),/Retired preparation target/);assert.equal(gitCalls,0);assert.equal(planCalls,0);assert.equal(await fs.stat(f.packet).then(()=>true,()=>false),false);
});
test('permanent target ban is effective before any proposed seal is trusted, including direct Once reuse route',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.directory,'SEALED.json'),'invalid proposed seal');let calls=0;
 await assert.rejects(assertRetirementAdmission(f.config,f.target),/Retired preparation target/);await assert.rejects(prepareLatestMainOnce(f.config,{targetCommit:f.target,live:f.live,packet:f.packet},{git:async()=>{calls++;},makePlan:()=>{calls++;}}),/Retired preparation target/);assert.equal(calls,0);assert.equal(await fs.stat(f.packet).then(()=>true,()=>false),false);
});
test('missing target-ban, corrupt intent and unknown registry member fail closed',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.directory,'TARGET-BAN.json'));await assert.rejects(assertRetirementAdmission(f.config));await fs.writeFile(path.join(retirementDirectory(f.config),'unexpected'),'not an accepted run');await assert.rejects(assertRetirementAdmission(f.config));
});
