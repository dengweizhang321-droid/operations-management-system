/* Synthetic UI checks only. This script never queries a business API or PostgreSQL. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.COMPARISON_PLAYWRIGHT || 'playwright');

const url = new URL(process.argv[2] || 'http://127.0.0.1:3170/');
assert.equal(url.hostname, '127.0.0.1', 'Only an isolated loopback demo is allowed');
assert.ok(Number(url.port) >= 3100 && Number(url.port) <= 3900);
const out = path.join(__dirname, 'evidence');
fs.mkdirSync(out, {recursive: true});
const cases = [];
const errors = [];
const requests = [];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.COMPARISON_CHROME ? {executablePath: process.env.COMPARISON_CHROME} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}, locale: 'zh-CN', timezoneId: 'Asia/Shanghai'});
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push({method: r.method(), url: r.url()}));
  const check = async (name, fn) => {
    try { await fn(); cases.push({name, result: 'pass'}); }
    catch (e) { cases.push({name, result: 'fail', detail: e.message}); }
  };
  const snapshot = () => page.evaluate(() => window.comparisonDemo.snapshot());
  const set = patch => page.evaluate(x => window.comparisonDemo.setState(x), patch);
  try {
    const response = await page.goto(url.href);
    await page.waitForFunction(() => Boolean(window.comparisonDemo));
    await check('Static-only CSP and synthetic disclosure', async () => {
      assert.equal(response.status(), 200);
      assert.ok(response.headers()['content-security-policy'].includes("connect-src 'none'"));
      assert.match(await page.locator('body').innerText(), /合成/);
    });
    for (let design = 1; design <= 5; design++) {
      await check(`Design ${design}: distinct rendering and desktop fit`, async () => {
        await page.getByTestId(`design-${design}`).click();
        assert.equal((await snapshot()).state.design, design);
        assert.ok((await snapshot()).selectedIds.length >= 2 && (await snapshot()).selectedIds.length <= 4);
        assert.ok(await page.getByTestId('ranking-table').count());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({path: path.join(out, `design-${design}-desktop.png`), fullPage: true});
      });
    }
    await check('Platform mode keeps platforms separate from shop totals', async () => {
      await page.getByTestId('design-1').click();
      await page.getByTestId('platform-filter').selectOption('all');
      await set({currentStart:'2026-09-01',currentEnd:'2026-09-03',source:'platform',coverage:'all'});
      await page.getByTestId('mode-platforms').click();
      const s = await snapshot();
      assert.equal(s.state.mode, 'platforms');
      assert.equal(s.objects.length, 2);
      assert.equal(new Set(s.objects.map(x => x.id)).size, 2);
      assert.ok(s.totals.current.amount>0);
      for(const platform of s.objects) {
        assert.equal(platform.current.amount,platform.children.reduce((sum,shop)=>sum+shop.current.amount,0));
      }
      assert.equal(s.totals.current.amount,s.objects.reduce((sum,o)=>sum+o.current.amount,0));
      const expander = page.locator('[data-testid^="expand-platform-"]').first();
      await expander.click();
      assert.match(await page.getByTestId('ranking-table').innerText(), /演示/);
      assert.deepEqual((await snapshot()).totals.current, s.totals.current);
    });
    await check('Source/date/grain controls alter the actual dataset', async () => {
      await page.getByTestId('mode-shops').click();
      await page.getByTestId('platform-filter').selectOption('JD');
      const before = await snapshot();
      await page.getByTestId('source-filter').selectOption('erp');
      const erp = await snapshot();
      assert.equal(erp.state.source, 'erp');
      assert.notEqual(erp.totals.current.amount, before.totals.current.amount);
      await page.getByTestId('current-end').fill('2026-09-20');
      await page.getByTestId('current-end').dispatchEvent('change');
      const shorter = await snapshot();
      assert.notEqual(shorter.totals.current.amount, erp.totals.current.amount);
      await page.getByTestId('grain-week').click();
      assert.equal((await snapshot()).state.grain, 'week');
      await page.getByTestId('grain-month').click();
      assert.equal((await snapshot()).state.grain, 'month');
      await page.getByTestId('grain-day').click();
    });
    await check('Partial coverage is visible and cannot produce full growth or rate', async () => {
      await set({platform:'all',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-29',previousStart:'2026-08-01',previousEnd:'2026-08-29'});
      await page.getByTestId('coverage-filter').selectOption('partial');
      const s = await snapshot();
      assert.ok(s.objects.length > 0);
      assert.ok(s.objects.every(x => x.status !== 'available'));
      assert.ok(s.objects.every(x => x.growth.value == null));
      assert.ok(s.objects.every(x => x.ratios.promotionRate == null));
      await page.getByTestId('coverage-filter').selectOption('complete');
      assert.ok((await snapshot()).objects.every(x => x.status === 'available'));
    });
    await check('Rapid range changes end with the latest explicit range', async () => {
      await set({platform:'JD',source:'erp',coverage:'all',currentEnd:'2026-09-20'});
      await set({platform:'TMALL',source:'platform',currentEnd:'2026-09-29'});
      const s = await snapshot();
      assert.equal(s.state.platform,'TMALL');
      assert.ok(s.objects.every(x => x.platform === 'TMALL'));
      assert.equal(s.state.currentEnd,'2026-09-29');
    });
    await check('Demo detail and return preserve the comparison range', async () => {
      const before = (await snapshot()).state;
      await page.evaluate(id => window.comparisonDemo.openDetail('shop',id), (await snapshot()).objects[0].id);
      await page.getByTestId('detail-close').click();
      assert.deepEqual((await snapshot()).state, before);
    });
    await check('Zero, negative and missing baselines cannot generate growth or normalized indexes', async () => {
      await set({design:1,mode:'shops',platform:'JD',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-28',selectedIds:['JD:A','JD:B','JD:C'],normalized:true});
      let s = await snapshot();
      assert.equal(s.objects.find(o=>o.id==='JD:C').previous.amount,0);
      assert.equal(s.objects.find(o=>o.id==='JD:C').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='JD:C').points.every(p=>p.value===null));
      await set({source:'erp'});
      s = await snapshot();
      assert.ok(s.objects.find(o=>o.id==='JD:B').previous.amount<0);
      assert.equal(s.objects.find(o=>o.id==='JD:B').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='JD:B').points.every(p=>p.value===null));
      await set({platform:'TMALL'});
      s = await snapshot();
      assert.equal(s.objects.find(o=>o.id==='TMALL:E').previous.amount,null);
      assert.equal(s.objects.find(o=>o.id==='TMALL:E').growth.value,null);
      assert.ok(s.series.find(o=>o.id==='TMALL:E').points.every(p=>p.value===null));
    });
    await check('Weighted ratios and cross-period ranking use the complete selected candidates', async () => {
      await set({platform:'JD',source:'platform',coverage:'all',currentEnd:'2026-09-28',selectedIds:['JD:A','JD:B'],normalized:false});
      const s = await snapshot();
      const rows = s.objects.filter(o=>['JD:A','JD:B'].includes(o.id));
      const weighted = rows.reduce((sum,o)=>sum+o.current.attribution,0)/rows.reduce((sum,o)=>sum+o.current.spend,0);
      assert.ok(Math.abs(s.totals.ratios.roas-weighted)<1e-12);
      assert.ok(Math.abs(s.totals.ratios.roas-rows.reduce((sum,o)=>sum+o.ratios.roas,0)/rows.length)>1e-8);
      assert.ok(s.currentRank.indexOf('JD:A')<s.currentRank.indexOf('JD:B'));
      assert.ok(s.previousRank.indexOf('JD:A')>s.previousRank.indexOf('JD:B'));
    });
    await check('Mixed-platform promotion remains separate and cannot produce a combined ROAS', async () => {
      await set({platform:'all',selectedIds:['JD:A','TMALL:D']});
      const s = await snapshot();
      assert.equal(s.totals.ratios.roas,null);
      assert.equal(s.totals.current.attribution,null);
      assert.match(s.totals.promotionReason,/不同平台/);
    });
    await check('Local ranking pagination and six report chapters are interactive', async () => {
      await set({design:1,platform:'all',page:1,selectedIds:['JD:A','JD:B','TMALL:D']});
      await page.getByTestId('rank-next').click();
      assert.equal((await snapshot()).state.page,2);
      await page.getByTestId('rank-previous').click();
      assert.equal((await snapshot()).state.page,1);
      await page.getByTestId('design-4').click();
      for(let chapter=1;chapter<=6;chapter++){
        await page.getByTestId(`chapter-${chapter}`).click();
        assert.equal((await snapshot()).state.chapter,chapter);
        assert.ok(await page.locator(`[data-section="3.${chapter}"]`).count());
      }
    });
    await check('Synthetic limited-scope fixture rejects a shop outside that fixture scope', async () => {
      await set({design:1,platform:'all',permission:'limited',selectedIds:['JD:B','TMALL:E']});
      const s = await snapshot();
      assert.deepEqual(s.objects.map(o=>o.id).sort(),['JD:A','TMALL:D']);
      assert.ok(!s.selectedIds.includes('JD:B')&&!s.selectedIds.includes('TMALL:E'));
      // This models UI scope only. Formal principal/PG permission tests remain required.
      await set({permission:'full'});
    });
    await check('Complete coverage requires both periods, and a partial baseline prevents decomposition', async () => {
      await set({mode:'shops',platform:'TMALL',source:'erp',coverage:'complete',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28'});
      assert.ok(!(await snapshot()).objects.some(o=>o.id==='TMALL:E'));
      await set({coverage:'all'});
      assert.equal((await snapshot()).objects.find(o=>o.id==='TMALL:E').status,'partial');
      await set({platform:'JD',source:'platform',currentStart:'2026-08-01',currentEnd:'2026-08-28',previousStart:'2026-09-01',previousEnd:'2026-09-28'});
      const s = await snapshot();
      assert.ok(s.candidateSets.unknown.includes('JD:C'));
      assert.equal(s.objects.find(o=>o.id==='JD:C').status,'partial');
    });
    await check('Workbench platform disclosure expands shops and does not only focus the row', async () => {
      await set({design:3,mode:'platforms',platform:'all',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-28'});
      await page.getByTestId('expand-platform-JD').click();
      assert.ok((await snapshot()).state.expanded.includes('JD'));
      assert.ok(await page.locator('.table-subrow').count()>=3);
    });
    await check('Trend buckets and normalized values match the summary for stable shop identities', async () => {
      await set({design:1,mode:'shops',platform:'JD',source:'platform',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-03',previousStart:'2026-08-01',previousEnd:'2026-08-28',selectedIds:['JD:A','JD:B'],grain:'week',normalized:false});
      let s=await snapshot();
      for(const id of ['JD:A','JD:B']){
        const row=s.objects.find(o=>o.id===id),series=s.series.find(o=>o.id===id);
        assert.equal(series.points.length,1);
        assert.equal(series.points[0].value,row.current.amount);
      }
      await set({normalized:true});
      s=await snapshot();
      for(const id of ['JD:A','JD:B']){
        const row=s.objects.find(o=>o.id===id),point=s.series.find(o=>o.id===id).points[0];
        const expected=(row.current.amount/point.days)/(row.previous.amount/row.previous.coverage.requested)*100;
        assert.ok(Math.abs(point.value-expected)<1e-10);
      }
      await set({mode:'platforms',platform:'all',grain:'month',normalized:false});
      s=await snapshot();
      for(const platform of s.objects){
        assert.equal(s.series.find(o=>o.id===platform.id).points[0].value,platform.current.amount);
      }
    });
    await check('ERP summary labels coverage independently of the selected platform source', async () => {
      await set({design:1,mode:'shops',platform:'TMALL',source:'platform',coverage:'all',currentStart:'2026-08-01',currentEnd:'2026-08-03',previousStart:'2026-07-01',previousEnd:'2026-07-03',selectedIds:['TMALL:D','TMALL:E']});
      const s=await snapshot();
      assert.equal(s.totals.current.coverage.erp,3);
      assert.equal(s.totals.current.coverage.requested,6);
      const card=page.locator('.kpi-card').filter({hasText:'ERP 订单毛利'});
      assert.match(await card.innerText(),/已覆盖/);
      assert.match(await card.innerText(),/3\/6 店日/);
    });
    await check('Negative net sales remain in tables and do not enter the scale bubble chart', async () => {
      await set({platform:'JD',source:'erp',currentStart:'2026-08-01',currentEnd:'2026-08-03',previousStart:'2026-07-01',previousEnd:'2026-07-03',selectedIds:['JD:A','JD:B']});
      assert.ok((await snapshot()).objects.find(o=>o.id==='JD:B').current.amount<0);
      const scatter=page.locator('svg[aria-label="规模与客单价分布"]');
      assert.equal(await scatter.locator('circle').count(),1);
      assert.doesNotMatch(await scatter.innerText(),/京东 B 店/);
      assert.match(await page.getByTestId('ranking-table').innerText(),/京东 B 店/);
    });
    await set({mode:'shops',platform:'JD',source:'platform',coverage:'all',grain:'day',currentStart:'2026-09-01',currentEnd:'2026-09-29',previousStart:'2026-08-01',previousEnd:'2026-08-29'});
    await page.setViewportSize({width:390,height:844});
    for (let design = 1; design <= 5; design++) {
      await check(`Design ${design}: narrow layout`, async () => {
        await page.getByTestId(`design-${design}`).click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({path: path.join(out, `design-${design}-narrow.png`),fullPage:true});
      });
    }
    await check('No JS errors or business/network requests', async () => {
      assert.deepEqual(errors, []);
      assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).origin === url.origin));
      assert.ok(requests.every(r => !new URL(r.url).pathname.startsWith('/api/')));
    });
  } finally {
    await browser.close();
    const report = {
      scope: 'synthetic isolated UI only',
      sourceHashes: Object.fromEntries(['index.html','demo.js','demo.css'].filter(f=>fs.existsSync(path.join(__dirname,f))).map(f=>[f,sha(f)])),
      testedAt: new Date().toISOString(),
      viewport: ['1440x1080','390x844'],
      cases, errors, requests,
      passed: cases.filter(x=>x.result==='pass').length,
      failed: cases.filter(x=>x.result==='fail').length,
      PostgreSQL: 'not implemented/not tested in this design stage',
      productionPermissions: 'not tested; required after F/P/A integration',
      productionOperations: []
    };
    fs.writeFileSync(path.join(out,'ui-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,cases:cases.filter(x=>x.result==='fail')},null,2));
    if(report.failed) process.exitCode=1;
  }
})().catch(e => {console.error(e);process.exitCode=1;});
