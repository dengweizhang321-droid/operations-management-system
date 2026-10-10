// Independent fixtures only. No operator, task, lifecycle, service, DB or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { runAdapter, saveOriginal } from './adapter.mjs';
import { sha, canonical, components } from './validators.mjs';

const start=Date.parse('2026-10-10T12:00:00Z');
const desired=Buffer.from('independent-desired-fixture\n');
function good(at) {
  return {at,releaseId:'fixture',admission:{mode:'running',fence:sha(desired)},healthy:true,probeError:false,
    system:'Running',backend:'Ready',worker:'exact_release',supervisor:'running',supervisorHealth:'healthy',
    components:Object.fromEntries(components.map(n=>[n,true])),probes:Object.fromEntries(['homepage','live','ready','helper'].map(n=>[n,{ok:true}])),workerPid:100,supervisorPid:101};
}
async function heldRaw(root,raw) {
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(entry.isFile()&&(await readFile(path.join(root,entry.name))).equals(raw))return true;
  }
  return false;
}
async function fixture(raws,action) {
  const root=await mkdtemp(path.join(os.tmpdir(),'teruisi-independent-adapter-'));
  const priorNow=Date.now,priorTimeout=globalThis.setTimeout;
  let tick=0,index=0;
  Date.now=()=>start+(tick++)*1000;
  globalThis.setTimeout=callback=>{queueMicrotask(callback);return 0;};
  const context={root,h:{workerPlan:{candidateReleaseId:'fixture'}},safeRead:async filename=>{
    if(filename.includes('django-supervisor-desired-state.json'))return desired;
    assert.ok(filename.endsWith('operations-watchdog/latest.json'));
    return raws[Math.min(index++,raws.length-1)];
  },digestFile:async filename=>{assert.ok(filename.includes('django-supervisor-desired-state.json'));return sha(desired);}};
  try {await action(root,()=>runAdapter('natural-watchdog',context));}
  finally {Date.now=priorNow;globalThis.setTimeout=priorTimeout;await rm(root,{recursive:true,force:true});}
}
test('independent natural malformed JSON is rejected with original bytes preserved',async()=>{
  const raw=Buffer.from('{malformed-observation');
  await fixture([raw],async(root,run)=>{await assert.rejects(run);assert.ok(await heldRaw(root,raw),'Observed malformed raw must survive the failure');});
});
for(const [name,mutate] of [['invalid-at',value=>value.at='not-a-time'],['missing-at',value=>delete value.at]]) {
  test('independent natural '+name+' cannot be skipped while hunting two healthy records',async()=>{
    const invalid=good(new Date(start+10000).toISOString());mutate(invalid);const raw=Buffer.from(canonical(invalid));
    await fixture([raw,Buffer.from(canonical(good(new Date(start+60000).toISOString()))),Buffer.from(canonical(good(new Date(start+120000).toISOString())))],async(root,run)=>{
      await assert.rejects(run);assert.ok(await heldRaw(root,raw),'Observed unclassifiable raw must survive the failure');
    });
  });
}
test('independent natural fresh unhealthy record is retained and rejected',async()=>{
  const bad=good(new Date(start+10000).toISOString());bad.healthy=false;const raw=Buffer.from(canonical(bad));
  await fixture([raw],async(root,run)=>{await assert.rejects(run);assert.ok(await heldRaw(root,raw));});
});
test('independent create-only recovery preservation refuses replacement and retains original',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'teruisi-independent-original-'));
  try {const raw=Buffer.from('original failed/unknown fixture\n');await saveOriginal(root,'receipt.json',raw);await saveOriginal(root,'receipt.json',raw);
    await assert.rejects(()=>saveOriginal(root,'receipt.json',Buffer.from('rewritten-success')));assert.deepEqual(await readFile(path.join(root,'receipt.json')),raw);
  }finally {await rm(root,{recursive:true,force:true});}
});
