import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const names=['ADMIN_RESIDUAL_PACKET_V2.json','ADMIN_RESIDUAL_METADATA_V2.json','ADMIN_REFERENCE_DIAGNOSTIC_V1.json'];
const raw=await Promise.all(names.map(n=>readFile(root+n)));
const [packet,result,baseline]=raw.map(b=>JSON.parse(b));
assert.equal(hash(raw[0]),'bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0');
assert.equal(hash(raw[1]),'0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6');
assert.equal(result.baselineSha256,hash(raw[2]));assert.equal(packet.baselineSha256,hash(raw[2]));
const sourceHash=hash(await readFile(packet.script.path));assert.equal(sourceHash,packet.script.sha256);assert.equal(sourceHash,'6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9');
assert.equal(result.isAdministrator,true);assert.equal(result.productionActions,0);assert.equal(result.readProcessMemoryCalls,0);assert.equal(result.debugPrivilegeEnabledByProbe,false);
const expected=[
 [236,129,true,5], [280,1,true,5],
 [1700,128,false,4294967294,'C:\\Windows\\System32\\LsaIso.exe','c6d056926edf6c5b531f1bb58a366794f95446bf35e40cf51c069bd068d0c967'],
 [6548,128,false,4294967294,'C:\\Windows\\System32\\NgcIso.exe','a35439fab7d5188fe047b580e6ed3aea547453718a4fa854524a8d1d2c213203'],
 [53880,0,true,4294967294]
];
assert.deepEqual(result.records.map(r=>r.processId),expected.map(r=>r[0]));
for(const [pid,flags,peb,level,image,sha] of expected){
 const r=result.records.find(r=>r.processId===pid),prior=baseline.unknown.find(r=>r.processId===pid);
 for(const key of ['nativeCreationFileTime','cimCreationUtc','name'])assert.equal(r[key],prior[key]);
 assert.equal(r.sessionId,0);assert.equal(r.openError,null);assert.equal(r.timeBeforeError,null);assert.equal(r.timeAfterError,null);
 assert.equal(r.instanceMatchesBaseline,true);assert.equal(r.identityStable,true);assert.equal(r.ntStatus,0);assert.equal(r.ntStatusHex,'00000000');
 assert.equal(r.returnedLength,64);assert.equal(r.structureSize,64);assert.equal(r.basicProcessId,pid);assert.equal(r.layoutValid,true);
 assert.equal(r.flags,flags);assert.equal(r.flagsHex,flags.toString(16).padStart(8,'0'));assert.equal(r.pebIsNull,peb);assert.equal(r.unknownFlagBits,0);
 assert.equal(r.isSecureProcess,!!(flags&128));assert.equal(r.isProtectedProcess,!!(flags&1));assert.equal(r.isSubsystemProcess,false);
 assert.equal(r.protectionSucceeded,true);assert.equal(r.protectionError,null);assert.equal(r.protectionLevel,level);assert.equal(r.protectionLevelHex,level.toString(16).padStart(8,'0'));
 if(image){const e=r.imageEvidence;assert.equal(e.status,'metadata-collected-not-admission');assert.equal(e.expectedPath,image);assert.equal(e.actualPath,image);assert.equal(e.sha256,sha);assert.equal(e.signatureStatus,'Valid');assert.equal(e.signerSubject,'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');assert.equal(e.signerThumbprint,'DC91E564D5BC1E3A8E02D6A8508682ABEA8A2443');assert.equal(e.postIdentityStable,true);assert.equal(e.failure,null);assert.equal(e.queryError,null);}
}
const audit={version:'astra-residual-v2-record-crosscheck-v1',files:names.map((name,i)=>({name,sha256:hash(raw[i])})),sourceSha256:sourceHash,instancesMatched:5,systemImagesMatched:2,status:'record-consistent-not-admission',nativeCalls:0,productionActions:0,limitations:'Saved facts match pinned source/baseline; no live requery, no proof of all future or guest references, and no frozen-guard exemption.'};
await writeFile(root+'ASTRA_RESIDUAL_V2_RECORD_CROSSCHECK.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(audit,null,2));
