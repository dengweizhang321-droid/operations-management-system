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

/** A synthetic run() mock's extract-step reply: valid stdout + a closure record in stderr that matches `known`'s extractedFunctionNames exactly (recover() parses this before trusting the extraction). */
function extractReply(text) {
  return {stdout: text, stderr: JSON.stringify({version: 'pandas-closure-v1', seeds: ['Start-PandasSandbox', 'Complete-PandasRotation'], computed: extractedFunctionNames})};
}

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
  const run = async (script, options) => {
    calls.push({script, options});
    if (calls.length === 1) {
      assert.match(script, /ParseFile/, 'first call must be the extract script');
      return extractReply('# synthetic extracted function text');
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
  assert.ok(calls.every(c => c.options?.scriptPath), 'every run() call must be given an evidence-backed scriptPath');
  const evidenceFiles = (await fs.readdir(evidenceDirectory)).sort();
  assert.deepEqual(evidenceFiles, ['01-preconditions.json', '02-extract-script.ps1.txt', '03-closure.json', '04-extracted-functions.ps1.txt', '05-check-script.ps1.txt', '06-check-stdout.json', 'CHECKED.json']);
  const preconditions = JSON.parse(await fs.readFile(path.join(evidenceDirectory, '01-preconditions.json'), 'utf8'));
  assert.equal(preconditions.ok, true);
  const closureEvidence = JSON.parse(await fs.readFile(path.join(evidenceDirectory, '03-closure.json'), 'utf8'));
  assert.deepEqual([...closureEvidence.computed].sort(), [...extractedFunctionNames].sort());
  await cleanup(runtimeRoot, installedToolsRoot, evidenceDirectory, failedReceiptPath);
});

test('recover(): refuses when the extraction step reports a closure that does not match extractedFunctionNames', async () => {
  const deploymentBytes = Buffer.from('synthetic-deployment-manifest-closure-mismatch');
  const aiScriptBytes = Buffer.from('synthetic-django-ai-script-closure-mismatch');
  const failedReceiptBytes = Buffer.from(JSON.stringify({phase: '启动服务', maintenanceStarted: true}));
  const known = makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes});
  const {runtimeRoot, installedToolsRoot} = await makeRuntime({deploymentBytes, aiScriptBytes});
  const evidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-evidence-'));
  const failedReceiptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-pandas-recovery-failed-'));
  const failedReceiptFile = path.join(failedReceiptPath, 'FAILED.json');
  await fs.writeFile(failedReceiptFile, failedReceiptBytes);

  // Simulates exactly the original defect: the real extraction step reports a
  // closure missing Read-PandasConfig/Invoke-PandasProbe/Invoke-PandasSystemctl/
  // Assert-AiRuntimeEntry. recover() must refuse before ever running the
  // recovery script, instead of silently proceeding with an incomplete set.
  let calls = 0;
  const run = async () => {
    calls += 1;
    return {stdout: '# extracted', stderr: JSON.stringify({version: 'pandas-closure-v1', seeds: [], computed: ['Read-PandasRotationJson', 'Write-PandasRotationJson', 'Start-PandasSandbox', 'Complete-PandasRotation']})};
  };

  await assert.rejects(
    recover({runtimeRoot, installedToolsRoot, evidenceDirectory, check: true, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile}),
    /实测闭包与本次驱动固定清单不符/,
  );
  assert.equal(calls, 1, 'must refuse after the one extraction call, never reach the recovery script');
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
    if (calls === 1) return extractReply('# extracted');
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
  assert.deepEqual(evidenceFiles, ['01-preconditions.json', '02-extract-script.ps1.txt', '03-closure.json', '04-extracted-functions.ps1.txt', '05-recovery-script.ps1.txt', 'FAILED.json']);
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

test('buildExtractScript: asserts the exact function-name inventory, computes and asserts the transitive closure, and prints them in the requested order', () => {
  const script = buildExtractScript('C:/fake/django-ai.ps1', ['Start-PandasSandbox', 'Complete-PandasRotation']);
  assert.match(script, /ParseFile\('C:\/fake\/django-ai\.ps1'/);
  assert.match(script, /'Start-PandasSandbox','Complete-PandasRotation'/);
  assert.match(script, /if\(\$functions\.Count -ne \$names\.Count\)/);
  // Closure computation: must walk CommandAst nodes, follow only names that are
  // themselves FunctionDefinitionAst nodes, and refuse on any mismatch with the
  // pinned list -- in either direction (new dependency or a name that vanished).
  assert.match(script, /Get-CalledNames/);
  assert.match(script, /if\(\(\$computed -join ','\) -cne \(\$expected -join ','\)\)\{throw 'Installed controller transitive closure changed/);
  assert.match(script, /if\(\$called -ceq 'Assert-PandasPublicationOwner'\)\{continue\}/, 'the substitute must never be pulled into the closure');
  // extractedFunctionNames must include every function the real installed
  // django-ai.ps1 needs for Start-PandasSandbox/Complete-PandasRotation to run,
  // not just the ones this driver happens to define itself -- this is exactly
  // the set defect 1 found missing (Read-PandasConfig/Invoke-PandasProbe/
  // Invoke-PandasSystemctl/Assert-AiRuntimeEntry).
  for (const name of ['Read-PandasConfig', 'Invoke-PandasProbe', 'Invoke-PandasSystemctl', 'Assert-AiRuntimeEntry', 'Start-PandasSandbox', 'Complete-PandasRotation'])
    assert.ok(extractedFunctionNames.includes(name), 'extractedFunctionNames is missing: ' + name);
  assert.ok(!extractedFunctionNames.includes('Assert-RuntimeChildPath'), 'Assert-RuntimeChildPath belongs to the base library, never extracted from django-ai.ps1');
  assert.ok(!extractedFunctionNames.includes('Assert-PandasPublicationOwner'), 'the owner substitute is defined, never extracted');
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
  // Evidence recording: both the 'absent' and 'recycled' branches must record
  // which one fired and the observed CreationDate, not just silently proceed.
  assert.match(script, /PandasOwnerSubstituteEvidence\.ownerBranch = 'recycled'/);
  assert.match(script, /PandasOwnerSubstituteEvidence\.ownerBranch = 'absent'/);
  assert.match(script, /observedCreationDateIso/);
});

test('ownerSubstitutePowerShell (executed): pid absent and pid recycled with a different CreationDate both proceed; same pid with the recorded CreationDate throws', {timeout: 30000}, async () => {
  // Runs the real extracted-and-substituted function body under PS5.1 against
  // three synthetic "owner" scenarios, proving the brief's own criterion
  // ("不存在，或存在但 creationDate 与记录不同") is what the code actually does,
  // not what an earlier (wrong) comment claimed.
  const {spawn, spawnSync} = await import('node:child_process');
  const fsSync = await import('node:fs');

  // A real FAILED.json fixture matching clause 4 exactly, so only the
  // owner-liveness clause (2) under test can throw or proceed.
  const failedReceiptBytes = Buffer.from(JSON.stringify({phase: '启动服务', maintenanceStarted: true}));
  const failedReceiptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-owner-substitute-failed-'));
  const failedReceiptFile = path.join(failedReceiptDir, 'FAILED.json');
  await fs.writeFile(failedReceiptFile, failedReceiptBytes);
  const failedReceiptSha256 = sha256(failedReceiptBytes);

  function runCase(ownerPid, recordedCreationDateIso) {
    const custom = {...k, publicationOwnerPid: ownerPid, publicationOwnerCreationDate: recordedCreationDateIso, failedReceiptSha256};
    const script = ownerSubstitutePowerShell({failedReceiptPath: failedReceiptFile, known: custom});
    const harness = [
      "$ErrorActionPreference='Stop'",
      "$RunDirectory = $env:TEMP",
      "$RuntimeRoot = $env:TEMP",
      script,
      "$binding = [pscustomobject]@{preparedAppId='" + custom.preparedAppId + "';preparedAppSha256='" + custom.preparedAppSha256 + "';registeredPlanSha256='" + custom.planSha256 + "';sourceCommit='" + custom.mainCommit + "';maintenanceId='" + custom.maintenanceId + "';publicationOwnerPid=" + ownerPid + "}",
      "try { Assert-PandasPublicationOwner $binding; Write-Output 'PROCEEDED' } catch { Write-Output ('THREW:' + $_.Exception.Message) }",
      "Write-Output ('BRANCH:' + $script:PandasOwnerSubstituteEvidence.ownerBranch)",
    ].join('\n');
    const scriptPath = path.join(os.tmpdir(), 'teruisi-owner-substitute-exec-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    fsSync.writeFileSync(scriptPath, Buffer.concat([bom, Buffer.from(harness, 'utf8')]));
    try {
      return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {encoding: 'utf8', windowsHide: true, timeout: 15000});
    } finally {
      fsSync.unlinkSync(scriptPath);
    }
  }

  // Case 1: pid absent. Probe candidate PIDs until a genuinely unused one is
  // found, rather than trusting a single guessed value.
  function isPidFree(candidatePid) {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      "if (Get-Process -Id " + candidatePid + " -ErrorAction SilentlyContinue) { Write-Output 'IN_USE' } else { Write-Output 'FREE' }"],
      {encoding: 'utf8', windowsHide: true, timeout: 10000});
    assert.equal(probe.status, 0, probe.stderr);
    return probe.stdout.includes('FREE');
  }
  let absentPid = null;
  for (const candidate of [999999, 999998, 999997, 999996, 999995]) {
    if (isPidFree(candidate)) { absentPid = candidate; break; }
  }
  assert.ok(absentPid, 'could not find a free PID to use as the absent-owner case');
  const absentRun = runCase(absentPid, '2026-01-01T00:00:00.0000000Z');
  assert.equal(absentRun.status, 0, absentRun.stderr || absentRun.stdout);
  assert.match(absentRun.stdout, /PROCEEDED/);
  assert.match(absentRun.stdout, /BRANCH:absent/);

  // Case 2 and 3 both need a real, live process whose actual CreationDate we
  // can read. A short-lived `powershell -Command Start-Sleep` child works for
  // both: compare against a deliberately wrong date (recycled, proceeds) and
  // against its own real CreationDate read back via Get-CimInstance (live,
  // throws) -- using the identical ToString format the substitute itself uses.
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 20'], {windowsHide: true});
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    // Read StartTime the identical way the function itself does
    // ([DateTimeOffset]$owner.StartTime.ToUniversalTime()...), not via
    // Get-CimInstance's separate CreationDate property, which can round
    // differently and never compare equal.
    const creationProbe = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      "([DateTimeOffset](Get-Process -Id " + child.pid + ").StartTime.ToUniversalTime()).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')"],
      {encoding: 'utf8', windowsHide: true, timeout: 10000});
    assert.equal(creationProbe.status, 0, creationProbe.stderr);
    const realCreationDateIso = creationProbe.stdout.trim();
    assert.match(realCreationDateIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);

    const recycledRun = runCase(child.pid, '2000-01-01T00:00:00.0000000Z');
    assert.equal(recycledRun.status, 0, recycledRun.stderr || recycledRun.stdout);
    assert.match(recycledRun.stdout, /PROCEEDED/);
    assert.match(recycledRun.stdout, /BRANCH:recycled/);

    const liveRun = runCase(child.pid, realCreationDateIso);
    assert.equal(liveRun.status, 0, liveRun.stderr || liveRun.stdout);
    assert.match(liveRun.stdout, /THREW:Pandas rotation requires the original live publication owner \(recorded owner pid is still the same live process\)/);
    assert.match(liveRun.stdout, /BRANCH:\r?\n/, 'the live branch throws before recording ownerBranch, leaving it empty');
  } finally {
    child.kill();
    await cleanup(failedReceiptDir);
  }
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
