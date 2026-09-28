import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../tmp/workerd-memory/',import.meta.url);
const load=async label=>JSON.parse(await readFile(new URL(`${label}/result.json`,root),'utf8'));
const before=await load('wrangler-before-normal'),after=await load('wrangler-after-normal'),soak=await load('wrangler-after-soak');
const bufferBefore=await load('proxy-buffer-before2'),bufferAfter=await load('proxy-buffer-after');
const functional=await Promise.all(['wrangler-after-asset3','wrangler-after-rsc2','wrangler-after-page'].map(load));
for(const run of [before,after,soak,...functional])if(run.error||run.requests.some(r=>r.status!==200)||run.counters.rejectedOrigin||run.counters.rejectedSignature||run.counters.unhandled)throw new Error('Incomplete full Worker experiment');
if(before.buildIndexSha256!==after.buildIndexSha256||JSON.stringify(before.requests)!==JSON.stringify(after.requests)||JSON.stringify(before.counters)!==JSON.stringify(after.counters))throw new Error('Before/after workload or output contract differs');
for(const run of [bufferBefore,bufferAfter])if(run.error)throw new Error('Incomplete proxy experiment');
const mib=n=>Math.round(n/1048576*1000)/1000;
const byRole=(run,role)=>run.samples.map(s=>({seconds:s.seconds,requests:s.requests,privateMiB:mib(s.host.processes.find(p=>p.role===role).privateBytes)}));
function summarize(run){return {requests:run.requests.length,backendCalls:run.counters.outbound,elapsedSeconds:run.elapsedSeconds,responseBytes:run.requests[0].bytes,fixturePadding:run.fixturePadding,
 proxyPeakMiB:Math.max(...byRole(run,'public-proxy').map(p=>p.privateMiB)),proxyFinalMiB:byRole(run,'public-proxy').at(-1).privateMiB,
 applicationPeakMiB:Math.max(...byRole(run,'application').map(p=>p.privateMiB)),nodeHostPeakMiB:mib(Math.max(...run.samples.map(s=>s.host.hostPrivateBytes))),
 competingSamples:run.samples.filter(s=>s.host.competingTests>0).length,inspectorProxySha256:run.inspectorProxySha256,externalDevToolsAttached:run.inspectorAttached};}
const summary={version:1,baseline:summarize(before),candidate:summarize(after),candidateSoak:summarize(soak),workerBuildUnchanged:true,
 outputLengthsAndSuccessResultsMatch:true,noForcedGcInWranglerComparison:true,oldSpaceMiB:3072,
 buffer:{events:3000,originalBuffered:bufferBefore.samples.at(-1).state.buffered,patchedBuffered:bufferAfter.samples.at(-1).state.buffered,
 originalRetainedHeapMiB:mib(bufferBefore.samples.at(-1).heaps['core:user:'].usedSize),patchedRetainedHeapMiB:mib(bufferAfter.samples.at(-1).heaps['core:user:'].usedSize),
 retainingPaths:bufferBefore.snapshots.final.networkEventPathSamples},
 functional:functional.map(r=>({mode:r.mode,requests:r.requests.length,bytes:r.requests[0].bytes,sha256:r.requests[0].sha256})),productionChanged:false};
const directory=new URL('../docs/evidence/workerd-inspector-fix-20260929/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('summary.json',directory),JSON.stringify(summary,null,2));
await writeFile(new URL('experiments.json',directory),JSON.stringify({before,after,soak,bufferBefore,bufferAfter,functional},null,2));
let csv='run,phase,seconds,requests,role,privateMiB\n';
for(const [label,run] of [['before',before],['after',after],['soak',soak]])for(const sample of run.samples)for(const p of sample.host.processes)csv+=`${label},${sample.phase},${sample.seconds},${sample.requests},${p.role},${mib(p.privateBytes)}\n`;
await writeFile(new URL('curves.csv',directory),csv);
const colors=['#b54a17','#116ab3'];
function chart(title,role){const series=[before,after].map(r=>byRole(r,role));const maxX=Math.max(...series.flat().map(p=>p.seconds)),maxY=Math.ceil(Math.max(...series.flat().map(p=>p.privateMiB))/50)*50;
 let s=`<svg viewBox="0 0 1000 340" role="img" aria-label="${title}"><text x="65" y="25">${title}</text>`;
 for(let i=0;i<=5;i++){const y=280-i*44;s+=`<path d="M65 ${y}H940" stroke="#ddd"/><text x="8" y="${y+5}">${Math.round(maxY*i/5)}</text>`;}
 for(let i=0;i<=5;i++)s+=`<text x="${65+i*175}" y="302">${Math.round(maxX*i/5)}s</text>`;
 series.forEach((points,i)=>{s+=`<polyline fill="none" stroke="${colors[i]}" stroke-width="3" points="${points.map(p=>`${65+p.seconds/maxX*875},${280-p.privateMiB/maxY*220}`).join(' ')}"/><text x="${65+i*220}" y="327" fill="${colors[i]}">${i?'Candidate':'Original 4.92.0'}</text>`;});return s+'</svg>';}
await writeFile(new URL('curves.html',directory),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Wrangler inspector retention fix</title><style>body{max-width:1100px;margin:30px auto;font:16px system-ui;color:#222}svg{width:100%;border:1px solid #ddd;margin:12px 0}text{font:14px system-ui}pre{white-space:pre-wrap}</style><h1>Wrangler inspector retention fix — isolated verification</h1><p>Same compiled Worker, 51 scheduled requests, 459 signed fixture calls, 3072 MiB old-space. No external DevTools, heap snapshot, forced GC or restart during these curves. Windows Private bytes in MiB. Node host includes Wrangler API, driver and synthetic backend.</p>${chart('Public proxy process (contains InspectorProxyWorker)','public-proxy')}${chart('Application workerd process','application')}<pre>${JSON.stringify(summary,null,2)}</pre></html>`);
console.log(JSON.stringify(summary,null,2));
