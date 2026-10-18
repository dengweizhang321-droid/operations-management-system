import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {assertSelectedDependencyCache} from '../tools/publish-latest-main.mjs';import {submitPreparation,drainPreparationQueue,ticketResult} from '../tools/main-prebuild-queue.mjs';
const raw=Buffer.from('{"lockfileVersion":3}\n'),hash=createHash('sha256').update(raw).digest('hex'),target='a'.repeat(40),base='b'.repeat(40),h='c'.repeat(64);
test('dependency admission hashes exact frozen lock bytes and rejects missing or different cache binding',async()=>{
 await assertSelectedDependencyCache({cacheLockSha256:hash},{targetCommit:target},{readLock:async()=>raw});
 await assert.rejects(assertSelectedDependencyCache({cacheLockSha256:h},{targetCommit:target},{readLock:async()=>raw}),/no matching offline cache/);
 await assert.rejects(assertSelectedDependencyCache({},{targetCommit:target},{readLock:async()=>raw}),/Bound offline dependency lock/);
 await assert.rejects(assertSelectedDependencyCache({cacheLockSha256:hash},{targetCommit:target},{readLock:async()=>raw.toString()}),/exact Git object bytes/);
});
test('cache mismatch fails before dispatch; corrected binding can prepare without an unknown operation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'selected-dependency-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let cacheLockSha256=h,native=0;
 const binding={configSha256:h,bundleSha256:h},options={...binding,observe:async()=>({targetCommit:target,packet:path.join(root,'packet'),live:{mainCommit:base,head:{bindingSha256:h},djangoManifestSha256:h,chainStateSha256:h}}),admitSelectedPreparation:selection=>assertSelectedDependencyCache({cacheLockSha256},selection,{readLock:async()=>raw}),prepare:async()=>{native++;return {status:'already-current',targetCommit:target,currentCommit:base,publicationPerformed:false};}};
 const first=await submitPreparation(root,{origin:'manual',...binding});await drainPreparationQueue(root,options);assert.equal((await ticketResult(root,first.requestId,first.ticketSha256)).status,'failed');assert.equal(native,0);assert.deepEqual(await fs.readdir(path.join(root,'dispatches')),[]);
 cacheLockSha256=hash;const next=await submitPreparation(root,{origin:'manual',...binding});await drainPreparationQueue(root,options);assert.equal((await ticketResult(root,next.requestId,next.ticketSha256)).status,'current');assert.equal(native,1);assert.equal((await ticketResult(root,first.requestId,first.ticketSha256)).status,'failed');
});
