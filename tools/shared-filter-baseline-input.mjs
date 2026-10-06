// Bounded reproduction of the deployed source, without reverting development.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..');
const pin='c00edc8df8a04f16fe5a26c4654a45c0bd15f9e8';
const output=path.join(root,'.runtime/shared-filter-evidence/baseline-input-'+Date.now());
await mkdir(output,{recursive:true});
const changed=new Set(['app/inventory-module-view.tsx','app/inventory-filter-bar.tsx','app/ui/searchable-select.tsx']);
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Home from './app/page';import './app/globals.css';import './app/shell/top-navigation.css';import './app/styles/shared-theme.css';createRoot(document.body).render(<Home/>);`,loader:'tsx',resolveDir:root},
  bundle:true,outfile:path.join(output,'ui.js'),format:'esm',jsx:'automatic',platform:'browser',conditions:['style'],define:{'process.env.NODE_ENV':'"test"'},
  plugins:[{name:'pinned-baseline',setup(builder){builder.onLoad({filter:/\.tsx$/},args=>{const relative=path.relative(root,args.path).replaceAll('\\','/');if(changed.has(relative))return{contents:execFileSync('git',['show',pin+':'+relative],{encoding:'utf8',windowsHide:true}),loader:'tsx',resolveDir:path.dirname(args.path)};});}}]});
const server=createServer(async(req,res)=>{
  if(req.method!=='GET') return res.writeHead(405).end();
  if(req.url.startsWith('/api/')) {const r=await fetch('http://127.0.0.1:3781'+req.url);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
  if(req.url==='/ui.js'||req.url==='/ui.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');return res.end(await readFile(path.join(output,req.url.slice(1))));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html lang="zh-CN"><head><link rel="stylesheet" href="/ui.css"></head><body><script type="module" src="/ui.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const requests=[];
 await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin)return route.abort();if(route.request().url().includes('/api/inventory/')){requests.push(route.request().url());const response=await route.fetch();await new Promise(r=>setTimeout(r,1200));return route.fulfill({response});}return route.continue();});
 await page.goto(origin+'/?module=inventory');await page.waitForTimeout(4500);
 const field=page.getByRole('textbox',{name:'库存公共货品搜索'});
 await field.click();const before=await field.boundingBox();
 await page.evaluate(()=>window.__field=document.querySelector('[aria-label="库存公共货品搜索"]'));
 await page.screenshot({path:path.join(output,'before.png')});
 const start=requests.length;
 await page.keyboard.type('DEMO-001',{delay:130});
 await page.waitForTimeout(800);
 const during=await page.evaluate(()=>({originalConnected:window.__field.isConnected,focused:document.activeElement?.getAttribute('aria-label'),value:document.querySelector('[aria-label="库存公共货品搜索"]')?.value,caret:document.querySelector('[aria-label="库存公共货品搜索"]')?.selectionStart}));
 await page.screenshot({path:path.join(output,'during.png')});
 await writeFile(path.join(output,'result.json'),JSON.stringify({pin,before,during,after:await field.boundingBox(),requests:requests.slice(start),syntheticOnly:true},null,2));
 console.log(JSON.stringify({output,during,requests:requests.slice(start)},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
