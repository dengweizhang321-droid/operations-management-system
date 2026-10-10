// Real isolated Chrome + loopback fixture. No production URL, credentials or data.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { installRequestCompletionBarrier, waitForProductDetailReady } from './request-completion.mjs';
const { chromium } = await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/node_modules/playwright-core/index.mjs'));
const html = `<!doctype html><button id="open">详情</button><div id="detail"></div><script>
let controller;document.querySelector('#open').onclick=()=>{
 const root=document.querySelector('#detail');root.innerHTML='<div class="data-refresh-region" aria-busy="true"><button class="product-detail-back">返回</button></div>';
 const region=root.firstChild;controller=new AbortController();
 region.firstChild.onclick=()=>{controller.abort();root.innerHTML='';};
 fetch('/api/sales/summary?productCodes=SYNTHETIC&startDate=2026-01-01&endDate=2026-01-01&range=custom&mode='+new URL(location.href).searchParams.get('mode'),{signal:controller.signal})
 .then(async r=>{await r.json();if(!r.ok)throw Error('fixture status');region.setAttribute('aria-busy','false');region.insertAdjacentHTML('beforeend',new URL(location.href).searchParams.get('mode')==='domerror'?'<div role="alert">fixture invalid detail</div>':'<div class="product-detail-kpi-grid">synthetic complete</div>');})
 .catch(()=>{region.setAttribute('aria-busy','false');region.insertAdjacentHTML('beforeend','<div role="alert">fixture failure</div>');});
};</script>`;

test('request terminal and successful current DOM barriers with real isolated subprocess', async t => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname !== '/api/sales/summary') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
    res.writeHead(url.searchParams.get('mode') === 'httpfail' ? 500 : 200, { 'content-type': 'application/json' });
    res.write('{"synthetic":'); // Headers and part of the body precede actual completion.
    setTimeout(() => res.end('true}'), 300);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.notEqual(server.address().port, 3000);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking'] });
  async function scenario(mode, run, options = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const barrier = installRequestCompletionBarrier(context, { origin, ...options });
    try {
      const page = await context.newPage(); await page.goto(origin + '/?mode=' + mode); await page.waitForLoadState('networkidle');
      await run(page, barrier);
    } finally { await context.close(); }
  }
  const exactRead = { pathname: '/api/sales/summary', requiredQueryKeys: ['productCodes', 'startDate', 'endDate', 'range'] };
  try {
    await t.test('slow body must finish before Back; old networkidle does not release the barrier', () => scenario('ok', async (page, barrier) => {
      const start = performance.now();
      const receipt = await barrier.runAndWaitForRead(() => page.locator('#open').click(), exactRead);
      assert.ok(performance.now() - start >= 280, 'Response headers did not prove body completion');
      assert.equal(receipt.terminal, 'finished'); await waitForProductDetailReady(page); await barrier.waitForIdle();
      await page.locator('.product-detail-back').click(); assert.equal(await page.locator('.product-detail-back').count(), 0);
    }));
    await t.test('current inflight GET blocks navigation even when page already had networkidle', () => scenario('ok', async (page, barrier) => {
      await page.locator('#open').click(); const start = performance.now(); await barrier.waitForIdle();
      assert.ok(performance.now() - start >= 250); await waitForProductDetailReady(page);
    }));
    await t.test('HTTP error cannot become successful detail', () => scenario('httpfail', async (page, barrier) => {
      await assert.rejects(barrier.runAndWaitForRead(() => page.locator('#open').click(), exactRead), /returned an error/);
    }));
    await t.test('legitimate Back cancellation still fails selected-read acceptance', () => scenario('ok', async (page, barrier) => {
      await assert.rejects(barrier.runAndWaitForRead(async () => { await page.locator('#open').click(); await page.locator('.product-detail-back').click(); }, exactRead), /selected current read failed/);
    }));
    await t.test('200 plus error DOM still fails', () => scenario('domerror', async (page, barrier) => {
      await barrier.runAndWaitForRead(() => page.locator('#open').click(), exactRead);
      await assert.rejects(waitForProductDetailReady(page), /complete and free of errors/);
    }));
    await t.test('no request is bounded failure, not empty success', () => scenario('ok', async (_page, barrier) => {
      await assert.rejects(barrier.runAndWaitForRead(async () => {}, exactRead), /deadline exceeded/);
    }, { timeoutMs: 80, quietMs: 5 }));
    await t.test('previous completed request cannot satisfy a new action', () => scenario('ok', async (page, barrier) => {
      await barrier.runAndWaitForRead(() => page.locator('#open').click(), exactRead);
      await assert.rejects(barrier.runAndWaitForRead(async () => {}, exactRead), /deadline exceeded/);
    }, { timeoutMs: 700, quietMs: 5 }));
    await t.test('different query cannot satisfy exact product detail', () => scenario('ok', async (page, barrier) => {
      await assert.rejects(barrier.runAndWaitForRead(() => page.locator('#open').click(), { ...exactRead, requiredQueryKeys: ['missingExactKey'] }), /deadline exceeded/);
    }, { timeoutMs: 700, quietMs: 5 }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
