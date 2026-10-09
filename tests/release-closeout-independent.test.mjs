import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, hash } from '../tools/release-impact.mjs';
import { closeoutAccounting, generateCloseoutDraft, renderCloseoutDraft } from '../tools/release-closeout-report.mjs';
import { retryReadOnlyObservation, observationError, assertCompleteReadiness, runReadOnlyProcess } from '../tools/release-readonly-retry.mjs';
import { requestPolicy, installUiRequestAudit } from '../tools/release-acceptance-ui.mjs';

const at = ms => new Date(Date.UTC(2026, 9, 9) + ms).toISOString();
const h = value => value.repeat(64);
async function fixture(events, extras = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'teruisi-independent-closeout-'));
  const core = { id: 'independent-batch', binding: { artifactSha256: h('a') },
    operations: [{ id: 'final-status', phase: 'closeout', kind: 'command', mutating: false }] };
  const batch = { ...core, batchSha256: hash(core) };
  const batchPath = path.join(directory, 'batch.json'), journalDirectory = path.join(directory, 'journal');
  await writeFile(batchPath, canonical(batch)); await mkdir(journalDirectory);
  let previous = null;
  for (const [index, event] of events.entries()) {
    const value = { ...event, batchSha256: batch.batchSha256, previous };
    const record = { ...value, eventSha256: hash(value) }; previous = record.eventSha256;
    await writeFile(path.join(journalDirectory, `${String(index).padStart(6, '0')}.json`), canonical(record) + '\n');
  }
  return { directory, input: { batchPath, journalDirectory, approvedSha256: batch.batchSha256, ...extras },
    dispose: () => rm(directory, { recursive: true, force: true }) };
}

test('independent: completion interval cannot absorb work recorded after completion', () => {
  const result = closeoutAccounting([
    { at: at(0), phase: 'queue', status: 'approved' },
    { at: at(2000), phase: 'closeout', status: 'completed' },
    { at: at(4000), phase: 'prepare', status: 'admission-failed', durationMs: 1000 },
  ]);
  assert.equal(result.executionCoveredMs, 0);
  assert.equal(result.waitingOrUninstrumentedMs, 2000);
});

test('independent: receipt whitelist rejects or removes unexpected sensitive field types', async () => {
  const marker = 'SYNTHETIC-CUSTOMER-CONTENT';
  const value = { status: { customerText: marker }, backupId: ['SYNTHETIC-CUSTOMER-CONTENT'], privateBody: marker };
  const f = await fixture([
    { at: at(0), phase: 'queue', status: 'approved' },
    { at: at(1000), phase: 'closeout', status: 'passed', operationId: 'final-status', receiptSha256: hash(value) },
    { at: at(2000), phase: 'closeout', status: 'completed' },
  ]);
  try {
    const receiptPath = path.join(f.directory, 'receipt.json'), bytes = Buffer.from(canonical(value));
    await writeFile(receiptPath, bytes);
    let report;
    try { report = await generateCloseoutDraft({ ...f.input, receipts: [{ path: receiptPath, sha256: hash(bytes), operationId: 'final-status' }] }); }
    catch { return; } // Invalid original evidence may fail closed.
    assert.ok(!JSON.stringify(report).includes(marker));
    assert.ok(!renderCloseoutDraft(report).includes(marker));
  } finally { await f.dispose(); }
});

test('independent: incomplete batch timing remains uncompleted even with a stale closeout event', async () => {
  const f = await fixture([
    { at: at(0), phase: 'queue', status: 'approved' },
    { at: at(1000), phase: 'closeout', status: 'completed' },
    { at: at(2000), phase: 'closeout', status: 'unknown', operationId: 'final-status' },
  ]);
  try {
    const report = await generateCloseoutDraft(f.input);
    assert.equal(report.status, 'release-incomplete');
    assert.equal(report.timing.approvedToCompleteMs, null);
    assert.equal(report.timing.completedAt, null);
  } finally { await f.dispose(); }
});

test('independent: interrupted operation report preserves already fsynced attempt metadata', async () => {
  const observation = { stage: 'closeout-status', attempt: 1, at: at(1500), durationMs: 53000,
    status: 'failed', error: { code: 'STATUS_TIMEOUT', retryable: true } };
  const f = await fixture([
    { at: at(0), phase: 'queue', status: 'approved' },
    { at: at(1000), phase: 'closeout', status: 'started', operationId: 'final-status' },
    { at: at(2000), phase: 'closeout', status: 'observation-attempt', operationRef: 'final-status', observation },
  ]);
  try {
    const report = await generateCloseoutDraft(f.input), evidence = report.operations[0].evidence;
    assert.equal(report.status, 'release-incomplete');
    assert.ok(JSON.stringify(evidence).includes('STATUS_TIMEOUT'));
    assert.ok(JSON.stringify(evidence).includes('53000'));
    assert.ok(JSON.stringify(evidence).includes('closeout-status'));
  } finally { await f.dispose(); }
});

test('independent: source/version projection cannot retain sensitive nested release identifiers', async () => {
  const marker = 'SYNTHETIC-CUSTOMER-CONTENT';
  const f = await fixture([{ at: at(0), phase: 'queue', status: 'approved' }]);
  try {
    const bytes = Buffer.from(canonical({ sourceCommit: 'a'.repeat(40), candidateManifestSha256: h('a'),
      candidateReleaseId: { privateText: marker }, predecessorReleaseId: [marker] }));
    const versionPath = path.join(f.directory, 'versions.json'); await writeFile(versionPath, bytes);
    let report;
    try { report = await generateCloseoutDraft({ ...f.input, versionsEvidence: { path: versionPath, sha256: hash(bytes) } }); }
    catch { return; }
    assert.ok(!JSON.stringify(report).includes(marker));
  } finally { await f.dispose(); }
});

test('independent: independent runtime projection rejects sensitive nested identity fields', async () => {
  const marker = 'SYNTHETIC-CUSTOMER-CONTENT';
  const f = await fixture([{ at: at(0), phase: 'queue', status: 'approved' }]);
  try {
    const bytes = Buffer.from(canonical({ checkedAt: at(0), releaseId: { privateText: marker }, state: [marker], components: {} }));
    const runtimePath = path.join(f.directory, 'runtime.json'); await writeFile(runtimePath, bytes);
    let report;
    try { report = await generateCloseoutDraft({ ...f.input, runtimeEvidence: { path: runtimePath, sha256: hash(bytes) } }); }
    catch { return; }
    assert.ok(!JSON.stringify(report).includes(marker));
  } finally { await f.dispose(); }
});

test('independent: report can preserve valid failure states from the actual system Status contract', async () => {
  const f = await fixture([{ at: at(0), phase: 'queue', status: 'approved' }]);
  try {
    const bytes = Buffer.from(canonical({ checkedAt: at(0), state: 'StatusError', backendState: 'Error', workerState: 'status_error', components: {} }));
    const runtimePath = path.join(f.directory, 'runtime.json'); await writeFile(runtimePath, bytes);
    const report = await generateCloseoutDraft({ ...f.input, runtimeEvidence: { path: runtimePath, sha256: hash(bytes) } });
    assert.equal(report.status, 'release-incomplete');
    assert.equal(report.observedRuntime.state, 'StatusError'); assert.equal(report.observedRuntime.backendState, 'Error');
    assert.equal(report.observedRuntime.workerState, 'status_error'); assert.equal(report.acceptancePassed, null);
  } finally { await f.dispose(); }
});

test('independent: observation sidecar timestamp is validated before projecting evidence', async () => {
  const marker = 'SYNTHETIC-CUSTOMER-CONTENT';
  const f = await fixture([{ at: at(0), phase: 'queue', status: 'approved' }]);
  try {
    const value = { version: 'teruisi-status-attempt-v1', batchSha256: f.input.approvedSha256,
      observation: { stage: 'closeout-admission-status', attempt: 1, durationMs: 1000,
        status: 'failed', at: { privateText: marker }, error: { code: 'STATUS_TIMEOUT' } } };
    const bytes = Buffer.from(canonical(value)), observationPath = path.join(f.directory, 'observation.json');
    await writeFile(observationPath, bytes);
    let report;
    try { report = await generateCloseoutDraft({ ...f.input, observationReceipts: [{ path: observationPath, sha256: hash(bytes) }] }); }
    catch { return; }
    assert.ok(!JSON.stringify(report).includes(marker));
  } finally { await f.dispose(); }
});

test('independent: report CLI does not print malformed evidence payload fragments', async () => {
  const marker = 'SYNTHETIC-CUSTOMER-CONTENT';
  const directory = await mkdtemp(path.join(tmpdir(), 'teruisi-independent-malformed-'));
  try {
    const inputPath = path.join(directory, 'input.json'); await writeFile(inputPath, marker);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/release-closeout-report.mjs', import.meta.url)), inputPath, path.join(directory, 'report')], { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('independent: total deadline includes persistent attempt evidence', async () => {
  let clock = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', totalTimeoutMs: 1000,
    now: () => clock, query: async () => { clock = 900; return {}; },
    onAttempt: async () => { clock += 200; } }), error => error.code === 'DEADLINE_EXCEEDED');
});

test('independent: expired binding validation prevents starting another native probe', async () => {
  let clock = 0, calls = 0;
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', totalTimeoutMs: 1000,
    now: () => clock, query: async ({ remaining }) => {
      remaining(); clock = 1001; // Controlled slow source-file validation.
      remaining(); calls++; return {};
    } }), error => error.code === 'DEADLINE_EXCEEDED');
  assert.equal(calls, 0);
});

test('independent: direct process completion returns while inherited output remains open', { skip: process.platform !== 'win32' }, async t => {
  // Windows Node/libuv does not retain its captured pipe when an intermediate
  // Node process exits, even with an IPC readiness handshake. Use the native
  // .NET inheritance path and first prove the exit/EOF gap instead of assuming it.
  const descendantArgs = `-e "process.stdout.write('DESC_READY');setTimeout(()=>{},1800)"`;
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const script = `$p=New-Object Diagnostics.Process;$p.StartInfo.FileName=${quote(process.execPath)};$p.StartInfo.Arguments=${quote(descendantArgs)};$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;[void]$p.Start();Write-Output ('PARENT_READY '+$p.Id)`;
  const executable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const args = ['-NoProfile', '-NonInteractive', '-Command', script];
  const calibration = await new Promise((resolve, reject) => {
    const started = performance.now(), child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', exitMs = null;
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume();
    child.once('error', reject); child.once('exit', () => { exitMs = performance.now() - started; });
    child.once('close', code => resolve({ code, output, exitMs, eofMs: performance.now() - started }));
  });
  assert.equal(calibration.code, 0); assert.match(calibration.output, /PARENT_READY/);
  assert.ok(calibration.eofMs - calibration.exitMs >= 1200, 'fixture must establish real inherited EOF hold');
  t.diagnostic(JSON.stringify({ parentExitMs: calibration.exitMs, eofMs: calibration.eofMs, inheritedHoldMs: calibration.eofMs - calibration.exitMs }));
  const begun = performance.now();
  const result=await runReadOnlyProcess(executable,args,{timeoutMs:700});
  assert.match(result.stdout,/PARENT_READY/);assert.equal(result.processEvidence.exitCode,0);
  const descendant=Number(/PARENT_READY (\d+)/.exec(result.stdout)[1]);
  try {process.kill(descendant,0);assert.ok(performance.now()-begun<1700);} finally {try{process.kill(descendant);}catch{}}
});

test('independent: permanent identity mismatch does not retry after a transient query', async () => {
  let count = 0, clock = 0; const evidence = [];
  await assert.rejects(retryReadOnlyObservation({ stage: 'closeout-status', now: () => clock,
    sleep: async ms => { clock += ms; }, onAttempt: async record => evidence.push(record),
    query: async () => { if (++count === 1) throw observationError('ECONNRESET'); throw observationError('STATUS_IDENTITY_MISMATCH'); } }), error => error.code === 'STATUS_IDENTITY_MISMATCH');
  assert.equal(count, 2); assert.equal(evidence.length, 2); assert.equal(evidence[1].error.retryable, false);
});

test('independent: HTTP icon query, other HTTPS origin and static-suffix writes remain dangerous', () => {
  const decide = requestPolicy({ origin: 'http://127.0.0.1:3000', resources: { '/favicon.svg': h('a') } });
  for (const request of [
    { url: 'https://127.0.0.1:3000/favicon.svg?x=1', method: 'GET', resourceType: 'other' },
    { url: 'https://external.invalid/favicon.svg', method: 'GET', resourceType: 'image' },
    { url: 'http://127.0.0.1:3000/favicon.svg', method: 'POST', resourceType: 'other' },
  ]) {
    const decision = decide(request); assert.equal(decision.action, 'abort'); assert.notEqual(decision.kind, 'blocked-nonbusiness-icon');
  }
});

test('independent: allowed business GET network failure invalidates real UI audit', async () => {
  const handlers = {};
  const context = { route: async () => {}, on: (name, handler) => { handlers[name] = handler; } };
  const audit = await installUiRequestAudit(context, { origin: 'http://127.0.0.1:3000', resources: {}, readPaths: ['/api/customer-service/conversations'] });
  handlers.requestfailed({ url: () => 'http://127.0.0.1:3000/api/customer-service/conversations', method: () => 'GET', resourceType: () => 'fetch' });
  const result = await audit.finish(); assert.equal(result.status, 'failed'); assert.equal(result.failures.length, 1);
});

test('independent: complete readiness requires the actual twelve domain names', () => {
  const status = { state: 'Running', backendState: 'Ready', workerState: 'exact_release', releaseId: 'approved',
    components: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`unexpected${i}`, true])) };
  assert.throws(() => assertCompleteReadiness(status, 'approved'), /STATUS_NOT_READY|STATUS_IDENTITY_MISMATCH/);
});

test('independent: fixed snapshot and verified source receipt isolation regressions', () => {
  const result = spawnSync('python', [fileURLToPath(new URL('./release-closeout-independent.test.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /Ran 5 tests/);
});
