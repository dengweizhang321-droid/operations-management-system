// Optional standalone reproduction; synthetic design UI only.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve('docs/netshop-refactor/panorama/evidence/round-3');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PANORAMA_BROWSER_PATH?{executablePath:process.env.PANORAMA_BROWSER_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>requests.push(r.url()));
async function search(q){await page.locator('#product-search-input').fill(q);await page.locator('#product-search-input').press('Enter')}
try{
  await page.goto('http://127.0.0.1:3160/?layout=5&shop=jd-demo');
  await page.locator('.cockpit-layout').waitFor();
  assert.equal(await page.locator('#variants,[data-layout],.comparison-matrix,.paired-workspace,.trend-led,.chapter-dossier').count(),0);
  assert.match(page.url(),/layout=1/);checks.push('only01 and old layout URL normalizes');
  assert.equal(await page.locator('.filterbar').evaluate(e=>getComputedStyle(e).position),'static');checks.push('shop filter is not sticky');
  const summary=await page.locator('.kpis').innerText();
  assert.equal(await page.locator('#product-list tbody .product-link').count(),5);
  assert.match(await page.locator('#product-page-status').innerText(),/18.*1.*4/);
  await page.locator('#product-list').getByRole('button',{name:'下一页',exact:true}).click();
  assert.match(await page.locator('#product-page-status').innerText(),/6—10.*2.*4/);
  assert.equal(await page.locator('#product-list [data-product="P-DEMO-106"]').count(),1);
  await page.locator('[data-product-page="4"]').click();
  assert.equal(await page.locator('#product-list tbody .product-link').count(),3);
  assert(await page.locator('#product-list').getByRole('button',{name:'下一页',exact:true}).isDisabled());checks.push('real pages and terminal boundary');
  await search('p-demo-118');assert.equal(await page.locator('#product-list tbody .product-link').count(),1);
  assert.match(await page.locator('#product-page-status').innerText(),/第 1 \/ 1/);
  await search('切配');assert.equal(await page.locator('[data-product="P-DEMO-102"]').count(),1);
  assert.equal(await page.locator('.kpis').innerText(),summary);checks.push('ID/title search only changes list');
  await search('不存在的商品');assert.equal(await page.locator('#product-list tbody .product-link').count(),0);
  assert.match(await page.locator('#product-list').innerText(),/没有匹配/);checks.push('empty result');
  await page.locator('[data-product-clear]').click();await page.locator('#product-page-size').selectOption('10');
  assert.equal(await page.locator('#product-list tbody .product-link').count(),10);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'product-page-size');checks.push('clear/page size/focus');
  await page.locator('#product-page-size').selectOption('5');await page.locator('#product-list').getByRole('button',{name:'2',exact:true}).click();
  await page.locator('[data-product="P-DEMO-106"]').click();
  assert.match(await page.locator('#detail-content').innerText(),/京东.*P-DEMO-106/s);
  await page.locator('#detail-dialog [data-close]').first().click();
  assert.match(await page.locator('#product-page-status').innerText(),/第 2 \/ 4/);checks.push('return preserves page');
  await page.locator('#shop').selectOption('tm-demo');await page.locator('.cockpit-layout').waitFor();
  assert.match(await page.locator('#product-page-status').innerText(),/第 1 \/ 4/);assert.match(await page.locator('#product-list').innerText(),/tm-demo/);checks.push('shop resets page/identity');
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('fits '+width)}
  assert.equal(errors.length,0);assert(requests.every(u=>u.startsWith('http://127.0.0.1:3160/')));
  await writeFile(resolve(out,'optional-cli-checks.json'),JSON.stringify({kind:'single01-synthetic-ui-only',checks,errors,checkedAt:new Date().toISOString()},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,failed:0}));
}finally{await browser.close()}