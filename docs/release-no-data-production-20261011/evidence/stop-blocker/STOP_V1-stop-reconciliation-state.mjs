// Only the fixed Stop postcondition already established by this batch's full maintenance.
import assert from 'node:assert/strict';
export const stopFixed=Object.freeze({
 batch:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',
 id:'first-adoption-live-guard-20261011',operation:'op-stopworker-switch',
 head:'290394e394a67bd4e095c052caf9302702028435af8c799678db8a4d30af62c9',
 entered:'8ddc0f29606ba1ea9a4cfd20b4bf93a265121efe05aa8abf5ed368ad2d608d31',
 maintenanceId:'a483894ad8d945298c866c74a06df6ff',
 release:'20261010T014638Z-97833d2f2b7e7bc9',
 manifest:'f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113',
 binding:'094e10d4508986d62e5d90bf99041271fb7527f9a8b5d33f1dfb386529cee548',
 chain:'aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9',
 django:'237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9',
 pids:[48744,71332,11416,49472],
});
export function normalizeStopObservation(raw){
 assert.equal(raw.version,'fixed-stop-postcondition-observation-v1');assert.equal(raw.worker.exitCode,0);assert.equal(raw.django.exitCode,0);assert.equal(raw.native.exitCode,0);
 assert.equal(raw.native.receipt.sid,'S-1-5-21-815909789-107973518-1379257801-1001');assert.equal(raw.native.receipt.administrator,true);
 for(const k of ['active','maintenance','drain','lastControlledStop']){assert.equal(raw[k].absent,false);assert.match(raw[k].sha256,/^[a-f0-9]{64}$/);}
 assert.equal(raw.workerProcessReceipt.absent,true);
 const p=raw.native.receipt.ports;assert.ok(Array.isArray(p));assert.deepEqual(p,[{address:'127.0.0.1',port:5432,pid:4080}]);
 return {version:'fixed-stop-postcondition-live-v1',workerStatus:raw.worker.receipt,djangoStatus:raw.django.receipt,checkedPorts:[3000,5791],listeningPorts:p.filter(p=>p.port===3000||p.port===5791),workerReceipt:null,processes:[...raw.native.receipt.missing].sort((a,b)=>a.pid-b.pid),maintenance:raw.maintenance.value,drain:raw.drain.value,controlledStop:raw.lastControlledStop.value};
}
export function validateStoppedPostcondition({state,active,observation,chain,djangoManifestSha256,operation,operations}){
 assert.equal(state.events.length,19);assert.equal(state.previous,stopFixed.head);assert.equal(state.unknown.length,1);
 const failed=state.latest.get(stopFixed.operation);assert.equal(failed,state.unknown[0]);assert.equal(failed.eventSha256,stopFixed.head);assert.equal(failed.status,'unknown');
 assert.ok(failed.processEvidence.engine.some(e=>e.code==='worker_gate_failed'&&e.stage==='StopForRelease'&&e.processId===49472));
 const entered=state.latest.get('op-entermaintenance-drain');assert.equal(entered.status,'passed');assert.equal(entered.eventSha256,stopFixed.entered);assert.equal(entered.outputs.maintenanceId,stopFixed.maintenanceId);
 assert.deepEqual(active,{batchSha256:stopFixed.batch,id:stopFixed.id});
 assert.equal(operation.id,stopFixed.operation);assert.equal(operation.kind,'lifecycle');assert.equal(operation.step,'StopWorker');
 assert.ok(!operations.some(o=>(o.command?.args??[]).some(a=>a.includes('{receipt:'+stopFixed.operation+':'))),'Stop outputs unexpectedly consumed');
 assert.equal(chain.status,'resolved');assert.equal(chain.successorCount,219);assert.equal(chain.chainStateSha256,stopFixed.chain);assert.equal(chain.head.bindingSha256,stopFixed.binding);assert.equal(chain.head.manifestSha256,stopFixed.manifest);assert.equal(chain.head.releaseId,stopFixed.release);
 assert.equal(djangoManifestSha256,stopFixed.django);
 const o=observation;assert.equal(o.version,'fixed-stop-postcondition-live-v1');
 assert.equal(o.workerStatus.version,'teruisi-local-worker-status-v1');assert.equal(o.workerStatus.state,'stopped');assert.equal(o.workerStatus.releaseId,stopFixed.release);assert.equal(o.workerStatus.manifestSha256,stopFixed.manifest);
 assert.equal(o.workerStatus.supervisorProcessId,null);assert.equal(o.workerStatus.portProcessId,null);assert.equal(o.workerStatus.reason,null);
 assert.deepEqual(o.listeningPorts,[]);assert.deepEqual(o.checkedPorts,[3000,5791]);assert.equal(o.workerReceipt,null);
 assert.deepEqual([...o.processes].sort((a,b)=>a.pid-b.pid),[...stopFixed.pids].sort((a,b)=>a-b).map(pid=>({pid,cimAbsent:true,openSucceeded:false,error:87})));
 assert.equal(o.djangoStatus.PostgreSQL,'running');assert.equal(o.djangoStatus.DjangoReader,'stopped');assert.equal(o.djangoStatus.DjangoWriter,'stopped');
 for(const g of [o.maintenance,o.drain]){assert.equal(g.id,stopFixed.maintenanceId);assert.equal(g.runtimeRoot,'D:\\teruisi-runtime\\django-sales');assert.equal(g.keepPostgres,true);}
 assert.equal(o.maintenance.version,'teruisi-system-maintenance-v1');assert.equal(o.maintenance.drainedStopped,true);assert.equal(o.drain.version,'teruisi-automation-drain-v1');assert.equal(o.drain.phase,'requests');
 // Diagnostic is corroboration only. Actual status, ports, gates and native identities above are mandatory.
 assert.equal(o.controlledStop.version,'teruisi-worker-stop-diagnostic-v1');assert.equal(o.controlledStop.action,'EnterMaintenance');assert.equal(o.controlledStop.phase,'supervisor_absent');assert.equal(o.controlledStop.supervisorPid,48744);assert.equal(o.controlledStop.supervisorCreationDate,'2026-10-10T06:26:26.7917950Z');assert.equal(o.controlledStop.manifestSha256,stopFixed.manifest);
 return {postcondition:'stopped-by-this-batch-enter-maintenance',originalStopForRelease:'gate-failed-not-replayed',outputsRequired:false};
}
