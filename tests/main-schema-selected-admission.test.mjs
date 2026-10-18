import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertSelectedPreparationSupported} from '../tools/publish-latest-main.mjs';
import {assertMainSchemaPlanSupported,piWorkspaceMigration} from '../tools/main-schema-release.mjs';
import {submitPreparation,drainPreparationQueue,ticketResult} from '../tools/main-prebuild-queue.mjs';
const h='a'.repeat(64),target='b'.repeat(40),base='c'.repeat(40);
test('installed schema capability checks pure frozen plan and exact finite migration',async()=>{
 const selection={targetCommit:target,live:{mainCommit:base}},config={repository:'private-repository'};
 let observed;
 const makePlan=args=>{observed=args;return {baseSha:base,headSha:target,migrate:true,changes:[{status:'A',path:piWorkspaceMigration}]};};
 assert.equal((await assertSelectedPreparationSupported(config,selection,{makePlan})).additionKind,'PiWorkspace');assert.deepEqual(observed,{cwd:config.repository,base,head:target});
 assert.equal(assertMainSchemaPlanSupported({migrate:false}),null);
 for(const changes of [[{status:'M',path:piWorkspaceMigration}],[{status:'A',path:'backend/unknown/migrations/9999.py'}],[]])assert.throws(()=>assertMainSchemaPlanSupported({migrate:true,changes}));
});
test('unsupported selected schema terminates before dispatch/effects; a later supported ticket can proceed',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'selected-schema-admission-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let supported=false,prepare=0;const events=[];
 const binding={configSha256:h,bundleSha256:h};const options={...binding,admitPreparation:async()=>events.push('ordinary'),observe:async()=>{events.push('observe');return {targetCommit:target,packet:path.join(root,'packet'),live:{mainCommit:base,head:{bindingSha256:h},djangoManifestSha256:h,chainStateSha256:h}};},admitSelectedPreparation:async selection=>{events.push('schema');assert.equal(selection.targetCommit,target);if(!supported)throw Error('fixed installed schema capability missing');},prepare:async()=>{events.push('prepare');prepare++;return {status:'already-current',targetCommit:target,currentCommit:target,publicationPerformed:false};}};
 const first=await submitPreparation(root,{...binding,origin:'manual'});await drainPreparationQueue(root,options);
 const failure=await ticketResult(root,first.requestId,first.ticketSha256);assert.equal(failure.status,'failed');assert.equal(failure.dispatchId,undefined);assert.deepEqual(events,['ordinary','observe','schema']);assert.deepEqual(await fs.readdir(path.join(root,'dispatches')),[]);assert.equal(prepare,0);
 const original=await fs.readFile(path.join(root,'results',first.requestId+'.json'));supported=true;events.length=0;const second=await submitPreparation(root,{...binding,origin:'manual'});await drainPreparationQueue(root,options);
 assert.equal((await ticketResult(root,second.requestId,second.ticketSha256)).status,'current');assert.deepEqual(events,['ordinary','observe','schema','prepare']);assert.equal(prepare,1);assert.deepEqual(await fs.readFile(path.join(root,'results',first.requestId+'.json')),original);
});
