import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root=new URL('../tmp/workerd-memory/',import.meta.url);
const before=JSON.parse(await readFile(new URL('before-controlled.json',root),'utf8'));
const after=JSON.parse(await readFile(new URL('after-controlled.json',root),'utf8'));
const profile=await readFile(new URL('before-profile.json',root),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const production=(await readFile(new URL('production-observation-v2.jsonl',root),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(JSON.parse);
const mib=n=>Math.round(n/1048576*100)/100;
const summary=run=>({label:run.label,sourceSha256:run.sourceSha256,requestCount:run.requestCount,elapsedSeconds:run.elapsedSeconds,
  peakSampledPrivateMiB:mib(Math.max(...run.samples.flatMap(s=>s.processes.map(p=>p.privateBytes)))),
  peakWorkingSetMiB:mib(Math.max(...run.samples.flatMap(s=>s.processes.map(p=>p.peakWorkingSetBytes)))),
  finalIdlePrivateMiB:mib(run.samples.at(-1).processes[0].privateBytes),
  competingSamples:run.samples.filter(s=>s.competingTestOrBuildCount>0).length,
  minFreeHostMiB:Math.min(...run.samples.map(s=>s.freePhysicalKiB))/1024,
  idleEnds:run.samples.filter((s,i,a)=>s.phase.startsWith('idle')&&a[i+1]?.phase!==s.phase).map(s=>({seconds:s.seconds,privateMiB:mib(s.processes[0].privateBytes)})),
  cleanup:run.cleanup});
const results={before:summary(before),after:summary(after),profile:profile?summary(profile):null,production:{samples:production.length,seconds:(Date.parse(production.at(-1).utc)-Date.parse(production[0].utc))/1000,
  busySamples:production.filter(r=>r.helper.busy===true).length,processes:production[0].processes.map(p=>{
    const rows=production.map(r=>r.processes.find(q=>q.pid===p.pid));
    return {pid:p.pid,role:p.role,initialAgeMinutes:p.ageSeconds/60,firstPrivateMiB:mib(p.privateBytes),lastPrivateMiB:mib(rows.at(-1).privateBytes),peakSampledPrivateMiB:mib(Math.max(...rows.map(r=>r.privateBytes))),peakSampledWorkingSetMiB:mib(Math.max(...rows.map(r=>r.workingSetBytes))),cpuDeltaSeconds:rows.at(-1).cpuSeconds-p.cpuSeconds};
  })}};
const destination=new URL('../docs/evidence/workerd-memory-20260929/',import.meta.url);
await mkdir(destination,{recursive:true});
await writeFile(new URL('measurements.json',destination),JSON.stringify({results,before,after,profile,production},null,2));
let csv='environment,label,seconds,pid,role,privateMiB,workingSetMiB\n';
for(const run of [before,after]) for(const s of run.samples) for(const p of s.processes) csv+=`isolated,${run.label},${s.seconds},${p.pid},workerd,${mib(p.privateBytes)},${mib(p.workingSetBytes)}\n`;
if(profile)for(const s of profile.samples)for(const p of s.processes)csv+=`isolated-profile,${profile.label},${s.seconds},${p.pid},workerd,${mib(p.privateBytes)},${mib(p.workingSetBytes)}\n`;
for(const s of production) for(const p of s.processes) csv+=`production,readonly,${(Date.parse(s.utc)-Date.parse(production[0].utc))/1000},${p.pid},${p.role},${mib(p.privateBytes)},${mib(p.workingSetBytes)}\n`;
await writeFile(new URL('curves.csv',destination),csv);
const colors=['#1967d2','#d35400','#218739','#9b59b6','#555555','#008a8a'];
function chart(title,series,ymax) {
  const xmax=Math.max(...series.flatMap(s=>s.points.map(p=>p[0])));
  let svg=`<svg viewBox="0 0 950 370" role="img" aria-label="${title}"><text x="65" y="25" font-size="18">${title}</text>`;
  for(let i=0;i<=5;i++) {const y=290-i*46;svg+=`<path d="M65 ${y} H910" stroke="#ddd"/><text x="10" y="${y+5}">${Math.round(ymax*i/5)}</text>`;}
  for(let i=0;i<=5;i++){const x=65+i*169;svg+=`<text x="${x}" y="315">${Math.round(xmax*i/5)}s</text>`;}
  series.forEach((s,i)=>{const c=colors[i];svg+=`<polyline fill="none" stroke="${c}" stroke-width="2" points="${s.points.map(([x,y])=>`${65+x/xmax*845},${290-y/ymax*230}`).join(' ')}"/><text x="${65+(i%3)*285}" y="${342+Math.floor(i/3)*20}" fill="${c}">${s.name}</text>`;});
  return svg+'</svg>';
}
const isolated=[before,after].map(r=>({name:r.label,points:r.samples.map(s=>[s.seconds,mib(s.processes[0].privateBytes)])}));
const live=production[0].processes.map(p=>({name:`${p.role} PID ${p.pid}`,points:production.map(s=>[(Date.parse(s.utc)-Date.parse(production[0].utc))/1000,mib(s.processes.find(q=>q.pid===p.pid).privateBytes)])}));
const heapSeries=profile?['core:user:','core:entry'].flatMap(id=>['usedSize','backingStorageSize'].map(field=>({name:`${id} ${field}`,points:profile.samples.map(s=>[s.seconds,mib(s.heaps[id][field])])}))):[];
const heapChart=profile?chart('Isolated inspector: heap and backing storage (MiB); no forced GC',heapSeries,Math.max(1,Math.ceil(Math.max(...heapSeries.flatMap(s=>s.points.map(p=>p[1])))))):'';
await writeFile(new URL('curves.html',destination),`<!doctype html><html lang="en"><meta charset="utf-8"><title>workerd memory diagnostic evidence</title><style>body{max-width:1100px;margin:30px auto;font:16px system-ui;color:#222}svg{width:100%;border:1px solid #ddd;margin:12px 0}text{font-family:system-ui;font-size:13px}pre{white-space:pre-wrap}</style><h1>workerd memory diagnosis — 2026-09-29</h1><p>Private bytes in MiB. Samples are not JS heap measurements. Low-rate synthetic traffic and an idle production window cannot prove a historic leak is fixed. No forced GC, raised limits or production restart.</p>${chart('Isolated mixed workload: three identical cycles',isolated,Math.ceil(Math.max(...isolated.flatMap(s=>s.points.map(p=>p[1])))/20)*20)}${chart('Production: read-only observation; exact business request count unavailable',live,300)}${heapChart}<pre>${JSON.stringify(results,null,2)}</pre></html>`);
console.log(JSON.stringify(results,null,2));
