// A stopped-WSL observation is not a name exemption or a saved-receipt bypass.
import assert from 'node:assert/strict';
const sid='S-1-5-21-815909789-107973518-1379257801-1001';
export const selectedBirth=Object.freeze({pid:47936,cim:'2026-10-06T00:51:18.5673010Z',native:'134357214785673015'});
export function assertNoWslFreshBoundary(frame,now=Date.now()){
 const times=[frame.startedAt,frame.nativeCompletedAt,frame.hcs.completedAt,frame.at,frame.runningFinishedAt].map(Date.parse);
 assert.ok(Number.isFinite(now)&&times.every(Number.isFinite));assert.ok(times.every((v,i)=>i===0||v>=times[i-1]));assert.ok(now>=times[4]&&now-times[1]<=5000,'Actual native/HCS boundary expired');
}
export function validateNoWslBoundary(frame){
 assert.equal(frame?.version,'fixed-no-running-wsl-boundary-v1');assert.equal(frame.sid,sid);assert.equal(frame.administrator,true);
 assert.equal(frame.productionActions,0);assert.equal(frame.debugPrivilegeEnabled,false);assert.equal(frame.guestInvocations,0);
 assert.equal(frame.hcs.startStatus,0);assert.equal(frame.hcs.completionStatus,0);assert.equal(frame.hcs.documentPresent,true);
 assert.equal(frame.hcs.arrayVerified,true);assert.equal(frame.hcs.systemCount,0);assert.deepEqual(frame.hcs.systems,[]);assert.match(frame.hcs.rawSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(frame.vmNameRows,[]);assert.deepEqual(frame.oldVm,{processId:53880,cimAbsent:true,openSucceeded:false,openError:87});
 assert.deepEqual(frame.runningDistros,[]);assert.equal(frame.runningExitCode,0);
 assert.equal(frame.selected.processId,selectedBirth.pid);
 if(frame.selected.cimAbsent===true){assert.equal(frame.selected.openSucceeded,false);assert.equal(frame.selected.openError,87);assert.equal(frame.selected.cimCreationUtc,null);assert.equal(frame.selected.nativeCreationFileTime,null);}
 else {assert.equal(frame.selected.cimAbsent,false);assert.equal(frame.selected.openSucceeded,true);assert.equal(frame.selected.openError,null);assert.equal(frame.selected.cimCreationUtc,selectedBirth.cim);assert.equal(frame.selected.nativeCreationFileTime,selectedBirth.native);assert.equal(frame.selected.identityStable,true);}
 const times=[frame.startedAt,frame.nativeCompletedAt,frame.hcs.completedAt,frame.at,frame.runningFinishedAt].map(Date.parse);assert.ok(times.every(Number.isFinite)&&times.every((v,i)=>i===0||v>=times[i-1]));return frame;
}
export function validateNoWslCensus(before,after,current,native){
 validateNoWslBoundary(before);validateNoWslBoundary(after);assert.ok(Date.parse(after.at)>=Date.parse(before.at));
 assert.ok(Array.isArray(current.processes)&&current.processes.length<=4096);assert.ok(Array.isArray(current.tasks)&&current.tasks.length<=4096);
 assert.equal(new Set(current.processes.map(p=>p.ProcessId)).size,current.processes.length);
 for(const p of current.processes){assert.ok(Number.isSafeInteger(p.ProcessId));assert.notEqual(p.ProcessId,53880);assert.equal(typeof p.Name,'string');assert.ok(!/^(?:vmmem|vmwp(?:\.exe)?$)/i.test(p.Name),'Unreviewed VM process in current census');}
 assert.deepEqual(native.records.map(r=>r.processId),[236,280,1700,6548,53880]);
 const gone=native.records[4];assert.equal(gone.openError,87);assert.equal(gone.name,null);assert.equal(gone.cimCreationUtc,null);assert.equal(gone.nativeCreationFileTime,null);assert.equal(gone.identityStable,false);assert.equal(gone.instanceMatchesBaseline,false);
 for(const n of native.records.slice(0,4)){const p=current.processes.find(p=>p.ProcessId===n.processId);assert.ok(p,'Reviewed OS instance missing');assert.equal(n.identityStable,true);assert.equal(n.instanceMatchesBaseline,true);assert.equal(p.identityStable,true);assert.equal(n.cimCreationUtc,p.cimCreationUtc);}
 return {mode:'no-running-wsl',guestInvocations:0,oldVmProcessId:53880};
}
export function validateSelectedCwdMode(before,after,current){
 const actor=current.processes.find(p=>p.ProcessId===selectedBirth.pid),cwd=current.selectedCwd;
 if(!actor){assert.equal(before.selected.cimAbsent,true);assert.equal(after.selected.cimAbsent,true);return {mode:'kernel-confirmed-absent',processId:selectedBirth.pid};}
 assert.equal(before.selected.cimAbsent,false);assert.equal(after.selected.cimAbsent,false);assert.equal(actor.identityStable,true);assert.equal(actor.cimCreationUtc,selectedBirth.cim);
 assert.equal(cwd?.processId,selectedBirth.pid);assert.equal(cwd.readable,true);assert.equal(cwd.identityStable,true);assert.equal(cwd.cimCreationUtc,selectedBirth.cim);assert.equal(cwd.nativeCreationFileTime,selectedBirth.native);
 assert.match(cwd.CurrentDirectory,/^[A-Za-z]:[\\/]/);assert.ok(!/[\r\n\0]/.test(cwd.CurrentDirectory));return {mode:'live-cwd-required',processId:selectedBirth.pid};
}
