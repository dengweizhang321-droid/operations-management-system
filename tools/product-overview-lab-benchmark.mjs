import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('.runtime/product-overview-lab/evidence');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const all=[],requests=[],errors=[],frames=[];
try{
for(const implementation of ['baseline','candidate']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const native=window.fetch;
    window.fetch=async(...args)=>{
      const r=await native(...args),json=r.json.bind(r);
      r.json=async()=>{const p=await json();const m=window.__labMarks;if(m&&String(args[0]).includes('/api/products/summary')&&r.ok){m.receipts.push({p,time:performance.now()-m.start});}return p;};
      return r;
    };
    window.__labMeasure=()=>{
      window.__labObserver?.disconnect();
      const m=window.__labMarks={start:performance.now(),timeOrigin:performance.timeOrigin,retainedContentAvailableMs:document.querySelector('.product-cell')?0:null,receipts:[]};
      const startOnInteraction=()=>{if(!m.interactionStarted){m.start=performance.now();m.interactionStarted=true;delete m.feedbackMs;}};
      document.addEventListener('click',startOnInteraction,{capture:true,once:true});
      document.addEventListener('input',startOnInteraction,{capture:true,once:true});
      const update=()=>{
        const elapsed=performance.now()-m.start;
        if(m.feedbackMs===undefined&&(document.querySelector('.product-live-hero')||document.body.textContent.includes('正在同步商品')))m.feedbackMs=elapsed;
        const receipts=m.receipts.filter(r=>r.p.items), last=receipts.at(-1);
        if(last&&m.firstCommitMs===undefined && !document.querySelector('.product-list-region[aria-busy=true]') && !document.querySelector('.product-live-table')?.closest('[aria-busy=true]') && (last.p.items.length ? document.querySelector('.product-live-table tbody .product-cell small')?.textContent.includes(last.p.items[0].productCode) : document.body.textContent.includes('没有符合当前筛选'))){m.firstCommitMs=elapsed;requestAnimationFrame(()=>requestAnimationFrame(()=>{m.updatedFirstContentMs=performance.now()-m.start;}));}
        const metadata=m.receipts.find(r=>r.p.projection==='overview'||r.p.projection==='full');
        if(metadata&&m.firstCommitMs!==undefined&&m.allCommitMs===undefined&&document.querySelector('.product-margin-kpi')&&!document.querySelector('.product-kpi-grid[aria-busy=true]')){m.allCommitMs=elapsed;requestAnimationFrame(()=>requestAnimationFrame(()=>{m.allNecessaryContentMs=performance.now()-m.start;}));}
      };
      window.__labObserver=new MutationObserver(update);window.__labObserver.observe(document.body,{childList:true,subtree:true,attributes:true});
      document.addEventListener('input',()=>{if(m.feedbackMs===undefined)m.feedbackMs=performance.now()-m.start;},{once:true});
    };
  });
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/products/summary'){requests.push({implementation,url:r.url(),status:r.status(),timing:r.request().timing(),serverTiming:r.headers()['server-timing'],sqlQueries:r.headers()['x-lab-queries'],bytes:(await r.body()).length});}});
  await page.goto('http://127.0.0.1:3138/.runtime/product-overview-lab/index.html?implementation='+implementation);
  await page.getByRole('button',{name:'打开商品经营',exact:true}).waitFor();
  const cdp=await page.context().newCDPSession(page);
  let recording=false;
  cdp.on('Page.screencastFrame',async e=>{await cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId});if(recording){const filename=`${implementation}-frame-${frames.length}.jpg`;frames.push({implementation,file:filename,timestamp:e.metadata.timestamp*1000});await writeFile(path.join(out,filename),Buffer.from(e.data,'base64'));}});
  async function measure(scenario,repeat,action){
    console.log(implementation,scenario,repeat);
    await page.evaluate(()=>window.__labMeasure());await action();
    // page/sort deliberately keep already-ready full statistics; update only
    // the list. Other scenarios wait for the matching statistics receipt.
    try { await page.waitForFunction((listOnly)=>{const m=window.__labMarks;return m?.updatedFirstContentMs!==undefined&&(listOnly||m?.allNecessaryContentMs!==undefined);},['page','sort'].includes(scenario),{timeout:30000}); }
    catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});await writeFile(path.join(out,'failure.json'),JSON.stringify({implementation,scenario,requests,errors,marks:await page.evaluate(()=>window.__labMarks),body:(await page.locator('body').innerText()).slice(0,3000)},null,2));throw e;}
    const m=await page.evaluate(()=>window.__labMarks);
    if(['page','sort'].includes(scenario))m.allNecessaryContentMs=m.updatedFirstContentMs;
    all.push({implementation,scenario,repeat,...m,receipts:m.receipts.map(r=>({projection:r.p.projection,page:r.p.pagination.page,total:r.p.pagination.total,time:r.time}))});
  }
  for(let i=0;i<3;i++){
    recording=i===0;
    if(recording)await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,everyNthFrame:1});
    await measure(i===0?'first-open':'revisit',i,()=>page.getByRole('button',{name:'打开商品经营',exact:true}).click());
    if(recording){await cdp.send('Page.stopScreencast');recording=false;await page.screenshot({path:path.join(out,implementation+'-loaded.png'),fullPage:true});}
    await measure('page',i,()=>page.getByRole('button',{name:'下一页',exact:true}).click());
    await measure('sort',i,async()=>{await page.getByRole('button',{name:'排序方式',exact:true}).click();await page.getByRole('option',{name:'按订单毛利',exact:true}).click();});
    await measure('filter',i,()=>page.getByRole('textbox',{name:'搜索一个或多个货品规格代码、名称、品牌、供应商、规格或品类'}).fill('LAB-001'));
    await measure('date',i,()=>page.getByLabel('实验开始日期').fill('2026-09-10'));
    await measure('refresh',i,()=>page.getByRole('button',{name:/同步数据/}).click());
    await page.getByRole('button',{name:'离开页面',exact:true}).click();
    await page.getByLabel('实验开始日期').fill('2026-09-01');
  }
  await page.close();
}
assert.deepEqual(errors,[]);
await writeFile(path.join(out,'result.json'),JSON.stringify({fixture:'120 products, 3600 sales (refunds), 120 stock (missing costs), 120 rates (zero and .05); fixed September 2026; SQLite; domain direct, shell/code-load measured separately; no delay injection',all,requests,frames,errors},null,2));
console.log({records:all.length,requests:requests.length,frames:frames.length,errors});
}finally{await browser.close();}
