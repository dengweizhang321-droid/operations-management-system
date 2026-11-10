/**
 * One-batch tail completion + publication-accounting closure for the
 * c7604df99c552dfaa770f46980aec266f1047b30 release whose attempt directory
 * has STARTED.json + FAILED.json (phase "启动服务") and no SUCCESS.json.
 *
 * This tool recognizes ONLY this one release: every identity below is a
 * fixed, pre-measured pin. It never replays ExitMaintenance or Start (both
 * already completed for real, outside any evidence-capturing tool at
 * 19:45); it only completes the remaining tail steps (VerifyStartup, the
 * Pandas completion record, the readiness probe) and then writes
 * SUCCESS.json + PUBLISHED-MAIN.json from MEASURED live values, the same
 * way publish-main-tail.mjs and publish-latest-main.mjs:911-923 would have,
 * had the normal tail completed. --check calls VerifyStartup (confirmed
 * read-only) but reads the Pandas completion record straight off disk
 * instead of re-invoking CompletePandasRotation, whose native path is not
 * fully auditable as read-only from here (see runReadOnlyTail).
 *
 * Precedent: tools/manual-startup-reconcile.mjs (2f875fb0 activated-startup
 * recovery) and tools/publish-main-resume.mjs (general Pi/Worker/Django tail
 * resume - explicitly refuses this case because Pandas is configured here,
 * see inspectMainPublication's pandasRuntimeChanged(request) assertion).
 *
 * --check: read-only, prints the two JSON documents that --execute would
 * write, byte for byte except timestamps. --execute: writes them.
 *
 * Every path/loader/fetch/identity-pin below is an injection seam for
 * isolated tests only (the CLI entry point always uses the real
 * `knownBatch`/`productionConfig()` defaults and never overrides them);
 * every identity assertion in verifyIdentity/runReadOnlyTail stays
 * unconditional given whatever pins it receives (same convention as
 * publish-latest-main.mjs's readLivePublication).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const shaFile = async (file) => sha(await fs.readFile(file));
const exists = async (file) => {
  try { await fs.access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

// ---------------------------------------------------------------------------
// Fixed identity for this one batch only. Any mismatch at runtime throws
// before any write. These values were independently measured from the real
// production attempt directory and runtime at authoring time.
// ---------------------------------------------------------------------------
export const defaultKnownBatch = Object.freeze({
  mainCommit: 'c7604df99c552dfaa770f46980aec266f1047b30',
  maintenanceId: '8fb21f03834e44f3a428ce9c8a7c6acb',
  workerReleaseId: '20261110T081637Z-3b276c4b744f92be',
  workerManifestSha256: '46da32a9c0efc9a3fd153068f1395438dd85ba56baf4f793b73e988c0e1f40d0',
  djangoManifestSha256: '49ff2e8b97ec89f9fb7f51dc7fba72ec987f029ac3a799f57e7bade4d6dfbaa9',
  startedSha256: 'b7b23b5ae360c69efaecc970eba569c50bcd1de46391f522e54566ee962bb0eb',
  failedSha256: 'c4e1529896a3077bb09d89aaf5d0f27dd2900c4a6392c4c171dbea6485bca8d5',
  piUpgradeCompletedSha256: 'e77cbc930eb81c3dc46fb47e4e854b793fc6cf7f53d60d4f62bbb68765f369cf',
  pandasSwitchedSha256: '2da737cd250ad8c9acea67fc1c1d67a7cff8631e1c091a05fd0e9926b874f4c4',
  pandasRegisteredPlanSha256: '3f52a62675e41ff328928beb1f2233e0a6b94fffef770210472944118926b36a',
  pandasPublicationOwnerPid: 66644,
});

export const toolVersion = 'teruisi-c7604df9-tail-reconcile-v1';

/** Production defaults. Tests override every one of these via `config`. */
export function productionConfig() {
  const packetRoot = 'D:/codex-isolated/main-release-packages/c7604df99c55-d5a6a3fb-06d27651-r2';
  const workerRuntimeRoot = 'D:/teruisi-runtime/teruisi-worker-sales';
  const djangoRuntimeRoot = 'D:/teruisi-runtime/django-sales';
  return {
    packetRoot,
    sourceRoot: path.join(packetRoot, 'source'),
    attemptRoot: path.join(packetRoot, 'publish-c7604df99c55'),
    stateDirectory: 'D:/codex-isolated/main-manual-release-20261016',
    nativeToolsSource: path.join(packetRoot, 'source'),
    workerRuntimeRoot,
    djangoRuntimeRoot,
    installedAppRoot: path.join(djangoRuntimeRoot, 'app'),
    readyUrl: 'http://127.0.0.1:3000/_teruisi/local/health/ready',
  };
}

/** Create-only JSON write. Never overwrites. */
async function writeOnce(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

/**
 * Load the frozen native adapters from the packet's own frozen source, never
 * from anywhere else, and never statically (the same reasoning as
 * publish-latest-main.mjs's own dynamic imports of worker-local-release*.mjs:
 * a packet-frozen copy of the exact bytes that ran the original attempt).
 */
async function defaultLoadNative(config) {
  const api = await import(pathToFileURL(path.join(config.nativeToolsSource, 'tools/worker-local-release.mjs')));
  const rotation = await import(pathToFileURL(path.join(config.nativeToolsSource, 'tools/worker-local-release-rotation.mjs')));
  const transport = await import(pathToFileURL(path.join(config.nativeToolsSource, 'tools/release-batch.mjs')));
  return { api, rotation, transport };
}

/**
 * Run one native PowerShell action the same way publish-main-step.mjs does:
 * manualStepCommand's bootstrap shape over the system PowerShell 5.1 host,
 * executed through the frozen worker-local-release.mjs's runProcess with
 * outputProtocol:'direct-exit-files' (long-lived children inherit pipes, so
 * EOF-based capture silently hangs/truncates - this is the lesson from the
 * prior Pandas tool's second review round).
 */
function manualStepCommand({ script, action, extra = [], addJson = true }) {
  const systemHost = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return { host: systemHost, args: ['-NoProfile', '-NonInteractive', '-File', script, '-Action', action, ...extra, ...(addJson ? ['-Json'] : [])] };
}

async function defaultRunNativeStep({ api, transport, script, action, extra = [], label }) {
  const command = manualStepCommand({ script, action, extra });
  const result = await api.runProcess(
    command.host,
    transport.productionCommandArguments(command.host, command.args),
    {
      cwd: path.dirname(script),
      env: transport.productionCommandEnvironment(command.host),
      timeoutMs: 1800000,
      outputProtocol: 'direct-exit-files',
      cleanup: 'preserve',
      captureOutputBuffers: true,
      label,
    },
  );
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.rawOutput.stdout).trim());
}

async function defaultFetchReady(config) {
  return fetch(config.readyUrl, { headers: { 'x-teruisi-local-health': '1' }, signal: AbortSignal.timeout(15000) });
}

/**
 * All read-only identity assertions that must hold before any native call or
 * write. Throws with a specific message on the first mismatch. Returns the
 * already-existing receipts this batch produced for real (STARTED, FAILED,
 * PiUpgrade-completed.json, PandasRotation-switched.json, PREPARED.json,
 * main-release-request.json), which the tail steps below re-verify against.
 */
async function verifyIdentity(config, knownBatch) {
  const { attemptRoot, packetRoot, djangoRuntimeRoot } = config;
  assert.equal(await shaFile(path.join(attemptRoot, 'STARTED.json')), knownBatch.startedSha256, 'STARTED.json 已变化，拒绝续接');
  assert.equal(await shaFile(path.join(attemptRoot, 'FAILED.json')), knownBatch.failedSha256, 'FAILED.json 已变化，拒绝续接');
  const started = await readJson(path.join(attemptRoot, 'STARTED.json'));
  assert.equal(started.mainCommit, knownBatch.mainCommit, 'STARTED.mainCommit 不是本批次');
  assert.equal(started.maintenanceId, knownBatch.maintenanceId, 'STARTED.maintenanceId 不是本批次');
  assert.deepEqual(started.components, ['worker', 'django']);
  assert.equal(started.pandasBrokerRotation?.configured, true);
  assert.equal(started.pandasBrokerRotation?.registeredPlanSha256, knownBatch.pandasRegisteredPlanSha256);
  const failed = await readJson(path.join(attemptRoot, 'FAILED.json'));
  assert.equal(failed.mainCommit, knownBatch.mainCommit, 'FAILED.mainCommit 不是本批次');
  assert.equal(failed.phase, '启动服务', 'FAILED.phase 不是本批次预期的启动服务步骤');
  assert.equal(failed.maintenanceStarted, true);
  assert.equal(failed.automaticRetry, false);

  const piUpgrade = await readJson(path.join(attemptRoot, 'PiUpgrade-completed.json'));
  assert.equal(await shaFile(path.join(attemptRoot, 'PiUpgrade-completed.json')), knownBatch.piUpgradeCompletedSha256, 'PiUpgrade-completed.json 已变化');
  assert.equal(piUpgrade.value.upgraded, true);

  const pandasSwitch = await readJson(path.join(attemptRoot, 'PandasRotation-switched.json'));
  assert.equal(await shaFile(path.join(attemptRoot, 'PandasRotation-switched.json')), knownBatch.pandasSwitchedSha256, 'PandasRotation-switched.json 已变化');
  assert.equal(pandasSwitch.value.status, 'switched_stopped');
  assert.equal(pandasSwitch.value.registeredPlanSha256, knownBatch.pandasRegisteredPlanSha256);
  assert.equal(pandasSwitch.value.publicationOwnerPid, knownBatch.pandasPublicationOwnerPid);

  const preparedFile = path.join(attemptRoot, 'preparation/PREPARED.json');
  const prepared = await readJson(preparedFile);
  assert.equal(prepared.sourceIdentity?.commit, knownBatch.mainCommit);
  assert.equal(prepared.djangoManifestSha256, knownBatch.djangoManifestSha256);
  assert.equal(prepared.workerPlan?.candidateReleaseId, knownBatch.workerReleaseId);
  assert.equal(prepared.workerPlan?.candidateManifestSha256, knownBatch.workerManifestSha256);

  const requestFile = path.join(packetRoot, 'main-release-request.json');
  const request = await readJson(requestFile);
  assert.equal(request.mainCommit, knownBatch.mainCommit);
  assert.equal(request.migrate, false);
  assert.equal(request.schemaRelease, undefined);
  assert.deepEqual(request.components, ['worker', 'django']);

  // Maintenance/drain markers must already be clear (brief: ExitMaintenance
  // already ran for real; we only assert, never call it again).
  for (const name of ['system-maintenance.json', 'automation-drain.json']) {
    assert.equal(await exists(path.join(djangoRuntimeRoot, 'run', name)), false, '维护或排空闸仍存在，拒绝续接: ' + name);
  }

  return { started, failed, piUpgrade, pandasSwitch, prepared, request };
}

/** Shared identity assertions on a Pandas completion record, from either the real native call or the pre-existing on-disk file. */
function assertPandasCompletion(pandasCompletion, knownBatch) {
  assert.equal(pandasCompletion.status, 'ready_verified', 'Pandas原启动回执未核验，拒绝续接');
  assert.equal(pandasCompletion.completed, true);
  assert.equal(pandasCompletion.postconditionsVerified, true);
  assert.equal(pandasCompletion.registeredPlanSha256, knownBatch.pandasRegisteredPlanSha256);
  assert.equal(pandasCompletion.publicationOwnerPid, knownBatch.pandasPublicationOwnerPid);
}

/**
 * The remaining read-only tail steps: VerifyStartup (shortcut-only check, no
 * lifecycle action - confirmed read-only against worker-local-service.ps1's
 * own source), the readiness probe publish-main-tail.mjs itself performs
 * before SUCCESS, and the Pandas completion record.
 *
 * Pandas completion is intentionally NOT re-invoked here for --check: unlike
 * VerifyStartup, django-ai.ps1's Complete-PandasRotation always calls through
 * to the WSL-side native rotation operator before it even checks whether the
 * completion file already exists (django-ai.ps1:532 runs before the :536
 * Test-Path branch), and this tool cannot fully audit that WSL-side script
 * for read-only behaviour from here. "不确定就不调" (brief): for --check the
 * already-written pandas-rotation-*.complete.json is read directly off disk
 * instead - a pure filesystem read with the same identity assertions. Only
 * --execute calls CompletePandasRotation for real.
 */
async function runReadOnlyTail({ config, knownBatch, api, transport, rotation, identity, runNativeStep, fetchReady, check }) {
  const targetWorkerScript = path.join(config.workerRuntimeRoot, 'releases', knownBatch.workerReleaseId, 'tools/worker-local-service.ps1');
  const startup = await runNativeStep({
    api, transport, script: targetWorkerScript, action: 'VerifyStartup',
    label: 'c7604df9-tail-reconcile-VerifyStartup',
  });
  assert.equal(startup.startupVerified, true, 'VerifyStartup 未通过，拒绝续接');
  assert.equal(startup.releaseId, knownBatch.workerReleaseId);
  assert.equal(startup.manifestSha256, knownBatch.workerManifestSha256);

  let pandasCompletion;
  if (check) {
    const completionFile = path.join(config.djangoRuntimeRoot, 'run', 'pandas-rotation-' + knownBatch.pandasRegisteredPlanSha256 + '.complete.json');
    pandasCompletion = await readJson(completionFile);
  } else {
    const pandasArgs = [
      '-PandasPreparedAppId', identity.prepared.pandasBrokerRotation.preparedAppId,
      '-PandasPreparedAppSha256', identity.prepared.pandasBrokerRotation.preparedAppSha256,
      '-PandasSourceCommit', knownBatch.mainCommit,
      '-PandasPlanSha256', knownBatch.pandasRegisteredPlanSha256,
      '-PandasMaintenanceId', knownBatch.maintenanceId,
      '-PandasPublicationOwnerPid', String(knownBatch.pandasPublicationOwnerPid),
    ];
    pandasCompletion = await runNativeStep({
      api, transport, script: path.join(config.installedAppRoot, 'tools/django-ai.ps1'), action: 'CompletePandasRotation',
      extra: pandasArgs, label: 'c7604df9-tail-reconcile-CompletePandasRotation',
    });
  }
  assertPandasCompletion(pandasCompletion, knownBatch);

  const chain = await rotation.resolveEffectiveReleaseChain({ verifyInstalledHead: true });
  assert.equal(chain.head.releaseId, knownBatch.workerReleaseId, '现役Worker版本不是本批次目标');
  assert.equal(chain.head.manifestSha256, knownBatch.workerManifestSha256);

  const djangoManifestSha256 = await shaFile(path.join(config.installedAppRoot, 'deployment.json'));
  assert.equal(djangoManifestSha256, knownBatch.djangoManifestSha256, '现役后台manifest不是本批次目标');

  const readyResponse = await fetchReady(config);
  assert.equal(readyResponse.status, 200, '服务未就绪，拒绝续接');
  const health = await readyResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.status, 'ready');
  assert.deepEqual(health.unavailableServices ?? [], []);

  return { startup, pandasCompletion, chain, djangoManifestSha256 };
}

/**
 * The SUCCESS.json this batch would have produced, shaped like
 * publish-main-tail.mjs:73 plus the recovery/transparency fields from
 * receiptExtra's established vocabulary (publish-main-resume.mjs:168):
 * manualRecovery, automatedPublisherSuccess, originalAttempt,
 * originalStartedSha256, originalFailureSha256. originalStartObserved is
 * this tool's own addition: the brief requires recording, not inventing,
 * whether the 19:45 manual Start's exit was ever captured - it was not (no
 * recovery tool wrote evidence for it; only the two Pandas-reconcile
 * directories exist, both unrelated to Start's own exit code).
 */
function buildSuccessReceipt({ config, knownBatch, at, tail, identity }) {
  return {
    status: 'deployed_and_ready',
    at,
    mainCommit: knownBatch.mainCommit,
    components: ['worker', 'django'],
    workerRelease: tail.chain.head.releaseId,
    workerManifestSha256: tail.chain.head.manifestSha256,
    djangoManifestSha256: tail.djangoManifestSha256,
    source: config.sourceRoot,
    sourceTree: identity.started.sourceTree ?? null,
    djangoPreparedId: identity.prepared.djangoPackage?.id ?? null,
    maintenanceId: knownBatch.maintenanceId,
    migration: null,
    piRunnerUpgrade: identity.piUpgrade.value,
    pandasBrokerRotation: tail.pandasCompletion,
    startupVerified: true,
    readyVerified: true,
    backupPerformed: false,
    manualRecovery: true,
    automatedPublisherSuccess: false,
    originalAttempt: config.attemptRoot,
    originalStartedSha256: knownBatch.startedSha256,
    originalFailureSha256: knownBatch.failedSha256,
    // The 19:45 manual `-Action Start` that actually switched the stack was
    // run directly against the live controller, outside any evidence-
    // capturing tool; its stdout/exit code were never written to disk. This
    // field records that truthfully instead of claiming a `started` result
    // this tool never observed.
    originalStartObserved: false,
    reconciliationTool: toolVersion,
  };
}

/** publish-latest-main.mjs:911-923's exact catalog construction, from measured live values. */
async function buildCatalog({ config, api, success, successRaw }) {
  const sourceTree = await api.hashRelativeFiles(config.sourceRoot, await api.listGitSourceFiles(config.sourceRoot));
  return {
    ...success,
    source: config.sourceRoot,
    sourceTree,
    receiptPath: path.join(config.attemptRoot, 'SUCCESS.json'),
    receiptSha256: sha(successRaw),
  };
}

async function alreadyCompleted(config, knownBatch) {
  const successRaw = await fs.readFile(path.join(config.attemptRoot, 'SUCCESS.json'));
  const success = JSON.parse(successRaw.toString('utf8'));
  assert.equal(success.manualRecovery, true, 'SUCCESS.json 不是本工具写入');
  assert.equal(success.reconciliationTool, toolVersion, 'SUCCESS.json 不是本工具写入');
  assert.equal(success.mainCommit, knownBatch.mainCommit);
  assert.equal(success.originalStartedSha256, knownBatch.startedSha256);
  assert.equal(success.originalFailureSha256, knownBatch.failedSha256);
  const catalogFile = path.join(config.stateDirectory, 'PUBLISHED-MAIN.json');
  let catalogMatches = false;
  if (await exists(catalogFile)) {
    const catalog = await readJson(catalogFile);
    catalogMatches = catalog.receiptPath === path.join(config.attemptRoot, 'SUCCESS.json') && catalog.mainCommit === knownBatch.mainCommit;
  }
  return { status: 'already-completed', mainCommit: knownBatch.mainCommit, receiptPath: path.join(config.attemptRoot, 'SUCCESS.json'), catalogMatches, productionExecuted: false };
}

export async function runTailReconcile({
  check = false,
  config = productionConfig(),
  knownBatch = defaultKnownBatch,
  loadNative = defaultLoadNative,
  runNativeStep = defaultRunNativeStep,
  fetchReady = defaultFetchReady,
  now = () => new Date(),
} = {}) {
  const identity = await verifyIdentity(config, knownBatch);
  if (await exists(path.join(config.attemptRoot, 'SUCCESS.json'))) return alreadyCompleted(config, knownBatch);

  const { api, rotation, transport } = await loadNative(config);
  return rotation.withRotationLock(async () => {
    await rotation.assertActiveBatchOwnership(config.workerRuntimeRoot);
    // Re-check SUCCESS existence under the lock: another actor may have
    // completed this batch between the pre-lock check above and now.
    if (await exists(path.join(config.attemptRoot, 'SUCCESS.json'))) return alreadyCompleted(config, knownBatch);

    const tail = await runReadOnlyTail({ config, knownBatch, api, transport, rotation, identity, runNativeStep, fetchReady, check });
    const at = now().toISOString();
    const success = buildSuccessReceipt({ config, knownBatch, at, tail, identity });

    if (check) {
      const previewRaw = Buffer.from(JSON.stringify(success, null, 2) + '\n');
      const previewCatalog = await buildCatalog({ config, api, success, successRaw: previewRaw });
      return {
        status: 'checked', mainCommit: knownBatch.mainCommit, productionExecuted: false,
        successPreview: success, catalogPreview: previewCatalog,
      };
    }

    // SUCCESS.json: create-only, inside the original attempt directory, next
    // to the untouched original STARTED.json/FAILED.json.
    await writeOnce(path.join(config.attemptRoot, 'SUCCESS.json'), success);
    const successRaw = await fs.readFile(path.join(config.attemptRoot, 'SUCCESS.json'));

    // PUBLISHED-MAIN.json: back up whatever is there first, then
    // temp-file + rename (create-only on both the backup and the temp file).
    const catalogFile = path.join(config.stateDirectory, 'PUBLISHED-MAIN.json');
    const evidenceDirectory = path.join(config.attemptRoot, 'reconciliation', toolVersion);
    await fs.mkdir(evidenceDirectory, { recursive: true });
    if (await exists(catalogFile)) {
      await fs.copyFile(catalogFile, path.join(evidenceDirectory, 'superseded-PUBLISHED-MAIN.json'), fs.constants.COPYFILE_EXCL);
    }
    const catalog = await buildCatalog({ config, api, success, successRaw });
    const temporary = catalogFile + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporary, catalogFile);

    return {
      status: 'deployed_and_ready', mainCommit: knownBatch.mainCommit, productionExecuted: true,
      receiptPath: path.join(config.attemptRoot, 'SUCCESS.json'), catalogFile,
    };
  });
}

async function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false }, execute: { type: 'boolean', default: false } } });
  assert.ok(values.check !== values.execute, '只支持明确 --check 或 --execute');
  const result = await runTailReconcile({ check: values.check });
  console.log(JSON.stringify(result, null, 2));
}
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (invokedDirectly) {
  main().catch((error) => { console.error('续接已停止：' + error.message); process.exitCode = 1; });
}
