import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const origin=process.env.FILTER_PREVIEW_URL || 'http://127.0.0.1:3781';
assert.match(origin,/^http:\/\/127\.0\.0\.1:3[1-8]\d\d$/,'Isolated preview only');
const output=process.env.FILTER_EVIDENCE_DIR || '.runtime/shared-filter-evidence/after-'+Date.now();
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],requests=[],responses=[],errors=[];
let delay=0,fail=false;
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/')) requests.push({url:r.url(),method:r.method()});});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin) return route.abort('blockedbyclient');
    if(!url.pathname.startsWith('/api/') || url.pathname==='/api/auth/me') return route.continue();
    assert.equal(route.request().method(),'GET');
    const wait=delay,failed=fail; fail=false;
    const response=await route.fetch();
    if(wait) await new Promise(r=>setTimeout(r,wait));
    if(failed) return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'合成故障验证'})});
    let payload; try{payload=await response.json();}catch{}
    responses.push({url:route.request().url(),status:response.status(),payload});
    await route.fulfill({response});
  });
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
  const open=async(module,label)=>{
    await page.goto(origin+'/?module='+module);
    await page.getByRole('button',{name:label,exact:true}).waitFor();
    await page.waitForTimeout(1200);
    await page.getByRole('button',{name:label,exact:true}).click();
    return page.getByRole('listbox',{name:label+(module==='product'?'多选':'选项'),exact:true});
  };
  await check('销售连续多选/取消/搜索焦点/不请求/不移动',async()=>{
    const menu=await open('sales','销售分析平台');
    const search=page.getByRole('searchbox',{name:'搜索销售分析平台'});
    await search.fill('');
    const mark=requests.length,box=await menu.boundingBox();
    await page.evaluate(()=>window.__menu=document.querySelector('[role=listbox]'));
    await menu.getByRole('option',{name:'京东',exact:true}).click();
    await menu.getByRole('option',{name:'天猫',exact:true}).click();
    assert.equal(await menu.getByRole('option',{selected:true}).count(),2);
    await menu.getByRole('option',{name:'京东',exact:true}).click();
    assert.equal(await menu.getByRole('option',{selected:true}).count(),1);
    await menu.getByRole('option',{name:'京东',exact:true}).click();
    assert.equal(await search.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>window.__menu.isConnected),true);
    assert.deepEqual(await menu.boundingBox(),box);
    assert.equal(requests.length,mark);
    assert.equal(new URL(page.url()).searchParams.has('salesPlatform'),false);
    await page.screenshot({path:output+'/sales-multi.png'});
  });
  await check('统一应用携带两个平台/真实后端结果范围',async()=>{
    const mark=responses.length;
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.sales-period-note[role=status]')?.textContent.includes('全部区域已更新'));
    const reads=responses.slice(mark).filter(r=>new URL(r.url).pathname==='/api/sales/summary');
    assert.equal(reads.length,2);
    for(const r of reads){assert.deepEqual(new URL(r.url).searchParams.getAll('platform').sort(),['京东','天猫']);assert.equal(r.status,200);assert.equal(r.payload.current.netSalesCents,2691000);}
    assert.deepEqual(new URL(page.url()).searchParams.getAll('salesPlatform').sort(),['京东','天猫']);
  });
  await check('平台店铺联动只移除失效店铺/清空与撤销/恢复默认',async()=>{
    await page.getByRole('button',{name:'销售分析店铺',exact:true}).click();
    const shops=page.getByRole('listbox',{name:'销售分析店铺选项'});
    await shops.getByRole('option').nth(1).click();await shops.getByRole('option').nth(2).click();
    const labels=await shops.getByRole('option').allTextContents();
    await page.getByRole('button',{name:'销售分析平台',exact:true}).click();
    await page.getByRole('listbox',{name:'销售分析平台选项'}).getByRole('option',{name:'天猫',exact:true}).click();
    await page.getByRole('button',{name:'销售分析店铺',exact:true}).click();
    const next=page.getByRole('listbox',{name:'销售分析店铺选项'});
    assert.equal(await next.getByRole('option',{selected:true}).count(),1);
    assert.match(await next.getByRole('option',{selected:true}).innerText(),/京东/);
    assert.equal(labels.length,3);
    await next.getByRole('button',{name:'清空',exact:true}).click();
    assert.match(await next.getByRole('option',{selected:true}).innerText(),/全部店铺/);
    await page.getByRole('button',{name:'撤销修改',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'应用筛选',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'恢复默认',exact:true}).click();
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.waitForTimeout(1200);
    assert.equal(new URL(page.url()).searchParams.has('salesPlatform'),false);
  });
  await check('库存货品连续输入/光标/中文IME/粘贴/删除/清空无请求',async()=>{
    await open('inventory','库存公共仓库');
    await page.keyboard.press('Escape');
    const input=page.getByRole('textbox',{name:'库存公共货品搜索'});
    const mark=requests.length;
    await input.click();const box=await input.boundingBox();
    await input.pressSequentially('DEMO-001',{delay:70});
    await page.waitForTimeout(800);
    assert.equal(await input.inputValue(),'DEMO-001');
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    await input.evaluate(el=>el.setSelectionRange(5,5));await input.pressSequentially('X');
    assert.equal(await input.inputValue(),'DEMO-X001');
    assert.equal(await input.evaluate(el=>el.selectionStart),6);
    await input.fill('');
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'商用',selectionStart:2,selectionEnd:2});
    await page.waitForTimeout(500);
    assert.equal(await input.inputValue(),'商用');
    await cdp.send('Input.insertText',{text:'商用'});
    assert.equal(await input.inputValue(),'商用');
    await page.evaluate(()=>navigator.clipboard.writeText('DEMO-002,DEMO-003'));
    await input.press('Control+A');await input.press('Control+V');
    assert.equal(await input.inputValue(),'DEMO-002,DEMO-003');
    await input.press('Backspace');assert.equal(await input.inputValue(),'DEMO-002,DEMO-00');
    await input.press('Control+A');await input.press('Backspace');
    assert.equal(await input.inputValue(),'');
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(await input.boundingBox(),box);assert.equal(requests.length,mark);
    await input.fill('DEMO-001');
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.waitForTimeout(1300);
    const reads=responses.filter(r=>new URL(r.url).pathname==='/api/inventory/overview' && new URL(r.url).searchParams.get('q')==='DEMO-001');
    assert.ok(reads.length>=2);assert.equal(reads.at(-1).status,200);
    await page.screenshot({path:output+'/inventory-input.png'});
  });
  await check('库存慢请求中继续输入/请求完成不覆盖草稿/组件不卸载',async()=>{
    const input=page.getByRole('textbox',{name:'库存公共货品搜索'});
    delay=2000;await input.fill('DEMO-002');
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await input.click();await input.pressSequentially('3');
    await page.evaluate(()=>window.__input=document.querySelector('[aria-label="库存公共货品搜索"]'));
    await page.waitForTimeout(2700);
    assert.equal(await input.inputValue(),'DEMO-0023');
    assert.equal(await page.evaluate(()=>window.__input.isConnected),true);
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    delay=0;await page.getByRole('button',{name:'撤销修改',exact:true}).click();
    assert.equal(await input.inputValue(),'DEMO-002');
  });
  await check('商品连续多选/搜索稳定/应用带完整平台/单选排序',async()=>{
    const menu=await open('product','销售平台');const mark=requests.length;
    await menu.getByRole('option',{name:'京东',exact:true}).click();
    await menu.getByRole('option',{name:'天猫',exact:true}).click();
    assert.equal(await menu.getByRole('option',{selected:true}).count(),2);
    assert.equal(requests.length,mark);
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.waitForTimeout(1600);
    const reads=responses.filter(r=>new URL(r.url).pathname==='/api/products/summary' && new URL(r.url).searchParams.getAll('platform').length===2);
    assert.ok(reads.length>=2);for(const r of reads) assert.deepEqual(new URL(r.url).searchParams.getAll('platform'),['京东','天猫']);
    await page.getByRole('button',{name:'排序方式',exact:true}).click();
    await page.getByRole('listbox',{name:'排序方式选项'}).getByRole('option',{name:'按订单毛利'}).click();
    assert.equal(await page.getByRole('listbox',{name:'排序方式选项'}).count(),0);
    await page.screenshot({path:output+'/product-multi.png'});
  });
  await check('快速应用/忽略abort的迟到旧响应不能覆盖新范围/失败重试',async()=>{
    await open('sales','销售分析平台');await page.keyboard.press('Escape');
    // Deliberately make the transport ignore abort; the real caller must still
    // reject the old generation after its late response completes.
    await page.evaluate(()=>{const native=window.fetch;window.fetch=(url,init={})=>native(url,{...init,signal:undefined});});
    const input=page.getByRole('textbox',{name:'销售分析货品编码或名称'});
    delay=2200;await input.fill('NO-SUCH-CODE');
    const first=page.waitForRequest(r=>new URL(r.url()).searchParams.get('productQuery')==='NO-SUCH-CODE');
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();await first;
    delay=0;await input.fill('DEMO-002');
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.waitForTimeout(3200);
    assert.equal(await input.inputValue(),'DEMO-002');
    assert.equal(await page.getByText('本月暂无销售数据',{exact:true}).count(),0);
    assert.match(await page.locator('.sales-period-note[role=status]').innerText(),/全部区域已更新/);
    fail=true;await input.fill('DEMO-003');await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.getByText('销售数据加载失败',{exact:true}).waitFor();
    await input.click();await input.pressSequentially('x');
    assert.equal(await input.inputValue(),'DEMO-003x');
    await page.getByRole('button',{name:'撤销修改',exact:true}).click();
    await page.getByRole('button',{name:'重新加载',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.sales-period-note[role=status]')?.textContent.includes('全部区域已更新'));
    assert.equal(await input.inputValue(),'DEMO-003');
  });
  await check('库存六页签/销售三页签输入不触发请求/切页撤销草稿且继承已应用条件',async()=>{
    await open('inventory','库存公共仓库');await page.keyboard.press('Escape');
    for(const tab of ['库存总览','库龄分析','备货计划','滞销清理','京东入仓监控','广东入仓监控']){
      await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(700);
      const input=page.getByRole('textbox',{name:'库存公共货品搜索'});await input.waitFor();
      const mark=requests.length;await input.fill('DEMO-001');await input.pressSequentially('2');
      await page.waitForTimeout(550);assert.equal(await input.inputValue(),'DEMO-0012');
      assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      assert.equal(requests.length,mark);
    }
    await page.getByRole('tab',{name:'库存总览',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'库存公共货品搜索'}).inputValue(),'');
    await page.goto(origin+'/?module=sales');await page.waitForTimeout(800);
    for(const tab of ['销售总览','渠道分析','品类分析']){
      await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(800);
      const input=page.getByRole('textbox',{name:'销售分析货品编码或名称'});const mark=requests.length;
      await input.fill('DEMO-001\nDEMO-002');await page.waitForTimeout(550);
      assert.equal(await input.inputValue(),'DEMO-001\nDEMO-002');assert.equal(requests.length,mark);
    }
    await page.getByRole('tab',{name:'销售总览',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'销售分析货品编码或名称'}).inputValue(),'');
  });
  await check('库存健康状态多值请求由后端完整过滤',async()=>{
    await open('inventory','健康状态');
    const menu=page.getByRole('listbox',{name:'健康状态选项'});
    await menu.getByRole('option').nth(1).click();await menu.getByRole('option').nth(2).click();
    const mark=responses.length;
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.waitForTimeout(1200);
    const reads=responses.slice(mark).filter(r=>new URL(r.url).pathname==='/api/inventory/overview');
    assert.equal(reads.length,2);
    for(const r of reads){assert.equal(new URL(r.url).searchParams.getAll('status').length,2);assert.equal(r.status,200);}
    const detail=reads.find(r=>new URL(r.url).searchParams.get('section')==='detail').payload;
    const allowed=new URL(reads[0].url).searchParams.getAll('status');
    assert.ok(detail.items.length>0);assert.ok(detail.items.every(row=>allowed.includes(row.status)));
  });
  await check('日期仍独立确认/取消不改变已应用周期/公共筛选面板保持可用',async()=>{
    await page.getByRole('button',{name:'统计周期',exact:true}).click();
    await page.getByRole('listbox',{name:'统计周期选项'}).getByRole('option',{name:'自定义',exact:true}).click();
    const picker=page.locator('.stat-period-picker');await picker.waitFor();
    const mark=requests.length;
    await picker.getByRole('button',{name:'昨天',exact:true}).click();
    assert.equal(requests.length,mark);
    await picker.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await picker.count(),0);
    await page.getByRole('button',{name:'库存公共仓库',exact:true}).click();
    assert.equal(await page.getByRole('listbox',{name:'库存公共仓库选项'}).count(),1);
  });
  assert.deepEqual(errors,[]);
  await writeFile(output+'/result.json',JSON.stringify({checks,errors,requests,responses,syntheticOnly:true},null,2));
} catch(error) {
  await writeFile(output+'/failure.json',JSON.stringify({checks,error:error.message,errors,requests,responses},null,2));throw error;
} finally { await browser.close(); }
