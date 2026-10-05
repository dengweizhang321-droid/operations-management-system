import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:3136';
const label=process.argv[2]||'baseline';
const output=path.resolve('.runtime/product-overview-browser',label);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const requests=[],records=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/products/summary') requests.push({url:r.url(),status:r.status(),timing:r.request().timing()});});
async function measure(name, action){
  await page.evaluate(()=>{ window.__productMarks={start:performance.now()};
    window.__productObserver?.disconnect();
    window.__productObserver=new MutationObserver(()=>{
      const m=window.__productMarks;
      if(!m.feedback && (document.querySelector('.product-live-hero')||document.body.textContent.includes('正在同步商品')))m.feedback=performance.now()-m.start;
      if(!m.first && document.querySelector('.product-live-table tbody .product-cell'))m.first=performance.now()-m.start;
      if(!m.all && document.querySelector('.product-margin-kpi') && document.querySelector('.product-live-table tbody .product-cell') && ![...document.querySelectorAll('[aria-busy=true]')].some(e=>e.closest('.product-filter-panel')||e.classList.contains('product-kpi-grid')))m.all=performance.now()-m.start;
    });window.__productObserver.observe(document.body,{childList:true,subtree:true,attributes:true});});
  await action();
  await page.waitForFunction(()=>window.__productMarks?.all,{timeout:30000});
  records.push({scenario:name,...await page.evaluate(()=>window.__productMarks)});
}
try{
  await page.goto(base+'/?module=inventory');
  await page.getByRole('button',{name:/同步库存/}).waitFor();
  await page.getByRole('link',{name:'商品经营',exact:true}).first().waitFor();
  for(let i=0;i<3;i++){
    await measure('open-'+i,()=>page.getByRole('link',{name:'商品经营',exact:true}).first().click());
    if(i===0)await page.screenshot({path:path.join(output,'loaded.png'),fullPage:true});
    await measure('refresh-'+i,()=>page.getByRole('button',{name:/同步数据/}).click());
    await page.getByRole('link',{name:'库存管理',exact:true}).first().click();
    await page.getByRole('heading',{name:/库存/}).first().waitFor();
  }
  const resource=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('product-module')||r.name.includes('/api/products/summary')).map(r=>({name:r.name,startTime:r.startTime,duration:r.duration,transferSize:r.transferSize,responseStart:r.responseStart,responseEnd:r.responseEnd})));
  await writeFile(path.join(output,'result.json'),JSON.stringify({environment:'Vite development preview, six synthetic products / 180 sales; backend scale measured separately',label,records,requests,resource,errors},null,2));
}finally{await browser.close();}
