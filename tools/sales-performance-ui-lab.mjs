import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createServer as netServer } from 'node:net';
import { cleanEnvironment } from './preview/launcher.mjs';

const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'.runtime/sales-performance-lab');
const verifyRequested=process.argv.includes('--verify');
// Vite otherwise treats a noninteractive stdin EOF as process.exit(), bypassing
// owned child cleanup and returning a false-positive exit 0 during verification.
process.env.CI='true';
// Recover only this worktree's previous synthetic session, using its nonce.
if(existsSync(path.join(out,'control.json'))){
  const prior=JSON.parse(await readFile(path.join(out,'control.json'),'utf8'));
  if(prior.fixture==='synthetic-only'&&/^http:\/\/127\.0\.0\.1:18(4[8-9][0-9]|5[0-7][0-9]|580)$/.test(prior.backend)){
    try{const health=await fetch(prior.backend+'/health',{headers:{authorization:'Bearer '+prior.token},signal:AbortSignal.timeout(1000)});
      if(health.ok&&(await health.json()).fixture==='sales-performance-pg-v1')await fetch(prior.backend+'/__stop',{method:'POST',headers:{authorization:'Bearer '+prior.token},signal:AbortSignal.timeout(1000)});
    }catch{}
  }
}
const baseline='bab42d8ce836b4ee9acd82e80de085ff71f9f494';
let port;
for(let candidate=3481;candidate<3581;candidate++){
  const probes=[];
  try{for(const value of [candidate,candidate+15000,candidate+15001]){const probe=netServer();probes.push(probe);await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen({host:'127.0.0.1',port:value,exclusive:true},resolve);});}port=candidate;}
  catch{}finally{await Promise.all(probes.filter(p=>p.listening).map(p=>new Promise(r=>p.close(r))));}
  if(port)break;
}
if(!port)throw new Error('No isolated port pair available');
const backendPort=port+15000,backend=`http://127.0.0.1:${backendPort}`;
const writer=`http://127.0.0.1:${backendPort+1}`;
if(!existsSync(path.join(root,'.git')) || !lstatSync(path.join(root,'.git')).isFile() || !execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().startsWith('codex/'))throw new Error('Use an independent codex worktree');
if(readdirSync(root).some(n=>/^\.env($|\.)|^\.dev\.vars($|\.)/.test(n)))throw new Error('No production environment files in lab');
for(const p of [root,path.join(root,'node_modules'),out])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error('No linked lab directories');
await mkdir(out,{recursive:true});
for(const file of ['sales-module-view','sales-category-view','finance-annual-progress-view','page']){
  let source=execFileSync('git',['show',`${baseline}:app/${file}.tsx`],{cwd:root,encoding:'utf8',windowsHide:true});
  source=source.replaceAll('from "./','from "/app/').replaceAll('import("./','import("/app/')
    .replaceAll('import("/app/sales-category-view")','import("./baseline-sales-category-view")')
    .replaceAll('import("/app/sales-module-view")','import("./baseline-sales-module-view")')
    .replace('from "/app/finance-annual-progress-view"','from "./baseline-finance-annual-progress-view"');
  await writeFile(path.join(out,`baseline-${file}.tsx`),source);
}
await writeFile(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="UTF-8"><title>销售性能隔离预览</title><div id="root"></div><script type="module" src="/.runtime/sales-performance-lab/main.tsx"></script></html>');
await writeFile(path.join(out,'main.tsx'),`import React,{lazy,Suspense,useState,Profiler}from'react';import{createRoot}from'react-dom/client';import'/app/globals.css';import'/app/shell/top-navigation.css';import'/app/styles/shared-theme.css';
const impl=new URLSearchParams(location.search).get('implementation')==='baseline'?'baseline':'candidate';
const View=lazy(()=>impl==='baseline'?import('./baseline-sales-module-view'):import('/app/sales-module-view'));
const Home=lazy(()=>impl==='baseline'?import('./baseline-page'):import('/app/page'));const native=window.fetch;
window.fetch=(url,init={})=>native(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),'X-Lab-Implementation':impl}});
function Lab(){const[open,setOpen]=useState(false),[start,setStart]=useState('2026-09-01'),[end,setEnd]=useState('2026-09-30'),[tab,setTab]=useState(new URLSearchParams(location.search).get('view')||'overview');
const user={email:'fixture@example.invalid',displayName:'合成管理员',role:'admin',scope:null};return <main style={{padding:24}}><p>销售性能隔离预览 · {impl} · 合成150000销售/2000商品/60品类/120目标 · 私有PostgreSQL · 目标写入仅影响本次合成库</p>
<div className="filter-row"><button onClick={()=>setOpen(v=>!v)}>{open?'离开销售':'打开销售'}</button><label>开始日期<input aria-label="实验开始日期" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束日期<input aria-label="实验结束日期" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
<Profiler id="sales-lab" onRender={()=>window.__salesCommit=performance.now()}><Suspense fallback={<section className="panel data-state" role="status">正在打开销售模块…</section>}>{new URLSearchParams(location.search).get('mode')==='home'?<Home/>:open&&<View range="自定义" customStartDate={start} customEndDate={end} currentUser={user} moduleView={tab} onModuleViewChange={setTab}/>}</Suspense></Profiler></main>}
createRoot(document.getElementById('root')).render(<Lab/>);`);

const secret='django-sales-contract-test-secret-at-least-32-bytes';
const principal={email:'fixture@example.invalid',displayName:'Synthetic lab',role:'admin',scope:null};
const token=randomBytes(32).toString('hex');

async function routeModule(entry){
  const result=await build({entryPoints:[path.join(root,entry)],bundle:true,write:false,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'synthetic-authority',setup(builder){
      builder.onResolve({filter:/^@\/lib\/(auth\/authorization|django\/(finance-service|sales-consumer-reader|sales-gateway))$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>{
        const actual=path.join(root,args.path.slice(2)+'.ts').replaceAll('\\','/');
        const contents=args.path.includes('authorization')?`export const requireAppPrincipal=async()=>(${JSON.stringify(principal)});export const requireUnrestrictedDataScope=()=>{};export const authorizationErrorResponse=()=>null;`
          :args.path.endsWith('finance-service')?`export * from ${JSON.stringify(actual)};import{createDjangoFinanceService as real}from${JSON.stringify(actual)};export const createDjangoFinanceService=()=>{const api=real({readerBaseUrl:${JSON.stringify(backend)},writerBaseUrl:${JSON.stringify(writer)},internalSecret:${JSON.stringify(secret)}});return{...api,request:(p,i,o={})=>api.request(p,i,{...o,fetchImpl:globalThis.__salesLabFetch})}};`
          :args.path.endsWith('sales-consumer-reader')?`export * from ${JSON.stringify(actual)};import{createDjangoSalesConsumerReader as real}from${JSON.stringify(actual)};export const createDjangoSalesConsumerReader=()=>{const api=real({djangoBaseUrl:${JSON.stringify(backend)},internalSecret:${JSON.stringify(secret)}});return{read:(p,i,o={})=>api.read(p,i,{...o,fetchImpl:globalThis.__salesLabFetch})}};`
          :`export * from ${JSON.stringify(actual)};import{routeDjangoSalesReadRequest as real}from${JSON.stringify(actual)};export const routeDjangoSalesReadRequest=(o)=>real({...o,config:{djangoBaseUrl:${JSON.stringify(backend)},internalSecret:${JSON.stringify(secret)}},fetchImpl:globalThis.__salesLabFetch});`;
        return {contents,loader:'ts',resolveDir:root};
      });
    }}]});
  const file=path.join(out,path.basename(path.dirname(entry))+'-'+path.basename(path.dirname(path.dirname(entry)))+'.mjs');
  await writeFile(file,result.outputFiles[0].text);return import('file:///'+file.replaceAll('\\','/'));
}
const modules=new Map();
for(const name of ['sales/summary','sales/category-analysis','sales/category-analysis/detail','finance/analysis','finance/targets','finance/targets/import','finance/targets/export']){
  modules.set('/api/'+name,await routeModule('app/api/'+name+'/route.ts'));
}
const python=spawn(path.join(root,'.runtime/sales-venv/Scripts/python.exe'),['tools/sales-performance-postgres.py','serve'],{
  cwd:root,env:{...cleanEnvironment(),SALES_PERFORMANCE_LAB_TOKEN:token,SALES_PERFORMANCE_LAB_PORT:String(backendPort)},windowsHide:true,stdio:['ignore','inherit','inherit']});
let server,failed=false;
python.once('exit',()=>{failed=true;void server?.close();});python.once('error',()=>{failed=true;});
async function close(){process.stdin.destroy();await server?.close();try{await fetch(backend+'/__stop',{method:'POST',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});}catch{}}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
let ready=false;
for(let i=0;i<600;i++){if(failed)throw new Error('Owned synthetic backend exited');try{const r=await fetch(backend+'/health',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).fixture==='sales-performance-pg-v1'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
if(!ready){await close();throw new Error('Owned synthetic readiness failed');}

// Async-local state keeps concurrent routes and implementations separate.
const {AsyncLocalStorage}=await import('node:async_hooks');const requestContext=new AsyncLocalStorage();
globalThis.__salesLabFetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(![backend,writer].includes(url.origin))throw new Error('Lab outbound request blocked');
  const context=requestContext.getStore();
  const headers=new Headers(init.headers);headers.set('X-Lab-Implementation',context?.impl||'candidate');
  const response=await fetch(input,{...init,headers});
  context?.traces.push({path:url.pathname,timing:response.headers.get('server-timing'),queries:response.headers.get('x-lab-queries')});
  return response;
};
const apiPlugin={name:'sales-synthetic-api',configureServer(vite){vite.middlewares.use('/api',async(req,res)=>{
  const parsed=new URL('/api'+req.url,`http://127.0.0.1:${port}`);
  if(parsed.pathname==='/api/auth/me'){res.setHeader('content-type','application/json');res.end(JSON.stringify({user:principal}));return;}
  const route=modules.get(parsed.pathname),handler=route?.[req.method];
  if(!handler){res.statusCode=403;res.end(JSON.stringify({error:'隔离实验未开放此接口'}));return;}
  try{
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)throw new Error('Lab request too large');chunks.push(chunk);}
    const request=new Request(parsed,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const context={impl:req.headers['x-lab-implementation']==='baseline'?'baseline':'candidate',traces:[]};
    const response=await requestContext.run(context,()=>handler(request));
    res.statusCode=response.status;for(const[key,value]of response.headers)res.setHeader(key,value);
    res.setHeader('x-lab-queries',context.traces.reduce((n,t)=>n+Number(t.queries||0),0));
    res.setHeader('server-timing',context.traces.map(t=>t.timing).filter(Boolean).join(','));
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});}};
try{server=await createServer({configFile:false,root,plugins:[react(),apiPlugin],cacheDir:path.join(out,'vite-cache-app-only'),
  css:{postcss:{plugins:[tailwind({base:path.join(root,'app')})]}},
  optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client']},resolve:{alias:{'@':root}},
  server:{host:'127.0.0.1',port,strictPort:true},define:{'process.env.NODE_ENV':'"development"'}});await server.listen();}
catch(error){await close();throw error;}
await writeFile(path.join(out,'session.json'),JSON.stringify({fixture:'synthetic-only',port,backendPort,writerPort:backendPort+1,pid:process.pid,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),baseline}));
await writeFile(path.join(out,'control.json'),JSON.stringify({token,backend,fixture:'synthetic-only'}));
process.stdin.on('data',chunk=>{if(String(chunk).trim()==='stop')void close();});
console.log(`Sales paired PostgreSQL preview: http://127.0.0.1:${port}/.runtime/sales-performance-lab/index.html`);
if(verifyRequested){
  console.log('Running bounded sales browser verification');
  try{
    // Treat dev stylesheet compilation as environment preparation, then measure
    // cold browser module downloads separately through resource timing.
    for(const asset of ['/app/globals.css','/.runtime/sales-performance-lab/main.tsx']){
      const ready=await fetch(`http://127.0.0.1:${port}${asset}`,{signal:AbortSignal.timeout(120000)});
      if(!ready.ok)throw new Error(`Lab asset preparation failed: ${asset}`);await ready.text();
    }
    console.log('Lab base assets ready');await import('./sales-performance-browser.mjs');console.log('Browser verification returned');
  }finally{await close();}
}
