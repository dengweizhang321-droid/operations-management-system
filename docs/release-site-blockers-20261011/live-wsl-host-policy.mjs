import assert from 'node:assert/strict';
const GUID='3aaab424-3094-4bb0-a07a-652f47171ad7';
const expectedSystem=Object.freeze({id:GUID.toUpperCase(),runtimeId:GUID,owner:'WSL',state:'Running',systemType:'VirtualMachine',runtimeOsType:null});
const expectedEpoch=Object.freeze({bootId:'4a67b065-2648-48ef-8821-72f272ceb41d',pid1Start:'122',osrelease:'6.18.33.2-microsoft-standard-WSL2'});
const commandShape=Object.freeze([
 {kind:'absolute-drive-path',sha256:'12a1cbda27acdc5c1d6950e8dfd62f904c7f0567085ea28f78a14cfad77f4414'},
 {kind:'guid',sha256:'3a1a7e7084e0217a11bda844855c183f8830920a56f9547bfe4f95f7555b8250'},
 {kind:'opaque',sha256:'333516b481e0554d0c7cc6f85bf22c2a1fedbc578718df354546e335913f1f1f'}
]);
export const hostAssociationEvidenceSha256='f11f84beed8e8f6645c19929f74fdd7ee88a2827dea93e72b2d2286e836eb1c4';
export function validateLiveWslHostFrame(frame,guestEpoch){
 assert.equal(frame?.version,'teruisi-live-wsl-host-association-v1','Old diagnostic is not a live receipt');
 assert.equal(frame.rawCommandPersisted,false);assert.equal(frame.debugPrivilegesEnabled,false);assert.equal(frame.remoteMemoryReads,0);assert.equal(frame.productionActionsRequested,0);
 const r=frame.record;assert.equal(r?.status,'association-metadata-collected-not-admission');assert.equal(r.failure,null);
 assert.equal(r.vmmemProcessId,53880);assert.equal(r.vmmemCreationFileTime,'134360870965622198');
 assert.equal(r.parentProcessId,7788);assert.equal(r.parentCreationFileTime,'134360870964681909');assert.equal(r.parentCimCreationUtc,'2026-10-10T06:24:56.4681900Z');
 assert.equal(r.accessMask,'0x1000');assert.equal(r.vmmemOpenError,null);assert.equal(r.parentOpenError,null);assert.equal(r.identityStable,true);
 assert.equal(r.imagePath,'C:\\Windows\\System32\\vmwp.exe');assert.equal(r.imageSha256,'62814079cc5a896142fc28d1084b7c22e97b4e35d3816b4e45f51c5bb0a88b7c');
 assert.equal(r.signatureStatus,'Valid');assert.equal(r.signerSubject,'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
 assert.equal(r.commandStatusFirst,0);assert.equal(r.commandStatusSecond,0);assert.equal(r.commandSha256,'37bc785ae86d5554ea64eeaa5afff05538d6ec48d3008d70c3aea62242b8d396');
 assert.deepEqual(r.commandArgumentShape,commandShape);assert.deepEqual(r.runtimeGuidCandidates,[GUID]);assert.deepEqual(r.matchingRuntimeIds,[GUID]);
 for(const hcs of [r.hcsBefore,r.hcsAfter]){assert.equal(hcs?.startStatus,0);assert.equal(hcs.completionStatus,0);assert.deepEqual(hcs.wslSystems,[expectedSystem]);}
 // The observed HCS runtimeOsType is null. Linux identity comes from the fixed
 // independently captured guest epoch, never a made-up HCS field or time guess.
 assert.deepEqual(guestEpoch,expectedEpoch);
 return {runtimeId:GUID,parentProcessId:7788,parentCreationFileTime:r.parentCreationFileTime,vmmemProcessId:53880,vmmemCreationFileTime:r.vmmemCreationFileTime,guestEpoch:{...expectedEpoch}};
}
export function validateLiveWslAssociation(before,after,guestEpoch){
 const a=validateLiveWslHostFrame(before,guestEpoch),b=validateLiveWslHostFrame(after,guestEpoch);assert.deepEqual(a,b);
 assert.deepEqual(before.record,after.record,'Host association changed across guest collection');
 return {kind:'exact-live-host-guest-association',...a};
}
