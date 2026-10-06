import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.env.FILTER_PREVIEW_URL||'http://127.0.0.1:3781';
assert.match(origin,/^http:\/\/127\.0\.0\.1:3[1-8]\d\d$/,'Isolated preview only');
const output='.runtime/filter-layout-after-'+Date.now();await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[],requests=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/api/')||url.pathname.startsWith('/api/auth/'))return route.continue();
  assert.equal(route.request().method(),'GET');requests.push(url.href);
  if(url.pathname==='/api/inventory/guangdong-monitor'){
   // The private demo has no Guangdong watchlist. Exercise its real view using
   // explicit synthetic regional payloads, without writing a watchlist or
   // implying this is real-backend Guangdong business verification.
   const section=url.searchParams.get('section');const scope=new URL(url);scope.searchParams.delete('section');
   const payload={version:'layout-fixture',hasInventory:true,watchCount:1,
    readSection:section,readScope:createHash('sha256').update(scope.search).digest('hex'),readSnapshot:'a'.repeat(64),
    sync:{inventoryAsOf:'2026-10-07',inventoryAgeAsOf:'2026-10-07',salesThrough:'2026-10-06',latestInventoryBatchId:'synthetic',inventoryStale:false},
    filters:{brands:['合成甲','合成乙'],categories:[],suppliers:[]},
    metrics:{itemCount:0,availableQuantity:0,inTransitQuantity:0,knownStockValueCents:0,missingCostCount:0,missingStockCount:0},
    distribution:[{risk:'healthy',label:'健康',itemCount:0,quantity:0,knownStockValueCents:0,itemRate:0,quantityRate:0,valueRate:0}],
    pagination:{page:1,pageSize:50,total:0,totalPages:1},items:[],disclosures:['Synthetic layout fixture only']};
   await new Promise(r=>setTimeout(r,1300));return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
  }
  const response=await route.fetch();await new Promise(r=>setTimeout(r,1300));await route.fulfill({response});
 });
 const cases=[
  ['sales',null,'销售分析平台'],['sales','渠道分析','销售分析平台'],['sales','品类分析','销售分析平台'],
  ['sales','财报分析','销售分析平台'],['inventory',null,'健康状态'],
  ['inventory','备货计划','备货计划状态',true],['inventory','库龄分析','库龄风险状态'],
  ['inventory','广东入仓监控','库存公共品牌'],['product',null,'销售平台'],
 ].filter(([module])=>!process.env.FILTER_LAYOUT_MODULES||process.env.FILTER_LAYOUT_MODULES.split(',').includes(module));
 for(const [module,tab,label,single]of cases){
  await page.goto(origin+'/?module='+module);await page.waitForTimeout(4500);
  if(tab){await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(4500);}
  await page.addStyleTag({content:'html{scroll-behavior:auto}'});
  await page.evaluate(()=>window.scrollTo(0,130));await page.getByRole('button',{name:label,exact:true}).click();
  const menu=page.getByRole('listbox',{name:label+(module==='product'?'多选':'选项'),exact:true});await menu.getByRole('option').nth(1).waitFor();
  const target=module+(tab?'-'+tab:'');
  await page.evaluate(label=>{
   window.__layoutTrigger=document.querySelector('[aria-label="'+label+'"][aria-haspopup=listbox]');window.__layoutMenu=document.querySelector('[role=listbox]');window.__layoutFrames=[];window.__layoutRunning=true;
   const start=performance.now();function tick(){const t=window.__layoutTrigger,m=window.__layoutMenu;
    window.__layoutFrames.push({ms:performance.now()-start,scrollY:window.scrollY,height:document.documentElement.scrollHeight,triggerConnected:t.isConnected,triggerY:t.getBoundingClientRect().y,menuConnected:m.isConnected,menuY:m.getBoundingClientRect().y,retained:document.querySelectorAll('[data-retained-read=true]').length});
    if(window.__layoutRunning)requestAnimationFrame(tick)}tick();
  },label);
  const requestStart=requests.length;
  await page.screenshot({path:output+'/'+target+'-before.png'});await menu.getByRole('option').nth(1).click();await page.waitForTimeout(900);
  await page.screenshot({path:output+'/'+target+'-loading.png'});await page.waitForTimeout(3400);
  if(!single){
   assert.equal(await menu.isVisible(),true);const search=menu.getByRole('searchbox');assert.equal(await search.evaluate(el=>el===document.activeElement),true);
   await menu.getByRole('option').nth(1).click();await page.waitForTimeout(4300);
  }
  await page.evaluate(()=>window.__layoutRunning=false);
  const frames=await page.evaluate(()=>window.__layoutFrames);
  const range=key=>[Math.min(...frames.map(x=>x[key])),Math.max(...frames.map(x=>x[key]))];
  const result={module,tab,label,injectedRegionalFixture:tab==='广东入仓监控',first:frames[0],scroll:range('scrollY'),height:range('height'),triggerY:range('triggerY'),menuY:range('menuY'),allTriggerConnected:frames.every(x=>x.triggerConnected),allMenuConnected:frames.every(x=>x.menuConnected),retainedFrames:frames.filter(x=>x.retained).length,requests:requests.slice(requestStart),frames};
  results.push(result);await writeFile(output+'/result.json',JSON.stringify({results,errors,syntheticOnly:true},null,2));
  assert(result.allTriggerConnected,target+' filter remounted');
  assert(result.scroll[1]-result.scroll[0]<1,target+' document scroll moved: '+result.scroll);
  assert(result.triggerY[1]-result.triggerY[0]<1,target+' trigger moved: '+result.triggerY);
  if(!single){assert(result.allMenuConnected,target+' menu remounted');assert(result.menuY[1]-result.menuY[0]<1,target+' menu moved: '+result.menuY);}
  assert(result.requests.length>0,target+' did not auto-load');
  console.log('PASS '+target+' scroll='+result.scroll+' trigger='+result.triggerY);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,checks:results.length,errors}));
}catch(error){await writeFile(output+'/failure.json',JSON.stringify({error:error.message,results,errors},null,2));throw error;}finally{await browser.close()}
