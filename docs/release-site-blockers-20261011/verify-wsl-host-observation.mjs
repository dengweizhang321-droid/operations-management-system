import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(root+'WSL_HOST_ASSOCIATION_ADMIN_V1.json'),capture=JSON.parse(raw),r=capture.record;
const packetRaw=await readFile(root+'WSL_HOST_READONLY_PACKET_V2.json'),packet=JSON.parse(packetRaw);
assert.equal(sha(packetRaw),'6af6ec639f51242f3afc8290669fe83f9ea8a7cfab77794ceccead28445f67ad');
assert.equal(sha(await readFile(packet.script.path)),packet.script.sha256);
assert.equal(capture.version,'teruisi-wsl-host-association-metadata-v1');assert.equal(capture.rawCommandPersisted,false);
assert.equal(capture.remoteMemoryReads,0);assert.equal(capture.debugPrivilegesEnabled,false);assert.equal(capture.productionActionsRequested,0);
assert.equal(r.status,'unproven');assert.equal(r.failure,'HCS WSL record is outside the reviewed shape');
assert.equal(r.identityStable,true);assert.equal(r.vmmemProcessId,53880);assert.equal(r.parentProcessId,7788);
assert.equal(r.vmmemCreationFileTime,'134360870965622198');assert.equal(r.parentCreationFileTime,'134360870964681909');
assert.equal(r.parentCimCreationUtc,'2026-10-10T06:24:56.4681900Z');
assert.equal(r.vmmemOpenError,null);assert.equal(r.parentOpenError,null);assert.equal(r.accessMask,'0x1000');
assert.equal(r.imagePath,'C:\\Windows\\System32\\vmwp.exe');assert.equal(r.imageSha256,'62814079cc5a896142fc28d1084b7c22e97b4e35d3816b4e45f51c5bb0a88b7c');
assert.equal(r.signatureStatus,'Valid');assert.equal(r.signerSubject,'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
assert.equal(r.commandStatusFirst,0);assert.equal(r.commandStatusSecond,0);
assert.equal(r.commandSha256,'37bc785ae86d5554ea64eeaa5afff05538d6ec48d3008d70c3aea62242b8d396');
assert.deepEqual(r.commandArgumentShape.map(v=>v.kind),['absolute-drive-path','guid','opaque']);
assert.deepEqual(r.runtimeGuidCandidates,['3aaab424-3094-4bb0-a07a-652f47171ad7']);
assert.deepEqual(r.hcsBefore,r.hcsAfter);assert.equal(r.hcsBefore.startStatus,0);assert.equal(r.hcsBefore.completionStatus,0);
assert.deepEqual(r.hcsBefore.wslSystems,[{id:'3AAAB424-3094-4BB0-A07A-652F47171AD7',runtimeId:'3aaab424-3094-4bb0-a07a-652f47171ad7',owner:'WSL',state:'Running',systemType:'VirtualMachine',runtimeOsType:null}]);
// Native argv uses the uppercase GUID spelling; RuntimeId is lower-case.
// Compare the recorded token bytes to the exact HCS Id, then UUID semantics.
assert.equal(r.commandArgumentShape[1].sha256,sha(r.hcsBefore.wslSystems[0].id));
assert.equal(r.hcsBefore.wslSystems[0].id.toLowerCase(),r.runtimeGuidCandidates[0]);
const result={version:'primary-wsl-host-observation-crosscheck-v1',packetSha256:sha(packetRaw),captureSha256:sha(raw),scriptSha256:packet.script.sha256,
 recordedStatusUnchanged:'unproven',nativeIdentityStable:true,hcsSnapshotsIdentical:true,uniqueHcsRuntimeEqualsExactCommandGuid:true,
 interpretation:'Metadata collection succeeded; draft expected Linux in optional RuntimeOsType. Actual HCS omitted it. Preserve original refusal; new explicit nullable-field schema must be independently reviewed and wired to a fresh live collector. Guest Linux/epoch proof remains separate.',
 productionActions:0};
await writeFile(root+'PRIMARY_WSL_HOST_OBSERVATION_CROSSCHECK_V1.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
