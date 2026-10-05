import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const records=[],requests=[],errors=[];
try {
for (const implementation of ['baseline','candidate'])for(let repeat=0;repeat<3;repeat++) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const native=window.fetch;window.fetch=async(...args)=>{const r=await native(...args),read=r.json.bind(r);r.json=async()=>{const p=await read();if(window.__cold&&r.ok&&String(args[0]).includes('/api/products/summary'))window.__cold.receipts.push(p);return p;};return r;};});
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/products/summary')requests.push({implementation,repeat,url:r.url(),status:r.status(),timing:r.request().timing(),serverTiming:r.headers()['server-timing'],queries:r.headers()['x-lab-queries']});});
  await page.goto('http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation='+implementation+'&view=calculator');
  await page.evaluate(async()=>{const r=await fetch('/api/products-lab/reset');if(!r.ok||!(await r.json()).fixtureCacheReset)throw new Error('private fixture cache reset failed');});
  await page.evaluate(()=>{
    const m=window.__cold={start:performance.now(),receipts:[]};document.addEventListener('click',()=>{m.start=performance.now();},{once:true,capture:true});
    const mark=(key)=>{if(m[key+'Commit']!==undefined)return;m[key+'Commit']=performance.now()-m.start;requestAnimationFrame(()=>requestAnimationFrame(()=>{m[key]=performance.now()-m.start;}));};
    new MutationObserver(()=>{
      if(m.feedback===undefined&&document.querySelector('.product-live-hero'))m.feedback=performance.now()-m.start;
      const initial=m.receipts.find(p=>p.items);
      if(initial&&document.querySelector('.calculator-result')&&!document.querySelector('.product-calculator-grid[aria-busy=true]'))mark('first');
      if(m.firstCommit!==undefined&&m.receipts.some(p=>['full','overview'].includes(p.projection))&&!document.querySelector('.product-refresh:disabled'))mark('all');
    }).observe(document.body,{subtree:true,childList:true,attributes:true});
  });
  await page.getByRole('button',{name:'打开商品经营',exact:true}).click();await page.waitForFunction(()=>window.__cold?.all!==undefined);
  const marks=await page.evaluate(()=>window.__cold);delete marks.receipts;records.push({implementation,repeat,calculationCache:'cold; cleared own synthetic process cache, complete September range',...marks});
  assert.equal(await page.locator('.product-cell').count(),0,'direct calculator never mounts overview table');await page.close();
}
assert.deepEqual(errors,[]);await writeFile('docs/performance/products/evidence/cold-calculator.json',JSON.stringify({records,requests,errors,fixture:'same fixed complete September 120-product/3600-sales synthetic loopback laboratory; no artificial delay'},null,2));
}finally{await browser.close();}
