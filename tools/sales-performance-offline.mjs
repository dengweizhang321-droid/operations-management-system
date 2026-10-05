/** Standalone read-only fixed-snapshot preview. Does not start a server. */
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'docs/performance/sales/preview.html');
await mkdir(path.join(root,'.runtime/sales-offline'),{recursive:true});
const fixtures={};for(const name of ['core','full','category','detail','finance','annual','targets','options'])fixtures[name]=JSON.parse(await readFile(path.join(root,`docs/performance/sales/fixtures/${name}.json`),'utf8'));
const entry=path.join(root,'.runtime/sales-offline/entry.tsx');
await writeFile(entry,`import React,{Suspense,useState}from'react';import{createRoot}from'react-dom/client';import Sales from'../../app/sales-module-view';
const fixtures=${JSON.stringify(fixtures)};
window.fetch=async(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,'http://snapshot.invalid');let name=null;
if((init.method||'GET')!=='GET')return Response.json({error:'离线快照仅用于只读查看'},{status:403});
if(url.pathname==='/api/sales/summary'&&url.searchParams.get('startDate')==='2026-09-01'&&!['platform','outlet','category','productQuery'].some(k=>url.searchParams.has(k)))name=url.searchParams.get('view')==='core'?'core':'full';
if(url.pathname==='/api/sales/category-analysis'&&(!url.searchParams.has('page')||url.searchParams.get('page')==='1')&&url.searchParams.get('granularity')==='day'&&url.searchParams.get('sortBy')==='netSalesCents'&&url.searchParams.get('direction')==='desc')name='category';
if(url.pathname==='/api/sales/category-analysis/detail'&&url.searchParams.get('category')==='合成品类00')name='detail';
if(url.pathname==='/api/finance/analysis'&&url.searchParams.getAll('month').join() ==='2026-09')name='finance';
if(url.pathname==='/api/finance/targets'&&url.searchParams.get('year')==='2026'&&url.searchParams.get('page')==='1')name=url.searchParams.get('view')==='annual'?'annual':'targets';
if(!name)return Response.json({error:'这个范围或操作没有离线快照；完整交互已在私有 PostgreSQL 测试会话中单独验证。'},{status:400});
return Response.json(fixtures[name],{headers:{'x-sales-data-revision':'1:1','x-sales-source-revision':'1:1'}});};
function Preview(){const[tab,setTab]=useState('overview');return <main style={{padding:24}}><p>销售性能隔离候选 · 只读合成快照 · 固定2026年9月 · 不连接正式或测试服务 · 翻页、其他筛选及写入不提供离线数据</p><Suspense fallback={<p>正在打开销售页面…</p>}><Sales range="自定义" customStartDate="2026-09-01" customEndDate="2026-09-30" currentUser={{email:'snapshot@example.invalid',displayName:'快照观察者',role:'viewer',scope:null}} moduleView={tab} onModuleViewChange={setTab}/></Suspense></main>};createRoot(document.getElementById('root')).render(<Preview/>);`);
const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},metafile:true});
let css='';for(const file of ['app/globals.css','app/shell/top-navigation.css','app/styles/shared-theme.css']){
 const source=await readFile(path.join(root,file),'utf8');const result=await postcss([tailwind({base:path.join(root,'app')})]).process(source,{from:path.join(root,file)});css+=result.css;
}
const js=bundle.outputFiles[0].text.replaceAll('</script','<\\/script');
await writeFile(out,`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';"><title>销售性能隔离候选</title><style>${css}</style><body><div id="root"></div><script>${js}</script></body></html>`);
await writeFile(path.join(root,'docs/performance/sales/offline-build.json'),JSON.stringify({kind:'standalone-read-only-synthetic-snapshot',javascriptBytes:bundle.outputFiles[0].contents.length,cssBytes:Buffer.byteLength(css),inputs:Object.keys(bundle.metafile.inputs)},null,2));
console.log(out);
