// Actual Home, isolated preview, GET only. No CSS mutation and no forced click.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const origin = process.env.AUDIT_PREVIEW_URL || 'http://127.0.0.1:3781';
if (!/^http:\/\/127\.0\.0\.1:3[1-8]\d\d$/.test(origin)) throw new Error('Isolated preview only');
const output = path.resolve(process.env.AUDIT_OUTPUT || `.runtime/detail-layout-audit-${Date.now()}`);
await mkdir(output, { recursive: true });
const results = { origin, source: 'actual app/page.tsx; no markup/CSS substitution', cases: [] };
const save = () => writeFile(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const selectedCases = (process.env.AUDIT_CASES || '').split(',').map(value => value.trim()).filter(Boolean);
async function run(name, task) {
  if (selectedCases.length && !selectedCases.some(value => name === value || name.startsWith(value))) return;
  const record = { name, status: 'running', requests: [], observations: {} }; results.cases.push(record);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(6000); page.setDefaultNavigationTimeout(20000);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
  page.on('request', request => { if (request.url().includes('/api/')) record.requests.push({ time: Date.now(), url: request.url(), method: request.method() }); });
  try { await task(page, record); record.status = 'observed'; }
  catch (error) { record.status = 'probe_incomplete'; record.error = error.stack || error.message; }
  finally { await page.screenshot({ path: path.join(output, name + '.png') }).catch(() => undefined); await save(); await context.close(); console.log(JSON.stringify(record)); }
}
const detailGeometry = page => page.evaluate(() => {
  const selectors = ['.product-detail-back', '.product-detail-heading', '.product-detail-heading-main', '.product-detail-heading-meta', '.shell-masthead'];
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const styles = element => { const c = getComputedStyle(element); return Object.fromEntries(['position', 'zIndex', 'display', 'paddingTop', 'fontSize', 'lineHeight', 'height', 'minHeight', 'overflow', 'pointerEvents'].map(key => [key, c[key]])); };
  const back = document.querySelector('.product-detail-back'), r = back?.getBoundingClientRect();
  const hits = r ? [0.2, 0.5, 0.8].flatMap(fx => [0.2, 0.5, 0.8].map(fy => {
    const x = r.x + r.width * fx, y = r.y + r.height * fy, hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit ? { tag: hit.tagName, className: hit.className } : null, reachesBack: Boolean(hit && (hit === back || back.contains(hit))) };
  })) : [];
  return { scrollY, scrollHeight: document.documentElement.scrollHeight, viewport: { width: innerWidth, height: innerHeight }, elements: selectors.map(selector => { const element = document.querySelector(selector); return { selector, ...(element ? { rect: rect(element), styles: styles(element) } : { missing: true }) }; }), hits };
});
try {
  await run('product-detail-back-hit-test', async (page, record) => {
    await page.goto(origin + '/?module=product');
    const firstDetail = page.locator('.product-list-region tbody tr').getByRole('button', { name: '详情', exact: true }).first();
    await firstDetail.waitFor();
    const next = page.locator('.product-filter-panel').getByRole('button', { name: '下一页', exact: true });
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await page.waitForFunction(() => document.querySelector('.product-filter-panel .jd-sku-pagination')?.textContent?.includes('第 2 /') && !document.querySelector('.product-filter-panel [data-retained-read="true"]'));
      record.observations.page2 = true;
    } else record.observations.page2 = 'unavailable in isolated dataset; first-page detail used';
    await firstDetail.click();
    const back = page.locator('.product-detail-back'); await back.waitFor();
    await page.waitForTimeout(450);
    record.observations.beforeClick = await detailGeometry(page);
    try { await back.click({ timeout: 6000 }); record.observations.ordinaryClick = 'resolved'; }
    catch (error) { record.observations.ordinaryClick = { failed: true, error: error.message }; }
    record.observations.detailRemainsAfterOrdinary = await back.count() > 0;
    if (record.observations.detailRemainsAfterOrdinary) {
      record.observations.afterOrdinaryFailure = await detailGeometry(page);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(100);
      record.observations.afterScrollTop = await detailGeometry(page);
      const box = await back.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(100);
      record.observations.detailRemainsAfterVisibleCoordinateClick = await back.count() > 0;
    }
    if (await back.count()) {
      await back.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      record.observations.detailRemainsAfterKeyboardEnter = await back.count() > 0;
    }
    record.observations.qualification = 'If visible-coordinate click succeeds and hit-testing reaches the button, keep the first locator failure as automation/scroll ambiguity instead of claiming a product-wide blocked button.';
  });
  await run('netshop-products-period-overflow', async (page, record) => {
    await page.goto(origin + '/?module=shop&view=products');
    await page.locator('.np-date-label').waitFor(); record.observations.widths = [];
    for (const width of [1440, 1100, 900]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(150);
      record.observations.widths.push(await page.evaluate(() => {
        const date = document.querySelector('.np-date-label'), button = date?.querySelector('button');
        const labels = [...document.querySelectorAll('.np-filters > label')];
        const quality = labels.find(label => label.textContent?.trim().startsWith('资料质量'));
        const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, display: c.display, cssHeight: c.height, padding: c.padding, lineHeight: c.lineHeight, fontSize: c.fontSize }; };
        const d = box(date), b = box(button), q = box(quality);
        const intersects = Boolean(b && q && Math.min(b.right, q.right) > Math.max(b.left, q.left) && Math.min(b.bottom, q.bottom) > Math.max(b.top, q.top));
        const hit = b ? document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) : null;
        return { width: innerWidth, date: d, button: b, quality: q, buttonExceedsParentBottom: Boolean(d && b && b.bottom > d.bottom + 1), intersectsQuality: intersects, buttonCenterHit: hit ? { tag: hit.tagName, className: hit.className } : null };
      }));
      await page.screenshot({ path: path.join(output, `netshop-products-${width}.png`) });
    }
  });
  for (const target of [
    { name: 'market-ranking-root-overflow', query: '?module=market', selector: '.market-module' },
    { name: 'n8n-jackyun-root-overflow', query: '?module=n8n_workflows', selector: '.n8n-workflow-module' },
    { name: 'n8n-tmall-root-overflow', query: '?module=n8n_workflows&view=tmall', selector: '.n8n-workflow-module' },
  ]) await run(target.name, async (page, record) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto(origin + '/' + target.query); await page.locator(target.selector).waitFor();
    await page.waitForTimeout(900);
    record.observations.geometry = await page.evaluate(() => {
      const describe = element => {
        const r = element.getBoundingClientRect(), c = getComputedStyle(element);
        return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '',
          rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right },
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          display: c.display, position: c.position, minWidth: c.minWidth, width: c.width,
          gridTemplateColumns: c.gridTemplateColumns, flexShrink: c.flexShrink,
          whiteSpace: c.whiteSpace, overflowX: c.overflowX, overflowY: c.overflowY };
      };
      const exceeding = [...document.body.querySelectorAll('*')].filter(element => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > innerWidth + 1;
      }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 30);
      return { viewportWidth: innerWidth, rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        exceeding: exceeding.map(element => {
          const ancestors = []; let current = element.parentElement;
          for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) ancestors.push(describe(current));
          return { element: describe(element), ancestors, boundedByScrollableAncestor: ancestors.some(row => ['auto', 'scroll', 'hidden', 'clip'].includes(row.overflowX) && row.rect.right <= innerWidth + 1) };
        }),
        iframes: [...document.querySelectorAll('iframe')].map(element => ({ title: element.title, rect: describe(element).rect, sourceOrigin: new URL(element.src, location.href).origin })),
      };
    });
    record.observations.qualification = 'Root width is distinct from an intentionally bounded table scroller. Record overflowing ancestors before attribution. External n8n/helper iframe requests are blocked by the isolated same-origin GET-only policy; only shell/pipeline geometry is measured.';
  });
} finally { await save(); await browser.close(); console.log(JSON.stringify({ output })); }
