// Metadata-only execution/timing capture. Never runs a lifecycle or DB action.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const supplement='E:/codex-artifacts/release-integration-review-20261010/AB-ui-supplement-20261010-0820-final';
const metadata='E:/codex-artifacts/release-integration-review-20261010/AB-backup-metadata-20261010-1025-final';
const label=process.argv[2];assert.match(label??'',/^[a-z0-9-]{3,60}$/);
const spec=JSON.parse(await readFile(root+'/approved-batch.json'));
const {journalState,timingReport}=await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/release-batch.mjs'));
const state=await journalState(spec.journalRoot,spec.batch),events=state.events;
const approved=events.find(e=>e.status==='approved');assert.ok(approved);
const at=new Date().toISOString(),phases=timingReport(events),completed=events.findLast(e=>e.status==='completed');
const operations=spec.batch.operations.map(op=>({id:op.id,phase:op.phase,mutating:op.mutating,status:state.latest.get(op.id)?.status??'not-started',
  latestAt:state.latest.get(op.id)?.at??null,latestEventSha256:state.latest.get(op.id)?.eventSha256??null,
  latestReceiptSha256:state.latest.get(op.id)?.receiptSha256??null,outputs:state.latest.get(op.id)?.outputs??null,
  attempts:events.filter(e=>e.operationId===op.id&&e.status==='started').length,
  recordedExecutionMs:events.filter(e=>e.operationId===op.id&&Number.isFinite(e.durationMs)).reduce((sum,e)=>sum+e.durationMs,0)}));
const phaseTotals=Object.values(phases.durationMs).reduce((sum,value)=>sum+value,0),lastRequired=state.latest.get(spec.batch.operations.at(-1).id);
const segments=[];for(const folder of [root+'/production',supplement+'/production',metadata+'/production']){
  const raw=await readFile(folder+'/entry-observations.jsonl'),rows=raw.toString().trim().split('\n').map(line=>JSON.parse(line));
  const intervals=[];for(let i=0;i<rows.length;i++){if(rows[i].available)continue;const first=i;while(i+1<rows.length&&!rows[i+1].available)i++;
    const before=rows[first-1],after=rows[i+1];intervals.push({firstUnavailable:rows[first].at,lastUnavailable:rows[i].at,samples:i-first+1,
      previousAvailable:before?.at??null,nextAvailable:after?.at??null,observedSpanMs:Date.parse(rows[i].at)-Date.parse(rows[first].at),
      conservativeBoundMs:before&&after?Date.parse(after.completedAt)-Date.parse(before.at):null});}
  segments.push({folder,prefixSha256:createHash('sha256').update(raw).digest('hex'),first:rows[0].at,last:rows.at(-1).at,count:rows.length,
    unavailableSamples:rows.filter(r=>!r.available).length,maxGapMs:Math.max(...rows.slice(1).map((r,i)=>Date.parse(r.at)-Date.parse(rows[i].at))),intervals});
}
const queue=[];for(const name of await readdir(path.join(spec.journalRoot,'_queue'))){const dir=path.join(spec.journalRoot,'_queue',name);
  let requested;try{requested=JSON.parse(await readFile(path.join(dir,'requested.json')));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(Date.parse(requested.requestedAt)<Date.parse(approved.at))continue;
  const entry={name,...requested};for(const kind of ['acquired','blocked'])try{entry[kind]=JSON.parse(await readFile(path.join(dir,kind+'.json')));}catch(error){if(error.code!=='ENOENT')throw error;}queue.push(entry);
}
let active=null;try{active=JSON.parse(await readFile(path.join(spec.journalRoot,'active.json')));}catch(error){if(error.code!=='ENOENT')throw error;}
const data={version:'teruisi-ab-execution-timing-v1',capturedAt:at,batchSha256:spec.batch.batchSha256,sourceCommit:'5faac8151f59d66de72c3caead8cad916ea547da',
  releaseId:'20261010T014638Z-97833d2f2b7e7bc9',workerManifestSha256:spec.batch.binding.artifactSha256,djangoManifestSha256:spec.batch.binding.djangoCandidateSha256,
  originalApprovedAt:approved.at,supplementApprovedAt:JSON.parse(await readFile(supplement+'/human-supplement-approval.json')).approvedAt,
  metadataApprovedAt:JSON.parse(await readFile(metadata+'/human-metadata-approval.json')).approvedAt,
  events:events.length,journalHead:state.previous,active,operations,unresolved:state.unknown,phases,
  necessaryAcceptanceClosedAt:completed&&operations.every(op=>op.status==='passed')?lastRequired.at:null,engineCompletedAt:completed?.at??null,fullDeliveryClosedAt:null,
  originalApprovalToCaptureMs:Date.parse(at)-Date.parse(approved.at),unallocatedWallThroughLastEventMs:Date.parse(events.at(-1).at)-Date.parse(approved.at)-phaseTotals,
  historicalFailures:events.filter(e=>['unknown','failed'].includes(e.status)).map(e=>({operationId:e.operationId,status:e.status,at:e.at,eventSha256:e.eventSha256,durationMs:e.durationMs??null,reason:e.reason})),
  queue,queueCoverage:'Only shared release-batch _queue records from original approval; no assertion about unrecorded work or OS contention',
  availability:{segments,blindGaps:[{from:approved.at,to:segments[0].first},...segments.slice(1).map((segment,index)=>({from:segments[index].last,to:segment.first}))],
    claims:'GET response headers/status samples only. Gaps remain unknown; switch span is not downtime; no customer response payload.'},
  calculation:'Only parent WAL durationMs added; nested process/observation/engine durations are subdivisions, never counted again. Unallocated wall includes human decisions, coordination, investigation and gaps without invented attribution.'};
await writeFile('docs/release-integration-review/production/'+label+'.json',JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({capturedAt:at,events:events.length,completed:phases.completed,latestOperation:operations.filter(op=>op.status!=='not-started').at(-1)?.id,
  minutesSinceOriginalApproval:data.originalApprovalToCaptureMs/60000,unresolved:state.unknown.map(e=>e.operationId),availableSamples:segments.map(s=>({count:s.count,failed:s.unavailableSamples}))}));
