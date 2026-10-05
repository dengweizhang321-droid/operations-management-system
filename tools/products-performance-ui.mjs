import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { cleanEnvironment } from './preview/launcher.mjs';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'.runtime/products-performance-lab');
if(!existsSync(path.join(root,'.git')) || !lstatSync(path.join(root,'.git')).isFile() || !execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().startsWith('codex/'))throw new Error('Use an independent codex/* worktree');
if(readdirSync(root).some(n=>/^\.env($|\.)|^\.dev\.vars($|\.)/.test(n)))throw new Error('Lab worktree must not contain production environment files');
for(const p of [root,path.join(root,'node_modules'),path.join(root,'.runtime'),out])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error('Lab paths cannot be links');
const token=randomBytes(32).toString('hex');
const probes=[];
try{for(const port of [3148,18148]){const probe=netServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});probes.push(probe);}}finally{await Promise.all(probes.map(p=>new Promise(r=>p.close(r))));}
await mkdir(out,{recursive:true});
const baseline=execFileSync('git',['show','bab42d8c:app/product-module-view.tsx'],{cwd:root,encoding:'utf8',windowsHide:true}).replaceAll('from "./','from "../../app/');
await writeFile(path.join(out,'baseline.tsx'),baseline);
await writeFile(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="/.runtime/products-performance-lab/main.tsx"></script></html>');
await writeFile(path.join(out,'main.tsx'),`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Candidate from'/app/product-module-view';import Baseline from'./baseline';import'/app/globals.css';
const impl=new URLSearchParams(location.search).get('implementation')==='baseline'?'baseline':'candidate';const View=impl==='baseline'?Baseline:Candidate;
const native=window.fetch;window.fetch=(url,init={})=>native(url,{...init,headers:{...init.headers,'X-Lab-Implementation':impl}});
function Lab(){const[open,setOpen]=useState(false),[start,setStart]=useState('2026-09-01'),[tab,setTab]=useState(new URLSearchParams(location.search).get('view')==='calculator'?'calculator':'overview');return <main style={{padding:24}}><p>商品经营速度试点 · {impl==='baseline'?'改造前bab42d8c':'候选'} · 合成120商品/3600销售/120库存/120费率 · 隔离SQLite领域实验（不含正式鉴权与主页代码加载）</p><div className="filter-row"><button onClick={()=>setOpen(v=>!v)}>{open?'离开页面':'打开商品经营'}</button><label>实验开始日期<input aria-label="实验开始日期" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label></div>{open&&<View range="自定义" customStartDate={start} customEndDate="2026-09-30" moduleView={tab} onModuleViewChange={setTab}/>}</main>};createRoot(document.getElementById('root')).render(<Lab/>);`);
const python=spawn(path.join(root,'.runtime/preview/venv/Scripts/python.exe'),['tools/products-performance-ui.py'],{cwd:root,env:{...cleanEnvironment(),PRODUCT_OVERVIEW_LAB_TOKEN:token},windowsHide:true,stdio:['ignore','inherit','inherit']});
let server;
let childFailed=false;
async function closeOwned(){await server?.close();try{await fetch('http://127.0.0.1:18148/__stop',{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1000)});}catch{}python.kill();}
async function stop(){await closeOwned();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
python.once('exit',()=>{childFailed=true;void server?.close();});python.once('error',()=>{childFailed=true;});
let ready=false;
for(let i=0;i<120;i++){if(childFailed)throw new Error('Owned lab backend exited');try{const r=await fetch('http://127.0.0.1:18148/health',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).fixture==='products-performance-lab-v1'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
if(!ready){python.kill();throw new Error('Owned lab readiness failed');}
const apiPlugin={name:'products-performance-lab-api',configureServer(vite){vite.middlewares.use('/api',async(req,res)=>{try{if(childFailed||req.method!=='GET'){res.statusCode=405;res.end();return;}const upstream=await fetch('http://127.0.0.1:18148/api'+req.url,{headers:{authorization:`Bearer ${token}`,'X-Lab-Implementation':req.headers['x-lab-implementation']||'candidate'},signal:AbortSignal.timeout(30000)});res.statusCode=upstream.status;for(const key of ['content-type','cache-control','server-timing','x-lab-queries','x-sales-data-revision','x-sales-source-revision'])res.setHeader(key,upstream.headers.get(key)||'');res.end(Buffer.from(await upstream.arrayBuffer()));}catch(e){res.statusCode=503;res.end(JSON.stringify({error:e.message}));}});}};
try{server=await createServer({configFile:false,root,plugins:[react(),apiPlugin],cacheDir:path.join(out,'vite-cache'),optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{alias:{'@':root}},server:{host:'127.0.0.1',port:3148,strictPort:true},
  define:{'process.env.NODE_ENV':'"development"'},
});
await server.listen();}catch(error){await closeOwned();throw error;}console.log('Paired synthetic UI lab: http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation=candidate');
