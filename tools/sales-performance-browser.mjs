import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { utils, write } from 'xlsx';

const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'docs/performance/sales/browser');
console.log('Browser evidence directory',out);
await mkdir(out,{recursive:true});
const session=JSON.parse(await readFile(path.join(root,'.runtime/sales-performance-lab/session.json'),'utf8'));
const control=JSON.parse(await readFile(path.join(root,'.runtime/sales-performance-lab/control.json'),'utf8'));
const base=`http://127.0.0.1:${session.port}`, lab=base+'/.runtime/sales-performance-lab/index.html';
if(session.fixture!=='synthetic-only'||control.fixture!=='synthetic-only'||!/^http:\/\/127\.0\.0\.1:18\d{3}$/.test(control.backend))throw Error('Owned lab required');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const records=[],checks=[],responses=[],errors=[];
let captures=[];
async function context(impl){
 const c=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await c.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const p=await c.newPage();
 const pending=new Set(),network=[];
 p.on('request',r=>{pending.add(r.url());});p.on('requestfinished',r=>pending.delete(r.url()));
 p.on('requestfailed',r=>{pending.delete(r.url());network.push({url:r.url(),failure:r.failure()});});
 p.on('response',r=>{if(r.status()>=400)network.push({url:r.url(),status:r.status()});});
 p.on('pageerror',e=>errors.push({impl,error:e.message}));
 p.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))captures.push((async()=>responses.push({impl,url:r.url(),status:r.status(),timing:r.request().timing(),serverTiming:r.headers()['server-timing'],cache:r.headers()['x-sales-overview-cache'],queries:r.headers()['x-lab-queries']}))());});
 try{await p.goto(lab+'?implementation='+impl,{waitUntil:'domcontentloaded'});}catch(error){
  await writeFile(path.join(out,`failure-network-${impl}.json`),JSON.stringify({pending:[...pending],network,body:await p.locator('body').innerText().catch(()=>''),errors},null,2));throw error;
 }
 await p.evaluate(()=>{
  const native=window.fetch;
  window.fetch=async(...args)=>{
   const response=await native(...args),url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);
   for(const method of ['json','text']){
    const consume=response[method].bind(response);
    response[method]=async(...parameters)=>{
     const value=await consume(...parameters),mark=window.__salesMeasure;
     if(mark&&mark.actionStarted&&response.ok&&mark.matches(url)){
      const phase=url.pathname==='/api/sales/summary'?(url.searchParams.get('view')==='core'?'core':'full'):'region';
      mark.bodies[phase]=performance.now();mark.responseCount++;
     }
     return value;
    };
   }
   return response;
  };
 });
 return {c,p};
}
async function reset(){const r=await fetch(control.backend+'/__reset',{method:'POST',headers:{authorization:'Bearer '+control.token}});assert.equal(r.status,200);}
async function measure(p,impl,name,action,selector,{api=true}={}){
 const region=name.startsWith('overview')||name.startsWith('channel')?'summary':name.startsWith('category-detail')?'detail':name.startsWith('category')?'category':name.startsWith('finance')?'finance':name.startsWith('annual')||name.startsWith('targets-enter')?'annual':'items';
 await p.evaluate(({selector,api,region})=>{
  const fingerprint=()=>JSON.stringify({tabs:[...document.querySelectorAll('.sales-subnav [aria-selected=true]')].map(e=>e.textContent),busy:[...document.querySelectorAll('[aria-busy]')].map(e=>[e.className,e.getAttribute('aria-busy')]),status:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent),dates:[...document.querySelectorAll('input[type=date]')].map(e=>e.value),content:document.querySelector(selector)?.textContent});
  const before=fingerprint();
  window.__salesMeasure={start:0,actionStarted:false,selector,api,region,bodies:{},responseCount:0,retained:!!document.querySelector(selector),feedbackMs:null,firstNewContentMs:null,completeMs:null};
  const m=window.__salesMeasure;
  m.matches=url=>region==='summary'?url.pathname==='/api/sales/summary':region==='detail'?url.pathname==='/api/sales/category-analysis/detail':region==='category'?url.pathname==='/api/sales/category-analysis':region==='finance'?url.pathname==='/api/finance/analysis':url.pathname==='/api/finance/targets'&&url.searchParams.get('view')===region;
  window.__salesActionController?.abort();const events=new AbortController();window.__salesActionController=events;
  const begin=()=>{if(!m.actionStarted){m.actionStarted=true;m.start=performance.now();}};
  for(const event of ['click','input','change'])document.addEventListener(event,begin,{capture:true,signal:events.signal});
  const sample=()=>{
   if(window.__salesMeasure!==m||!m.actionStarted)return;
   const changed=fingerprint()!==before,seen=document.querySelector(m.selector);
   if(changed&&m.feedbackMs===null)m.feedbackMs=performance.now()-m.start;
   const body=m.bodies.core||m.bodies.region||m.bodies.full;
   const committed=window.__salesCommit>=(body||m.start);
   if(seen&&committed&&(m.api?!!body:changed)&&m.firstNewContentMs===null)m.firstNewContentMs=performance.now()-m.start;
   const completeBody=m.region==='summary'?m.bodies.full:m.bodies.region;
   const owner=seen?.closest('.sales-category-view,.sales-metrics-grid,.finance-analysis-page,.finance-shop-panel,.finance-target-list-panel');
   const busy=owner?.getAttribute('aria-busy')==='true'||owner?.querySelector('[aria-busy=true]');
   if(seen&&m.firstNewContentMs!==null&&!busy&&(!m.api||(completeBody&&window.__salesCommit>=completeBody)))m.completeMs=performance.now()-m.start;
  };
  window.__salesObserver?.disconnect();window.__salesObserver=new MutationObserver(sample);window.__salesObserver.observe(document.body,{subtree:true,childList:true,attributes:true});
  const frame=()=>{if(window.__salesMeasure===m&&m.completeMs===null){sample();requestAnimationFrame(frame);}};requestAnimationFrame(frame);
 },{selector,api,region});
 await action();
 await p.waitForFunction(()=>window.__salesMeasure?.completeMs!==null,{timeout:30000});
 const mark=await p.evaluate(()=>{const m=window.__salesMeasure;return {feedbackMs:m.feedbackMs,firstNewContentMs:m.firstNewContentMs,completeMs:m.completeMs,retained:m.retained,responseCount:m.responseCount};});
 records.push({impl,scenario:name,feedbackMs:mark.feedbackMs,firstNewContentMs:mark.firstNewContentMs,completeMs:mark.completeMs,retainedAtStart:mark.retained,requests:mark.responseCount});
}
const open=p=>p.getByRole('button',{name:'打开销售',exact:true}).click();
const tab=(p,name)=>p.getByRole('tab',{name,exact:true}).click();
try{
 if(process.argv.includes('--direct-only')){
  for(const impl of ['baseline','candidate'])for(const [view,selector,name] of [['channel','.channel-kpi-grid','channel'],['category','.category-detail-table tbody tr','category'],['finance','.finance-kpi-grid','finance'],['targets','.finance-target-table tbody tr','targets-items']]){
   const {c,p}=await context(impl);
   try{await p.goto(lab+`?implementation=${impl}&view=${view}`,{waitUntil:'domcontentloaded'});
    // Reinstall the read instrumentation after navigation via the normal context setup.
    const originalContextURL=lab+'?implementation='+impl;
    await p.evaluate(url=>history.replaceState(null,'',url),originalContextURL);
    // Current tab is set on mount, while measured responses remain real.
    await reset();await measure(p,impl,`${name}-direct-first`,()=>open(p),selector,{api:false});
    await p.locator(selector).first().waitFor();await p.getByRole('button',{name:'离开销售',exact:true}).click();
    await measure(p,impl,`${name}-direct-reenter`,()=>open(p),selector,{api:false});
   }finally{await c.close();}
  }
 }else{
 if(!process.argv.includes('--checks-only'))for(const impl of ['baseline','candidate']){
  const {c,p}=await context(impl);
  try{
   for(let repeat=0;repeat<3;repeat++){
    await p.evaluate(()=>{const url=new URL(location.href);for(const key of ['salesCategoryLevel','salesGranularity','salesSort','salesDirection','salesPage','salesPageSize'])url.searchParams.delete(key);history.replaceState(null,'',url);});
    await reset();
    await measure(p,impl,`overview-first-${repeat}`,()=>open(p),'.sales-metrics-grid');
    await p.locator('.product-situation-grid').waitFor();
    await p.getByRole('button',{name:'离开销售',exact:true}).click();
    await measure(p,impl,`overview-reenter-${repeat}`,()=>open(p),'.sales-metrics-grid');
    await measure(p,impl,`overview-date-${repeat}`,()=>p.getByLabel('实验开始日期').fill('2026-09-10'),'.sales-metrics-grid');
    await measure(p,impl,`overview-restore-${repeat}`,()=>p.getByLabel('实验开始日期').fill('2026-09-01'),'.sales-metrics-grid');
    if(impl==='candidate')await measure(p,impl,`overview-refresh-${repeat}`,()=>p.getByRole('button',{name:'刷新销售数据',exact:true}).click(),'.sales-metrics-grid');
    await measure(p,impl,`channel-enter-${repeat}`,()=>tab(p,'渠道分析'),'.channel-kpi-grid',{api:false});
    await measure(p,impl,`channel-platform-${repeat}`,()=>p.getByRole('button',{name:'平台汇总',exact:true}).click(),'.channel-data-table',{api:false});
    await measure(p,impl,`category-enter-${repeat}`,()=>tab(p,'品类分析'),'.category-detail-table tbody tr');
    await measure(p,impl,`category-page-${repeat}`,()=>p.locator('.category-pagination').getByRole('button',{name:'下一页'}).click(),'.category-detail-table tbody tr');
    await measure(p,impl,`category-sort-${repeat}`,()=>p.locator('.category-detail-table thead').getByRole('button',{name:/毛利额/}).click(),'.category-detail-table tbody tr');
    await measure(p,impl,`category-week-${repeat}`,()=>p.getByRole('button',{name:'按周',exact:true}).click(),'.category-detail-table tbody tr');
    await measure(p,impl,`category-month-${repeat}`,()=>p.getByRole('button',{name:'按月',exact:true}).click(),'.category-detail-table tbody tr');
    await measure(p,impl,`category-day-${repeat}`,()=>p.getByRole('button',{name:'按日',exact:true}).click(),'.category-detail-table tbody tr');
    await measure(p,impl,`category-detail-${repeat}`,()=>p.getByRole('button',{name:'查看详情',exact:true}).first().click(),'.category-outlet-table tbody tr');
    await p.getByRole('button',{name:'关闭品类详情',exact:true}).click();
    await measure(p,impl,`finance-enter-${repeat}`,()=>tab(p,'财报分析'),'.finance-kpi-grid');
    await measure(p,impl,`finance-expense-search-${repeat}`,()=>p.getByLabel('搜索费用名称').fill('推广'),'.finance-expense-table',{api:false});
    await p.getByLabel('搜索费用名称').fill('');
    await measure(p,impl,`finance-expense-sort-${repeat}`,()=>p.locator('.finance-expense-table').getByRole('button',{name:/费用率/}).click(),'.finance-expense-table',{api:false});
    if(impl==='candidate')await measure(p,impl,`finance-refresh-${repeat}`,()=>p.getByRole('button',{name:'刷新财报',exact:true}).click(),'.finance-kpi-grid');
    await measure(p,impl,`targets-enter-${repeat}`,()=>tab(p,'目标进度情况'),'.annual-target-progress-table tbody tr');
    await p.locator('.finance-target-table tbody tr').first().waitFor();
    await measure(p,impl,`annual-page-${repeat}`,()=>p.locator('.finance-shop-panel').getByRole('button',{name:'下一页',exact:true}).click(),'.annual-target-progress-table tbody tr');
    await measure(p,impl,`targets-page-${repeat}`,()=>p.locator('.finance-target-list-panel').getByRole('button',{name:'下一页',exact:true}).click(),'.finance-target-table tbody tr');
    if(impl==='candidate')await measure(p,impl,`targets-refresh-${repeat}`,()=>p.getByRole('button',{name:'刷新目标列表',exact:true}).click(),'.finance-target-table tbody tr');
    if(repeat===0)await p.screenshot({path:path.join(out,`${impl}-targets.png`),fullPage:true});
    await tab(p,'销售总览');await p.locator('.sales-metrics-grid').waitFor();
    await p.getByRole('button',{name:'离开销售',exact:true}).click();
   }
   const resources=await p.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('sales-')||r.name.includes('/api/')).map(r=>({name:r.name,duration:r.duration,responseStart:r.responseStart,responseEnd:r.responseEnd,transferMs:r.responseEnd-r.responseStart,bytes:r.transferSize})));
   await writeFile(path.join(out,`${impl}-resources.json`),JSON.stringify(resources,null,2));
  }finally{await c.close();}
 }
 const {c,p}=await context('candidate');
 try{
  await open(p);await p.locator('.product-situation-grid').waitFor();
  await p.getByRole('button',{name:'周维度',exact:true}).click();await p.getByRole('button',{name:'月维度',exact:true}).click();await p.getByRole('button',{name:'日维度',exact:true}).click();
  await p.getByRole('button',{name:'平台维度',exact:true}).click();await p.getByRole('button',{name:'店铺维度',exact:true}).click();checks.push('overview-trend-and-distribution-all-local-dimensions');
  await p.screenshot({path:path.join(out,'candidate-overview.png'),fullPage:true});
  // Whole-round one-retry budget: core fails once, then full fails without a second retry.
  let coreCalls=0,fullCalls=0;
  await p.route('**/api/sales/summary?**',async route=>{
   const core=new URL(route.request().url()).searchParams.get('view')==='core';
   if(core&&++coreCalls>1){await route.continue();return;}if(!core)fullCalls++;
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成服务失败'})});
  });
  await p.getByRole('button',{name:'刷新销售数据'}).click();
  await p.getByText('服务暂时不可用，1 秒后自动重试（1/1）',{exact:true}).waitFor();
  await p.getByRole('alert').filter({hasText:'合成服务失败'}).waitFor();
  assert.equal(coreCalls,2);assert.equal(fullCalls,1);assert.ok(await p.locator('.sales-metrics-grid').count());checks.push('whole-round-one-retry-and-successful-region-retained');
  await p.unroute('**/api/sales/summary?**');
  await p.getByRole('button',{name:'重试',exact:true}).click();await p.getByText('全部区域已更新',{exact:true}).waitFor();
  // Native fetch is deliberately made non-cooperative to exercise the late-response fence.
  await p.evaluate(()=>{const original=window.fetch;window.fetch=(url,init={})=>original(url,{...init,signal:undefined});});
  let release,started,delivered;
  const held=new Promise(r=>release=r),began=new Promise(r=>started=r),finished=new Promise(r=>delivered=r);let oldResponse;
  await p.route('**/api/sales/summary?**',async route=>{
   const params=new URL(route.request().url()).searchParams;
   if(params.get('startDate')==='2026-09-10'&&params.get('view')==='core'){started();oldResponse=await route.fetch();await held;await route.fulfill({response:oldResponse});delivered();}
   else await route.continue();
  });
  await p.getByLabel('实验开始日期').fill('2026-09-10');
  await began;
  await p.getByLabel('实验开始日期').fill('2026-09-20');
  await p.getByText('全部区域已更新',{exact:true}).waitFor();release();await finished;await p.waitForTimeout(100);
  assert.match(await p.locator('.sales-period-note').first().innerText(),/2026-09-20/);checks.push('non-cooperative-late-summary-does-not-overwrite-new-scope');
  await p.unroute('**/api/sales/summary?**');await p.getByLabel('实验开始日期').fill('2026-09-01');await p.getByText('全部区域已更新',{exact:true}).waitFor();
  // In-flight old full read returning a revision conflict must restart both regions.
  let conflict=0;
  await p.route('**/api/sales/summary?**',async route=>{const q=new URL(route.request().url()).searchParams;if(q.get('expectedRevision')&&conflict++===0)await route.fulfill({status:409,contentType:'application/json',body:'{"error":"合成版本变化"}'});else await route.continue();});
  await p.getByRole('button',{name:'刷新销售数据'}).click();await p.getByText('全部区域已更新',{exact:true}).waitFor();assert.equal(conflict,2);checks.push('core-full-version-conflict-complete-reread');await p.unroute('**/api/sales/summary?**');
  let resume;const slow=new Promise(r=>resume=r);
  await p.route('**/api/sales/summary?**',async r=>{await slow;try{await r.continue();}catch{}});
  await p.getByRole('button',{name:'刷新销售数据'}).click();await p.getByText('正在读取核心指标',{exact:true}).waitFor();assert.ok(await p.locator('.sales-metrics-grid').count());
  await tab(p,'财报分析');await p.locator('.finance-kpi-grid').waitFor();resume();await p.unroute('**/api/sales/summary?**');checks.push('slow-sales-read-feedback-retention-and-leaving-page-cancels-ui');
  await tab(p,'品类分析');await p.locator('.category-detail-table tbody tr').first().waitFor();
  const platformFiltered=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/category-analysis'&&new URL(r.url()).searchParams.get('platform')==='京东');
  await p.getByRole('button',{name:'销售分析平台',exact:true}).click();await p.getByRole('option',{name:'京东',exact:true}).click();await p.getByRole('button',{name:'销售分析平台',exact:true}).click();
  await platformFiltered;await p.locator('.category-detail-table tbody tr').first().waitFor();
  await p.getByRole('button',{name:'销售分析平台',exact:true}).click();await p.getByRole('option',{name:'全部平台',exact:true}).click();await p.getByRole('button',{name:'销售分析平台',exact:true}).click();await p.locator('.category-detail-table tbody tr').first().waitFor();checks.push('category-direct-entry-authorized-platform-options-and-filter');
  await p.route('**/api/sales/category-analysis?**',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"合成品类失败"}'}));
  await p.getByRole('button',{name:'刷新品类'}).click();await p.getByText('合成品类失败',{exact:true}).waitFor();assert.ok(await p.locator('.category-detail-table tbody tr').count());
  await p.getByLabel('实验开始日期').fill('2026-09-10');await p.getByRole('alert').filter({hasText:'合成品类失败'}).first().waitFor();assert.equal(await p.locator('.category-detail-table').count(),0);checks.push('category-refresh-retained-new-scope-failure-clears-old-business');
  await p.unroute('**/api/sales/category-analysis?**');await p.getByLabel('实验开始日期').fill('2026-09-01');await p.locator('.category-detail-table tbody tr').first().waitFor();
  await p.getByRole('button',{name:'查看详情',exact:true}).first().click();await p.locator('.category-outlet-table tbody tr').first().waitFor();
  await p.route('**/api/sales/category-analysis/detail?**',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"合成详情失败"}'}));
  await p.getByRole('button',{name:'刷新详情'}).click();await p.getByRole('alert').filter({hasText:'合成详情失败'}).waitFor();assert.ok(await p.locator('.category-outlet-table tbody tr').count());checks.push('detail-failure-retains-valid-same-scope');
  await p.getByRole('button',{name:'关闭品类详情'}).click();await p.unroute('**/api/sales/category-analysis/detail?**');await p.screenshot({path:path.join(out,'candidate-category.png'),fullPage:true});
  await tab(p,'财报分析');await p.locator('.finance-kpi-grid').waitFor();
  await p.route('**/api/finance/analysis?**',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"合成财报失败"}'}));
  await p.getByRole('button',{name:'刷新财报'}).click();await p.getByRole('alert').filter({hasText:'合成财报失败'}).waitFor();assert.ok(await p.locator('.finance-kpi-grid').count());checks.push('finance-refresh-failure-retains-same-signature');await p.unroute('**/api/finance/analysis?**');
  await p.screenshot({path:path.join(out,'candidate-finance.png'),fullPage:true});
  await tab(p,'目标进度情况');await p.locator('.annual-target-progress-table tbody tr').first().waitFor();await p.locator('.finance-target-table tbody tr').first().waitFor();
  await p.route('**/api/finance/targets?**',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"合成目标失败"}'}));
  await p.getByRole('button',{name:'刷新年度进度'}).click();await p.getByRole('alert').filter({hasText:'合成目标失败'}).waitFor();assert.ok(await p.locator('.annual-target-progress-table tbody tr').count());
  await p.getByRole('button',{name:'刷新目标列表'}).click();await p.getByRole('alert').filter({hasText:'合成目标失败'}).first().waitFor();assert.ok(await p.locator('.finance-target-table tbody tr').count());checks.push('annual-and-target-list-independent-failure-retention');await p.unroute('**/api/finance/targets?**');
  await p.clock.install();let unblock;const stuck=new Promise(r=>unblock=r);
  await p.route('**/api/finance/targets?**',async r=>{await stuck;try{await r.continue();}catch{}});
  await p.getByRole('button',{name:'刷新目标列表'}).click();await p.clock.fastForward(30001);
  await p.getByRole('alert').filter({hasText:'目标列表读取超时'}).waitFor();assert.ok(await p.locator('.finance-target-table tbody tr').count());checks.push('target-read-deadline-keeps-valid-same-page');unblock();await p.unroute('**/api/finance/targets?**');await p.clock.resume();
  // File paths and changes below belong only to this synthetic DB.
  const form=p.locator('.finance-target-form-grid');await form.getByRole('button',{name:'经营目标平台与店铺',exact:true}).click();await p.getByRole('option',{name:'京东 · 同名店',exact:true}).click();
  await form.locator('label').filter({hasText:'全年销售目标（元）'}).locator('input').fill('12345');
  await p.getByRole('button',{name:'保存目标',exact:true}).click();await p.getByText('全年目标已保存，年累计进度已同步更新。',{exact:true}).waitFor();checks.push('synthetic-target-create');
  let row=p.locator('.finance-target-table tbody tr').filter({hasText:'同名店'}).first();await row.getByRole('button',{name:'编辑',exact:true}).click();
  await form.locator('label').filter({hasText:'全年销售目标（元）'}).locator('input').fill('23456');await p.getByRole('button',{name:'保存修改',exact:true}).click();await p.getByText('全年目标已保存，年累计进度已同步更新。',{exact:true}).waitFor();checks.push('synthetic-target-update');
  p.on('dialog',dialog=>void dialog.accept(dialog.type()==='prompt'?'合成回归删除':undefined));
  row=p.locator('.finance-target-table tbody tr').filter({hasText:'同名店'}).first();await row.getByRole('button',{name:'删除',exact:true}).click();await p.getByText('目标已删除。',{exact:true}).waitFor();checks.push('synthetic-target-delete');
  const template=await p.request.get(base+'/api/finance/targets/import');assert.equal(template.status(),200);assert.ok((await template.body()).byteLength>0);checks.push('actual-template-download');
  const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['店铺','负责人','销售目标','利润目标','大毛利率目标','推广费目标'],['京东-同名店','合成回归',1.5,.2,'40%','8%']]),'年度目标');
  await p.locator('input[type=file]').setInputFiles({name:'synthetic-annual.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:write(workbook,{type:'buffer',bookType:'xlsx'})});
  await p.getByText(/2026 年目标已导入/).waitFor();checks.push('actual-xlsx-parse-and-private-postgres-import');
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'导出年度目标',exact:true}).click();const file=await download;await file.saveAs(path.join(root,'.runtime/synthetic-export.xlsx'));checks.push('actual-paged-target-export');
 }finally{await c.close();}
 // The real Home/navigation is rendered in both implementations without editing its source.
 for(const impl of ['baseline','candidate']){
  const {c,p}=await context(impl);
  try{await p.goto(lab+`?mode=home&implementation=${impl}&module=sales&view=overview&period=custom&from=2026-09-01&to=2026-09-30`,{waitUntil:'domcontentloaded'});
    await p.locator('.sales-metrics-grid').waitFor();await p.locator('.product-situation-grid').waitFor();await p.screenshot({path:path.join(out,`${impl}-home.png`),fullPage:true});checks.push(`${impl}-actual-home-navigation`);
  }finally{await c.close();}
 }
 assert.deepEqual(errors,[]);
 }
}catch(error){errors.push({failure:error.message});throw error;}
finally{
 await Promise.allSettled(captures);await writeFile(path.join(out,process.argv.includes('--direct-only')?'direct-entry.json':'result.json'),JSON.stringify({environment:'private synthetic PostgreSQL17, real signed domain adapters; Vite dev; external requests blocked; serial three repeats; per-repeat reset both application caches; database buffers warm; mocked failures are separate from DB timing',session:{...session},records,checks,responses,errors},null,2));
 await browser.close();
}
