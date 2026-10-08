// Normal read-only navigation. No latency/failure injection; write methods blocked.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {moduleViewCatalog,navItems} from '../../../app/shell/navigation-catalog.ts';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const out=`.runtime/audit-private/production-survey-${stamp}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
const all=[],results=[],errors=[],blocked=[];const page=await ctx.newPage();page.setDefaultTimeout(6500);
const wanted=process.argv[2]?.split(',');
await ctx.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){blocked.push({path:new URL(r.request().url()).pathname,method:r.request().method()});return r.abort();}return r.continue();});
await page.addInitScript(()=>{window.__audit={longtasks:[],shifts:[],start:performance.now()};new PerformanceObserver(l=>window.__audit.longtasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});new PerformanceObserver(l=>window.__audit.shifts.push(...l.getEntries().map(e=>({start:e.startTime,value:e.value,recentInput:e.hadRecentInput})))).observe({type:'layout-shift',buffered:true});});
page.on('pageerror',e=>errors.push({at:Date.now(),message:e.message}));
page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))all.push({r,path:new URL(r.url()).pathname,query:new URL(r.url()).search,start:Date.now(),method:r.method()});});
page.on('requestfinished',async r=>{const x=all.find(x=>x.r===r);if(x){const response=await r.response();x.end=Date.now();x.status=response?.status();x.ms=x.end-x.start;x.timing=r.timing();x.bytes=(await r.sizes().catch(()=>({}))).responseBodySize;x.headers=Object.fromEntries(Object.entries(response?.headers()||{}).filter(([k])=>/revision|server-timing/.test(k)));}});
page.on('requestfailed',r=>{const x=all.find(x=>x.r===r);if(x){x.end=Date.now();x.ms=x.end-x.start;x.failure=r.failure()?.errorText;}});
const safeRequests=rs=>rs.map(({r,...x})=>x);
async function save(){await writeFile(out+'/results.json',JSON.stringify({started:stamp,environment:'production-local-3000',viewport:{width:1440,height:1000},browser:browser.version(),browserHttpCache:'disabled by safety routing',serverCache:'uncontrolled; not cleared',source:'actual deployed Home and modules',timingQualification:'terminalObservationMs is a post-response DOM observation, not first new range paint; per-stage backend timing unknown without Server-Timing',results,errors,blocked,requests:safeRequests(all)},null,2));}
try{
for(const item of navItems){
 if(wanted&&!wanted.includes(item.key))continue;
 for(const [index,view]of moduleViewCatalog[item.key].views.entries()){
  const start=Date.now(),mark=all.length,errorMark=errors.length;const target=`http://127.0.0.1:3000/?module=${item.key}&view=${view}`;
  const result={module:item.key,label:item.label,view,startedAt:new Date(start).toISOString(),interaction:'direct refresh-safe entry',status:'unobserved'};
  try{
   await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});
   await page.getByRole('heading',{name:item.label,exact:true}).first().waitFor({timeout:8000});result.shellVisibleMs=Date.now()-start;
   let stableSince=Date.now();for(;;){await page.waitForTimeout(200);const pending=all.slice(mark).some(r=>!r.end);const busy=await page.locator('[aria-busy="true"]:not([data-retained-read])').count();if(pending||busy)stableSince=Date.now();if(Date.now()-stableSince>800||Date.now()-start>24000)break;}
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   result.terminalObservationMs=Date.now()-start;
   result.dom=await page.evaluate(()=>({url:location.href,visibleBusy:[...document.querySelectorAll('[aria-busy="true"]')].filter(e=>e.getBoundingClientRect().height>0).length,retained:document.querySelectorAll('[data-retained-read=true]').length,rows:document.querySelectorAll('tbody tr').length,nodes:document.querySelectorAll('*').length,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,documentHeight:document.documentElement.scrollHeight,jsHeap:performance.memory?.usedJSHeapSize,alertCount:document.querySelectorAll('[role=alert]').length,loadingTexts:[...document.querySelectorAll('[role=status]')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.textContent).filter(s=>/加载|读取|等待|失败|不可用|更新中/.test(s)).slice(0,8),longtasks:window.__audit?.longtasks,shifts:window.__audit?.shifts}));
   result.tabs=await page.getByRole('tab').allTextContents();result.buttons=await page.getByRole('button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).map(e=>({label:e.getAttribute('aria-label')||e.textContent,disabled:e.disabled})).slice(0,50));
   result.status=result.dom.visibleBusy?'busy-at-limit':'observed';
   await page.screenshot({path:`${out}/${item.key}-${view}.png`,fullPage:false});
   if(index===0){await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(200);result.narrow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));await page.screenshot({path:`${out}/${item.key}-1024.png`});await page.setViewportSize({width:1440,height:1000});}
  }catch(e){result.status='probe-failed';result.error=e.message;}
  result.requests=safeRequests(all.slice(mark));result.pageErrors=errors.slice(errorMark);results.push(result);await save();console.log(JSON.stringify({module:result.module,view,ms:result.terminalObservationMs,status:result.status,requests:result.requests.map(r=>({path:r.path,status:r.status,ms:r.ms,bytes:r.bytes})),busy:result.dom?.visibleBusy,error:result.error}));
 }
}
}finally{await save();await browser.close();console.log(JSON.stringify({output:out,completed:results.length}));}
