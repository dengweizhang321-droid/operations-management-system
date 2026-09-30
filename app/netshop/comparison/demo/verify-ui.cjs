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
      await page.getByTestId('mode-platforms').click();
      const s = await snapshot();
      assert.equal(s.state.mode, 'platforms');
      assert.equal(s.objects.length, 2);
      assert.equal(new Set(s.objects.map(x => x.id)).size, 2);
      const expander = page.locator('[data-testid^="expand-platform-"]').first();
      await expander.click();
      assert.match(await page.getByTestId('ranking-table').innerText(), /演示/);
      assert.equal((await snapshot()).totals.current, s.totals.current);
    });
    await check('Source/date/grain controls alter the actual dataset', async () => {
      await page.getByTestId('mode-shops').click();
      await page.getByTestId('platform-filter').selectOption('JD');
      const before = await snapshot();
      await page.getByTestId('source-filter').selectOption('erp');
      const erp = await snapshot();
      assert.equal(erp.state.source, 'erp');
      assert.notEqual(erp.totals.current, before.totals.current);
      await page.getByTestId('current-end').fill('2026-09-20');
      await page.getByTestId('current-end').dispatchEvent('change');
      const shorter = await snapshot();
      assert.notEqual(shorter.totals.current, erp.totals.current);
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
      assert.ok(s.objects.every(x => x.growth == null));
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
