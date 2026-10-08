// Real app/page.tsx + source components/CSS on the existing isolated Vite server.
// Every API response is synthetic. This file neither starts a service nor writes business data.
// Run sequentially with other probes: node docs/performance-experience-audit-20261008/tools/customer-backup-probe.mjs
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.CUSTOMER_BACKUP_PREVIEW_URL || 'http://127.0.0.1:3781';
if (origin !== 'http://127.0.0.1:3781') throw new Error('Only the existing isolated 127.0.0.1:3781 preview is permitted');
const output = path.resolve(process.env.CUSTOMER_BACKUP_PROBE_OUTPUT || `docs/performance-experience-audit-20261008/evidence/customer-backup-${Date.now()}`);
await mkdir(output, { recursive: true });
const sourceSha = 'a37b5ffdbe9e6705cf4daa9545231e93b4378c5d';
const report = { sourceSha, origin, syntheticOnly: true, realAppAndCss: true, startedAt: new Date().toISOString(), viewport: { width: 1440, height: 1000 }, notes: ['No production requests. API fixtures explicitly exercise UI behavior only.', 'Raw samples, no P95 claim. Browser timing excludes SQL/Worker/backend measurements.', 'IME is Chromium CDP composition, not native Windows candidate-window acceptance.'], cases: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = () => writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));

function conversation(id, shopName) {
  return {
    id, shopName, consultedAt: '2026-10-07 10:00:00', customerId: `SYNTHETIC-CUSTOMER-${id}`, customerAlias: `SYNTHETIC-${id}`,
    consultationType: '商品咨询', agent: '合成客服', transferredAgent: '', skillGroup: '合成组', productSku: `SYNTHETIC-SKU-${id}`,
    matchedSkuId: `SYNTHETIC-SKU-${id}`, productSpuId: `SYNTHETIC-SPU-${id}`, erpProductCode: `SYNTHETIC-ERP-${id}`,
    productCategory: '合成类目', productName: `合成商品-${id}`, firstResponseAt: '', responseSeconds: 2, durationMinutes: 3,
    customerMessageCount: 1, agentMessageCount: 1, satisfaction: '', resolved: '', conversationId: `synthetic-${id}`,
    matchStatus: 'matched', matchConfidence: 'exact', chatStartedAt: '', chatEndedAt: '', chatCustomerAlias: '',
    messages: [{ sender: '合成客服', sentAt: '2026-10-07 10:00:00', content: '合成审查夹具，没有真实客户信息。' }],
    messageTotalCount: 1, messageReturnedCount: 1, messagesTruncated: false, robotScope: '', problemType: '', conversionStatus: '',
    serviceIssues: '', summaryText: '', analysisSource: '', analyzedAt: null, annotatedAt: null, version: 1, updatedAt: '2026-10-07T02:00:00Z',
  };
}
const A = conversation(101, '合成店A');
const B = conversation(202, '合成店B');
const backups = {
  enabled: true, items: [{ backupId: 'SYNTHETIC-BACKUP-ONLY', completedAt: '2026-10-07T00:00:00Z', sizeBytes: 1024, manifestSha256: 'a'.repeat(64), protected: true }],
  jobs: [], uploads: [], invalidBackupIds: [], uploadChunkBytes: 65536, maximumArchiveBytes: 1024 * 1024,
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function runCase(name, action) {
  const context = await browser.newContext({ viewport: report.viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.setDefaultNavigationTimeout(15000);
  const started = Date.now();
  const record = { name, startedAt: new Date().toISOString(), syntheticOnly: true, status: 'running', requests: [], pageErrors: [], routeErrors: [], observations: [], screenshots: [] };
  report.cases.push(record);
  const controls = { listDelayMs: 0, listFailure: false, backupDelayMs: 0, backupFailFirst: false };
  let backupOrdinal = 0;
  const requestIds = new Map();
  page.on('pageerror', error => record.pageErrors.push(error.message));
  page.on('request', request => {
    if (!request.url().includes('/api/')) return;
    const entry = { id: record.requests.length + 1, atMs: Date.now() - started, method: request.method(), url: request.url() };
    record.requests.push(entry); requestIds.set(request, entry);
  });
  page.on('response', response => {
    const entry = requestIds.get(response.request());
    if (entry) { entry.responseAtMs = Date.now() - started; entry.status = response.status(); }
  });
  page.on('requestfinished', request => {
    const entry = requestIds.get(request); if (entry) entry.finishedAtMs = Date.now() - started;
  });
  page.on('requestfailed', request => {
    const entry = requestIds.get(request); if (entry) { entry.failedAtMs = Date.now() - started; entry.failure = request.failure()?.errorText; }
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (request.method() !== 'GET') {
      record.routeErrors.push({ atMs: Date.now() - started, blockedWrite: request.method(), path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload, status = 200, delay = 0;
    if (url.pathname === '/api/auth/me') payload = { user: { email: 'synthetic-audit@example.invalid', displayName: 'Synthetic audit', role: 'admin', roleLabel: '管理员', scopeRestricted: false } };
    else if (url.pathname === '/api/customer-service/analyze') payload = { configured: true };
    else if (url.pathname === '/api/customer-service/import-history') payload = { items: [] };
    else if (url.pathname === '/api/customer-service/conversations') {
      if (url.searchParams.has('id')) payload = { item: url.searchParams.get('id') === '202' ? B : A };
      else {
        delay = controls.listDelayMs;
        if (controls.listFailure) { status = 503; payload = { error: 'SYNTHETIC_LIST_FAILURE' }; }
        else {
          const row = url.searchParams.getAll('shopName').includes('合成店B') ? B : A;
          payload = { items: [row], agents: ['合成客服'], shops: ['合成店A', '合成店B'], categories: ['合成类目'], summary: { total: 1, matched: 1, sessionOnly: 0, chatOnly: 0 }, pagination: { page: Number(url.searchParams.get('page') || 1), pageSize: 30, total: 1, returned: 1, truncated: false } };
        }
      }
    } else if (url.pathname === '/api/access-control/backups') {
      backupOrdinal += 1; delay = controls.backupDelayMs;
      if (controls.backupFailFirst && backupOrdinal === 1) { status = 503; payload = { error: 'SYNTHETIC_BACKUP_FIRST_FAILURE' }; }
      else payload = backups;
    } else { status = 501; payload = { error: 'Synthetic probe has no fixture for this API', path: url.pathname }; }
    const body = JSON.stringify(payload);
    const entry = requestIds.get(request);
    if (entry) { entry.fixture = true; entry.fixtureBytes = Buffer.byteLength(body); entry.injectedDelayMs = delay; }
    if (delay) await wait(delay);
    try { await route.fulfill({ status, contentType: 'application/json; charset=utf-8', body }); }
    catch (error) { record.routeErrors.push({ atMs: Date.now() - started, path: url.pathname, message: error.message, possiblyCancelledFixture: true }); }
  });
  const screenshot = async label => {
    const file = `${name}-${label}.png`;
    try { await page.screenshot({ path: path.join(output, file), fullPage: true }); record.screenshots.push(file); }
    catch (error) { record.observations.push({ screenshotFailure: label, error: error.message }); }
  };
  const observe = (label, value) => record.observations.push({ label, atMs: Date.now() - started, ...value });
  const snapshot = async label => observe(label, await page.evaluate(() => {
    const table = document.querySelector('.customer-service-table-panel');
    const backups = document.querySelector('.settings-backups');
    return {
      url: location.href, activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
      customerBusy: table?.getAttribute('aria-busy'), customerRows: [...(table?.querySelectorAll('tbody tr') || [])].map(row => row.textContent),
      rowButtons: [...(table?.querySelectorAll('button') || [])].map(button => ({ text: button.textContent, aria: button.getAttribute('aria-label'), disabled: button.disabled, inertAncestor: !!button.closest('[inert]') })),
      alerts: [...document.querySelectorAll('[role=alert]')].map(el => el.textContent),
      retainedLabels: [...document.querySelectorAll('[data-retained-read=true]')].map(el => el.textContent?.slice(0, 200)),
      backupRows: [...(backups?.querySelectorAll('tbody tr') || [])].map(row => row.textContent),
      backupText: backups?.textContent,
    };
  }));
  const openCustomer = async () => {
    await page.goto(`${origin}/?module=customer_service`, { waitUntil: 'domcontentloaded' });
    await page.locator('.customer-service-table-panel tbody').getByText('SYNTHETIC-CUSTOMER-101', { exact: true }).waitFor();
    await page.waitForTimeout(100);
  };
  const selectB = async () => {
    await page.getByRole('button', { name: '客服店铺筛选', exact: true }).click();
    await page.getByRole('listbox', { name: '客服店铺筛选选项', exact: true }).getByRole('option', { name: '合成店B', exact: true }).click();
  };
  const sku = () => page.locator('.customer-service-id-search').filter({ hasText: 'SKU ID' }).locator('input');
  try {
    await action({ page, context, record, controls, observe, screenshot, snapshot, openCustomer, selectB, sku });
    record.status = 'observed';
  } catch (error) {
    record.status = 'probe_failed'; record.error = { name: error.name, message: error.message, stack: error.stack };
    await screenshot('probe-failure');
  } finally {
    record.completedAt = new Date().toISOString(); record.elapsedMs = Date.now() - started;
    await save(); await context.close();
    console.log(JSON.stringify({ name, status: record.status, elapsedMs: record.elapsedMs, requests: record.requests.length, error: record.error?.message }));
  }
}

try {
  await runCase('customer-text-no-enter', async ({ page, record, observe, screenshot, openCustomer, sku }) => {
    await openCustomer(); const mark = record.requests.length;
    await sku().fill('SYNTHETIC-UNCONFIRMED'); await page.waitForTimeout(800);
    observe('typed_without_enter_800ms', { value: await sku().inputValue(), newRequests: record.requests.slice(mark) });
    const enterMark = record.requests.length; await sku().press('Enter'); await page.waitForTimeout(500);
    observe('explicit_enter_after_pause', { newRequests: record.requests.slice(enterMark) });
    await screenshot('after-unconfirmed-text');
  });
  await runCase('customer-ime', async ({ page, context, record, observe, screenshot, openCustomer, sku }) => {
    await openCustomer(); await sku().click();
    const session = await context.newCDPSession(page); const mark = record.requests.length;
    await session.send('Input.imeSetComposition', { text: '商用', selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(800);
    observe('during_composition_800ms', { value: await sku().inputValue(), newRequests: record.requests.slice(mark), limitation: 'Chromium CDP, no native Windows IME candidate window' });
    const commitMark = record.requests.length;
    await session.send('Input.insertText', { text: '商用' });
    await sku().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true });
    await page.waitForTimeout(700);
    observe('composition_commit_enter229', { value: await sku().inputValue(), newRequests: record.requests.slice(commitMark) });
    await screenshot('composition'); await session.detach();
  });
  await runCase('customer-draft-dropdown', async ({ page, record, observe, screenshot, openCustomer, selectB, sku }) => {
    await openCustomer(); const mark = record.requests.length;
    await sku().fill('SYNTHETIC-DRAFT-KEEP'); await selectB(); await page.waitForTimeout(900);
    observe('dropdown_while_text_unconfirmed', { value: await sku().inputValue(), newRequests: record.requests.slice(mark), menuVisible: await page.getByRole('listbox', { name: '客服店铺筛选选项', exact: true }).isVisible() });
    await screenshot('dropdown-draft');
  });
  await runCase('customer-stale-pending', async ({ page, record, controls, observe, screenshot, snapshot, openCustomer, selectB }) => {
    await openCustomer(); controls.listDelayMs = 2500;
    const mark = record.requests.length; await selectB(); await page.waitForTimeout(400);
    await snapshot('new_shop_pending_400ms'); await screenshot('old-row-pending');
    const detail = page.locator('.customer-service-table-panel').getByRole('button', { name: '查看会话', exact: true });
    const enabled = await detail.isEnabled(); observe('old_detail_click_eligibility', { enabled });
    if (enabled) { await detail.click(); await page.getByRole('dialog').waitFor(); observe('old_detail_opened', { dialogText: await page.getByRole('dialog').innerText(), newRequests: record.requests.slice(mark) }); await screenshot('old-detail-opened'); }
    await page.waitForTimeout(2800); await snapshot('after_new_shop_response');
  });
  await runCase('customer-stale-failure', async ({ page, record, controls, observe, screenshot, snapshot, openCustomer, selectB }) => {
    await openCustomer(); controls.listDelayMs = 150; controls.listFailure = true;
    const mark = record.requests.length; await selectB(); await page.waitForTimeout(700);
    await snapshot('new_shop_failed'); await screenshot('old-row-after-failure');
    const detail = page.locator('.customer-service-table-panel').getByRole('button', { name: '查看会话', exact: true });
    const enabled = await detail.isEnabled(); observe('failed_scope_old_detail_eligibility', { enabled });
    if (enabled) { await detail.click(); await page.getByRole('dialog').waitFor(); observe('failed_scope_old_detail_opened', { dialogText: await page.getByRole('dialog').innerText(), newRequests: record.requests.slice(mark) }); await screenshot('old-detail-after-failure'); }
  });
  await runCase('backup-slow-six-seconds', async ({ page, controls, snapshot, screenshot }) => {
    controls.backupDelayMs = 6000;
    await page.goto(`${origin}/?module=settings&view=backups`, { waitUntil: 'domcontentloaded' });
    await page.locator('.settings-backups').waitFor();
    await page.waitForTimeout(16000);
    await snapshot('after_16s_with_6s_each_response'); await screenshot('six-second-responses');
  });
  await runCase('backup-error-recovery', async ({ page, controls, snapshot, screenshot }) => {
    controls.backupFailFirst = true;
    await page.goto(`${origin}/?module=settings&view=backups`, { waitUntil: 'domcontentloaded' });
    await page.locator('.settings-backups').waitFor(); await page.waitForTimeout(300);
    await snapshot('first_read_failed'); await page.waitForTimeout(5500);
    await snapshot('successful_poll_after_failure'); await screenshot('after-recovery');
  });
} finally {
  await browser.close(); report.completedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ output, cases: report.cases.map(item => ({ name: item.name, status: item.status })), syntheticOnly: true }));
}
