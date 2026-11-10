import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runTailReconcile, productionConfig, defaultKnownBatch, toolVersion } from '../tools/c7604df9-tail-reconcile.mjs';
import { readLivePublication } from '../tools/publish-latest-main.mjs';
import { readPreparationQueueInventory } from '../tools/main-prebuild-queue.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const write = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  await fs.writeFile(file, raw);
  return sha(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
};

/**
 * Build a complete synthetic packet + runtime that mirrors the real
 * production c7604df9 shape, with every byte and hash self-consistent so
 * the tool's own identity assertions are genuinely exercised rather than
 * bypassed. Returns a `knownBatch` whose pins match this fixture's bytes.
 */
async function fixture(t, { git = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c7604df9-tail-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const packetRoot = path.join(root, 'packet');
  const sourceRoot = path.join(packetRoot, 'source');
  const attemptRoot = path.join(packetRoot, 'publish-fixture12');
  const stateDirectory = path.join(root, 'state');
  const workerRuntimeRoot = path.join(root, 'worker-runtime');
  const djangoRuntimeRoot = path.join(root, 'django-runtime');
  const installedAppRoot = path.join(djangoRuntimeRoot, 'app');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(attemptRoot, { recursive: true });
  await fs.mkdir(path.join(attemptRoot, 'preparation'), { recursive: true });
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.mkdir(path.join(djangoRuntimeRoot, 'run'), { recursive: true });
  await fs.mkdir(installedAppRoot, { recursive: true });

  let mainCommit = 'f'.repeat(40);
  if (git) {
    const run = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    run(sourceRoot, ['init', '--quiet', '--initial-branch=main']);
    run(sourceRoot, ['config', 'user.name', 'fixture']);
    run(sourceRoot, ['config', 'user.email', 'fixture@example.invalid']);
    await fs.writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(sourceRoot, 'package-lock.json'), '{}\n');
    run(sourceRoot, ['add', '.']);
    run(sourceRoot, ['commit', '--quiet', '-m', 'fixture source']);
    mainCommit = run(sourceRoot, ['rev-parse', 'HEAD']);
  }

  const workerReleaseId = '20261110T081637Z-fixture0000000a';
  const workerManifest = { version: 'fixture-manifest', releaseId: workerReleaseId };
  const workerManifestSha256 = await write(path.join(workerRuntimeRoot, 'releases', workerReleaseId, 'deployment-manifest.json'), workerManifest);
  await fs.mkdir(path.join(workerRuntimeRoot, 'releases', workerReleaseId, 'tools'), { recursive: true });
  await fs.writeFile(path.join(workerRuntimeRoot, 'releases', workerReleaseId, 'tools/worker-local-service.ps1'), '# fixture\n');

  const djangoManifest = { version: 'fixture-django-manifest' };
  const djangoManifestSha256 = await write(path.join(installedAppRoot, 'deployment.json'), djangoManifest);
  await fs.mkdir(path.join(installedAppRoot, 'tools'), { recursive: true });
  await fs.writeFile(path.join(installedAppRoot, 'tools/django-ai.ps1'), '# fixture\n');

  const maintenanceId = 'f'.repeat(32);
  const pandasRegisteredPlanSha256 = 'a'.repeat(64);
  const pandasPublicationOwnerPid = 12345;

  // Every field verifyPandasCompletion/verifyIdentity (publish-main-pandas.mjs)
  // actually checks: configured, registeredPlanSha256, sourceSha256,
  // predecessorSourceSha256, image, preparedAppId, preparedAppSha256,
  // sourceCommit on the prepared binding; maintenanceId, publicationOwnerPid,
  // intentSha256 on the switch receipt.
  const pandasBrokerRotation = {
    configured: true, preparedAppId: 'b'.repeat(32), preparedAppSha256: 'c'.repeat(64),
    registeredPlanSha256: pandasRegisteredPlanSha256, sourceCommit: mainCommit, started: false,
    sourceSha256: '1'.repeat(64), predecessorSourceSha256: '2'.repeat(64), image: 'sha256:' + 'e'.repeat(64),
  };
  const started = {
    resumeProtocol: 'teruisi-pi-main-resume-v1', mainCommit, maintenanceId,
    components: ['worker', 'django'], source: sourceRoot, sourceTree: 'tree-fixture-01',
    pandasBrokerRotation,
  };
  const startedSha256 = await write(path.join(attemptRoot, 'STARTED.json'), started);

  const failed = {
    at: new Date().toISOString(), mainCommit, phase: '启动服务',
    error: 'fixture failure', processEvidence: { exitCode: 1 },
    maintenanceStarted: true, automaticRetry: false,
  };
  const failedSha256 = await write(path.join(attemptRoot, 'FAILED.json'), failed);

  const piUpgrade = { at: new Date().toISOString(), registeredPlanSha256: 'd'.repeat(64), value: { upgraded: true, image: 'sha256:' + 'e'.repeat(64) } };
  const piUpgradeCompletedSha256 = await write(path.join(attemptRoot, 'PiUpgrade-completed.json'), piUpgrade);

  const intentSha256 = 'f'.repeat(64);
  const pandasSwitch = {
    at: new Date().toISOString(),
    value: { status: 'switched_stopped', ...pandasBrokerRotation, maintenanceId, publicationOwnerPid: pandasPublicationOwnerPid, intentSha256 },
  };
  const pandasSwitchedSha256 = await write(path.join(attemptRoot, 'PandasRotation-switched.json'), pandasSwitch);

  // The real startup receipt file CompletePandasRotation's own startupReceiptSha256 is checked against.
  const startupReceiptRaw = 'fixture-pandas-startup-receipt';
  await fs.writeFile(path.join(djangoRuntimeRoot, 'run', 'pandas-rotation-' + pandasRegisteredPlanSha256 + '.startup.json'), startupReceiptRaw);
  const startupReceiptSha256 = sha(Buffer.from(startupReceiptRaw));

  // The already-existing on-disk completion record: the same shape
  // Complete-PandasRotation itself would have written/compared, satisfying
  // both the artifact-existence precheck and verifyPandasCompletion's fields.
  const pandasCompletionRecord = {
    status: 'ready_verified', completed: true, postconditionsVerified: true,
    ...pandasBrokerRotation, maintenanceId, publicationOwnerPid: pandasPublicationOwnerPid,
    intentSha256, startupReceiptSha256,
  };
  await write(path.join(djangoRuntimeRoot, 'run', 'pandas-rotation-' + pandasRegisteredPlanSha256 + '.complete.json'), pandasCompletionRecord);

  const prepared = {
    version: 'teruisi-main-preparation-v1', sourceIdentity: { commit: mainCommit, tree: 'tree-fixture-01' },
    djangoManifestSha256, djangoPackage: { id: '0'.repeat(32) },
    workerPlan: { candidateReleaseId: workerReleaseId, candidateManifestSha256: workerManifestSha256 },
    pandasBrokerRotation,
  };
  await write(path.join(attemptRoot, 'preparation/PREPARED.json'), prepared);

  const request = { mainCommit, migrate: false, components: ['worker', 'django'] };
  await write(path.join(packetRoot, 'main-release-request.json'), request);

  const knownBatch = Object.freeze({
    mainCommit, maintenanceId, workerReleaseId, workerManifestSha256, djangoManifestSha256,
    startedSha256, failedSha256, piUpgradeCompletedSha256, pandasSwitchedSha256,
    pandasRegisteredPlanSha256, pandasPublicationOwnerPid,
  });

  const config = { packetRoot, sourceRoot, attemptRoot, stateDirectory, nativeToolsSource: sourceRoot, workerRuntimeRoot, djangoRuntimeRoot, installedAppRoot, readyUrl: 'http://fixture.invalid/ready' };

  // Fake native adapters for the lock/rotation chain/native process launch,
  // but api.hashRelativeFiles/listGitSourceFiles and the whole `pandas`
  // module stay real (imported from the real modules) so sourceTree
  // computation and Pandas completion verification are genuinely exercised.
  const realApi = await import(pathToFileURL(path.join(process.cwd(), 'tools/worker-local-release.mjs')));
  const realPandas = await import(pathToFileURL(path.join(process.cwd(), 'tools/publish-main-pandas.mjs')));
  const nativeCalls = [];
  const api = { hashRelativeFiles: realApi.hashRelativeFiles, listGitSourceFiles: realApi.listGitSourceFiles };
  let liveWorkerReleaseId = workerReleaseId, liveWorkerManifestSha256 = workerManifestSha256;
  const rotation = {
    withRotationLock: async (operation) => operation({}),
    assertActiveBatchOwnership: async () => {},
    resolveEffectiveReleaseChain: async () => ({ head: { releaseId: liveWorkerReleaseId, manifestSha256: liveWorkerManifestSha256 } }),
  };
  const transport = { productionCommandArguments: (host, args) => args, productionCommandEnvironment: () => ({}) };
  const loadNative = async () => ({ api, rotation, transport, pandas: realPandas });
  const runNativeStep = async ({ action }) => {
    nativeCalls.push(action);
    if (action === 'VerifyStartup') return { status: 'verified', startupVerified: true, releaseId: workerReleaseId, manifestSha256: workerManifestSha256 };
    if (action === 'CompletePandasRotation') return { ...pandasCompletionRecord };
    throw Error('unexpected native action: ' + action);
  };
  const readyBody = (overrides = {}) => new Response(
    JSON.stringify({ ok: true, status: 'ready', unavailableServices: [], serviceChecks: [], ...overrides }),
    { status: overrides.httpStatus ?? 200, headers: { 'content-type': 'application/json' } },
  );
  const fetchReady = async () => readyBody();

  return {
    root, packetRoot, sourceRoot, attemptRoot, stateDirectory, config, knownBatch, loadNative, runNativeStep, fetchReady, readyBody,
    nativeCalls, mainCommit, workerReleaseId, workerManifestSha256, djangoManifestSha256, installedAppRoot,
    setLiveWorkerRelease: (releaseId, manifestSha256) => { liveWorkerReleaseId = releaseId; liveWorkerManifestSha256 = manifestSha256; },
  };
}

test('full success: writes SUCCESS.json and PUBLISHED-MAIN.json with the exact expected shape', async (t) => {
  const f = await fixture(t);
  const result = await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  assert.equal(result.status, 'deployed_and_ready');
  assert.equal(result.productionExecuted, true);
  assert.equal(result.mainCommit, f.mainCommit);

  const success = JSON.parse(await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json'), 'utf8'));
  assert.equal(success.status, 'deployed_and_ready');
  assert.equal(success.mainCommit, f.mainCommit);
  assert.deepEqual(success.components, ['worker', 'django']);
  assert.equal(success.workerRelease, f.workerReleaseId);
  assert.equal(success.workerManifestSha256, f.workerManifestSha256);
  assert.equal(success.djangoManifestSha256, f.djangoManifestSha256);
  assert.equal(success.source, f.sourceRoot);
  assert.equal(success.maintenanceId, f.knownBatch.maintenanceId);
  assert.equal(success.migration, null);
  assert.equal(success.startupVerified, true);
  assert.equal(success.readyVerified, true);
  assert.equal(success.backupPerformed, false);
  assert.equal(success.manualRecovery, true);
  assert.equal(success.automatedPublisherSuccess, false);
  assert.equal(success.originalAttempt, f.attemptRoot);
  assert.equal(success.originalStartedSha256, f.knownBatch.startedSha256);
  assert.equal(success.originalFailureSha256, f.knownBatch.failedSha256);
  assert.equal(success.originalStartObserved, false);
  assert.equal(success.reconciliationTool, toolVersion);
  assert.equal(success.pandasBrokerRotation.status, 'ready_verified');
  assert.equal(success.piRunnerUpgrade.upgraded, true);

  // Original STARTED/FAILED untouched.
  const startedBytes = await fs.readFile(path.join(f.attemptRoot, 'STARTED.json'));
  assert.equal(sha(startedBytes), f.knownBatch.startedSha256);
  const failedBytes = await fs.readFile(path.join(f.attemptRoot, 'FAILED.json'));
  assert.equal(sha(failedBytes), f.knownBatch.failedSha256);

  const catalog = JSON.parse(await fs.readFile(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json'), 'utf8'));
  assert.equal(catalog.mainCommit, f.mainCommit);
  assert.equal(catalog.workerRelease, f.workerReleaseId);
  assert.equal(catalog.workerManifestSha256, f.workerManifestSha256);
  assert.equal(catalog.djangoManifestSha256, f.djangoManifestSha256);
  assert.equal(catalog.source, f.sourceRoot);
  assert.equal(catalog.receiptPath, path.join(f.attemptRoot, 'SUCCESS.json'));
  assert.equal(catalog.receiptSha256, sha(await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json'))));
  assert.ok(catalog.sourceTree && typeof catalog.sourceTree.sha256 === 'string');

  assert.deepEqual(f.nativeCalls, ['VerifyStartup', 'CompletePandasRotation']);
});

test('--check produces a preview byte-identical to --execute (timestamps excluded), calling the same native actions', async (t) => {
  const f = await fixture(t);
  const fixedNow = () => new Date('2026-11-10T20:00:00.000Z');
  const checked = await runTailReconcile({ check: true, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady, now: fixedNow });
  assert.equal(checked.status, 'checked');
  assert.equal(checked.productionExecuted, false);
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json')), { code: 'ENOENT' });
  // --check and --execute call the identical native actions: both are
  // confirmed read-only in the current state (both completion artifacts
  // already exist), so --check never needs a separate disk-only path.
  assert.deepEqual(f.nativeCalls, ['VerifyStartup', 'CompletePandasRotation']);
  f.nativeCalls.length = 0;

  const executed = await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady, now: fixedNow });
  assert.equal(executed.status, 'deployed_and_ready');
  assert.deepEqual(f.nativeCalls, ['VerifyStartup', 'CompletePandasRotation']);
  const writtenSuccess = JSON.parse(await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json'), 'utf8'));
  const writtenCatalog = JSON.parse(await fs.readFile(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json'), 'utf8'));

  // With the clock pinned, the preview must be byte-identical to what was
  // actually written, including derived fields like receiptSha256.
  assert.deepEqual(checked.successPreview, writtenSuccess);
  assert.deepEqual(checked.catalogPreview, writtenCatalog);
});

test('refuses outright when the Windows Pandas completion artifact does not exist yet (never the first writer)', async (t) => {
  const f = await fixture(t);
  const completionFile = path.join(f.config.djangoRuntimeRoot, 'run', 'pandas-rotation-' + f.knownBatch.pandasRegisteredPlanSha256 + '.complete.json');
  await fs.rm(completionFile);
  await assert.rejects(
    runTailReconcile({ check: true, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady }),
    /Pandas完成回执尚不存在/,
  );
  assert.deepEqual(f.nativeCalls, [], '完成回执不存在时不得调用任何原生步骤');
  await assert.rejects(
    runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady }),
    /Pandas完成回执尚不存在/,
  );
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
});

test('already-completed: a second run neither re-runs native steps nor rewrites files', async (t) => {
  const f = await fixture(t);
  await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  const successBefore = await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json'));
  const catalogBefore = await fs.readFile(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json'));
  f.nativeCalls.length = 0;

  const second = await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  assert.equal(second.status, 'already-completed');
  assert.equal(second.productionExecuted, false);
  assert.equal(second.catalogMatches, true);
  assert.deepEqual(f.nativeCalls, [], '已完成批次不应再次调用原生步骤');
  assert.deepEqual(await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json')), successBefore);
  assert.deepEqual(await fs.readFile(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json')), catalogBefore);

  const secondChecked = await runTailReconcile({ check: true, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  assert.equal(secondChecked.status, 'already-completed');
});

const mutate = async (file, mutator) => {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  mutator(value);
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
};

for (const [name, apply] of [
  ['STARTED.json byte changed', async (f) => mutate(path.join(f.attemptRoot, 'STARTED.json'), (v) => { v.extra = 'tampered'; })],
  ['FAILED.json byte changed', async (f) => mutate(path.join(f.attemptRoot, 'FAILED.json'), (v) => { v.extra = 'tampered'; })],
  ['FAILED.json wrong phase', async (f) => mutate(path.join(f.attemptRoot, 'FAILED.json'), (v) => { v.phase = '退出维护'; })],
  ['PiUpgrade-completed.json byte changed', async (f) => mutate(path.join(f.attemptRoot, 'PiUpgrade-completed.json'), (v) => { v.extra = 'tampered'; })],
  ['PandasRotation-switched.json byte changed', async (f) => mutate(path.join(f.attemptRoot, 'PandasRotation-switched.json'), (v) => { v.extra = 'tampered'; })],
  ['maintenance marker present', async (f) => write(path.join(f.config.djangoRuntimeRoot, 'run/system-maintenance.json'), { id: 'x' })],
  ['drain marker present', async (f) => write(path.join(f.config.djangoRuntimeRoot, 'run/automation-drain.json'), { id: 'x' })],
]) test('identity mismatch is rejected with zero writes: ' + name, async (t) => {
  const f = await fixture(t);
  await apply(f);
  await assert.rejects(runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady }));
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json')), { code: 'ENOENT' });
  assert.deepEqual(f.nativeCalls, [], '身份不符时不得调用任何原生步骤');
});

test('a VerifyStartup failure is rejected with zero writes', async (t) => {
  const f = await fixture(t);
  const runNativeStep = async ({ action }) => {
    f.nativeCalls.push(action);
    if (action === 'VerifyStartup') return { status: 'verified', startupVerified: false, releaseId: f.workerReleaseId, manifestSha256: f.workerManifestSha256 };
    throw Error('must not reach CompletePandasRotation after a failed VerifyStartup');
  };
  await assert.rejects(runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep, fetchReady: f.fetchReady }), /VerifyStartup/);
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
});

test('an unready live service is rejected with zero writes', async (t) => {
  const f = await fixture(t);
  const fetchReady = async () => ({ status: 200, json: async () => ({ ok: true, status: 'degraded', unavailableServices: ['sales.reader'] }) });
  await assert.rejects(runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady }));
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
});

test('a CompletePandasRotation result with a tampered intentSha256 is rejected by the REAL verifyPandasCompletion, zero writes', async (t) => {
  const f = await fixture(t);
  const runNativeStep = async ({ action, ...rest }) => {
    const result = await f.runNativeStep({ action, ...rest });
    if (action === 'CompletePandasRotation') return { ...result, intentSha256: 'f'.repeat(63) + '0' };
    return result;
  };
  // This must fail inside the real, imported publish-main-pandas.mjs
  // verifyPandasCompletion itself (its intentSha256 equality check), not
  // inside this tool's own narrower checks - proving the full real
  // verification function actually runs and actually checks this field.
  await assert.rejects(
    runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep, fetchReady: f.fetchReady }),
    (error) => error.stack.includes('publish-main-pandas.mjs'),
  );
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
});

test('a CompletePandasRotation result whose startupReceiptSha256 does not match the real startup file on disk is rejected, zero writes', async (t) => {
  const f = await fixture(t);
  const runNativeStep = async ({ action, ...rest }) => {
    const result = await f.runNativeStep({ action, ...rest });
    if (action === 'CompletePandasRotation') return { ...result, startupReceiptSha256: '0'.repeat(64) };
    return result;
  };
  await assert.rejects(runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep, fetchReady: f.fetchReady }));
  await assert.rejects(fs.access(path.join(f.attemptRoot, 'SUCCESS.json')), { code: 'ENOENT' });
});

test('an existing PUBLISHED-MAIN.json is backed up before being replaced', async (t) => {
  const f = await fixture(t);
  const oldCatalog = { mainCommit: '0'.repeat(40), note: 'stale 11-07 catalog' };
  await write(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json'), oldCatalog);
  await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  const backup = JSON.parse(await fs.readFile(path.join(f.attemptRoot, 'reconciliation', toolVersion, 'superseded-PUBLISHED-MAIN.json'), 'utf8'));
  assert.deepEqual(backup, oldCatalog);
  const newCatalog = JSON.parse(await fs.readFile(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json'), 'utf8'));
  assert.equal(newCatalog.mainCommit, f.mainCommit);
});

test('drift between SUCCESS.json and the catalog write aborts before the catalog; SUCCESS stays; a rerun reports catalogMatches:false with advice', async (t) => {
  const f = await fixture(t);
  // The live Worker release drifts to something else exactly between
  // runReadOnlyTail's own observation and the post-SUCCESS re-check: the
  // fixture's resolveEffectiveReleaseChain answers correctly for the first
  // call (inside runReadOnlyTail) and reports a different release from the
  // second call onward (the post-SUCCESS re-check in runTailReconcile).
  let calls = 0;
  const driftingLoadNative = async (config) => {
    const native = await f.loadNative(config);
    return {
      ...native,
      rotation: {
        ...native.rotation,
        resolveEffectiveReleaseChain: async () => {
          calls += 1;
          if (calls === 1) return { head: { releaseId: f.workerReleaseId, manifestSha256: f.workerManifestSha256 } };
          return { head: { releaseId: 'some-other-release', manifestSha256: '0'.repeat(64) } };
        },
      },
    };
  };

  await assert.rejects(
    runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: driftingLoadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady }),
    /目标版本在写入catalog前已变化/,
  );
  // SUCCESS.json was written and stays; the catalog was never written.
  const success = JSON.parse(await fs.readFile(path.join(f.attemptRoot, 'SUCCESS.json'), 'utf8'));
  assert.equal(success.mainCommit, f.mainCommit);
  await assert.rejects(fs.access(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json')), { code: 'ENOENT' });

  // A rerun (even with the live system back to normal / using the original,
  // non-drifting native loader) must not try to finish the job itself: it
  // reports already-completed with catalogMatches:false and tells the
  // operator what to check and that this tool will not auto-write the catalog.
  const rerun = await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  assert.equal(rerun.status, 'already-completed');
  assert.equal(rerun.productionExecuted, false);
  assert.equal(rerun.catalogMatches, false);
  assert.equal(rerun.receiptPath, path.join(f.attemptRoot, 'SUCCESS.json'));
  assert.ok(typeof rerun.advice === 'string' && rerun.advice.length > 0);
  assert.match(rerun.advice, /人工核对/);
  await assert.rejects(fs.access(path.join(f.stateDirectory, 'PUBLISHED-MAIN.json')), { code: 'ENOENT' }, '已完成分支绝不应自己补写catalog');

  const rerunChecked = await runTailReconcile({ check: true, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  assert.equal(rerunChecked.status, 'already-completed');
  assert.equal(rerunChecked.catalogMatches, false);
});

// --- Cross-check against the REAL readLivePublication and the REAL
// preparation-resolution read path, per the brief's item 3/测试 requirement. ---

test('the real readLivePublication accepts the catalog + SUCCESS.json this tool writes', async (t) => {
  const f = await fixture(t);
  await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });

  const realApi = await import(pathToFileURL(path.join(process.cwd(), 'tools/worker-local-release.mjs')));
  const djangoRaw = await fs.readFile(path.join(f.config.installedAppRoot, 'deployment.json'));
  const config = { nativeToolsSource: f.sourceRoot, stateDirectory: f.stateDirectory };
  const result = await readLivePublication(config, {
    loadApi: async () => ({ workerRuntimeRoot: f.config.workerRuntimeRoot, hashRelativeFiles: realApi.hashRelativeFiles, listGitSourceFiles: realApi.listGitSourceFiles }),
    loadRotation: async () => ({ resolveEffectiveReleaseChain: async () => ({ head: { releaseId: f.workerReleaseId, manifestSha256: f.workerManifestSha256 }, chainStateSha256: 'chain-fixture' }) }),
    readDjango: async () => djangoRaw,
    runtimeRoot: f.config.djangoRuntimeRoot,
    fetchReady: f.readyBody,
  });
  assert.equal(result.mainCommit, f.mainCommit);
  assert.equal(result.head.releaseId, f.workerReleaseId);
  assert.equal(result.djangoManifestSha256, sha(djangoRaw));
  assert.equal(path.resolve(result.completedReceiptPath), path.resolve(path.join(f.attemptRoot, 'SUCCESS.json')));
});

test('the real readLivePublication still refuses a half-switch (FAILED but no SUCCESS) before reconciliation runs', async (t) => {
  const f = await fixture(t);
  const realApi = await import(pathToFileURL(path.join(process.cwd(), 'tools/worker-local-release.mjs')));
  const djangoRaw = await fs.readFile(path.join(f.config.installedAppRoot, 'deployment.json'));
  const config = { nativeToolsSource: f.sourceRoot, stateDirectory: f.stateDirectory };
  await assert.rejects(readLivePublication(config, {
    loadApi: async () => ({ workerRuntimeRoot: f.config.workerRuntimeRoot, hashRelativeFiles: realApi.hashRelativeFiles, listGitSourceFiles: realApi.listGitSourceFiles }),
    loadRotation: async () => ({ resolveEffectiveReleaseChain: async () => ({ head: { releaseId: f.workerReleaseId, manifestSha256: f.workerManifestSha256 }, chainStateSha256: 'chain-fixture' }) }),
    readDjango: async () => djangoRaw,
    runtimeRoot: f.config.djangoRuntimeRoot,
  }));
});

test('readPreparationQueueInventory does not need and is not blocked by this attempt (no v2 queue dispatch exists for it)', async (t) => {
  const f = await fixture(t);
  await runTailReconcile({ check: false, config: f.config, knownBatch: f.knownBatch, loadNative: f.loadNative, runNativeStep: f.runNativeStep, fetchReady: f.fetchReady });
  const queueDirectory = path.join(f.stateDirectory, 'prebuild-queue-v2');
  await fs.mkdir(path.join(queueDirectory, 'dispatches'), { recursive: true });
  await fs.mkdir(path.join(queueDirectory, 'results'), { recursive: true });
  await fs.mkdir(path.join(queueDirectory, 'tickets'), { recursive: true });
  // An empty v2 queue (as production effectively has, for THIS attempt: the
  // real production dispatch for this exact packet has terminal status
  // 'prepared', which main-prebuild-queue.mjs:350/370 never routes into
  // unresolved/resolution machinery) must read cleanly with no reference to
  // this attempt or its SUCCESS.json at all.
  const inventory = await readPreparationQueueInventory(queueDirectory);
  assert.deepEqual(inventory.dispatches, []);
  assert.deepEqual(inventory.tickets, []);
});
