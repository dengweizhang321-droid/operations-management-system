import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateKernelDeparture} from './live-os-instance-policy.mjs';
const actual=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/ASTRA_OWNED_PROCESS_DEPARTURE_V1.json'));
function row(proof){return {ProcessId:proof.processId,identityStable:false,cimCreationUtc:proof.originalCimCreationUtc,nativeCreationFileTime:proof.originalNativeCreationFileTime,departureProof:structuredClone(proof)};}
const exited=actual.cases.find(c=>c.name==='same-instance-exit0-proven').proof;
function absent(){return row({...exited,kind:'pid-absent',openError:87,nativeCreationBefore:null,nativeCreationAfter:null,exitQuerySucceeded:false,exitCode:null,finalCimState:'absent',reason:'kernel-invalid-pid-and-cim-absent'});}
test('actual owned child same-native-instance exit0 evidence accepted',()=>{assert.equal(validateKernelDeparture(row(exited)).kind,'kernel-confirmed-departure');});
for(const name of ['alive-259-rejected','different-native-birth-rejected-before-exit-query','actually-terminated-exit259-remains-unknown'])test('actual native negative stays unknown: '+name,()=>{assert.throws(()=>validateKernelDeparture(row(actual.cases.find(c=>c.name===name).proof)));});
test('controlled error87 plus final absent DTO accepted (no claim of live query here)',()=>{assert.equal(validateKernelDeparture(absent()).proof.openError,87);});
const negatives=[
 ['access denied is not absence',r=>{r.departureProof.openError=5;}],
 ['a CIM miss alone is not kernel absence',r=>{r.departureProof.openError=null;}],
 ['PID reappeared',r=>{r.departureProof.finalCimState='present';}],
 ['live current row cannot be skipped',r=>{r.identityStable=true;}],
 ['mismatched current instance',r=>{r.cimCreationUtc='2026-01-01T00:00:00.0000000Z';}],
 ['wrong PID in proof',r=>{r.departureProof.processId++;}],
 ['missing kernel result',r=>{delete r.departureProof.openError;}],
 ['contradictory queried-birth on failed open',r=>{r.departureProof.nativeCreationBefore=exited.nativeCreationBefore;}]
];
for(const [name,change] of negatives)test(name,()=>{const r=absent();change(r);assert.throws(()=>validateKernelDeparture(r));});
test('exit receipt cannot transfer to another native birth',()=>{const r=row(exited);r.nativeCreationFileTime=(BigInt(r.nativeCreationFileTime)+1n).toString();assert.throws(()=>validateKernelDeparture(r));});
test('exit receipt must remain same birth after query',()=>{const r=row(exited);r.departureProof.nativeCreationAfter=(BigInt(exited.nativeCreationBefore)+1n).toString();assert.throws(()=>validateKernelDeparture(r));});
test('failed exit query is never termination proof',()=>{const r=row(exited);r.departureProof.exitQuerySucceeded=false;assert.throws(()=>validateKernelDeparture(r));});
