import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const records=[],errors=[],payloads={baseline:[],candidate:[]};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
try {
for(const implementation of ['baseline','candidate']) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const native=window.fetch;window.fetch=async(...a)=>{const r=await native(...a),read=r.json.bind(r);r.json=async()=>{const p=await read();if(window.__filterMarks&&r.ok)window.__filterMarks.responses.push({url:String(a[0]),p});return p;};return r;};});
  await page.goto('http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation='+implementation);
  await page.getByRole('button',{name:'打开商品经营',exact:true}).click();await page.locator('.product-dependent-filters:not(:disabled)').waitFor();
  async function change(label,reset,repeat) {
    await page.evaluate(()=>{window.__filterObserver?.disconnect();const m=window.__filterMarks={start:performance.now(),responses:[]};document.addEventListener('click',()=>{m.start=performance.now();},{once:true,capture:true});window.__filterObserver=new MutationObserver(()=>{if(m.feedback===undefined)m.feedback=performance.now()-m.start;const metadata=m.responses.find(r=>['full','overview'].includes(r.p.projection));if(metadata&&!document.querySelector('.product-kpi-grid[aria-busy=true]')&&!document.querySelector('.product-list-region[aria-busy=true]')&&m.commit===undefined){m.commit=performance.now()-m.start;requestAnimationFrame(()=>requestAnimationFrame(()=>{m.paint=performance.now()-m.start;}));}});window.__filterObserver.observe(document.body,{subtree:true,childList:true,attributes:true});});
    await page.getByRole('button',{name:label,exact:true}).click();const menu=page.getByRole('listbox',{name:label+'多选',exact:true});
    if(reset)await menu.getByRole('button',{name:'清空',exact:true}).click();else await menu.getByRole('option').last().click();
    await page.waitForFunction(()=>window.__filterMarks?.paint!==undefined);
    const m=await page.evaluate(()=>window.__filterMarks),initial=m.responses.find(r=>r.p.items)?.p,overview=m.responses.find(r=>['full','overview'].includes(r.p.projection))?.p;
    assert(initial&&overview);assert.equal(initial.pagination.total,overview.metrics.skuCount);
    const business=stable({scope:initial.filtersApplied,sync:initial.sync,sort:initial.sort,pagination:initial.pagination,items:initial.items,metrics:overview.metrics,filters:overview.filters});payloads[implementation].push(business);
    const hash=createHash('sha256').update(JSON.stringify(business)).digest('hex');
    records.push({implementation,repeat,label,reset,feedbackMs:m.feedback,newCompletePaintMs:m.paint,total:initial.pagination.total,applied:initial.filtersApplied,businessHash:hash,requests:m.responses.map(r=>r.url)});
    await page.getByRole('button',{name:label,exact:true}).click();
  }
  for(let repeat=0;repeat<3;repeat++)for(const [label,reset] of [['销售平台',false],['销售店铺',false],['商品品类',false],['商品品类',true],['销售店铺',true],['销售平台',true]])await change(label,reset,repeat);
  await page.close();
}
assert.deepEqual(payloads.baseline,payloads.candidate);assert.deepEqual(errors,[]);
await writeFile('docs/performance/products/evidence/filter-controls.json',JSON.stringify({baseline:'bab42d8ce836b4ee9acd82e80de085ff71f9f494',fixture:'synthetic120/3600; one synthetic platform/shop and two categories; selected platform+shop complete120, category60, no proof of real multi-platform/store coverage',records,errors,deepEqualPairs:payloads.baseline.length},null,2));
}finally{await browser.close();}
