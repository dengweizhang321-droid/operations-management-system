import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const records=[],requests=[],errors=[],sortRecords=[];
try {
for(const implementation of ['baseline','candidate']) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({implementation,url:r.url()});});
  await page.goto('http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation='+implementation);
  await page.getByRole('button',{name:'打开商品经营',exact:true}).click();await page.locator('.product-cell').first().waitFor();
  for(const [name,field] of [['按毛利率','grossMarginRate'],['按退货率','refundRate'],['按订单毛利','grossProfitCents'],['按销售净额','netSalesCents']]) {
    const response=page.waitForResponse(r=>r.url().includes('/api/products/summary')&&new URL(r.url()).searchParams.get('sortBy')===field);
    await page.getByRole('button',{name:'排序方式',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();const raw=await response;const data=await raw.json();assert.equal(data.sort.by,field);assert.equal(data.pagination.total,120);await page.waitForFunction(code=>document.querySelector('.product-cell small')?.textContent.includes(code),data.items[0].productCode);sortRecords.push({implementation,field,total:data.pagination.total,firstProductCode:data.items[0].productCode});
  }
  await page.getByRole('button',{name:'详情',exact:true}).first().click();await page.locator('.product-detail-kpi-grid').waitFor();
  const count=requests.length;
  for(let repeat=0;repeat<3;repeat++)for(const name of ['周维度','月维度','日维度','净销量','净销量','平台维度','店铺维度']) {
    await page.evaluate(()=>{window.__control={start:performance.now()};document.addEventListener('click',()=>{window.__control.start=performance.now();},{once:true,capture:true});});
    await page.getByRole('button',{name,exact:true}).click();
    const ms=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-window.__control.start)))));
    records.push({implementation,repeat,control:name,paintMs:ms});
  }
  assert.equal(requests.length,count,'local detail controls must not rerun the complete aggregate');
  await page.close();
}
assert.deepEqual(errors,[]);
await writeFile('docs/performance/products/evidence/detail-controls.json',JSON.stringify({records,requests,errors,sortRecords,fixture:'same 120/3600 paired synthetic laboratory; real existing shared detail components unchanged'},null,2));
}finally{await browser.close();}
