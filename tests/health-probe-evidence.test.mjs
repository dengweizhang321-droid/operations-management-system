import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const text=await readFile(new URL('../tools/release-readonly-retry.mjs',import.meta.url),'utf8');
const names=['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
const block=text.slice(text.indexOf('function sanitizeReadinessFailure('),text.indexOf('export async function retryReadOnlyObservation(')).replaceAll('export function ','function ');
const api=new Function('readinessComponents',block+'\nreturn {safeHealthEvidence,safeReadinessFailure,sanitizeReadinessFailure};')(names);
const trace=()=>({version:1,checkedAt:'2026-10-10T22:49:00.1234567Z',probes:Object.fromEntries(['live','helper','ready'].map(n=>[n,{called:true,requested:true,statusCode:200,parsedObject:true,okMatches:true,markerMatches:true,passed:true,degradedMatches:false,beforeDeadline:true,timeoutMs:n==='ready'?5000:3000,effectiveTimeoutMs:n==='ready'?5000:3000,elapsedMs:4.3,errorKind:'none'}]))});
test('three known bounded probes survive repeated readiness filtering exactly',()=>{
  const status={state:'Running',backendState:'Ready',workerState:'exact_release',releaseId:'fixture',components:Object.fromEntries(names.map(n=>[n,true])),healthEvidence:trace()};
  const out=api.safeReadinessFailure(status,'fixture');assert.equal(out.healthEvidence.checkedAt,'2026-10-10T22:49:00.123Z');assert.deepEqual(api.sanitizeReadinessFailure(out),out);assert.deepEqual(api.safeHealthEvidence(out.healthEvidence),out.healthEvidence);
});
test('old source status has unchanged snapshot shape and no fabricated health trace',()=>{
  const out=api.safeReadinessFailure({components:{}},'fixture');assert.equal(Object.hasOwn(out,'healthEvidence'),false);assert.deepEqual(api.sanitizeReadinessFailure(out),out);
});
test('unknown probe names, private values and all response bodies are discarded',()=>{
  const v=trace();v.checkedAt='PRIVATE_SECRET';v.probes.customer={response:'PRIVATE_SECRET'};v.probes.ready.reason='PRIVATE_SECRET';v.probes.ready.content='PRIVATE_SECRET';v.probes.ready.uri='http://local/?PRIVATE_SECRET';v.probes.ready.errorKind='PRIVATE_SECRET';
  const out=api.safeHealthEvidence(v);assert.equal(JSON.stringify(out).includes('PRIVATE_SECRET'),false);assert.equal(out.checkedAt,null);assert.equal(out.probes.ready.errorKind,'unrecognized');assert.deepEqual(Object.keys(out.probes),['live','helper','ready']);
});
test('missing and malformed probe fields stay null instead of becoming healthy',()=>{
  const v=trace();delete v.probes.helper;v.probes.live.passed='true';v.probes.live.statusCode={private:true};v.probes.live.elapsedMs=Infinity;v.probes.live.effectiveTimeoutMs=-1;
  const out=api.safeHealthEvidence(v);assert.equal(out.probes.helper,null);assert.equal(out.probes.live.passed,null);assert.equal(out.probes.live.statusCode,null);assert.equal(out.probes.live.elapsedMs,null);assert.equal(out.probes.live.effectiveTimeoutMs,null);assert.deepEqual(api.safeHealthEvidence(out),out);
});
test('failure and no-request facts survive alongside completed native metadata',()=>{
  const v=trace();Object.assign(v.probes.live,{requested:false,passed:false,beforeDeadline:false,statusCode:null,effectiveTimeoutMs:null,errorKind:'deadline'});Object.assign(v.probes.ready,{called:false,requested:false,passed:false,statusCode:null,errorKind:'not-called'});
  const out=api.safeHealthEvidence(v);assert.equal(out.probes.live.errorKind,'deadline');assert.equal(out.probes.live.requested,false);assert.equal(out.probes.ready.called,false);assert.equal(out.probes.ready.passed,false);assert.deepEqual(api.safeHealthEvidence(out),out);
});
test('unknown version or invalid envelope cannot provide a valid diagnostic',()=>{
  for(const v of [null,{version:2,probes:{}},{version:1,probes:[]}])assert.equal(api.safeHealthEvidence(v),null);
});
