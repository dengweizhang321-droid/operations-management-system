// Audit of the actual Home and shared controls. Never connects to production.
// Run serially: AUDIT_PREVIEW_URL=http://127.0.0.1:3781 node <this file>
// Each case writes its observations even when another case fails. No mutation APIs.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.AUDIT_PREVIEW_URL || 'http://127.0.0.1:3781';
if (!/^http:\/\/127\.0\.0\.1:3[1-8]\d\d$/.test(origin)) throw new Error('Isolated preview loopback only');
const selectedCases = (process.env.AUDIT_CASES || '').split(',').map(value => value.trim()).filter(Boolean);
const selected = name => selectedCases.length === 0 || selectedCases.some(value => name === value
  || (value === 'search' && name.startsWith('global-search-')) || (value === 'ai' && name.startsWith('ai-')));
const output = path.resolve(process.env.AUDIT_OUTPUT || `.runtime/public-interaction-audit-${Date.now()}`);
await mkdir(output, { recursive: true });
const started = new Date().toISOString(), groups = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const save = async () => writeFile(path.join(output, 'result.json'), JSON.stringify({ started, source: 'actual app/page.tsx in isolated preview', origin, syntheticSearchOnly: true, nativeWindowsImeVerified: false, groups }, null, 2));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function searchFixture(query) {
  return { query, page: 1, returned: 1, truncated: false, unavailableDomains: [], groups: [{
    key: 'products', label: '商品', icon: '品', module: 'product', available: true, page: 1,
    total: 1, totalExact: true, hasMore: false, items: [{ kind: 'products', id: `fixture-${query}`,
      title: `仅属于${query}`, subtitle: '隔离审查合成结果', detail: '', updatedAt: '', amountCents: null,
      module: 'product', target: { module: 'product', view: 'overview', entity: { kind: 'product', id: 'AUDIT-FIXTURE' } },
    }],
  }] };
}

async function caseRun(name, fn, options = {}) {
  if (!selected(name)) return;
  const group = { name, started: new Date().toISOString(), status: 'running', requests: [], responses: [], pageErrors: [], observations: {} };
  groups.push(group);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000); page.setDefaultNavigationTimeout(20000);
  const clock = () => Math.round(performance.now());
  page.on('request', request => {
    if (request.url().includes('/api/')) group.requests.push({ at: clock(), method: request.method(), url: request.url() });
  });
  page.on('response', response => {
    if (response.url().includes('/api/')) group.responses.push({ at: clock(), url: response.url(), status: response.status() });
  });
  page.on('pageerror', error => group.pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') return route.abort('blockedbyclient');
    if (options.searchDelay && url.pathname === '/api/search') {
      const query = url.searchParams.get('q') || '';
      await wait(options.searchDelay(query));
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(searchFixture(query)) }); }
      catch (error) { group.responses.push({ at: clock(), url: request.url(), fixtureFulfillmentError: error.message }); }
      return;
    }
    if (options.intercept && await options.intercept(route, group)) return;
    return route.continue();
  });
  try {
    await fn(page, group);
    group.status = 'observed';
  } catch (error) {
    group.status = 'probe_incomplete'; group.error = error.stack || error.message;
  } finally {
    group.finished = new Date().toISOString();
    try { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); } catch {}
    await save();
    await context.close();
    console.log(JSON.stringify({ name, status: group.status, observations: group.observations, error: group.error }));
  }
}

const headerState = page => page.evaluate(() => ({
  url: location.href,
  title: document.querySelector('.title-area')?.textContent?.trim(),
  periodButton: document.querySelector('.date-selector .searchable-select-trigger')?.textContent?.trim(),
  periodTitle: document.querySelector('.date-selector')?.getAttribute('title'),
  pickerOpen: Boolean(document.querySelector('.stat-period-picker')),
}));
const searchState = page => page.evaluate(() => ({
  input: document.querySelector('input[aria-label="搜索系统全部已接入数据"]')?.value,
  busy: document.querySelector('.search-results')?.getAttribute('aria-busy'),
  states: [...document.querySelectorAll('.search-state')].map(el => el.textContent?.trim()),
  results: [...document.querySelectorAll('.search-result-item')].map(el => ({ text: el.textContent?.trim(), disabled: el.disabled })),
}));
async function openSearch(page, group) {
  await page.getByRole('button', { name: '统计周期', exact: true }).waitFor();
  // Literal selector matches the real controlled input, independent of role mapping.
  const search = page.locator('#global-search-dialog input[aria-label="搜索系统全部已接入数据"]');
  await page.keyboard.press('Control+k');
  group.observations.openMethod = 'Playwright Control+k';
  try { await search.waitFor({ state: 'visible', timeout: 1500 }); }
  catch {
    // Replay the same documented shell shortcut through the actual keydown handler.
    // This is idempotent: the handler sets searchOpen=true, never toggles it.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })));
    group.observations.openMethod = 'Control+k followed by DOM keydown on actual shell handler';
    await search.waitFor({ state: 'visible', timeout: 6000 });
  }
  return search;
}
async function waitForRecordedSearch(group, query) {
  const until = performance.now() + 6000;
  while (performance.now() < until) {
    if (group.requests.some(request => new URL(request.url).pathname === '/api/search' && new URL(request.url).searchParams.get('q') === query)) return;
    await wait(30);
  }
  // Unlike a pending waitForRequest promise, this rejection is immediately awaited
  // inside caseRun and cannot terminate subsequent audit cases.
  throw new Error(`No recorded /api/search request for ${query} within 6000 ms`);
}

try {
  await caseRun('custom-date-cancel', async (page, group) => {
    await page.goto(origin + '/?module=sales');
    await page.getByRole('button', { name: '统计周期', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    group.observations.before = await headerState(page);
    const mark = group.requests.length;
    await page.getByRole('button', { name: '统计周期', exact: true }).click();
    await page.getByRole('listbox', { name: '统计周期选项', exact: true }).getByRole('option', { name: '自定义', exact: true }).click();
    await page.locator('.stat-period-picker').waitFor();
    await page.waitForTimeout(450);
    group.observations.openedBeforeConfirm = await headerState(page);
    group.observations.requestsBeforeConfirm = group.requests.slice(mark);
    await page.locator('.stat-period-picker').getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(350);
    group.observations.afterCancel = await headerState(page);
    await page.reload();
    await page.getByRole('button', { name: '统计周期', exact: true }).waitFor();
    await page.waitForTimeout(450);
    group.observations.afterReload = await headerState(page);
    const o = group.observations;
    o.conditionChangedBeforeConfirm = o.before.periodTitle !== o.openedBeforeConfirm.periodTitle;
    o.cancelDidNotRestore = o.before.periodTitle !== o.afterCancel.periodTitle || o.before.periodButton !== o.afterCancel.periodButton;
    o.reloadDiffersFromCanceledState = o.afterReload.periodTitle !== o.afterCancel.periodTitle || o.afterReload.periodButton !== o.afterCancel.periodButton;
  });

  await caseRun('single-select-ime-enter', async (page, group) => {
    await page.goto(origin + '/?module=inventory&view=plan');
    const trigger = page.getByRole('button', { name: '备货计划状态', exact: true });
    await trigger.waitFor(); await trigger.click();
    const search = page.getByRole('searchbox', { name: '搜索备货计划状态', exact: true });
    await search.fill('待确认');
    group.observations.before = { url: page.url(), trigger: await trigger.innerText(), options: await page.getByRole('listbox', { name: '备货计划状态选项', exact: true }).getByRole('option').allTextContents() };
    const mark = group.requests.length;
    await search.dispatchEvent('compositionstart');
    await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true, bubbles: true, cancelable: true });
    group.observations.immediate = { url: page.url(), trigger: await trigger.innerText(), menuOpen: await page.getByRole('listbox', { name: '备货计划状态选项', exact: true }).count() > 0 };
    // End capture on its still-mounted owner even when the search field was removed.
    await page.locator('.inventory-shared-filter-panel').dispatchEvent('compositionend', { data: '待确认', bubbles: true });
    await page.waitForTimeout(850);
    group.observations.afterComposition = { url: page.url(), trigger: await trigger.innerText(), requests: group.requests.slice(mark) };
    group.observations.selectionChangedOnCompositionEnter = group.observations.before.trigger !== group.observations.immediate.trigger;
  });

  await caseRun('global-search-return-to-pending-query', async (page, group) => {
    await page.goto(origin + '/?module=import');
    const search = await openSearch(page, group);
    await search.fill('审查A'); await waitForRecordedSearch(group, '审查A');
    group.observations.beforeEdit = await searchState(page);
    const editStarted = clockForAudit();
    await search.fill('审查AB'); await search.fill('审查A');
    group.observations.editRoundTripMs = clockForAudit() - editStarted;
    await page.waitForTimeout(1900);
    group.observations.afterOriginalWouldHaveCompleted = await searchState(page);
    group.observations.searchRequests = group.requests.filter(request => new URL(request.url).pathname === '/api/search');
    group.observations.busyWithoutReplacementRequest = group.observations.afterOriginalWouldHaveCompleted.busy === 'true' && group.observations.searchRequests.length === 1;
  }, { searchDelay: () => 1200 });

  await caseRun('global-search-old-result-label', async (page, group) => {
    await page.goto(origin + '/?module=import');
    const search = await openSearch(page, group);
    await search.fill('审查A'); await page.getByText('仅属于审查A', { exact: true }).waitFor();
    group.observations.successA = await searchState(page);
    await search.fill('审查B'); await page.waitForTimeout(350);
    group.observations.pendingB = await searchState(page);
    await page.getByText('仅属于审查B', { exact: true }).waitFor();
    group.observations.successB = await searchState(page);
    group.observations.qualification = 'Old buttons are disabled while loading; this case must not be reported as an old-row-click defect.';
  }, { searchDelay: query => query === '审查B' ? 1200 : 30 });

  if (process.env.AUDIT_AI_CHUNK === '1' || selectedCases.some(value => value === 'ai' || value === 'ai-memory-chunk-retry')) {
    let failedOnce = false;
    await caseRun('ai-memory-chunk-retry', async (page, group) => {
      await page.goto(origin + '/?module=ai&view=memory');
      const retry = page.getByRole('button', { name: '重试当前模块', exact: true });
      await retry.waitFor(); group.observations.failureBeforeRetry = await retry.count();
      await retry.click(); await page.waitForTimeout(1300);
      group.observations.failureAfterRetry = await retry.count();
      group.observations.qualification = 'Vite module-loading behavior only; this does not prove immutable Worker chunk behavior.';
    }, { intercept: async route => {
      if (!failedOnce && /\/app\/ai-memory-view\.tsx(?:\?|$)/.test(new URL(route.request().url()).pathname)) {
        failedOnce = true; await route.abort('failed'); return true;
      }
      return false;
    } });
  }
} finally {
  await save(); await browser.close(); console.log(JSON.stringify({ output, groups: groups.map(group => ({ name: group.name, status: group.status })) }));
}
function clockForAudit() { return Math.round(performance.now()); }
