// Offline verification only: mocked fetch; no server, production API, or external action.
import { mkdir } from 'node:fs/promises';
await mkdir('.runtime/e5', { recursive: true });
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import View from './app/import-run-records-view.tsx';createRoot(document.getElementById('root')).render(<View refreshKey={0} onShowChains={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:'tsconfig.json'});
const script=built.outputFiles[0].text;
const fixture=`<!doctype html><html><meta charset="utf-8"><title>E5 synthetic pagination verification</title><body><p>合成数据验证文件：仅用于本次分页交互核对，不连接业务接口，不代表真实记录。</p><div id="root"></div><script>window.calls=[];window.fetch=(url,init)=>new Promise(resolve=>{window.calls.push({url:String(url),signal:init.signal,resolve});if(!new URL(location.href).searchParams.has('test')){const q=new URL(url,'https://synthetic.invalid').searchParams,source=q.get('source')||'',status=q.get('status')||'',size=Number(q.get('pageSize')||20),total=status&&status!=='completed'?0:source==='sales'?20:source==='finance'?45:65,p=Math.min(Number(q.get('page')||1),Math.max(1,Math.ceil(total/size))),offset=(p-1)*size,items=Array.from({length:Math.max(0,Math.min(size,total-offset))},(_,i)=>({id:'synthetic-'+(offset+i),sourceKey:source||'sales',sourceLabel:'合成验证 · '+(source||'sales'),fileName:'synthetic-example.xlsx',createdAt:'2026-11-03T00:00:00Z',sortAt:'2026-11-03T00:00:00.000000+00:00',status:'completed',rowCount:1,insertedCount:1,warningCount:0})),truncated=offset+items.length<total;setTimeout(()=>resolve(new Response(JSON.stringify({items,sources:[{key:'sales',label:'销售（合成）'},{key:'finance',label:'财务（合成）'}],pagination:{page:p,pageSize:size,total,returned:items.length,truncated,completeness:truncated?'truncated_do_not_infer_absence':'complete'}}),{headers:{'content-type':'application/json'}})),30);}});window.respond=(index,data)=>window.calls[index].resolve(new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}}));</script><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`;
await writeFile('.runtime/e5/fixture.html',fixture);

import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const page=await browser.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
const sources=[{key:'sales',label:'Sales'},{key:'finance',label:'Finance'}];
function data(prefix,number,total,p=1,sourceKey='sales'){const items=Array.from({length:number},(_,i)=>({id:prefix+'-'+i,sourceKey,sourceLabel:prefix,fileName:prefix+'-file',createdAt:'2026-11-03T00:00:00Z',sortAt:'2026-11-03T00:00:00.000000+00:00',status:'completed',rowCount:1,insertedCount:1,warningCount:0}));const truncated=p*20<total;return{items,sources,pagination:{page:p,pageSize:20,total,returned:items.length,truncated,completeness:truncated?'truncated_do_not_infer_absence':'complete'}};}
const wait=async n=>page.waitForFunction(n=>window.calls.length>=n,n);
const respond=async(i,d)=>page.evaluate(({i,d})=>window.respond(i,d),{i,d});
await page.goto(pathToFileURL(path.resolve('.runtime/e5/fixture.html')).href+'?test=1');await wait(1);await respond(0,data('INITIAL',20,45));await page.getByRole('button',{name:'下一页'}).waitFor();await page.waitForFunction(()=>document.body.textContent.includes('匹配总数 45'));
await page.getByRole('button',{name:'下一页'}).click();await wait(2);
// Change filter with old page request still pending; fetch deliberately ignores abort.
await page.getByLabel('运行记录数据类型').selectOption('finance');await wait(3);
assert.equal(await page.evaluate(()=>window.calls[1].signal.aborted),true);
assert.match(await page.evaluate(()=>window.calls[2].url),/page=1.*source=finance/);
await respond(2,data('FILTERED',20,45,1,'finance'));await page.waitForFunction(()=>document.body.textContent.includes('FILTERED'));
await respond(1,data('STALE',20,45,2));await page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await page.locator('tbody').textContent().then(t=>t.includes('STALE')),false);
await page.getByRole('button',{name:'下一页'}).click();await wait(4);assert.match(await page.evaluate(()=>window.calls[3].url),/page=2.*source=finance/);await respond(3,data('FILTER-PAGE2',20,45,2,'finance'));await page.waitForFunction(()=>document.body.textContent.includes('FILTER-PAGE2'));
await page.getByRole('button',{name:'下一页'}).click();await wait(5);await respond(4,data('LAST',5,45,3,'finance'));await page.waitForFunction(()=>document.body.textContent.includes('当前范围第 41–45 条'));assert.equal(await page.getByRole('button',{name:'下一页'}).isDisabled(),true);
await page.getByLabel('运行记录状态').selectOption('failed');await wait(6);await respond(5,data('EMPTY',0,0,1,'finance'));await page.waitForFunction(()=>document.body.textContent.includes('没有符合筛选的批次。'));assert.equal(await page.getByRole('button',{name:'上一页'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'下一页'}).isDisabled(),true);
assert.deepEqual(failures,[]);console.log(JSON.stringify({fileUrl:true,empty:true,lastPage:true,filterThenPage:true,lateFilterRace:true,abortedOldRequest:true,pageErrors:failures}));
}finally{await browser.close()}
