// UI design checks only. These do not prove business API or PostgreSQL behavior.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve('docs/netshop-refactor/panorama/evidence');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PANORAMA_BROWSER_PATH?{executablePath:process.env.PANORAMA_BROWSER_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>requests.push(r.url()));
async function ready(){await page.waitForTimeout(240)}
try{
  await page.goto('http://127.0.0.1:3160/');await ready();
  assert.match(await page.locator('#content').innerText(),/先选择/);checks.push('no implicit first shop');
  await page.locator('#shop').selectOption('jd-demo');await ready();
  assert.match(await page.locator('#scope').innerText(),/2026-08-01 — 2026-08-29/);checks.push('actual previous period');
  for(let n=1;n<=5;n++){
    await page.locator(`[data-layout="${n}"]`).click();await ready();
    assert.equal(await page.locator('[data-layout][aria-pressed=true]').count(),1);
    if(n===1||n===2||n===5)assert.equal(await page.locator('[data-section]').count(),8);
    if(n===3||n===4){for(let chapter=1;chapter<=8;chapter++){await page.locator(`nav [data-chapter="${chapter}"]`).first().click();assert.equal(await page.locator(`[data-section="${chapter}"]`).count(),1)}await page.locator('nav [data-chapter="1"]').click()}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:resolve(out,`layout-${n}.png`)});
    checks.push(`layout ${n}: eight chapters, distinct composition, desktop width`);
  }
  await page.locator('[data-layout="3"]').click();
  await page.locator('nav [data-chapter="3"]').click();
  await page.evaluate(()=>window.scrollTo(0,250));
  const before=await page.evaluate(()=>scrollY);
  await page.locator('[data-product="P-DEMO-101"]').click();
  assert.match(await page.locator('#detail-content').innerText(),/京东.*演示商用设备旗舰店.*P-DEMO-101/s);
  assert.match(await page.locator('#detail-content').innerText(),/2026-09-01 — 2026-09-29/);
  await page.locator('#detail-dialog [data-close]').first().click();
  assert(Math.abs((await page.evaluate(()=>scrollY))-before)<5);checks.push('product identity, date and return position');
  await page.locator('nav [data-chapter="4"]').click();
  await page.locator('[data-action="promotion"]').first().click();
  assert.match(await page.locator('#detail-content').innerText(),/演示商用设备旗舰店/);
  await page.locator('#detail-dialog [data-close]').first().click();checks.push('promotion same shop and period');
  await page.locator('.scenario summary').click();
  for(const mode of ['missing','revision']){
    await page.locator('#scenario').selectOption(mode);await ready();
    assert.match(await page.locator('#feedback').innerText(),/整期推广费率主值为 —/);
    assert.match(await page.locator('#content').innerText(),/推广花费/);checks.push(`${mode}: combination blocked, independent chapter remains`);
  }
  await page.locator('#scenario').selectOption('failure');await ready();
  assert.match(await page.locator('#content').innerText(),/当前范围刷新失败/);
  assert.equal(await page.locator('[data-section]').count(),0);checks.push('refresh error cannot show old result');
  await page.locator('#scenario').selectOption('denied');await ready();
  assert.match(await page.locator('#content').innerText(),/没有.*权限/);assert.equal(await page.locator('[data-section]').count(),0);checks.push('denied UI contains no data');
  await page.locator('#scenario').selectOption('complete');await ready();
  await page.locator('#shop').selectOption('tm-demo');
  await page.locator('#shop').selectOption('jd-demo');
  await page.locator('#shop').selectOption('tm-demo');await ready();
  assert.match(await page.locator('#scope').innerText(),/天猫/);assert.doesNotMatch(await page.locator('#scope').innerText(),/京东/);
  assert.match(await page.locator('#content').innerText(),/天猫净成交金额/);checks.push('rapid switch rejects late old scope');
  await page.locator('#date-button').click();
  await page.locator('#start').fill('2026-08-28');await page.locator('#end').fill('2026-09-03');
  await page.locator('#apply-date').click();await ready();
  assert.match(await page.locator('#scope').innerText(),/2026-08-21 — 2026-08-27/);checks.push('cross-month equal-length period');
  await page.locator('#date-button').click();await page.locator('#start').fill('2026-02-01');await page.locator('#end').fill('2026-02-28');await page.locator('#apply-date').click();await ready();
  assert.match(await page.locator('#scope').innerText(),/2026-01-01 — 2026-01-31/);checks.push('full calendar month comparison');
  await page.locator('#date-button').click();await page.locator('#start').fill('2026-09-05');await page.locator('#end').fill('2026-09-04');await page.locator('#apply-date').click();assert.match(await page.locator('#date-error').innerText(),/有效/);await page.locator('#date-dialog [data-close]').first().click();checks.push('invalid date range rejected');
  await page.locator('#date-button').click();await page.locator('[data-preset="month"]').click();await page.locator('#apply-date').click();await ready();
  await page.locator('[data-layout="4"]').click();await page.locator('[data-select-day="2026-09-15"]').click();assert.match(await page.locator('.day-spotlight').innerText(),/2026-09-15/);checks.push('day selection updates details without changing period totals');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:900});
    for(let n=1;n<=5;n++){await page.locator(`[data-layout="${n}"]`).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`layout ${n} overflow at ${width}`);checks.push(`layout ${n} fits ${width}px`)}
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3160/?layout=1.5&shop=jd-demo');await ready();
  assert.equal(await page.locator('[data-layout="1"][aria-pressed=true]').count(),1);checks.push('non-enum variant parameter normalizes safely');
  await page.locator('#compare').selectOption('none');await ready();
  assert.match(await page.locator('.kpis').first().innerText(),/未启用比较/);assert.equal(await page.getByRole('columnheader',{name:'比较关闭'}).count(),1);checks.push('comparison off hides deltas');
  await page.locator('#compare').selectOption('year');await ready();assert.equal(await page.getByRole('columnheader',{name:'同比',exact:true}).count(),1);checks.push('year comparison label and actual dates');
  await page.locator('#date-button').click();await page.locator('#start').fill('2025-09-01');await page.locator('#end').fill('2025-09-29');await page.locator('#apply-date').click();await ready();
  await page.locator('#date-button').click();assert.match(await page.locator('#calendars').innerText(),/2025 年 9 月/);await page.locator('#date-dialog [data-close]').first().click();checks.push('calendar reopens with selected year');
  await page.locator('#date-button').click();await page.locator('[data-preset="month"]').click();await page.locator('#apply-date').click();await ready();
  await page.locator('.chart circle[data-day="2026-09-15"]').first().click();assert.match(await page.locator('#detail-title').innerText(),/2026-09-15/);await page.locator('#detail-dialog [data-close]').first().click();checks.push('chart point opens date detail');
  await page.locator('[data-action="daily"]').click();await page.locator('#detail-dialog [data-select-day="2026-09-15"]').click();assert.match(await page.locator('#detail-title').innerText(),/2026-09-15/);assert.equal(await page.locator('#detail-dialog .detail-grid').count(),1);await page.locator('#detail-dialog [data-close]').first().click();checks.push('daily list dialog opens selected day details');
  await page.locator('.scenario summary').click();await page.locator('#scenario').selectOption('missing');await ready();
  await page.locator('.chart circle[data-day="2026-09-15"]').first().click();assert.match(await page.locator('#detail-content').innerText(),/该店该日缺数据/);assert.match(await page.locator('#detail-content').innerText(),/广告花费\s*—/);await page.locator('#detail-dialog [data-close]').first().click();checks.push('missing ad day has null instead of zero or invented spend');
  await page.locator('#date-button').click();await page.locator('#start').fill('2026-06-01');await page.locator('#end').fill('2026-09-07');await page.locator('#apply-date').click();await ready();
  assert.equal(await page.locator('#chapter-4 .chart .now').count(),2);checks.push('long-period sampled ad trend retains the missing-day break');
  assert.equal((await page.request.post('http://127.0.0.1:3160/')).status(),405);assert.equal((await page.request.get('http://127.0.0.1:3160/api/netshop/store-panorama')).status(),404);checks.push('server rejects writes and has no business API');
  assert.equal(errors.length,0);
  assert(requests.every(url=>url.startsWith('http://127.0.0.1:3160/')));checks.push('no runtime errors or business/external requests');
  const report={kind:'synthetic-design-ui-only',checkedAt:new Date().toISOString(),checks,errors,requestOrigins:[...new Set(requests.map(url=>new URL(url).origin))],postgreSQL:'not-run-design-stage',businessInterfaces:'not-connected',oldViews:'unchanged-files-only; integration-regression-pending'};
  await writeFile(resolve(out,'ui-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
