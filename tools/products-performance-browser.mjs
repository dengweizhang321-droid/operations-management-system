import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve('docs/performance/products/evidence/browser');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const records=[],requests=[],frames=[],errors=[];
try {
for (const implementation of ['baseline','candidate']) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push({implementation,error:e.message}));
  await page.addInitScript(()=>{
    const native=window.fetch;
    window.fetch=async(...args)=>{
      const r=await native(...args),read=r.json.bind(r);
      r.json=async()=>{const p=await read();if(window.__marks&&r.ok)window.__marks.receipts.push({url:String(args[0]),p,at:performance.now()-window.__marks.start});return p;};return r;
    };
    window.__measure=(kind)=>{
      window.__observer?.disconnect();
      const m=window.__marks={kind,start:performance.now(),timeOrigin:performance.timeOrigin,receipts:[],retainedContentMs:document.querySelector('.product-cell,.calculator-result,.product-detail-kpi-grid')?0:null};
      const interacted=()=>{if(!m.interacted){m.interacted=true;m.start=performance.now();}};
      document.addEventListener('click',interacted,{capture:true,once:true});
      document.addEventListener('input',interacted,{capture:true,once:true});
      const paint=(key)=>{if(m[key+'Commit']!==undefined)return;m[key+'Commit']=performance.now()-m.start;requestAnimationFrame(()=>requestAnimationFrame(()=>{m[key+'Paint']=performance.now()-m.start;}));};
      window.__observer=new MutationObserver(()=>{
        if(m.feedbackMs===undefined)m.feedbackMs=performance.now()-m.start;
        const item=m.receipts.find(r=>r.p.items);
        const overview=m.receipts.find(r=>['full','overview'].includes(r.p.projection));
        if(['overview','page'].includes(kind)&&item&&!document.querySelector('.product-list-region[aria-busy=true]')&&(item.p.items.length?document.querySelector('.product-cell small')?.textContent.includes(item.p.items[0]?.productCode):document.body.textContent.includes('没有符合当前筛选条件')))paint('first');
        if(kind==='overview'&&overview&&m.firstCommit!==undefined&&!document.querySelector('.product-kpi-grid[aria-busy=true]'))paint('complete');
        if(kind==='page'&&m.firstCommit!==undefined)paint('complete');
        if(kind==='calculator'&&item&&document.querySelector('.calculator-result')&&!document.querySelector('.product-calculator-grid[aria-busy=true]')){paint('first');paint('complete');}
        if(kind==='detail'&&m.receipts.some(r=>r.url.includes('/api/sales/summary'))&&document.querySelector('.product-detail-kpi-grid')&&!document.querySelector('.product-detail-heading')?.closest('[aria-busy=true]')){paint('first');paint('complete');}

      });
      window.__observer.observe(document.body,{childList:true,subtree:true,attributes:true});
    };
  });
  page.on('response',async r=>{if(new URL(r.url()).pathname.startsWith('/api/')) requests.push({implementation,url:r.url(),status:r.status(),timing:r.request().timing(),serverTiming:r.headers()['server-timing'],queries:r.headers()['x-lab-queries'],bytes:(await r.body()).length});});
  await page.goto('http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation='+implementation);
  const cdp=await page.context().newCDPSession(page);let recording=false;
  cdp.on('Page.screencastFrame',async e=>{await cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId});if(recording){const file=`${implementation}-${frames.length}.jpg`;frames.push({implementation,file,timestamp:e.metadata.timestamp*1000});await writeFile(path.join(out,file),Buffer.from(e.data,'base64'));}});
  async function measure(pageName,scenario,repeat,kind,action) {
    console.log(implementation,pageName,scenario,repeat);
    await page.evaluate(kind=>window.__measure(kind),kind);await action();
    if(kind==='local')await page.evaluate(()=>{const m=window.__marks;m.firstCommit=performance.now()-m.start;m.completeCommit=m.firstCommit;requestAnimationFrame(()=>requestAnimationFrame(()=>{m.firstPaint=performance.now()-m.start;m.completePaint=m.firstPaint;}));});
    try{await page.waitForFunction(()=>window.__marks?.completePaint!==undefined,null,{timeout:30000});}
    catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});await writeFile(path.join(out,'failure.json'),JSON.stringify({implementation,pageName,scenario,marks:await page.evaluate(()=>window.__marks),text:await page.locator('body').innerText(),requests},null,2));throw error;}
    const marks=await page.evaluate(()=>window.__marks);
    records.push({implementation,page:pageName,scenario,repeat,...marks,receipts:marks.receipts.map(r=>({url:r.url,projection:r.p.projection,at:r.at}))});
  }
  for(let repeat=0;repeat<3;repeat++) {
    if(repeat===0){recording=true;await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,everyNthFrame:1});}
    await measure('overview',repeat===0?'open':'reenter',repeat,'overview',()=>page.getByRole('button',{name:'打开商品经营',exact:true}).click());
    if(repeat===0){await cdp.send('Page.stopScreencast');recording=false;await page.screenshot({path:path.join(out,implementation+'-overview.png'),fullPage:true});}
    await measure('overview','page',repeat,'page',()=>page.getByRole('button',{name:'下一页',exact:true}).click());
    await measure('overview','sort',repeat,'page',async()=>{await page.getByRole('button',{name:'排序方式',exact:true}).click();await page.getByRole('option',{name:'按订单毛利',exact:true}).click();});
    await measure('overview','search',repeat,'overview',()=>page.getByRole('textbox',{name:/搜索一个或多个/}).fill('LAB-001 LAB-002'));
    await measure('overview','margin',repeat,'overview',()=>page.locator('.product-margin-kpi').filter({hasText:'低于35%'}).click());
    // Reset the margin band and search before drilling or changing tabs.
    await measure('overview','margin-reset',repeat,'overview',()=>page.locator('.product-margin-kpi').filter({hasText:'低于35%'}).click());
    await measure('overview','refresh',repeat,'overview',()=>page.getByRole('button',{name:/同步数据/}).click());
    await measure('calculator','tab-open',repeat,'local',()=>page.getByRole('tab',{name:'毛利测算',exact:true}).click());
    await measure('calculator','input',repeat,'local',()=>page.locator('.calculator-fields input').nth(0).fill('100'));
    await measure('calculator','select',repeat,'local',async()=>{await page.getByRole('button',{name:'选择用于测算的商品',exact:true}).click();await page.getByRole('option').last().click();});
    await measure('calculator','refresh',repeat,'calculator',()=>page.getByRole('button',{name:/同步数据/}).click());
    // The overview region can finish after the calculator is usable.
    await page.getByRole('button',{name:/同步数据/}).waitFor();
    await page.getByRole('tab',{name:'商品经营',exact:true}).click();
    await measure('detail','open',repeat,'detail',()=>page.getByRole('button',{name:'详情',exact:true}).first().click());
    if(repeat===0)await page.screenshot({path:path.join(out,implementation+'-detail.png'),fullPage:true});
    if(implementation==='candidate')await measure('detail','refresh',repeat,'detail',()=>page.getByRole('button',{name:/同步数据/}).click());
    else {
      const before=requests.filter(r=>r.implementation===implementation&&r.url.includes('/api/sales/summary')).length;
      await measure('detail','refresh',repeat,'local',()=>page.getByRole('button',{name:/同步数据/}).click());
      await page.getByRole('button',{name:/同步数据/}).waitFor();
      const after=requests.filter(r=>r.implementation===implementation&&r.url.includes('/api/sales/summary')).length;
      assert.equal(after,before);records.at(-1).detailReloaded=false;
    }
    await measure('detail','date',repeat,'detail',()=>page.getByLabel('实验开始日期').fill('2026-09-10'));
    await page.getByRole('button',{name:/返回商品经营/}).click();
    await measure('detail','reenter',repeat,'detail',()=>page.getByRole('button',{name:'详情',exact:true}).first().click());
    await page.getByRole('button',{name:/返回商品经营/}).click();
    await measure('calculator','reenter',repeat,'local',()=>page.getByRole('tab',{name:'毛利测算',exact:true}).click());
    if(repeat===0)await page.screenshot({path:path.join(out,implementation+'-calculator.png'),fullPage:true});
    await measure('calculator','date',repeat,'calculator',()=>page.getByLabel('实验开始日期').fill('2026-09-05'));
    await page.getByRole('button',{name:'离开页面',exact:true}).click();
    // Direct calculator opening is also measured independently of overview.
    await page.getByLabel('实验开始日期').fill('2026-09-01');
    await measure('calculator','direct-open',repeat,'calculator',()=>page.getByRole('button',{name:'打开商品经营',exact:true}).click());
    await page.getByRole('button',{name:'离开页面',exact:true}).click();
    await page.getByLabel('实验开始日期').fill('2026-09-01');
    // Reset parent tab for the next cold component mount.
    await page.getByRole('button',{name:'打开商品经营',exact:true}).click();
    await page.getByRole('tab',{name:'商品经营',exact:true}).click();await page.getByRole('button',{name:'离开页面',exact:true}).click();
  }
  await page.close();
}
assert.deepEqual(errors,[]);
await writeFile(path.join(out,'result.json'),JSON.stringify({fixture:'120 synthetic products / 3600 sales with refunds / 120 stock with missing costs / 120 zero and nonzero rates; SQLite; Vite laboratory; does not include shell lazy load/auth',baseline:'bab42d8ce836b4ee9acd82e80de085ff71f9f494',records,requests,frames,errors},null,2));
console.log({records:records.length,requests:requests.length,frames:frames.length});
}finally{await browser.close();}
