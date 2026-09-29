import {Miniflare} from 'miniflare';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {patchWranglerInspector,originalInspectorSha256,originalInspectorForTesting} from './install-wrangler-inspector-patch.mjs';
import {connectMemoryInspector} from './workerd-memory-inspector.mjs';
import {captureUserHeap} from './workerd-memory-snapshot.mjs';

const variant=process.argv[2],label=process.argv[3];
if(!['before','after'].includes(variant)||!/^[a-z0-9-]{1,50}$/.test(label??''))throw new Error('Use before/after and a new label');
const directory=new URL(`../tmp/workerd-memory/${label}/`,import.meta.url);await mkdir(directory,{recursive:true});
if(await access(new URL('result.json',directory)).then(()=>true,()=>false))throw new Error('Evidence already exists');
const original=originalInspectorForTesting(await readFile(new URL('../node_modules/wrangler/wrangler-dist/InspectorProxyWorker.js',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');if(sha(original)!==originalInspectorSha256)throw new Error('Wrong original proxy');
const source=variant==='before'?original:patchWranglerInspector(original);
process.env.TERUISI_WORKERD_HEAP_MB='3072';
const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],modules:[
 {type:'ESModule',path:'entry.js',contents:`import {InspectorProxyWorker} from './proxy.js';
 let proxy;
 let sequence=0;
 export default {async fetch(request){const url=new URL(request.url);proxy??=new InspectorProxyWorker({}, {WRANGLER_VERSION:'4.92.0',PROXY_CONTROLLER:{fetch:async()=>new Response('')}});
   if(url.pathname==='/feed'){
     for(let i=0;i<100;i++)proxy.handleRuntimeIncomingMessage({data:JSON.stringify({method:'Network.dataReceived',params:{requestId:String(sequence++),timestamp:sequence,dataLength:4096,encodedDataLength:4096,data:btoa(String(sequence).padStart(16,'0')+'x'.repeat(4080))}})});
     await new Promise(resolve=>setTimeout(resolve,0));
   }
   return Response.json({events:sequence,buffered:proxy.runtimeMessageBuffer.length,chars:proxy.runtimeMessageBufferChars??null});
 }};`},
 {type:'ESModule',path:'proxy.js',contents:source},
],outboundService:async()=>new Response(null,{status:403})});
let inspector,error;const samples=[],snapshots={},started=Date.now();
async function sample(phase){
 const host=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$all=Get-CimInstance Win32_Process;$ids=@(${process.pid});for($i=0;$i -lt 4;$i++){$ids=@($ids+@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId})|Select-Object -Unique)};[pscustomobject]@{freeKiB=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;processes=@($all|Where-Object{$_.Name -eq 'workerd.exe' -and $ids -contains [int]$_.ProcessId}|ForEach-Object{$p=Get-Process -Id $_.ProcessId;[pscustomobject]@{pid=$p.Id;privateBytes=$p.PrivateMemorySize64;workingSetBytes=$p.WorkingSet64}})}|ConvertTo-Json -Depth 4 -Compress`],{windowsHide:true,encoding:'utf8'}));
 const state=await(await fetch(new URL('/state',await mf.ready))).json();
 samples.push({phase,seconds:(Date.now()-started)/1000,state,host,heaps:await inspector.usage()});
 if(host.freeKiB<700*1024||host.processes.some(p=>p.privateBytes>500*1024*1024))throw new Error('Lab memory budget exceeded');
}
try {
 await mf.ready;inspector=await connectMemoryInspector(mf);await inspector.callUser('Runtime.enable');await sample('warm');
 snapshots.warm=await captureUserHeap(inspector,fileURLToPath(new URL('warm.heapsnapshot',directory)));await sample('warm-after-snapshot');
 for(let batch=1;batch<=30;batch++){
  const result=await(await fetch(new URL('/feed',await mf.ready),{method:'POST'})).json();
  if(result.events!==batch*100)throw new Error('Wrong event count');
  if(batch%5===0)await sample('load-'+batch);
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 snapshots.final=await captureUserHeap(inspector,fileURLToPath(new URL('final.heapsnapshot',directory)));await sample('after-snapshot');
}catch(e){error=e.message;process.exitCode=1;}
finally{
 inspector?.close();await mf.dispose();const result={variant,label,proxySha256:sha(source),events:3000,bodyBytesPerEvent:4096,elapsedSeconds:(Date.now()-started)/1000,samples,snapshots,error,synthetic:true,production:false};
 await writeFile(new URL('result.json',directory),JSON.stringify(result,null,2));
 console.log(JSON.stringify({variant,error,elapsedSeconds:result.elapsedSeconds,points:samples.map(s=>({phase:s.phase,buffered:s.state.buffered,heapMiB:s.heaps['core:user:'].usedSize/1048576,privateMiB:s.host.processes[0].privateBytes/1048576})),retainedEvents:snapshots.final?.networkEventObjects,paths:snapshots.final?.networkEventPathSamples}));
}
