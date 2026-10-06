import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const origin=process.env.FILTER_PREVIEW_URL || 'http://127.0.0.1:3781';
const pin='c00edc8df8a04f16fe5a26c4654a45c0bd15f9e8';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),pin);
assert.equal(execFileSync('git',['diff','--name-only','--','app'],{encoding:'utf8',windowsHide:true}).trim(),'','Run the reproduction on the pinned original UI');
const output=process.env.FILTER_EVIDENCE_DIR || '.runtime/shared-filter-evidence/before-'+Date.now();
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,query:new URL(r.url()).search,method:r.method()});});
  const results=[];
  await page.route('**/api/**',async route=>{
    const response=await route.fetch();
    if(!route.request().url().includes('/auth/')) await new Promise(r=>setTimeout(r,1200));
    await route.fulfill({response});
  });
  for(const [module,label] of [['sales','销售分析平台'],['inventory','库存公共仓库'],['product','销售平台']]) {
    await page.goto(origin+'/?module='+module);
    await page.getByRole('button',{name:label,exact:true}).waitFor({timeout:30000});
    await page.waitForTimeout(4500);
    const trigger=page.getByRole('button',{name:label,exact:true});
    await trigger.click();
    const menu=page.getByRole('listbox').filter({has:page.getByRole('option')}).last();
    const options=await menu.getByRole('option').allTextContents();
    await page.evaluate(()=>{window.__probeTrigger=document.querySelector('[aria-expanded="true"][aria-haspopup="listbox"]');window.__probeMenu=document.querySelector('[role=listbox]');});
    const before=await trigger.boundingBox();
    await page.screenshot({path:output+'/'+module+'-before.png'});
    const start=requests.length;
    await menu.getByRole('option').nth(1).click();
    await page.waitForTimeout(100);
    const during=await page.evaluate(()=>({sameTrigger:window.__probeTrigger?.isConnected,sameMenu:window.__probeMenu?.isConnected,open:window.__probeTrigger?.getAttribute('aria-expanded'),focus:document.activeElement?.getAttribute('aria-label'),disabled:window.__probeTrigger?.matches(':disabled')}));
    await page.screenshot({path:output+'/'+module+'-during.png'});
    await page.waitForTimeout(4000);
    const after=await trigger.boundingBox();
    results.push({module,label,options,before,during,after,requests:requests.slice(start),url:page.url()});
    await writeFile(output+'/'+module+'.txt',await page.locator('body').innerText());
  }
  await writeFile(output+'/before.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
