import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {recover, knownPandasStartup as k, extractedFunctionNames} from '../tools/manual-pandas-startup-reconcile.mjs';

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes}) {
  return {...k, deploymentManifestSha256: sha256(deploymentBytes), djangoAiScriptSha256: sha256(aiScriptBytes), failedReceiptSha256: sha256(failedReceiptBytes)};
}

async function makeRuntime({deploymentBytes, aiScriptBytes}) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-install-collision-runtime-'));
  const installedToolsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-install-collision-tools-'));
  await fs.mkdir(path.join(runtimeRoot, 'run'), {recursive: true});
  await fs.mkdir(path.join(runtimeRoot, 'app'), {recursive: true});
  await fs.writeFile(path.join(runtimeRoot, 'app/deployment.json'), deploymentBytes);
  await fs.writeFile(path.join(installedToolsRoot, 'django-ai.ps1'), aiScriptBytes);
  const pending = {preparedAppId: k.preparedAppId, preparedAppSha256: k.preparedAppSha256, registeredPlanSha256: k.planSha256,
    sourceCommit: k.mainCommit, maintenanceId: k.maintenanceId, publicationOwnerPid: k.publicationOwnerPid};
  await fs.writeFile(path.join(runtimeRoot, 'run', `pandas-rotation-${k.planSha256}.pending.json`), JSON.stringify(pending));
  return {runtimeRoot, installedToolsRoot};
}

function extractReply(text) {
  return {stdout: text, stderr: JSON.stringify({version: 'pandas-closure-v1', seeds: ['Start-PandasSandbox', 'Complete-PandasRotation'], computed: extractedFunctionNames})};
}

async function cleanup(...dirs) { for (const dir of dirs) await fs.rm(dir, {recursive: true, force: true}); }

test('install script: 检查 and 执行 BATs point at distinct evidence subdirectories (static source check)', async () => {
  const source = await fs.readFile(path.join(import.meta.dirname, '../tools/install-manual-pandas-startup-reconcile.mjs'), 'utf8');
  // The exact regression: both loop entries used path.join(target,'evidence'),
  // with no per-mode distinction, so --check's and --execute's very first
  // create-only write (01-preconditions.json) collided.
  assert.match(source, /\[['"]检查Pandas首启补完\.bat['"],\s*['"]--check['"],\s*['"]evidence-check['"]\]/);
  assert.match(source, /\[['"]执行Pandas首启补完\.bat['"],\s*['"]--execute['"],\s*['"]evidence-execute['"]\]/);
  assert.doesNotMatch(source, /path\.join\(target,'evidence'\)/, 'must not reuse one shared "evidence" directory for both modes');
});

test('install script: check-then-execute with installer-shaped paths does not collide; a second execute still refuses to retry', async () => {
  // Mirrors exactly what the installer bakes into each BAT: a per-mode
  // subdirectory under the same kit directory, computed the identical way
  // (kitName -> target -> target/evidence-check, target/evidence-execute).
  const kitRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-install-collision-kit-'));
  const checkEvidenceDirectory = path.join(kitRoot, 'evidence-check');
  const executeEvidenceDirectory = path.join(kitRoot, 'evidence-execute');
  assert.notEqual(checkEvidenceDirectory, executeEvidenceDirectory);

  const deploymentBytes = Buffer.from('synthetic-deployment-manifest-install-collision');
  const aiScriptBytes = Buffer.from('synthetic-django-ai-script-install-collision');
  const failedReceiptBytes = Buffer.from(JSON.stringify({phase: '启动服务', maintenanceStarted: true}));
  const known = makeSyntheticKnown({deploymentBytes, aiScriptBytes, failedReceiptBytes});
  const {runtimeRoot, installedToolsRoot} = await makeRuntime({deploymentBytes, aiScriptBytes});
  const failedReceiptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-install-collision-failed-'));
  const failedReceiptFile = path.join(failedReceiptPath, 'FAILED.json');
  await fs.writeFile(failedReceiptFile, failedReceiptBytes);

  const run = async (script) => {
    if (script.includes('ParseFile')) return extractReply('# extracted');
    const check = script.includes('check=$true');
    return {stdout: JSON.stringify({version: known.version, check, pendingBinding: {}, ownerSubstituteWouldPass: check || undefined, startResult: check ? undefined : true, completeResult: check ? undefined : {status: 'ready_verified'}}), stderr: ''};
  };

  // Step 1: the recommended sequence -- run --check first, exactly as the brief instructs.
  const checkResult = await recover({runtimeRoot, installedToolsRoot, evidenceDirectory: checkEvidenceDirectory, check: true, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile});
  assert.equal(checkResult.status, 'checked');

  // Step 2: --execute, with its OWN evidence directory, must not collide with
  // --check's already-written 01-preconditions.json -- this is the exact
  // defect: before the fix, both pointed at the same directory and this
  // step would throw EEXIST before Start-PandasSandbox was ever reached.
  const executeResult = await recover({runtimeRoot, installedToolsRoot, evidenceDirectory: executeEvidenceDirectory, check: false, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile});
  assert.equal(executeResult.status, 'recovered');
  assert.equal(executeResult.productionExecuted, true);

  const checkFiles = (await fs.readdir(checkEvidenceDirectory)).sort();
  const executeFiles = (await fs.readdir(executeEvidenceDirectory)).sort();
  assert.ok(checkFiles.includes('CHECKED.json'));
  assert.ok(executeFiles.includes('SUCCESS.json'));

  // Step 3: running --execute a SECOND time, into the SAME evidence-execute
  // directory (exactly what double-clicking the 执行 BAT twice would do),
  // must still refuse -- the no-rerun guarantee is preserved per mode, not
  // lost by giving each mode its own directory.
  await assert.rejects(
    recover({runtimeRoot, installedToolsRoot, evidenceDirectory: executeEvidenceDirectory, check: false, run, probeRotationLock: async () => false, known, failedReceiptPath: failedReceiptFile}),
    /EEXIST|exist/i,
  );

  await cleanup(kitRoot, runtimeRoot, installedToolsRoot, failedReceiptPath);
});
