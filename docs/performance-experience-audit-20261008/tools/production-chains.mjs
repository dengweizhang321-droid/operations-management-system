import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
const out=`.runtime/audit-private/production-chains-${Date.now()}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(6000);
// No routing: normal HTTP browser caching remains enabled. Only known read UI actions.
const requests=[],results=[],errors=[];let lastEnd=Date.now();
page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push({r,start:Date.now(),path:new URL(r.url()).pathname,query:new URL(r.url()).search,method:r.method()});});
page.on('requestfinished',async r=>{const x=requests.find(x=>x.r===r);if(x){const res=await r.response();x.end=Date.now();lastEnd=x.end;x.ms=x.end-x.start;x.status=res.status();x.bytes=(await r.sizes().catch(()=>({}))).responseBodySize;x.timing=r.timing();try{const j=await res.json();x.scale={lineCount:j.current?.lineCount,total:j.pagination?.total,items:j.items?.length,shops:j.shops?.length,startDate:j.startDate,endDate:j.endDate,readScope:j.readScope,readSnapshot:j.readSnapshot,sourceRevision:j.salesSourceRevision,period:j.periods?.current,productCount:j.summary?.productCount};}catch{}}});
page.on('requestfailed',r=>{const x=requests.find(x=>x.r===r);if(x){x.end=Date.now();lastEnd=x.end;x.ms=x.end-x.start;x.failure=r.failure()?.errorText;}});
page.on('pageerror',e=>errors.push(e.message));
const safe=rs=>rs.map(({r,...x})=>x);
async function settle(mark,limit=30000){const start=Date.now();for(;;){await page.waitForTimeout(100);if((requests.slice(mark).every(x=>x.end)&&Date.now()-lastEnd>450&&Date.now()-start>600)||Date.now()-start>limit)break;}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function step(name,action){const start=Date.now(),mark=requests.length;const row={name,start:new Date(start).toISOString()};try{await action();row.actionResolvedMs=Date.now()-start;await settle(mark);row.observedCompleteMs=Date.now()-start;row.dom=await page.evaluate(()=>({url:location.href,rows:document.querySelectorAll('tbody tr').length,nodes:document.querySelectorAll('*').length,scrollY,scrollHeight:document.documentElement.scrollHeight,busy:[...document.querySelectorAll('[aria-busy=true]')].filter(x=>x.getBoundingClientRect().height>0).length,retained:document.querySelectorAll('[data-retained-read=true]').length,dialogs:document.querySelectorAll('[role=dialog]').length,usedHeap:performance.memory?.usedJSHeapSize}));row.status='observed';await page.screenshot({path:out+'/'+name+'.png'});}catch(e){row.status='probe-incomplete';row.error=e.message;}row.requests=safe(requests.slice(mark));results.push(row);await writeFile(out+'/results.json',JSON.stringify({browser:browser.version(),viewport:{width:1440,height:1000},browserCache:'normal enabled',serverCache:'uncontrolled',timing:'observedCompleteMs is after required known requests and double rAF; not exact paint',results,errors},null,2));console.log(JSON.stringify({name,status:row.status,ms:row.observedCompleteMs,requests:row.requests.map(x=>({path:x.path,ms:x.ms,status:x.status})),error:row.error}));}
try{
await step('bi-repeat-entry',()=>page.goto('http://127.0.0.1:3000/?module=dashboard'));
await step('bi-refresh',()=>page.getByRole('button',{name:'刷新',exact:true}).click());
await step('bi-single-platform',async()=>{const select=page.locator('select').first();const value=await select.locator('option').nth(1).getAttribute('value');await select.selectOption(value||await select.locator('option').nth(1).textContent());});
await step('shop-balanced-entry',()=>page.goto('http://127.0.0.1:3000/?module=shop&view=outlets&overviewView=balanced'));
await step('shop-balanced-page2',async()=>{await page.evaluate(()=>scrollTo(0,500));await page.evaluate(()=>{window.__geom=[];window.__stopGeom=false;function f(){window.__geom.push({ms:performance.now(),scrollY,height:document.documentElement.scrollHeight,loading:!![...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&/读取.*总览/.test(e.textContent||''))});if(!window.__stopGeom)requestAnimationFrame(f);}f();});await page.getByRole('button',{name:'下一页',exact:true}).first().click();});
await page.evaluate(()=>window.__stopGeom=true);await writeFile(out+'/balanced-page-geometry.json',JSON.stringify(await page.evaluate(()=>window.__geom),null,2));
await step('product-entry',()=>page.goto('http://127.0.0.1:3000/?module=product'));
await step('product-page2',()=>page.getByRole('button',{name:'下一页',exact:true}).click());
await step('product-detail',()=>page.getByRole('button',{name:'详情',exact:true}).first().click());
await step('product-return',async()=>{const b=page.getByRole('button',{name:/返回/}).first();await b.click();});
await step('product-sort',async()=>{const s=page.locator('select').first();if(await s.count()){const opts=await s.locator('option').all();await s.selectOption(await opts[1].getAttribute('value'));}else{await page.getByRole('button',{name:/排序/}).first().click();}});
await step('customer-entry',()=>page.goto('http://127.0.0.1:3000/?module=customer_service'));
await step('customer-detail',()=>page.getByRole('button',{name:'查看会话',exact:true}).first().click());
await step('customer-return',()=>page.getByRole('button',{name:'关闭',exact:true}).click());
await step('workflow-entry',()=>page.goto('http://127.0.0.1:3000/?module=workflow'));
await step('workflow-detail',()=>page.getByRole('button',{name:/协作详情|查看详情|详情/}).first().click());
await step('ai-assistant-entry',()=>page.goto('http://127.0.0.1:3000/?module=ai'));
results[results.length-1].visibleControls=await page.getByRole('button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).map(e=>e.getAttribute('aria-label')||e.textContent).slice(0,28));
await step('import-source-select',async()=>{await page.goto('http://127.0.0.1:3000/?module=import');await page.getByRole('button',{name:/SKU快递费率|SKU 快递费率/}).first().click();});
await step('settings-local-draft',async()=>{await page.goto('http://127.0.0.1:3000/?module=settings');await page.locator('input').first().focus();});
}finally{await browser.close();console.log(JSON.stringify({output:out}));}
