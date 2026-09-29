// Full compiled Worker with synthetic, closed outbound services. Never loads production vars.
import {Miniflare} from 'miniflare';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,access,cp} from 'node:fs/promises';
import {createHash,randomBytes,createHmac} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {connectMemoryInspector} from './workerd-memory-inspector.mjs';
import {captureUserHeap} from './workerd-memory-snapshot.mjs';
import {originalInspectorForTesting} from './install-wrangler-inspector-patch.mjs';

const mode=process.argv[2]??'scheduled',label=process.argv[3]??'full-app-pilot',count=Number(process.argv[4]??40);
const workspaceRoot=fileURLToPath(new URL('../',import.meta.url));
if(path.resolve(process.cwd()).toLowerCase()!==path.resolve(workspaceRoot).toLowerCase())throw new Error('Run the lab from its own isolated workspace');
const engine=process.argv[5]??'miniflare',fixturePadding=Number(process.argv[6]??0);
const dependencyVariant=process.argv[7]??'installed';
if(!['installed','original'].includes(dependencyVariant)||dependencyVariant==='original'&&engine!=='wrangler')throw new Error('Invalid dependency variant');
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
const gitDir=path.resolve(execFileSync('git',['rev-parse','--git-dir'],{encoding:'utf8'}).trim()),commonDir=path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim());
if(!branch.startsWith('codex/')||gitDir===commonDir)throw new Error('Use a dedicated codex worktree');
if(!['miniflare','wrangler'].includes(engine)||!Number.isInteger(fixturePadding)||fixturePadding<0||fixturePadding>512*1024)throw new Error('Invalid engine or fixture size');
if(!['scheduled','page','rsc','health','asset'].includes(mode)||!/^[a-z0-9-]{1,48}$/.test(label)||!Number.isInteger(count)||count<1||count>300)throw new Error('Invalid lab arguments');
const directory=new URL(`../tmp/workerd-memory/${label}/`,import.meta.url);
await mkdir(directory,{recursive:true});
if(await access(new URL('result.json',directory)).then(()=>true,()=>false))throw new Error('Evidence already exists');
const secret=randomBytes(32).toString('hex');
const assetBytes=Buffer.alloc(8*1024*1024,55),assetSha=createHash('sha256').update(assetBytes).digest('hex');
if(mode==='asset')await writeFile('dist/client/assets/__memory_lab.bin',assetBytes);
let directHttpFallback=0;
const servers=await Promise.all([0,1].map(async()=>{const server=createServer(async(req,res)=>{
 directHttpFallback++;const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v??'']));
 const response=await outbound(new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}));
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server;}));
const origins=servers.map(s=>`http://127.0.0.1:${s.address().port}`);
const revision='1:aaaaaaaaaaaa';
const counters={outbound:0,rejectedOrigin:0,rejectedSignature:0,unhandled:0,paths:{}};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','x-ai-revision':'1','x-market-data-revision':revision,'x-netshop-data-revision':revision}});
async function outbound(request){
  counters.outbound++;const url=new URL(request.url);
  if(!origins.includes(url.origin)){counters.rejectedOrigin++;return json({error:'isolated_outbound_denied'},403);}
  const body=await request.text(),h=request.headers;
  const digest=createHash('sha256').update(body).digest('hex');
  const canonical=['v1',h.get('x-teruisi-timestamp'),h.get('x-teruisi-request-id'),request.method,url.pathname,url.search.slice(1),digest,h.get('x-teruisi-principal')].join('\n');
  if(h.get('x-teruisi-signature')!==`v1=${createHmac('sha256',secret).update(canonical).digest('hex')}`){counters.rejectedSignature++;return json({error:'fixture_signature_rejected',code:'access_denied'},403);}
  const payload=body?JSON.parse(body):{};
  const key=url.pathname;counters.paths[key]=(counters.paths[key]??0)+1;
  if(key==='/api/ai/scheduler')return json({ok:true,idle:true,queue:payload.queue,padding:'x'.repeat(fixturePadding)});
  if(key==='/api/netshop/consumers/query'&&payload.operation==='market_projection_page')return json({operation:payload.operation,data:{rows:[],total:0,truncated:false}});
  if(key==='/api/market/commands'&&payload.domain==='projection')return json({ok:true,result:{status:'active',activeRevision:revision,activeTotal:0,syncingRevision:'',syncingTotal:0,syncingOffset:0}});
  if(key==='/api/market/commands'&&payload.domain==='images')return json({ok:true,result:{job:null,claims:[]}});
  if(key==='/api/market/queries'&&payload.operation==='annotations'&&payload.view==='dispatch')return json({jobs:[]});
  counters.unhandled++;return json({error:'fixture_unhandled',code:'service_unavailable'},503);
}
const bindings={TERUISI_LOCAL_DIRECT_ACCESS:'true',TERUISI_RUNTIME_ENV:'development',VITE_TERUISI_LOCAL_BUILD:'true',TERUISI_DJANGO_INTERNAL_SECRET:secret};
for(const domain of ['SALES','MARKET','AI','NETSHOP','ACCESS_CONTROL','INVENTORY','WORKFLOW','PRODUCTS','FINANCE','CUSTOMER_SERVICE','ERP','BI']){
  bindings[`TERUISI_DJANGO_${domain}_MODE`]='django';bindings[`TERUISI_DJANGO_${domain}_READER_BASE_URL`]=origins[0];bindings[`TERUISI_DJANGO_${domain}_WRITER_BASE_URL`]=origins[1];
}
process.env.TERUISI_WORKERD_HEAP_MB='3072';
const modulePaths=execFileSync('rg',['--files','dist/server','-g','*.js'],{encoding:'utf8'}).trim().split(/\r?\n/).map(p=>path.resolve(p));
const main=path.resolve('dist/server/index.js');
const modules=[main,...modulePaths.filter(p=>p!==main)].map(p=>({type:'ESModule',path:p}));
let mf;
let inspectorPackagePath=path.resolve('node_modules/wrangler/wrangler-dist/InspectorProxyWorker.js');
if(engine==='miniflare'){
 mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,modules,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings,
  assets:{directory:path.resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},r2Buckets:{SALES_IMPORT_FILES:'full-app-synthetic'},r2Persist:fileURLToPath(new URL('r2',directory)),outboundService:outbound});
}else{
 process.env.WRANGLER_WRITE_LOGS='false';process.env.WRANGLER_SEND_METRICS='false';process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false';
 const configPath=fileURLToPath(new URL('wrangler.json',directory));
 const guardedEntry=path.resolve('dist/server/__memory_lab_entry.js');
 await writeFile(guardedEntry,`import {env} from 'cloudflare:workers';
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(![env.TERUISI_DJANGO_AI_READER_BASE_URL,env.TERUISI_DJANGO_AI_WRITER_BASE_URL].includes(target.origin))throw new Error('memory_lab_external_request_denied');
 const result=await nativeFetch(input,{...init,redirect:'manual'});if(result.status>=300&&result.status<400){await result.body?.cancel();throw new Error('memory_lab_redirect_denied');}return result;};
 const {default:app}=await import('./index.js');
 export default {fetch(...args){return app.fetch(...args)}};`);
 await writeFile(configPath,JSON.stringify({name:'memory-full-app',main:guardedEntry,compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],no_bundle:true,find_additional_modules:true,rules:[{type:'ESModule',globs:['**/*.js']}],vars:bindings,r2_buckets:[{binding:'SALES_IMPORT_FILES',bucket_name:'memory-full-app'}],assets:{directory:path.resolve('dist/client'),binding:'ASSETS'}}));
 let wranglerImport='wrangler';
 if(dependencyVariant==='original'){
  const isolatedPackage=fileURLToPath(new URL('wrangler-original',directory));
  await cp(path.resolve('node_modules/wrangler'),isolatedPackage,{recursive:true,errorOnExist:true,force:false});
  inspectorPackagePath=path.join(isolatedPackage,'wrangler-dist/InspectorProxyWorker.js');
  await writeFile(inspectorPackagePath,originalInspectorForTesting(await readFile(inspectorPackagePath,'utf8')));
  wranglerImport=pathToFileURL(path.join(isolatedPackage,'wrangler-dist/cli.js')).href;
 }
 const {unstable_startWorker}=await import(wranglerImport);
 const worker=await unstable_startWorker({config:configPath,envFiles:[],sendMetrics:false,dev:{remote:false,persist:false,watch:false,liveReload:false,logLevel:'error',server:{hostname:'127.0.0.1',port:0},inspector:{hostname:'127.0.0.1',port:0},outboundService:outbound,enableContainers:false,registry:fileURLToPath(new URL('registry',directory))}});
 mf={get ready(){return worker.url;},dispose:()=>worker.dispose()};
}
let inspector,error;const samples=[],requests=[],snapshots={};const started=Date.now();
async function sample(phase){
 const publicPort=Number((await mf.ready).port);
 const ps=`$all=Get-CimInstance Win32_Process;$ids=@(${process.pid});for($i=0;$i -lt 5;$i++){$ids=@($ids+@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId})|Select-Object -Unique)};$owner=(Get-NetTCPConnection -State Listen -LocalPort ${publicPort}|Select-Object -First 1).OwningProcess;$p=@($all|Where-Object{$_.Name -eq 'workerd.exe' -and $ids -contains [int]$_.ProcessId}|ForEach-Object{$n=Get-Process -Id $_.ProcessId;[pscustomobject]@{pid=$n.Id;role=$(if($n.Id -eq $owner){'public-proxy'}else{'application'});privateBytes=$n.PrivateMemorySize64;workingSetBytes=$n.WorkingSet64}});$hostProcess=Get-Process -Id ${process.pid};[pscustomobject]@{processes=$p;hostPrivateBytes=$hostProcess.PrivateMemorySize64;freeKiB=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;competingTests=@($all|Where-Object{$_.Name -eq 'node.exe' -and $_.CommandLine -match '(--test\\s|test:unit|vinext.*build)'}).Count}|ConvertTo-Json -Depth 4 -Compress`;
 const host=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{windowsHide:true,encoding:'utf8'}));
 const heaps=inspector?await inspector.usage():null;samples.push({phase,seconds:(Date.now()-started)/1000,requests:requests.length,host,heaps});
 if(host.freeKiB<700*1024||host.processes.some(p=>p.privateBytes>900*1024*1024))throw new Error('Isolated memory guard reached');
}
async function runRequest(){
 const address=await mf.ready;let route='/';let options={};
 if(mode==='scheduled'){route='/_teruisi/local/market-annotation-scheduled';options={method:'POST',headers:{'x-teruisi-local-scheduled':'1'}};}
 if(mode==='health'){route='/_teruisi/local/health/live';options={headers:{'x-teruisi-local-health':'1'}};}
 if(mode==='page'||mode==='rsc'){route=`/?module=market&lab=${requests.length}`;options={headers:mode==='rsc'?{rsc:'1',accept:'text/x-component'}:{accept:'text/html'}};}
 if(mode==='rsc')route=`/.rsc?module=market&lab=${requests.length}`;
 if(mode==='asset')route='/assets/__memory_lab.bin';
 const response=await fetch(new URL(route,address),{...options,signal:AbortSignal.timeout(30000)});
 if(mode==='asset'){
  const bytes=Buffer.from(await response.arrayBuffer()),digest=createHash('sha256').update(bytes).digest('hex');
  if(response.status!==200||bytes.length!==assetBytes.length||digest!==assetSha)throw new Error(`Asset integrity failed: status=${response.status} bytes=${bytes.length}`);
  requests.push({status:response.status,bytes:bytes.length,sha256:digest});return;
 }
 const body=await response.text();
 if(response.status!==200)throw new Error(`Unexpected status ${response.status}: ${body.slice(0,2000).replace(/[0-9a-f]{64}/g,'<digest>')}`);
 if(mode==='scheduled'){
   const data=JSON.parse(body);if(!data.ok||Object.values(data.result).some(r=>r.ok!==true))throw new Error('Scheduled fixture did not complete: '+JSON.stringify(data));
 }
 if(mode==='page'&&!response.headers.get('content-type')?.includes('text/html'))throw new Error('HTML route contract failed');
 if(mode==='rsc'&&!response.headers.get('content-type')?.includes('text/x-component'))throw new Error('RSC route contract failed');
 requests.push({status:response.status,bytes:Buffer.byteLength(body)});
}
try{
 await mf.ready;if(engine==='miniflare'){inspector=await connectMemoryInspector(mf);await inspector.callUser('Runtime.enable');}
 await runRequest();await sample('warm');if(inspector){snapshots.warm=await captureUserHeap(inspector,fileURLToPath(new URL('warm.heapsnapshot',directory)));await sample('warm-after-snapshot');}
 for(let i=0;i<count;i++){await runRequest();if((i+1)%10===0)await sample('load');await new Promise(resolve=>setTimeout(resolve,100));}
 await sample('loaded');if(inspector){snapshots.final=await captureUserHeap(inspector,fileURLToPath(new URL('final.heapsnapshot',directory)));await sample('after-snapshot');}
 if(engine==='wrangler'&&mode==='scheduled'){await new Promise(resolve=>setTimeout(resolve,30000));await sample('idle-30s');}
}catch(e){error=e.message;process.exitCode=1;}
finally{
 inspector?.close();await mf.dispose();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 const result={mode,label,count,engine,dependencyVariant,fixturePadding,inspectorAttached:engine==='miniflare',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inspectorProxySha256:createHash('sha256').update(await readFile(inspectorPackagePath)).digest('hex'),buildIndexSha256:createHash('sha256').update(await readFile('dist/server/index.js')).digest('hex'),elapsedSeconds:(Date.now()-started)/1000,requests,samples,snapshots,counters,error,production:false};
 await writeFile(new URL('result.json',directory),JSON.stringify(result,null,2));
 console.log(JSON.stringify({label,requests:requests.length,error,counters,directHttpFallback,points:samples.map(s=>({phase:s.phase,heap:s.heaps?.['core:user:'].usedSize,processes:s.host.processes}))}));
}
