// Isolated, synthetic loopback experiment. No production env, DB, bindings or scheduler.
import http from 'node:http';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { Miniflare } from 'miniflare';
import { connectMemoryInspector } from './workerd-memory-inspector.mjs';

const label = process.argv[2];
if (!/^(before|after)(-[a-z0-9]+)?$/.test(label ?? '')) throw new Error('Use before/after label');
const out = new URL(`../tmp/workerd-memory/${label}.json`, import.meta.url);
await mkdir(new URL('../tmp/workerd-memory/', import.meta.url), { recursive: true });
if(await access(out).then(()=>true,()=>false)) throw new Error('Evidence output already exists; choose a new label');
const baselineRef = process.argv[3];
if (baselineRef && !/^[a-f0-9]{8,40}$/.test(baselineRef)) throw new Error('Baseline must be an exact commit');
const source = baselineRef ? execFileSync('git',['show',`${baselineRef}:lib/ai/bounded-fetch.ts`],{encoding:'utf8'}) : await readFile(new URL('../lib/ai/bounded-fetch.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const cycles=Number(process.argv[4] ?? 3);
if(!Number.isSafeInteger(cycles)||cycles<3||cycles>12) throw new Error('cycles must be 3..12');
const inspect=process.argv[5]==='inspect';
const payloadBytes = 8 * 1024 * 1024;
const fixture = Buffer.from(JSON.stringify(Array.from({length:4096},(_,id)=>({id,padding:'x'.repeat(220)}))));
let active = 0, opened = 0, closed = 0, sentBytes = 0;
const server = http.createServer((req, res) => {
  opened++; active++;
  req.resume();
  const successful = ['/query','/import'].includes(req.url);
  const size = successful ? fixture.length : payloadBytes;
  let sent = 0;
  res.writeHead(req.url === '/redirect' ? 302 : 200, { 'content-length': size, 'content-type': 'application/json' });
  res.flushHeaders();
  const timer = setInterval(() => {
    if (res.writableLength > 128 * 1024) return;
    const length=Math.min(64 * 1024,size-sent);
    const chunk = successful ? fixture.subarray(sent,sent+length) : Buffer.alloc(length,32);
    sent += chunk.length; sentBytes += chunk.length; res.write(chunk);
    if (sent >= size) { clearInterval(timer); res.end(); }
  }, 2);
  res.on('close', () => { clearInterval(timer); active--; closed++; });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
process.env.TERUISI_WORKERD_HEAP_MB = '3072';
const mf = new Miniflare({ host: '127.0.0.1', port: 0,
  ...(inspect?{inspectorPort:0}:{}),
  compatibilityDate: '2026-05-15',
  modules: [{type:'ESModule',path:'bounded.js',contents:compiled.code},{type:'ESModule',path:'entry.js',contents:`import {fetchBoundedJson} from './bounded.js';\nexport default { async fetch(request) {
    const mode = new URL(request.url).pathname;
    if (mode === '/ping') return Response.json({ok:true});
    if (mode === '/download') { const r=await fetch('http://127.0.0.1:${port}/download'); return new Response(r.body); }
    try { const result=await fetchBoundedJson({url:'http://127.0.0.1:${port}' + mode,init:mode==='/import'?{method:'POST',body:'x'.repeat(1048576)}:{},timeoutMs:30000,maxBytes:1048576}); return Response.json({rows:result.data.length}); }
    catch(e) { return Response.json({code:e.code}); }
  }};`}].reverse(),
});
const samples = [], requests = [];
let inspector;
const started = Date.now();
async function sample(phase) {
  const ps = `$all=Get-CimInstance Win32_Process; $ids=@(${process.pid}); for($i=0;$i -lt 4;$i++){ $ids=@($ids + @($all | Where-Object {$ids -contains [int]$_.ParentProcessId} | ForEach-Object {[int]$_.ProcessId}) | Select-Object -Unique) }; $rows=@($all | Where-Object {$_.Name -eq 'workerd.exe' -and $ids -contains [int]$_.ProcessId} | ForEach-Object {$p=Get-Process -Id $_.ProcessId; [pscustomobject]@{pid=$p.Id;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;peakWorkingSetBytes=$p.PeakWorkingSet64;cpuSeconds=$p.TotalProcessorTime.TotalSeconds}}); [pscustomobject]@{processes=$rows;freePhysicalKiB=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;competingTestOrBuildCount=@($all | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match '(--test\\s|test:unit|vinext.*build)'}).Count} | ConvertTo-Json -Depth 4 -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, encoding: 'utf8' }).trim();
  const measurement = JSON.parse(raw);
  const heaps=inspector?await inspector.usage():undefined;
  samples.push({ seconds: (Date.now()-started)/1000, phase, active, opened, closed, sentBytes, ...measurement,heaps });
  if(measurement.freePhysicalKiB < 512*1024) throw new Error('Low host memory; experiment stopped');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await mf.ready;
  if(inspect) inspector=await connectMemoryInspector(mf);
  await (await mf.dispatchFetch('http://fixture.invalid/ping')).text();
  await sample('warmup');
  for (let cycle=0; cycle<cycles; cycle++) {
    for(let i=0;i<40;i++) {
      const mode=['/oversize','/redirect','/query','/import','/download'][i%5];
      const t=Date.now();
      const response = await mf.dispatchFetch('http://fixture.invalid'+mode);
      if(mode==='/download') {
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length!==payloadBytes || bytes.some(b=>b!==32)) throw new Error('Download differs');
      } else {
        const data = await response.json();
        if(['/query','/import'].includes(mode) ? data.rows!==4096 : data.code !== (mode==='/redirect'?'redirect':'response_too_large')) throw new Error('Wrong response contract');
      }
      requests.push({cycle, mode, ms:Date.now()-t});
      if(i%10===9) await sample(`load-${cycle+1}`);
      await sleep(75);
    }
    for(let i=0;i<3;i++) { await sleep(1000); await sample(`idle-${cycle+1}`); }
  }
} finally {
  inspector?.close();
  await mf.dispose();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await writeFile(out, JSON.stringify({label,baselineRef,cycles,inspect,sourceSha256:createHash('sha256').update(source).digest('hex'),payloadBytes,fixtureRows:4096,fixtureBytes:fixture.length,importBytes:1048576,requestCount:requests.length,elapsedSeconds:(Date.now()-started)/1000,samples,requests,cleanup:{active,opened,closed}},null,2));
}
console.log(JSON.stringify({label,requestCount:requests.length,elapsedSeconds:(Date.now()-started)/1000,peakActive:Math.max(...samples.map(s=>s.active)),peakPrivateBytes:Math.max(...samples.flatMap(s=>s.processes.map(p=>p.privateBytes)))}));
