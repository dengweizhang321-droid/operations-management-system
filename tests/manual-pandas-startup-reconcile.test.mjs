import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  knownPandasStartup, verifyPreconditions, recover, saveEvidence, buildExtractScript,
  buildRecoveryScript, ownerSubstitutePowerShell, extractedFunctionNames, lastJsonLine,
} from '../tools/manual-pandas-startup-reconcile.mjs';

const k = knownPandasStartup;
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

/** A synthetic identity whose byte-pinned fields match synthetic, test-controlled bytes. */
function makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes}) {
  return {...k, deploymentManifestSha256: sha256(deploymentBytes), djangoAiScriptSha256: sha256(aiScriptBytes),
    failedReceiptSha256: sha256(failedReceiptBytes)};
}

/** Synthetic runtime root with exactly the files/paths verifyPreconditions inspects. */
async function makeRuntime({withPending = true, withStartupAttempt = false, withStartup = false, withComplete = false,
  withLease = false, withMaintenance = false, withDrain = false, withPandasPid = false,
  deploymentBytes = Buffer.from('known-deployment-bytes'), aiScriptBytes = Buffer.from('known-ai-script-bytes')} = {}) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-runtime-'));
  const installedToolsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-tools-'));
  await fs.mkdir(path.join(runtimeRoot, 'run'), {recursive: true});
  await fs.mkdir(path.join(runtimeRoot, 'app'), {recursive: true});
  await fs.writeFile(path.join(runtimeRoot, 'app/deployment.json'), deploymentBytes);
  await fs.writeFile(path.join(installedToolsRoot, 'django-ai.ps1'), aiScriptBytes);
  if (withPending) {
    const pending = {preparedAppId: k.preparedAppId, preparedAppSha256: k.preparedAppSha256, registeredPlanSha256: k.planSha256,
      sourceCommit: k.mainCommit, maintenanceId: k.maintenanceId, publicationOwnerPid: k.publicationOwnerPid};
    await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.pending.json`), JSON.stringify(pending));
  }
  if (withStartupAttempt) await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.startup-attempt.json`), '{}');
  if (withStartup) await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.startup.json`), '{}');
  if (withComplete) await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.complete.json`), '{}');
  if (withLease) await fs.writeFile(path.join(runtimeRoot, 'run/release-publication-lease.json'), '{}');
  if (withMaintenance) await fs.writeFile(path.join(runtimeRoot, 'run/system-maintenance.json'), '{}');
  if (withDrain) await fs.writeFile(path.join(runtimeRoot, 'run/automation-drain.json'), '{}');
  if (withPandasPid) await fs.writeFile(path.join(runtimeRoot, 'run/ai-pandas-wsl.pid.json'), '{}');
  return {runtimeRoot, installedToolsRoot};
}

async function cleanup(...dirs) {
  for (const dir of dirs) await fs.rm(dir, {recursive: true, force: true});
}

// Patch knownPandasStartup's hash expectations is not possible (frozen export), so these
// tests instead control the *input bytes* and compare against the real exported hashes by
// pre-computing what bytes would hash to the pinned values is infeasible (second-preimage).
// Instead, deployment/ai-script byte checks are tested via the "mismatch" path (wrong bytes
// always fail) and are independently covered by install-manual-pandas-startup-reconcile.mjs's
// own --check-only run against the real installed files (exercised manually, see report).

test('verifyPreconditions: every clause individually unmet refuses, nothing else evaluated twice', async () => {
  const noopProbe = async () => false;

  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withPending: false});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('pending记录缺失')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withStartupAttempt: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('startup-attempt 记录已存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withStartup: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('startup 记录已存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withComplete: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('complete 记录已存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withLease: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('release-publication-lease.json 仍存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withMaintenance: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('system-maintenance.json 仍存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withDrain: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('automation-drain.json 仍存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({withPandasPid: true});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('ai-pandas-wsl.pid.json 仍存在')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    // deployment.json / django-ai.ps1 byte mismatch (will never equal the pinned real hashes).
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('deployment.json 字节不符')));
    assert.ok(result.problems.some(p => p.includes('django-ai.ps1 字节不符')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    // rotation lock held.
    const {runtimeRoot, installedToolsRoot} = await makeRuntime({});
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: async () => true});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('Worker rotation lock 仍被持有')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
  {
    // pending binding field mismatch (wrong plan hash bound).
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-runtime-'));
    const installedToolsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-tools-'));
    await fs.mkdir(path.join(runtimeRoot, 'run'), {recursive: true});
    await fs.mkdir(path.join(runtimeRoot, 'app'), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, 'app/deployment.json'), 'x');
    await fs.writeFile(path.join(installedToolsRoot, 'django-ai.ps1'), 'x');
    const wrongPending = {preparedAppId: k.preparedAppId, preparedAppSha256: k.preparedAppSha256, registeredPlanSha256: k.planSha256,
      sourceCommit: k.mainCommit, maintenanceId: k.maintenanceId, publicationOwnerPid: 999999};
    await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.pending.json`), JSON.stringify(wrongPending));
    const result = await verifyPreconditions({runtimeRoot, installedToolsRoot, probeRotationLock: noopProbe});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('pending.publicationOwnerPid 不符')));
    await cleanup(runtimeRoot, installedToolsRoot);
  }
});

test('recover(): refused preconditions write evidence but perform zero further writes', async () => {
  const {runtimeRoot, installedToolsRoot} = await makeRuntime({withPending: false});
  const evidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-evidence-'));
  let runCalled = false;
  const result = await recover({
    runtimeRoot, installedToolsRoot, evidenceDirectory, check: true,
    run: async () => { runCalled = true; throw new Error('run must not be called when preconditions are refused'); },
    probeRotationLock: async () => false,
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.productionExecuted, false);
  assert.equal(runCalled, false);
  const evidenceFiles = await fs.readdir(evidenceDirectory);
  assert.deepEqual(evidenceFiles, ['01-preconditions.json']);
  const preconditions = JSON.parse(await fs.readFile(path.join(evidenceDirectory, '01-preconditions.json'), 'utf8'));
  assert.equal(preconditions.ok, false);
  await cleanup(runtimeRoot, installedToolsRoot, evidenceDirectory);
});

test('recover(): a fully satisfying runtime executes extract then recovery script, in order, with ordered evidence', async () => {
  const deploymentBytes = Buffer.from('synthetic-deployment-manifest');
  const aiScriptBytes = Buffer.from('synthetic-django-ai-script');
  const failedReceiptBytes = Buffer.from(JSON.stringify({phase: '启动服务', maintenanceStarted: true}));
  const known = makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes});
  const {runtimeRoot, installedToolsRoot} = await makeRuntime({deploymentBytes, aiScriptBytes});
  const evidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-evidence-'));
  const failedReceiptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-failed-'));
  const failedReceiptFile = path.join(failedReceiptPath, 'FAILED.json');
  await fs.writeFile(failedReceiptFile, failedReceiptBytes);

  const calls = [];
  const run = async (script) => {
    calls.push(script);
    if (calls.length === 1) {
      assert.match(script, /ParseFile/, 'first call must be the extract script');
      return {stdout: '# synthetic extracted function text', stderr: ''};
    }
    assert.match(script, /# synthetic extracted function text/, 'second call must embed the extracted text');
    assert.match(script, /check=\$true/, 'this test drives --check, never Start-PandasSandbox');
    return {stdout: JSON.stringify({version: known.version, check: true, pendingBinding: {}, ownerSubstituteWouldPass: true}), stderr: ''};
  };

  const result = await recover({
    runtimeRoot, installedToolsRoot, evidenceDirectory, check: true, run,
    probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile,
  });

  assert.equal(result.status, 'checked');
  assert.equal(result.productionExecuted, false);
  assert.equal(calls.length, 2, 'extract then recovery script, nothing more');
  const evidenceFiles = (await fs.readdir(evidenceDirectory)).sort();
  assert.deepEqual(evidenceFiles, ['01-preconditions.json', '02-extract-script.ps1.txt', '03-extracted-functions.ps1.txt', '04-check-script.ps1.txt', '05-check-stdout.json', 'CHECKED.json']);
  const preconditions = JSON.parse(await fs.readFile(path.join(evidenceDirectory, '01-preconditions.json'), 'utf8'));
  assert.equal(preconditions.ok, true);
  await cleanup(runtimeRoot, installedToolsRoot, evidenceDirectory, failedReceiptPath);
});

test('recover(): a native failure on the second (recovery) call stops in place, writes FAILED.json, never retries', async () => {
  const deploymentBytes = Buffer.from('synthetic-deployment-manifest-2');
  const aiScriptBytes = Buffer.from('synthetic-django-ai-script-2');
  const failedReceiptBytes = Buffer.from(JSON.stringify({phase: '启动服务', maintenanceStarted: true}));
  const known = makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes});
  const {runtimeRoot, installedToolsRoot} = await makeRuntime({deploymentBytes, aiScriptBytes});
  const evidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-evidence-'));
  const failedReceiptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-failed-'));
  const failedReceiptFile = path.join(failedReceiptPath, 'FAILED.json');
  await fs.writeFile(failedReceiptFile, failedReceiptBytes);

  let calls = 0;
  const run = async () => {
    calls += 1;
    if (calls === 1) return {stdout: '# extracted', stderr: ''};
    const err = new Error('simulated: WSL keepalive failed to establish identity');
    err.stdout = '{"partial":"output"}';
    err.stderr = 'native stderr tail';
    throw err;
  };

  await assert.rejects(
    recover({runtimeRoot, installedToolsRoot, evidenceDirectory, check: false, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile}),
    /simulated: WSL keepalive failed to establish identity/,
  );
  assert.equal(calls, 2, 'must stop after the one failing native call, never retry');
  const evidenceFiles = (await fs.readdir(evidenceDirectory)).sort();
  assert.deepEqual(evidenceFiles, ['01-preconditions.json', '02-extract-script.ps1.txt', '03-extracted-functions.ps1.txt', '04-recovery-script.ps1.txt', 'FAILED.json']);
  const failed = JSON.parse(await fs.readFile(path.join(evidenceDirectory, 'FAILED.json'), 'utf8'));
  assert.match(failed.error, /simulated: WSL keepalive failed to establish identity/);
  assert.equal(failed.stdout, '{"partial":"output"}');
  assert.equal(failed.stderr, 'native stderr tail');
  assert.ok(!evidenceFiles.includes('SUCCESS.json') && !evidenceFiles.includes('CHECKED.json'));

  // Calling recover() again with the exact same (still-failed, unresolved) runtime must
  // refuse to overwrite the preserved evidence rather than silently retry over it.
  await assert.rejects(
    recover({runtimeRoot, installedToolsRoot, evidenceDirectory, check: false, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile}),
    /EEXIST|exist/i,
  );
  await cleanup(runtimeRoot, installedToolsRoot, evidenceDirectory, failedReceiptPath);
});

test('buildExtractScript: asserts the exact function-name inventory and prints them in the requested order', () => {
  const script = buildExtractScript('C:/fake/django-ai.ps1', ['Start-PandasSandbox', 'Complete-PandasRotation']);
  assert.match(script, /ParseFile\('C:\/fake\/django-ai\.ps1'/);
  assert.match(script, /'Start-PandasSandbox','Complete-PandasRotation'/);
  assert.match(script, /if\(\$functions\.Count -ne \$names\.Count\)/);
  assert.deepEqual(extractedFunctionNames.slice(-2), ['Start-PandasSandbox', 'Complete-PandasRotation']);
});

test('ownerSubstitutePowerShell: every narrowing clause is present and no clause weakens the original gate', () => {
  const script = ownerSubstitutePowerShell({failedReceiptPath: 'C:/fake/FAILED.json'});
  // 1. binding identity pinned to the one known plan
  assert.match(script, new RegExp(k.preparedAppId));
  assert.match(script, new RegExp(k.planSha256));
  assert.match(script, new RegExp(String(k.publicationOwnerPid)));
  // 2. lease file must not exist at all (stricter than tolerating a live owner)
  assert.match(script, /release-publication-lease\.json/);
  assert.match(script, /if \(Test-Path -LiteralPath \$leasePath\) \{ throw/);
  // 3. owner pid must be absent, or present-but-different-creationDate
  assert.match(script, /Get-Process -Id 66644/);
  assert.match(script, /ProcessCommandException/);
  // 4. maintenance/drain markers must both be absent
  assert.match(script, /system-maintenance\.json/);
  assert.match(script, /automation-drain\.json/);
  // 5. FAILED.json must match the exact pinned sha256, phase, and maintenanceStarted
  assert.match(script, new RegExp(k.failedReceiptSha256));
  assert.match(script, /启动服务/);
  assert.match(script, /maintenanceStarted -ne \$true/);
});

test('buildRecoveryScript: check mode never calls Start-PandasSandbox or Complete-PandasRotation', () => {
  const script = buildRecoveryScript({runtimeRoot: 'C:/fake/runtime', installedToolsRoot: 'C:/fake/tools', extractedFunctionsText: '# fns', failedReceiptPath: 'C:/fake/FAILED.json', check: true});
  assert.doesNotMatch(script, /\$started = Start-PandasSandbox/);
  assert.doesNotMatch(script, /Complete-PandasRotation \| ConvertFrom-Json/);
  assert.match(script, /Assert-PandasPublicationOwner \$pending/);
  assert.match(script, /check=\$true/);
});

test('buildRecoveryScript: execute mode calls Start-PandasSandbox then Complete-PandasRotation, never the reverse', () => {
  const script = buildRecoveryScript({runtimeRoot: 'C:/fake/runtime', installedToolsRoot: 'C:/fake/tools', extractedFunctionsText: '# fns', failedReceiptPath: 'C:/fake/FAILED.json', check: false});
  const startIndex = script.indexOf('$started = Start-PandasSandbox');
  const completeIndex = script.indexOf('Complete-PandasRotation | ConvertFrom-Json');
  assert.ok(startIndex >= 0 && completeIndex >= 0 && startIndex < completeIndex);
  assert.match(script, /if \(\$started -ne \$true\) \{ throw/);
  assert.match(script, /\$Action = 'Start'/);
});

test('lastJsonLine: picks the final JSON object out of mixed PowerShell stdout noise', () => {
  const stdout = 'Preparing modules for first use.\n{"ignored":"earlier progress line"}\n{"version":"x","check":true}\n';
  assert.deepEqual(lastJsonLine(stdout), {version: 'x', check: true});
  assert.throws(() => lastJsonLine('no json here at all'), /没有返回JSON结果/);
});
