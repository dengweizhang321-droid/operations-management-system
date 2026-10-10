import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { retryReadOnlyObservation, observationError, assertCompleteReadiness, safeObservationError, isExactStatusOperation, runReadOnlyProcess, readinessComponents } from '../tools/release-readonly-retry.mjs';
import { requestPolicy, installUiRequestAudit, exerciseCustomerImportUi } from '../tools/release-acceptance-ui.mjs';
import { closeoutAccounting, generateCloseoutDraft, readOriginalJournal, renderCloseoutDraft } from '../tools/release-closeout-report.mjs';
import { canonical, hash } from '../tools/release-impact.mjs';
import { validateOperation } from '../tools/release-batch.mjs';

const policy = requestPolicy({ origin: 'http://127.0.0.1:3000', resources: { '/favicon.svg': 'a'.repeat(64), '/assets/exact.js': 'b'.repeat(64) }, readPaths: ['/api/customer-service/conversations'] });
const req = (url, method = 'GET', resourceType = 'other') => policy({ url, method, resourceType });
test('exact HTTPS loopback icon is blocked and classified', () => {
  assert.deepEqual(req('https://127.0.0.1:3000/favicon.svg'), { action: 'abort', kind: 'blocked-nonbusiness-icon' });
  assert.equal(req('http://127.0.0.1:3000/favicon.svg').kind, 'candidate-static');
});
for (const [url, method, resourceType] of [
  ['https://127.0.0.1:3000/assets/exact.js', 'GET', 'script'], ['https://127.0.0.1:3000/favicon.svg', 'POST', 'other'],
  ['https://other.invalid/favicon.svg', 'GET', 'image'], ['https://127.0.0.1:3001/favicon.svg', 'GET', 'other'],
  ['https://localhost:3000/favicon.svg', 'GET', 'other'], ['https://127.0.0.1:3000/favicon.svg?x=1', 'GET', 'other'],
  ['https://127.0.0.1:3000/favicon.svg', 'GET', 'fetch'], ['http://127.0.0.1:3000/api/import', 'GET', 'fetch'],
  ['http://127.0.0.1:3000/assets/unapproved.js', 'GET', 'script'], ['http://127.0.0.1:3000/api/customer-service/conversations', 'DELETE', 'fetch']
]) test(`dangerous or unapproved request remains blocked: ${method} ${url} ${resourceType}`, () => {
  const result = req(url, method, resourceType); assert.equal(result.action, 'abort'); assert.notEqual(result.kind, 'blocked-nonbusiness-icon');
});
test('normal candidate resource and exact reviewed business read stay allowed', () => {
  assert.equal(req('http://127.0.0.1:3000/assets/exact.js').action, 'continue');
  assert.equal(req('http://127.0.0.1:3000/api/customer-service/conversations?page=2').action, 'continue');
});
test('blocked favicon needs HTTP bytes; mismatched normal asset never passes', async () => {
  const handlers = {}; let routeHandler;
  const context = { route: async (_, handler) => { routeHandler = handler; }, on: (name, handler) => { handlers[name] = handler; },
    request: { get: async () => ({ status: () => 200, body: async () => Buffer.from('wrong-icon') }) } };
  const audit = await installUiRequestAudit(context, { origin: 'http://127.0.0.1:3000', resources: { '/favicon.svg': 'a'.repeat(64) } });
  await routeHandler({ request: () => ({ url: () => 'https://127.0.0.1:3000/favicon.svg', method: () => 'GET', resourceType: () => 'other' }), abort: async () => {} });
  assert.equal((await audit.finish()).status, 'failed');
});
test('real source four-shop component UI, read-only network, candidate SHA and viewer permission on isolated HTTP', { timeout: 60_000 }, async () => {
  const bundle = await build({ stdin: { contents: `import {createRoot} from 'react-dom/client';
    import Card from './app/customer-service-import-card';
    import {jdCustomerServiceStores} from './lib/jd/customer-service-stores';
    window.fixtureShops=jdCustomerServiceStores.map(store=>store.shopName);
    createRoot(document.getElementById('root')).render(<Card canImport={!location.search.includes('deny=1')} onCompleted={async()=>{throw new Error('unexpected import')}}/>);`,
    loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const styles = await build({ entryPoints: [fileURLToPath(new URL('../app/globals.css', import.meta.url))],
    alias: { tailwindcss: fileURLToPath(new URL('../node_modules/tailwindcss/index.css', import.meta.url)) }, bundle: true, write: false, logLevel: 'silent' });
  const script = bundle.outputFiles[0].text, css = Buffer.from(styles.outputFiles[0].contents), icon = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  let origin, writes = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { writes++; response.writeHead(405); response.end(); return; }
    const url = new URL(request.url, origin);
    if (url.pathname === '/assets/card.js') { response.setHeader('content-type', 'text/javascript'); response.end(script); }
    else if (url.pathname === '/assets/style.css') { response.setHeader('content-type', 'text/css'); response.end(css); }
    else if (url.pathname === '/favicon.svg') { response.setHeader('content-type', 'image/svg+xml'); response.end(icon); }
    else { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(`<link rel="stylesheet" href="/assets/style.css"><link rel="icon" href="${origin.replace('http:', 'https:')}/favicon.svg"><div id="root"></div><p>会话店铺筛选</p><script src="/assets/card.js"></script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const audit = await installUiRequestAudit(context, { origin, resources: { '/assets/card.js': hash(script), '/assets/style.css': hash(css), '/favicon.svg': hash(icon) } });
    const page = await context.newPage(); await page.goto(origin);
    const shops = await page.evaluate(() => window.fixtureShops);
    await exerciseCustomerImportUi(page, { origin, shops, from: '2026-10-01', to: '2026-10-07' });
    await page.goto(origin + '/?deny=1');
    assert.equal(await page.getByRole('button', { name: '客服导入店铺', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '仅管理员可导入', exact: true }).isDisabled(), true);
    const result = await audit.finish(); assert.equal(result.status, 'passed', JSON.stringify(result)); assert.equal(writes, 0);
    assert.ok(result.resourceEvidence.length >= 3);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
test('classified temporary reads retry at most four total; attempt time includes 53s queries', async () => {
  let clock = 0, calls = 0; const waits = [], records = [];
  const result = await retryReadOnlyObservation({ stage: 'closeout-status', now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, onAttempt: async item => records.push(item),
    query: async () => { clock += 53_000; if (++calls < 4) throw observationError('STATUS_TIMEOUT'); return 'ready'; } });
  assert.equal(result.value, 'ready'); assert.equal(calls, 4); assert.deepEqual(waits, [2000, 2000, 2000]);
  assert.equal(result.elapsedMs, 218_000); assert.equal(records.length, 4);
});
test('exhausted transient error preserves all four attempts', async () => {
  let clock = 0, calls = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-admission-status', now: () => clock, sleep: async ms => { clock += ms; }, query: async () => { calls++; throw observationError('ECONNRESET'); } }), error => error.observationAttempts.length === 4);
  assert.equal(calls, 4);
});
for (const code of ['EACCES', 'EPERM', 'STATUS_IDENTITY_MISMATCH', 'ASSERTION_FAILED', 'INVALID_STATUS_JSON', 'STATUS_NOT_READY', 'PROCESS_FAILED']) test(`terminal status failure never retries: ${code}`, async () => {
  let calls = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', query: async () => { calls++; throw observationError(code); } }), error => error.code === code && error.observationAttempts.length === 1);
  assert.equal(calls, 1);
});
test('unknown errors with timeout-looking sensitive text are terminal and redacted', async () => {
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', query: async () => { throw new Error('timeout token=secret customer=private'); } }), error => {
    assert.equal(error.observationAttempts.length, 1); assert.ok(!JSON.stringify(error.observationAttempts).includes('secret')); return true;
  });
  assert.equal(safeObservationError(new Error('ETIMEDOUT')).retryable, false);
});
test('one total deadline bounds slow successful queries and prevents another attempt', async () => {
  let clock = 0, calls = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', totalTimeoutMs: 1000, now: () => clock, query: async () => { clock = 1001; calls++; return {}; } }), error => error.code === 'DEADLINE_EXCEEDED');
  assert.equal(calls, 1);
});
test('retry waits consume the same budget', async () => {
  let clock = 0, calls = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', totalTimeoutMs: 3000, now: () => clock, sleep: async ms => { clock += ms; }, query: async () => { clock += 1100; calls++; throw observationError('STATUS_TIMEOUT'); } }), error => error.code === 'DEADLINE_EXCEEDED');
  assert.equal(calls, 1);
});
test('complete readiness requires exact identity and all twelve components', () => {
  const good = { state: 'Running', backendState: 'Ready', workerState: 'exact_release', releaseId: 'approved', components: Object.fromEntries(readinessComponents.map(name => [name, true])) };
  assertCompleteReadiness(good, 'approved');
  assert.throws(() => assertCompleteReadiness({ ...good, releaseId: 'other' }, 'approved'), /STATUS_IDENTITY_MISMATCH/);
  assert.throws(() => assertCompleteReadiness({ ...good, components: { a: true } }, 'approved'), /STATUS_NOT_READY/);
});
test('retry declaration cannot target Start, backup, apply, generic GET or script flags', () => {
  const good = { id: 'final-status', kind: 'command', phase: 'closeout', mutating: false, command: { executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile','-NonInteractive','-File','D:\\运营管理系统\\tools\\operations-system-control.ps1','-Action','Status','-Json'] },
    assertions:[{path:'state',equals:'Running'},{path:'backendState',equals:'Ready'},{path:'workerState',equals:'exact_release'},{path:'releaseId',equals:'approved'}],
    readOnlyRetry: { version: 'teruisi-status-retry-v1', totalTimeoutMs: 240000 } };
  validateOperation(good); assert.ok(isExactStatusOperation(good));
  for (const changed of [{ ...good, mutating: true }, { ...good, kind: 'worker-apply' }, { ...good, command: { ...good.command, args: [...good.command.args, '-Execute'] } }, { ...good, command: { ...good.command, args: good.command.args.map(value => value === 'Status' ? 'Start' : value) } }]) assert.throws(() => validateOperation(changed), /Retry/);
});
test('bounded native read-only runner covers inherited output EOF', async () => {
  const began = performance.now();
  await assert.rejects(runReadOnlyProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 100 }), /STATUS_TIMEOUT/);
  assert.ok(performance.now() - began < 1500);
  assert.equal((await runReadOnlyProcess(process.execPath, ['-e', 'console.log("ok")'], { timeoutMs: 3000 })).stdout.trim(), 'ok');
});
const at = ms => new Date(Date.UTC(2026,9,9) + ms).toISOString();
test('timing unions overlaps, excludes nested retries, keeps coordination and document completion separate', () => {
  const result = closeoutAccounting([{ at: at(0), status: 'approved', phase: 'queue' },
    { at: at(1000), status: 'started', phase: 'closeout', operationId: 'final' },
    { at: at(2000), status: 'unknown', phase: 'closeout', operationId: 'final', durationMs: 1000 },
    { at: at(1800), status: 'observation-attempt', phase: 'closeout', durationMs: 800 },
    { at: at(2500), status: 'admission', phase: 'closeout', durationMs: 1500 },
    { at: at(4000), status: 'passed', phase: 'closeout', operationId: 'final', reason: 'independently-reconciled' },
    { at: at(6000), status: 'completed', phase: 'closeout' }], at(8000));
  assert.equal(result.executionCoveredMs, 1500); assert.equal(result.waitingOrUninstrumentedMs, 4500);
  assert.equal(result.documentCloseoutMs, 2000); assert.equal(result.approvedToDeliveryMs, 8000);
  assert.equal(result.reconciliations[0].startedToResolutionMs, 3000);
});
test('uncompleted batch never gets approval-to-complete or successful conclusion', () => {
  const result = closeoutAccounting([{ at: at(0), status: 'approved' }, { at: at(1000), status: 'unknown' }]);
  assert.equal(result.approvedToCompleteMs, null);
});
test('offline report validates immutable journal, preserves unknown history and fails closed when steps missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teruisi-report-'));
  try {
    const core = { id: 'synthetic-batch', binding: {}, operations: [{ id: 'final', phase: 'closeout', kind: 'command', mutating: false }] }, batch = { ...core, batchSha256: hash(core) };
    const batchPath = path.join(root, 'batch.json'); await writeFile(batchPath, JSON.stringify(batch));
    const dir = path.join(root, 'journal'); await mkdir(dir); let previous = null;
    const records = [{ at: at(0), phase: 'queue', status: 'approved' }, { at: at(1000), phase: 'closeout', status: 'started', operationId: 'final' }, { at: at(2000), phase: 'closeout', status: 'unknown', operationId: 'final', reason: 'secret=customer' }];
    for (const [i, record] of records.entries()) { const value = { ...record, batchSha256: batch.batchSha256, previous }; const event = { ...value, eventSha256: hash(value) }; previous = event.eventSha256; await writeFile(path.join(dir, `${String(i).padStart(6,'0')}.json`), canonical(event) + '\n'); }
    const report = await generateCloseoutDraft({ batchPath, approvedSha256: batch.batchSha256, journalDirectory: dir });
    assert.equal(report.status, 'release-incomplete'); assert.equal(report.acceptancePassed, null); assert.deepEqual(report.unresolved, ['final']);
    assert.ok(!renderCloseoutDraft(report).includes('secret=customer')); assert.equal(report.failures.length, 1);
    const before = await readFile(path.join(dir, '000002.json')); await writeFile(path.join(dir, '000002.json'), before.toString().replace('unknown', 'passed'));
    await assert.rejects(readOriginalJournal(dir, batch.batchSha256), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('domain history synthetic isolation regressions', () => {
  const result = spawnSync('python', [fileURLToPath(new URL('./release-history-preservation.test.py', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /Ran 12 tests/);
});
test('independent domain history regressions with original source receipt bytes', () => {
  const result = spawnSync('python', [fileURLToPath(new URL('./release-closeout-independent.test.py', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
});
