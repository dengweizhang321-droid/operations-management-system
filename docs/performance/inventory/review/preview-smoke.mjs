import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'../../../..');
const target=new URL(process.argv[2]);assert.equal(target.hostname,'127.0.0.1');assert(target.pathname.endsWith('/inventory-independent-ui/index.html'));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(target.href,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'打开库存',exact:true}).click();
  for(const label of ['库存总览','库龄分析','备货计划','滞销清理','京东入仓监控','广东入仓监控']){
    await page.getByRole('tab',{name:label,exact:true}).click();await page.getByText('UI-ALL-P1-AA',{exact:false}).first().waitFor();checks.push(label);
  }
  await page.getByRole('button',{name:'监控清单',exact:true}).click();await page.getByLabel('筛选监控清单').waitFor();checks.push('广东监控清单');
  const denied=await fetch(new URL('/api/inventory/replenishment',target),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,405);assert.equal((await denied.json()).error,'隔离预览仅支持读取');checks.push('native-middleware-rejects-write');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(root,'.runtime/inventory-independent-ui/preview-smoke-result.json'),JSON.stringify({status:'passed',url:target.href,checks,errors,syntheticApi:true,productionConnection:false},null,2));
  console.log(JSON.stringify({status:'passed',checks,url:target.href}));
}finally{await browser.close();}
