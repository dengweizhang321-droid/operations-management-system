import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const origin=process.env.FILTER_PREVIEW_URL||'http://127.0.0.1:3781';
assert.match(origin,/^http:\/\/127\.0\.0\.1:3[1-8]\d\d$/,'Isolated preview only');
const output='.runtime/filter-confirmation-'+Date.now();await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],requests=[],responses=[],errors=[];let delay=0,fail=false;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')){assert.equal(r.method(),'GET');requests.push(r.url())}});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(!u.pathname.startsWith('/api/')||u.pathname==='/api/auth/me')return route.continue();const wait=delay,failed=fail;fail=false;const response=await route.fetch();if(wait)await new Promise(r=>setTimeout(r,wait));if(failed)return route.fulfill({status:400,contentType:'application/json',body:'{"error":"synthetic read failure"}'});responses.push({url:route.request().url(),status:response.status(),payload:await response.json().catch(()=>null)});return route.fulfill({response});});
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
 async function open(module){await page.goto(origin+'/?module='+module);await page.waitForTimeout(1800);assert.equal(await page.getByRole('button',{name:'应用筛选',exact:true}).count(),0);}
 async function salesReady(){await page.waitForFunction(()=>document.querySelector('.stable-read-content[aria-busy=false] .sales-period-note[role=status]')?.textContent.includes('全部区域已更新'));}
 await check('sales text waits for Enter; dropdown auto-loads only confirmed text and keeps panel focus',async()=>{
  await open('sales');await salesReady();const text=page.getByRole('textbox',{name:'销售分析货品编码或名称'});const mark=requests.length;
  await text.fill('DEMO-001');await page.waitForTimeout(850);assert.equal(requests.length,mark);
  await page.getByRole('button',{name:'销售分析平台',exact:true}).click();const menu=page.getByRole('listbox',{name:'销售分析平台选项'});
  await page.evaluate(()=>window.__confirmationMenu=document.querySelector('[role=listbox]'));
  await menu.getByRole('option',{name:'京东',exact:true}).click();await menu.getByRole('option',{name:'天猫',exact:true}).click();
  await page.waitForFunction(()=>new URL(location.href).searchParams.getAll('salesPlatform').length===2);await salesReady();
  assert.equal(await page.evaluate(()=>window.__confirmationMenu.isConnected),true);assert.equal(await page.getByRole('searchbox',{name:'搜索销售分析平台'}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await text.inputValue(),'DEMO-001');const reads=requests.slice(mark).filter(s=>s.includes('/api/sales/summary'));assert.equal(reads.length,2);assert(reads.every(s=>new URL(s).searchParams.getAll('platform').length===2&&!new URL(s).searchParams.has('productQuery')));
  await text.press('Enter');await page.waitForFunction(()=>new URL(location.href).searchParams.get('salesProductQuery')==='DEMO-001');await salesReady();
  const confirmed=responses.filter(r=>new URL(r.url).searchParams.get('productQuery')==='DEMO-001');assert.equal(confirmed.length,2);assert(confirmed.every(r=>r.status===200&&r.payload.current.lineCount>0));
  await page.screenshot({path:output+'/sales.png'});
 });
 await check('inventory IME commit is not a query; Enter preserves caret and complete text; slow reads keep later edits',async()=>{
  await open('inventory');const text=page.getByRole('textbox',{name:'库存公共货品搜索'});await text.click();const mark=requests.length;
  await text.pressSequentially('DEMO-001',{delay:60});await page.waitForTimeout(700);assert.equal(requests.length,mark);assert.equal(await text.evaluate(el=>el===document.activeElement),true);
  await text.evaluate(el=>el.setSelectionRange(5,5));await text.pressSequentially('X');assert.equal(await text.evaluate(el=>el.selectionStart),6);await text.fill('');
  const cdp=await context.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'商用',selectionStart:2,selectionEnd:2});await page.waitForTimeout(700);assert.equal(requests.length,mark);
  await cdp.send('Input.insertText',{text:'商用'});await page.waitForTimeout(700);assert.equal(requests.length,mark);assert.equal(await text.inputValue(),'商用');
  delay=1400;await text.fill('DEMO-002');const waiting=page.waitForRequest(r=>new URL(r.url()).searchParams.get('q')==='DEMO-002');await text.press('Enter');await waiting;await text.fill('unconfirmed later text');
  await page.waitForTimeout(1900);assert.equal(await text.inputValue(),'unconfirmed later text');assert.equal(await text.evaluate(el=>el===document.activeElement),true);assert(requests.slice(mark).every(s=>!new URL(s).searchParams.get('q')?.includes('unconfirmed')));
  delay=0;await page.getByRole('button',{name:'健康状态',exact:true}).click();const menu=page.getByRole('listbox',{name:'健康状态选项'});await menu.getByRole('option').nth(1).click();await menu.getByRole('option').nth(2).click();await page.waitForFunction(()=>new URL(location.href).searchParams.getAll('inventoryHealthStatus').length===2);await page.waitForTimeout(900);
  const reads=requests.filter(s=>s.includes('/api/inventory/overview')&&new URL(s).searchParams.getAll('status').length===2);assert(reads.length>=2&&reads.every(s=>new URL(s).searchParams.get('q')==='DEMO-002'));
  assert.equal(await text.inputValue(),'unconfirmed later text');await page.screenshot({path:output+'/inventory.png'});
 });
 await check('product code requires Enter; dropdowns retain unconfirmed code and auto-load complete multi-values',async()=>{
  await open('product');await page.locator('.product-dependent-filters:not(:disabled)').waitFor();const text=page.getByRole('textbox',{name:'搜索一个或多个货品规格代码、名称、品牌、供应商、规格或品类'});const mark=requests.length;
  await text.fill('DEMO-001');await page.waitForTimeout(750);assert.equal(requests.length,mark);
  await page.getByRole('button',{name:'销售平台',exact:true}).click();const menu=page.getByRole('listbox',{name:'销售平台多选'});await menu.getByRole('option',{name:'京东',exact:true}).click();await menu.getByRole('option',{name:'天猫',exact:true}).click();await page.waitForTimeout(1300);
  const reads=requests.slice(mark).filter(s=>s.includes('/api/products/summary'));assert(reads.length>=2&&reads.every(s=>new URL(s).searchParams.getAll('platform').length===2&&!new URL(s).searchParams.has('q')));assert.equal(await text.inputValue(),'DEMO-001');
  const confirmation=requests.length;await text.press('Enter');await page.waitForTimeout(1500);const confirmed=requests.slice(confirmation).filter(s=>s.includes('/api/products/summary'));assert(confirmed.length>=2&&confirmed.every(s=>new URL(s).searchParams.get('q')==='DEMO-001'));await page.screenshot({path:output+'/product.png'});
 });
 await check('single selection auto-loads; pending dimension edits are canceled when reset or navigating',async()=>{
  await open('inventory');await page.getByRole('tab',{name:'备货计划',exact:true}).click();await page.getByRole('button',{name:'备货计划状态',exact:true}).waitFor();await page.waitForTimeout(800);
  await page.getByRole('button',{name:'备货计划状态',exact:true}).click();const menu=page.getByRole('listbox',{name:'备货计划状态选项'});await menu.getByRole('option').nth(1).click();await page.waitForFunction(()=>new URL(location.href).searchParams.has('inventoryPlanStatus'));
  await page.getByRole('tab',{name:'库存总览',exact:true}).click();await page.waitForTimeout(800);
  await page.getByRole('button',{name:'健康状态',exact:true}).click();await page.getByRole('listbox',{name:'健康状态选项'}).getByRole('option').nth(1).click();await page.getByRole('button',{name:'恢复当前页默认',exact:true}).click();await page.waitForTimeout(800);assert.equal(new URL(page.url()).searchParams.has('inventoryHealthStatus'),false);
  await page.getByRole('button',{name:'健康状态',exact:true}).click();await page.getByRole('listbox',{name:'健康状态选项'}).getByRole('option').nth(1).click();await page.getByRole('tab',{name:'库龄分析',exact:true}).click();await page.waitForTimeout(800);assert.equal(new URL(page.url()).searchParams.has('inventoryHealthStatus'),false);
 });
 await check('late reads and failed retry never overwrite later unconfirmed input',async()=>{
  await open('sales');await salesReady();await page.evaluate(()=>{const native=window.fetch;window.fetch=(url,init={})=>native(url,{...init,signal:undefined});});const text=page.getByRole('textbox',{name:'销售分析货品编码或名称'});
  await page.addStyleTag({content:'html{scroll-behavior:auto}'});await text.fill('NO-SUCH-CODE');
  await page.evaluate(()=>{window.scrollTo(0,130);window.__readInput=document.querySelector('[aria-label="销售分析货品编码或名称"]');window.__readPositions=[];window.__readWatching=true;function tick(){window.__readPositions.push({scroll:scrollY,y:window.__readInput.getBoundingClientRect().y,connected:window.__readInput.isConnected});if(window.__readWatching)requestAnimationFrame(tick)}tick();});
  delay=1700;const waiting=page.waitForRequest(r=>new URL(r.url()).searchParams.get('productQuery')==='NO-SUCH-CODE');await text.press('Enter');await waiting;delay=0;await text.fill('DEMO-002');await text.press('Enter');await page.waitForTimeout(2300);await salesReady();assert.equal(await text.inputValue(),'DEMO-002');
  fail=true;await text.fill('DEMO-003');await text.press('Enter');await page.getByText('销售数据加载失败',{exact:true}).waitFor();await text.fill('keep editing');await page.getByRole('button',{name:'重新加载',exact:true}).click();await salesReady();assert.equal(await text.inputValue(),'keep editing');
  await page.evaluate(()=>window.__readWatching=false);const positions=await page.evaluate(()=>window.__readPositions);
  assert(positions.every(p=>p.connected));assert(Math.max(...positions.map(p=>p.scroll))-Math.min(...positions.map(p=>p.scroll))<1);assert(Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))<1);
 });
 assert.deepEqual(errors,[]);await writeFile(output+'/result.json',JSON.stringify({checks,errors,requests,responses,syntheticOnly:true,nativeWindowsCandidateWindowVerified:false},null,2));console.log(JSON.stringify({output,checks}));
}catch(e){await writeFile(output+'/failure.json',JSON.stringify({error:e.message,checks,errors,requests,responses},null,2));throw e}finally{await browser.close()}
