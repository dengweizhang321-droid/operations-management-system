// Serial low-rate synthetic attribution; all state, listeners and ports are owned here.
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,access,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
import {Miniflare} from 'miniflare';
import {connectMemoryInspector} from './workerd-memory-inspector.mjs';
import {captureUserHeap} from './workerd-memory-snapshot.mjs';

const cases=['empty','parse','response-json','synthetic-bounded','fetch-json','fetch-signal','fetch-timer','fetch-bounded','upload-bounded','stream','timeout','cancel'];
const selected=process.argv[2]??'all',runLabel=process.argv[3]??'split-v1';
const idleSeconds=Number(process.argv[4]??10),cycles=Number(process.argv[5]??3),detached=process.argv[6]==='detached';
if(!Number.isSafeInteger(idleSeconds)||idleSeconds<10||idleSeconds>300||!Number.isSafeInteger(cycles)||cycles<3||cycles>8)throw new Error('Invalid observation bounds');
if(selected!=='all'&&![...cases,'retained-control'].includes(selected))throw new Error('Unknown case');
if(!/^[a-z0-9-]{1,40}$/.test(runLabel))throw new Error('Invalid run label');
const directory=new URL(`../tmp/workerd-memory/${runLabel}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const baseline='e00d4a82';
const source=execFileSync('git',['show',`${baseline}:lib/ai/bounded-fetch.ts`],{encoding:'utf8'});
const compiled=await transform(source,{loader:'ts',format:'esm'});
const fixture=Buffer.from(JSON.stringify(Array.from({length:4096},(_,id)=>({id,padding:'x'.repeat(220)}))));
const download=Buffer.alloc(8*1024*1024,37);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
process.env.TERUISI_WORKERD_HEAP_MB='3072';

function hostSample() {
  const ps=`$all=Get-CimInstance Win32_Process; $ids=@(${process.pid}); for($i=0;$i -lt 4;$i++){$ids=@($ids+@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId})|Select-Object -Unique)}; $rows=@($all|Where-Object{$_.Name -eq 'workerd.exe' -and $ids -contains [int]$_.ProcessId}|ForEach-Object{$p=Get-Process -Id $_.ProcessId;[pscustomobject]@{pid=$p.Id;privateBytes=$p.PrivateMemorySize64;workingSetBytes=$p.WorkingSet64;peakWorkingSetBytes=$p.PeakWorkingSet64}}); [pscustomobject]@{processes=$rows;freePhysicalKiB=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;competing=@($all|Where-Object{$_.Name -eq 'node.exe' -and $_.CommandLine -match '(--test\\s|test:unit|vinext.*build|pg_restore)'}).Count}|ConvertTo-Json -Depth 4 -Compress`;
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{windowsHide:true,encoding:'utf8'}));
}

for(const name of selected==='all'?cases:[selected]) {
  const output=new URL(`${name}.json`,directory);
  if(await access(output).then(()=>true,()=>false)){
    const prior=JSON.parse(await readFile(output,'utf8'));
    if(prior.error||prior.requestCount!==3+24*cycles||!prior.snapshots?.final||(prior.idleSeconds??10)!==idleSeconds||(prior.detached??false)!==detached)throw new Error('Existing evidence is incomplete or has different settings; use a new label');
    console.log(JSON.stringify({case:name,status:'existing-skipped'}));continue;
  }
  const gate=hostSample();
  if(gate.competing||gate.freePhysicalKiB<1024*1024){console.log(JSON.stringify({case:name,status:'deferred-host-busy',gate}));process.exitCode=2;break;}
  let active=0,opened=0,closed=0,uploadedBytes=0;
  const server=http.createServer(async(req,res)=>{
    active++;opened++;res.on('close',()=>{active--;closed++;});
    for await(const chunk of req)uploadedBytes+=chunk.length;
    if(req.url==='/slow'){res.writeHead(200,{'content-type':'application/json'});res.write('[');return;}
    const body=req.url==='/stream'?download:fixture;
    res.writeHead(200,{'content-type':req.url==='/stream'?'application/octet-stream':'application/json','content-length':body.length});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const upstream=`http://127.0.0.1:${server.address().port}`;
  const script=`import {fetchBoundedJson} from './bounded.js';
    const fixture=JSON.stringify(Array.from({length:4096},(_,id)=>({id,padding:'x'.repeat(220)})));
    const retained=[];
    export default {async fetch(request){
      const mode=new URL(request.url).pathname.slice(1);
      if(mode==='empty')return Response.json({ok:true});
      if(mode==='retained-control'){const batch=Array.from({length:128},(_,id)=>({id,padding:'r'.repeat(220)}));retained.push(batch);return Response.json({rows:batch.length});}
      if(mode==='timeout'||mode==='cancel') {
        const external=new AbortController();
        const timer=mode==='cancel'?setTimeout(()=>external.abort(),25):undefined;
        try {await fetchBoundedJson({url:'${upstream}/slow',init:{},timeoutMs:mode==='timeout'?25:30000,maxBytes:1048576,signal:external.signal});return Response.json({code:'unexpected'});}
        catch(error){return Response.json({code:error.code});}
        finally{if(timer!==undefined)clearTimeout(timer);}
      }
      let data;
      if(mode==='parse')data=JSON.parse(fixture);
      else if(mode==='response-json')data=await new Response(fixture).json();
      else if(mode==='synthetic-bounded')data=(await fetchBoundedJson({url:'http://fixture.invalid',init:{},timeoutMs:30000,maxBytes:1048576,fetcher:async()=>new Response(fixture)})).data;
      else if(mode==='stream'){const r=await fetch('${upstream}/stream');return new Response(r.body);}
      else if(mode==='fetch-json')data=await(await fetch('${upstream}/data')).json();
      else if(mode==='fetch-bounded'||mode==='upload-bounded')data=(await fetchBoundedJson({url:'${upstream}/data',init:mode==='upload-bounded'?{method:'POST',body:'x'.repeat(1048576)}:{},timeoutMs:30000,maxBytes:1048576})).data;
      else {
        const controller=new AbortController();
        const timer=mode==='fetch-timer'?setTimeout(()=>controller.abort(),30000):undefined;
        try{const r=await fetch('${upstream}/data',{signal:controller.signal});data=await r.json();}
        finally{if(timer!==undefined)clearTimeout(timer);}
      }
      return Response.json({rows:data.length,first:data[0].id,last:data[data.length-1].id});
    }};`;
  const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,compatibilityDate:'2026-05-15',modules:[
    {type:'ESModule',path:'entry.js',contents:script},{type:'ESModule',path:'bounded.js',contents:compiled.code},
  ]});
  let inspector,error;
  const started=Date.now(),samples=[],snapshots={},requests=[];
  async function sample(phase) {
    const host=hostSample(),heaps=inspector?await inspector.usage():null;
    const entry={phase,seconds:(Date.now()-started)/1000,requests:requests.length,host,heaps,active,opened,closed,uploadedBytes};
    samples.push(entry);
    if(host.freePhysicalKiB<512*1024||host.processes.some(p=>p.privateBytes>512*1024*1024))throw new Error('Diagnostic memory budget exceeded');
  }
  async function request() {
    const t=Date.now();const r=await fetch(new URL(name,await mf.ready),{signal:AbortSignal.timeout(30000)});
    if(r.status!==200)throw new Error('Unexpected status');
    if(name==='stream'){
      let bytes=0;for await(const chunk of r.body){bytes+=chunk.byteLength;if(chunk.some(v=>v!==37))throw new Error('Corrupt stream');}
      if(bytes!==download.length)throw new Error('Truncated stream');
    }else{
      const body=await r.json();
      const valid=name==='empty'?body.ok:name==='retained-control'?body.rows===128:name==='timeout'||name==='cancel'?body.code===(name==='timeout'?'timeout':'cancelled'):body.rows===4096&&body.first===0&&body.last===4095;
      if(!valid)throw new Error('Invalid fixture result');
    }
    requests.push({ms:Date.now()-t});
  }
  try {
    await mf.ready;inspector=await connectMemoryInspector(mf);
    await inspector.callUser('Runtime.enable');
    for(let i=0;i<3;i++)await request();
    await sample('warm-before-snapshot');
    snapshots.warm=await captureUserHeap(inspector,fileURLToPath(new URL(`${name}-warm.heapsnapshot`,directory)));
    await sample('warm-after-snapshot');
    if(detached){inspector.close();inspector=undefined;}
    for(let cycle=1;cycle<=cycles;cycle++) {
      for(let i=0;i<24;i++){await request();await sleep(100);}
      await sample(`load-${cycle}`);await sleep(2000);await sample(`idle-${cycle}`);
    }
    if(detached){inspector=await connectMemoryInspector(mf);await sample('load-complete');inspector.close();inspector=undefined;}
    let remaining=idleSeconds;
    while(remaining>0){const seconds=Math.min(30,remaining);await sleep(seconds*1000);remaining-=seconds;if(remaining>0)await sample(`quiet-${idleSeconds-remaining}s`);}
    if(detached)inspector=await connectMemoryInspector(mf);
    await sample(`idle-${idleSeconds}s`);
    snapshots.final=await captureUserHeap(inspector,fileURLToPath(new URL(`${name}-final.heapsnapshot`,directory)));
    await sample('final-after-snapshot');
  }catch(e){error=e.message;process.exitCode=1;}
  finally {
    inspector?.close();await mf.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const result={name,runLabel,baseline,idleSeconds,cycles,detached,sourceSha256:createHash('sha256').update(source).digest('hex'),fixtureWorkerSha256:createHash('sha256').update(script).digest('hex'),startedUtc:new Date(started).toISOString(),elapsedSeconds:(Date.now()-started)/1000,fixtureRows:name==='retained-control'?128:4096,fixtureBytes:fixture.length,streamBytes:download.length,importBytes:1048576,heapMiB:3072,concurrency:1,requestCount:requests.length,requests,samples,snapshots,error,cleanup:{active,opened,closed},snapshotCollectionIsDiagnosticNotFix:true};
    await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
    console.log(JSON.stringify({name,requestCount:requests.length,elapsedSeconds:result.elapsedSeconds,error,heapBeforeSnapshot:samples.find(s=>s.phase===`idle-${idleSeconds}s`)?.heaps?.['core:user:'],heapAfterSnapshot:samples.at(-1)?.heaps?.['core:user:'],fixtureRowsAfterSnapshot:snapshots.final?.fixtureRowObjects}));
  }
  if(error)break;
}
