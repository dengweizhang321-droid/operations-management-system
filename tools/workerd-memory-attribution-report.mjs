import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {summarizeHeap} from './workerd-memory-snapshot.mjs';

const root=new URL('../tmp/workerd-memory/',import.meta.url);
const names=['empty','parse','response-json','synthetic-bounded','fetch-json','fetch-signal','fetch-timer','fetch-bounded','upload-bounded','stream','timeout','cancel'];
const read=async(file)=>{
  const result=JSON.parse(await readFile(new URL(file,root),'utf8'));
  const directory=file.slice(0,file.lastIndexOf('/')+1);
  for(const phase of ['warm','final']) {
    const raw=await readFile(new URL(`${directory}${result.name}-${phase}.heapsnapshot`,root));
    if(createHash('sha256').update(raw).digest('hex')!==result.snapshots[phase].sha256)throw new Error('Raw snapshot digest mismatch');
    result.snapshots[phase]={...result.snapshots[phase],...summarizeHeap(JSON.parse(raw.toString('utf8')))};
  }
  return result;
};
const cases=await Promise.all(names.map(name=>read(`${name==='fetch-json'?'fetch-json-pure-v2':'split-v1'}/${name}.json`)));
const positive=await read('positive-v1/retained-control.json');
const idle=await read('detached-idle-v1/upload-bounded.json');
const all=[...cases,positive,idle];
for(const run of all)if(run.error||!run.snapshots.final||run.cleanup.active!==0||run.cleanup.opened!==run.cleanup.closed)throw new Error('Incomplete experiment evidence');
for(const run of all)if(run.samples.some(s=>/idle|quiet|final-after/.test(s.phase)&&s.active!==0))throw new Error('Upstream response remained active before cleanup');
if(positive.snapshots.warm.fixtureRowObjects!==384||positive.snapshots.final.fixtureRowObjects!==9600)throw new Error('Positive retention control not detected');
const mib=n=>Math.round(n/1048576*1000)/1000;
function summarize(run){
  const before=run.samples.find(s=>s.phase===`idle-${run.idleSeconds??10}s`);
  const warm=run.samples.find(s=>s.phase==='warm-after-snapshot');
  const after=run.samples.at(-1);
  const counts=snapshot=>Object.fromEntries(snapshot.selectedClasses.map(c=>[c.name,c.count]));
  const initial=counts(run.snapshots.warm),final=counts(run.snapshots.final);
  return {case:run.name,label:run.runLabel,requestCount:run.requestCount,elapsedSeconds:run.elapsedSeconds,fixtureRows:run.fixtureRows,fixtureBytes:run.fixtureBytes,
    warmHeapMiB:mib(warm.heaps['core:user:'].usedSize),beforeSnapshotHeapMiB:mib(before.heaps['core:user:'].usedSize),afterSnapshotHeapMiB:mib(after.heaps['core:user:'].usedSize),
    backingBeforeMiB:mib(before.heaps['core:user:'].backingStorageSize),backingAfterMiB:mib(after.heaps['core:user:'].backingStorageSize),
    peakPrivateMiB:mib(Math.max(...run.samples.flatMap(s=>s.host.processes.map(p=>p.privateBytes)))),
    naturalIdlePrivateMiB:mib(before.host.processes[0].privateBytes),afterSnapshotPrivateMiB:mib(after.host.processes[0].privateBytes),
    fixtureRowObjectsWarm:run.snapshots.warm.fixtureRowObjects,fixtureRowObjectsFinal:run.snapshots.final.fixtureRowObjects,
    objectCountChanges:Object.fromEntries(Object.keys(final).map(name=>[name,{warm:initial[name]??0,final:final[name],delta:final[name]-(initial[name]??0)}])),
    competingSamples:run.samples.filter(s=>s.host.competing>0).length,upstreamResponsesActiveAtFinalSample:run.samples.at(-1).active,cleanup:run.cleanup,uploadedBytes:run.samples.at(-1).uploadedBytes,
    warmSnapshot:{bytes:run.snapshots.warm.bytes,sha256:run.snapshots.warm.sha256},finalSnapshot:{bytes:run.snapshots.final.bytes,sha256:run.snapshots.final.sha256}};
}
const summary={schema:'workerd-memory-attribution-v1',baseline:'e00d4a82',productionChanged:false,comparisonIsDiagnosisNotFix:true,cases:cases.map(summarize),positiveControl:summarize(positive),detachedIdle:summarize(idle)};
const destination=new URL('../docs/evidence/workerd-memory-attribution-20260929/',import.meta.url);
await mkdir(destination,{recursive:true});
await writeFile(new URL('summary.json',destination),JSON.stringify(summary,null,2));
await writeFile(new URL('experiments.json',destination),JSON.stringify(all,null,2));
let csv='run,case,phase,seconds,requests,userHeapMiB,backingMiB,privateMiB,competing\n';
for(const run of all)for(const sample of run.samples)csv+=`${run.runLabel},${run.name},${sample.phase},${sample.seconds},${sample.requests},${sample.heaps?mib(sample.heaps['core:user:'].usedSize):''},${sample.heaps?mib(sample.heaps['core:user:'].backingStorageSize):''},${mib(sample.host.processes[0].privateBytes)},${sample.host.competing}\n`;
await writeFile(new URL('curves.csv',destination),csv);
const rows=[...summary.cases,summary.positiveControl],max=Math.ceil(Math.max(...rows.map(r=>r.beforeSnapshotHeapMiB))/5)*5;
const height=rows.length*48+70;
let bars=`<svg viewBox="0 0 1040 ${height}" role="img" aria-label="User heap before and after diagnostic heap snapshot"><text x="230" y="24">User heap MiB: before snapshot (blue), after snapshot (orange)</text>`;
rows.forEach((r,i)=>{const y=48+i*48;bars+=`<text x="5" y="${y+13}">${r.case}</text><rect x="230" y="${y}" width="${r.beforeSnapshotHeapMiB/max*660}" height="13" fill="#176fc1"/><text x="${237+r.beforeSnapshotHeapMiB/max*660}" y="${y+11}">${r.beforeSnapshotHeapMiB}</text><rect x="230" y="${y+16}" width="${r.afterSnapshotHeapMiB/max*660}" height="13" fill="#bc5700"/><text x="${237+r.afterSnapshotHeapMiB/max*660}" y="${y+27}">${r.afterSnapshotHeapMiB}</text>`;});
bars+='</svg>';
const points=idle.samples.map(s=>[s.seconds,mib(s.host.processes[0].privateBytes)]),xmax=points.at(-1)[0],ymax=Math.ceil(Math.max(...points.map(p=>p[1]))/20)*20;
let curve='<svg viewBox="0 0 1040 350" role="img" aria-label="Private memory during detached idle experiment"><text x="60" y="24">Detached load and 180-second quiet interval: process Private MiB</text>';
for(let i=0;i<=5;i++){const y=280-i*44;curve+=`<path d="M60 ${y}H980" stroke="#ddd"/><text x="10" y="${y+5}">${Math.round(ymax*i/5)}</text>`;}
for(let i=0;i<=5;i++){const x=60+i*184;curve+=`<text x="${x}" y="306">${Math.round(xmax*i/5)}s</text>`;}
curve+=`<polyline fill="none" stroke="#176fc1" stroke-width="2" points="${points.map(([x,y])=>`${60+x/xmax*920},${280-y/ymax*220}`).join(' ')}"/></svg>`;
await writeFile(new URL('curves.html',destination),`<!doctype html><html lang="en"><meta charset="utf-8"><title>workerd split workload and heap attribution</title><style>body{max-width:1120px;margin:28px auto;font:16px system-ui;color:#222}svg{width:100%;border:1px solid #ddd;margin:12px 0}text{font:13px system-ui}pre{white-space:pre-wrap}</style><h1>Split workloads and heap snapshots</h1><p>These are diagnostic experiments, not a repair benchmark. Taking a heap snapshot affects collection. All ordinary fixture-row objects disappear; an intentionally retained positive control remains. No production service was changed.</p>${bars}${curve}<pre>${JSON.stringify(summary,null,2)}</pre></html>`);
console.log(JSON.stringify(summary,null,2));
