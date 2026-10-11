import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['ADMIN_READONLY_PACKET_V2.json','ADMIN_READONLY_COMPLETED_V1.json','ADMIN_REFERENCE_DIAGNOSTIC_V1.json','ADMIN_CAPTURE_SUMMARY_V1.json'];
const raw=await Promise.all(files.map(f=>readFile(root+f))),[packet,completion,result,summary]=raw.map(b=>JSON.parse(b));
assert.equal(sha(raw[0]),'9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38');
assert.equal(completion.packetSha256,sha(raw[0]));assert.deepEqual(result.captureSummary,summary);
assert.equal(completion.resultPath,root+files[2]);assert.equal(result.originalGuardSha256,packet.frozenGuardSha256);
assert.equal(result.status,'blocked');assert.equal(result.unknown.length,5);assert.equal(result.references.length,0);
assert.equal(summary.processes,840);assert.equal(summary.fallbackUsed,17);assert.equal(summary.changedDuringCapture,0);
assert.equal(packet.productionApproved,false);assert.equal(completion.productionActions,0);assert.equal(result.productionActions,0);assert.equal(summary.productionMutations,0);
assert.ok(Date.parse(summary.at)<=Date.parse(result.at)&&Date.parse(result.at)<=Date.parse(completion.at));
const sources=[];
for(const key of ['collector','evaluator','launcher']){const value=sha(await readFile(packet[key].path));assert.equal(value,packet[key].sha256);sources.push({kind:key,sha256:value});}
function toFileTime(iso){const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{1,7})Z$/.exec(iso);assert.ok(match);return BigInt(Date.parse(match[1]+'Z'))*10000n+116444736000000000n+BigInt(match[2].padEnd(7,'0'));}
const checks=[...result.unknown,result.selectedCwd].map(p=>{const native=BigInt(p.nativeCreationFileTime),cim=toFileTime(p.cimCreationUtc);assert.equal(native/10n,cim/10n);return {processId:p.processId,matchesAtMicrosecond:true,nativeMinusCim100ns:(native-cim).toString()};});
assert.equal(result.selectedCwd.processId,47936);assert.equal(result.selectedCwd.readable,true);assert.equal(result.selectedCwd.identityStable,true);assert.equal(result.selectedCwd.refersToPrevious,false);assert.equal(result.selectedCwd.failure,null);assert.equal('CurrentDirectory' in result.selectedCwd,false);
const audit={version:'astra-admin-record-crosscheck-v1',files:files.map((name,i)=>({name,sha256:sha(raw[i])})),sources,instanceChecks:checks,status:'records-consistent-still-blocked',unknown:5,knownReferences:0,nativeProbeCalls:0,productionActions:0,limitations:'Three saved records are internally consistent; completion does not embed result SHA. Raw full process inventory/image paths were intentionally not retained; this cannot independently replay all predicates or attest current live state.'};
await writeFile(root+'ASTRA_ADMIN_RECORD_CROSSCHECK_V1.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(audit,null,2));
