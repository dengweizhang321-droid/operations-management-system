import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:3146';
const label=process.argv[2]||'candidate';
const output=path.resolve('docs/performance/products/evidence/shell',label);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const requests=[],records=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/products/summary') requests.push({url:r.url(),status:r.status(),timing:r.request().timing()});});
await page.addInitScript(()=>{
  const native=window.fetch;
  window.fetch=async(...args)=>{const r=await native(...args),read=r.json.bind(r);r.json=async()=>{const p=await read();if(window.__productMarks&&r.ok&&String(args[0]).includes('/api/products/summary'))window.__productMarks.receipts.push(p);return p;};return r;};
});
async function measure(name,action){
  await page.evaluate(()=>{
    window.__productObserver?.disconnect();
    const m=window.__productMarks={start:performance.now(),receipts:[],retainedContentMs:document.querySelector('.product-cell')?0:null};
    document.addEventListener('click',()=>{m.start=performance.now();},{capture:true,once:true});
    const painted=(key)=>{if(m[key+'Commit']!==undefined)return;m[key+'Commit']=performance.now()-m.start;requestAnimationFrame(()=>requestAnimationFrame(()=>{m[key]=performance.now()-m.start;}));};
    window.__productObserver=new MutationObserver(()=>{
      if(m.feedback===undefined&&document.querySelector('.product-live-hero'))m.feedback=performance.now()-m.start;
      if(m.receipts.some(p=>p.items)&&document.querySelector('.product-cell')&&!document.querySelector('.product-list-region[aria-busy=true]'))painted('first');
      if(m.firstCommit!==undefined&&m.receipts.some(p=>p.projection==='overview'||p.projection==='full')&&!document.querySelector('.product-kpi-grid[aria-busy=true]'))painted('all');
    });window.__productObserver.observe(document.body,{childList:true,subtree:true,attributes:true});
  });
  await action();await page.waitForFunction(()=>window.__productMarks?.all!==undefined,null,{timeout:30000});
  const marks=await page.evaluate(()=>window.__productMarks);delete marks.receipts;records.push({scenario:name,...marks});
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
