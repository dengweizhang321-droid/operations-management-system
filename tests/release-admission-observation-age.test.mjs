import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

// Execute the actual collector function with controlled read-only seams. No
// production module imports, files, processes, network or database are used.
const raw=readFileSync(new URL('../tools/release-batch-admission.mjs',import.meta.url),'utf8');
const start=raw.indexOf('export async function collectBatchAdmission(');
const end=raw.indexOf('\nasync function main()',start);
assert.ok(start>=0&&end>start);
const source=raw.slice(start,end).replace(/^export /,'');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:canonical(v)).digest('hex');

function fixture(options={}) {
  let clock=1000000,identityReads=0,djangoReads=0,journalReads=0,chainReads=0;
  const calls=[],stages=[],h='d'.repeat(64),sourceTree={sha256:'a'.repeat(64),count:1};
  const identity={sourceTree,sourceInventorySha256:h,nodeExecutableSha256:h,toolchain:{},environmentSha256:h,runtimeConfigurationSha256:h,externalNpmConfiguration:{}};
  const manifest={source:{sourceFingerprint:sourceTree.sha256,tree:sourceTree,packageLockSha256:h}};
  const manifestRaw=Buffer.from(JSON.stringify(manifest));
  const plan={predecessor:{bindingSha256:'before',releaseId:'old'},predecessorChainStateSha256:'chain',candidate:{bindingSha256:'after',releaseId:'next',manifestSha256:hash(manifestRaw)}};
  const planRaw=Buffer.from(JSON.stringify(plan));
  const batch={batchSha256:h,binding:{djangoPredecessorSha256:h,djangoCandidateSha256:h,workerPlanSha256:hash(planRaw),artifactSha256:hash(manifestRaw),predecessorSha256:'before'},operations:[],recovery:{mode:'full'}};
  let observedResponseAt;
  const advance=(name,ms)=>{calls.push(name);clock+=ms;};
  const context={path,Buffer,Number,Math,Error,canonical,hash,djangoRoot:'/private/django',workerRuntimeRoot:'/private/worker',workerSourceRoot:'/private/source',
    admissionTimer:()=>({measure:async(stage,category,action)=>{let status='failed';try{const value=await action();status='passed';return value;}finally{stages.push({stage,category,status});}},result:()=>[...stages]}),
    verifyBatch:()=>{},requireHash:value=>assert.match(value,/^[a-f0-9]{64}$/),safeFileDigest:async()=>{djangoReads++;return options.djangoDrift&&djangoReads>1?'e'.repeat(64):h;},
    journalState:async()=>{journalReads++;return{latest:new Map(),events:[],previous:options.journalDrift&&journalReads>1?'foreign':null};},safeRead:async p=>p.includes('worker-release-rotation-plans')?planRaw:p.endsWith('deployment-manifest.json')?manifestRaw:Buffer.from('{}'),
    resolveEffectiveReleaseChain:async()=>{chainReads++;return{head:{bindingSha256:'before',manifestSha256:h},headManifestPath:'/private/worker/releases/old/deployment-manifest.json',chainStateSha256:options.chainDrift&&chainReads>1?'other-chain':'chain',bootstrap:{authority:{sourceD1PathSha256:h,persistRootPathSha256:h}},records:[]};},
    verifyNoDataDeploymentReceipts:async()=>{},requiresCompleteAdmission:()=>true,requiresCompleteArtifact:()=>true,
    workerPreparationIdentity:async()=>{identityReads++;advance(identityReads===1?'identity-initial':'identity-final',identityReads===1?10000:180000);return options.changedIdentity&&identityReads>1?{...identity,environmentSha256:'e'.repeat(64)}:identity;},
    readSourceTree:async()=>({}),sourceInventory:()=>({}),sourceTreeDigest:()=>h,
    verifyPreparedWorkerCandidate:async()=>{advance('artifact',90000);},runProcess:async()=>{throw new Error('No native process allowed');},
    collectBatchRecovery:async()=>{advance('recovery',120000);return null;},
    verifyWorkerReleaseProcessState:async()=>{advance('dynamic-process',30);},
    runReadOnlyPowerShell:async()=>{advance('status',700);observedResponseAt=clock;return {stdout:'{}',processEvidence:{processId:123,exitCode:0}};},
    parseStatus:()=>({ready:!options.notReady}),assertCompleteReadiness:status=>{if(!status.ready)throw Object.assign(new Error('Not ready'),{code:'STATUS_NOT_READY'});},safeReadinessFailure:()=>({state:'Unresponsive'}),
    retryReadOnlyObservation:async({query,onAttempt})=>{const value=await query({remaining:()=>60000});const attempts=[{attempt:1,status:'passed'}];await onAttempt(attempts[0]);return {value,attempts};},
  };
  const collect=vm.runInNewContext(source+';collectBatchAdmission',context);
  const session=options.session?{collect:async()=>{advance('session-initial',10000);return identity;},recheck:async()=>{advance('session-final',180000);}}:undefined;
  return {calls,stages,getClock:()=>clock,getResponseTime:()=>observedResponseAt,
    run:()=>collect(batch,'/private/tests.json',options.phase??'closeout',{session,now:()=>clock,onStatusAttempt:async()=>{advance('attempt-persistence',options.persistDelay??2000);}})};
}

test('slow artifact, recovery and source checks precede final observations; persistence does not renew time',async()=>{
  const f=fixture(),result=await f.run();
  assert.ok(f.calls.indexOf('artifact')<f.calls.indexOf('dynamic-process'));
  assert.ok(f.calls.indexOf('recovery')<f.calls.indexOf('dynamic-process'));
  assert.ok(f.calls.indexOf('identity-final')<f.calls.indexOf('status'));
  assert.equal(result.observedAtMs,f.getResponseTime());
  assert.equal(f.getClock()-result.observedAtMs,2000);
});
test('session full content recheck also precedes both dynamic observations',async()=>{
  const f=fixture({session:true}),result=await f.run();
  assert.ok(f.calls.indexOf('session-final')<f.calls.indexOf('dynamic-process'));
  assert.ok(f.calls.indexOf('session-final')<f.calls.indexOf('status'));
  assert.equal(result.observedAtMs,f.getResponseTime());
});
test('5001ms post-query persistence rejects stale success and retains its attempts',async()=>{
  const f=fixture({persistDelay:5001});
  await assert.rejects(f.run(),e=>e.code==='STALE_ADMISSION_SNAPSHOT'&&e.observationAgeMs===5001&&e.observationAttempts.length===1&&e.statusObservation.value.ready===true&&Array.isArray(e.admissionStages));
});
test('5000ms boundary remains accepted without resetting the actual clock',async()=>{
  const f=fixture({persistDelay:5000}),result=await f.run();
  assert.equal(f.getClock()-result.observedAtMs,5000);
});
test('backward wall clock is rejected rather than treated as a fresh observation',async()=>{
  const f=fixture({persistDelay:-1});
  await assert.rejects(f.run(),e=>e.code==='STALE_ADMISSION_SNAPSHOT'&&e.observationAgeMs===-1);
});
test('non-health phase timestamps completed process identity, with no later slow recheck',async()=>{
  const f=fixture({phase:'admission'}),result=await f.run();
  assert.equal(f.calls.at(-1),'dynamic-process');
  assert.equal(result.observedAtMs,f.getClock());
  assert.equal(result.statusObservation,null);
});
test('readiness failure keeps native and bounded diagnostics and is not converted to stale success',async()=>{
  const f=fixture({notReady:true});
  await assert.rejects(f.run(),e=>e.code==='STATUS_NOT_READY'&&e.processEvidence.processId===123&&e.readinessEvidence.state==='Unresponsive');
  assert.equal(f.calls.filter(c=>c==='status').length,1);
});
test('changed source blocks before any dynamic probe',async()=>{
  const f=fixture({changedIdentity:true});
  await assert.rejects(f.run(),/Source\/configuration\/toolchain changed/);
  assert.ok(!f.calls.includes('dynamic-process')&&!f.calls.includes('status'));
});
for(const [option,message]of [['djangoDrift','Django deployment changed'],['journalDrift','Batch journal changed'],['chainDrift','Effective release chain changed']]){
  test(`slow verification cannot hide ${option}`,async()=>{
    const f=fixture({[option]:true});
    await assert.rejects(f.run(),new RegExp(message));
    assert.ok(!f.calls.includes('dynamic-process')&&!f.calls.includes('status'));
  });
}
