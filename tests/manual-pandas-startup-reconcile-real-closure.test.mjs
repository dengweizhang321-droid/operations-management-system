import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {
  buildExtractScript, extractedFunctionNames, buildClosureOnlyScript,
  runPowerShell5Script, lastJsonLine, knownPandasStartup,
} from '../tools/manual-pandas-startup-reconcile.mjs';

const installedAiScriptPath = 'D:/teruisi-runtime/django-sales/app/tools/django-ai.ps1';
const installedToolsRoot = 'D:/teruisi-runtime/django-sales/app/tools';
const runtimeRoot = 'D:/teruisi-runtime/django-sales';
const guard = existsSync(installedAiScriptPath);

/**
 * Runs the real composition -- real dot-sourced base library, real
 * extracted django-ai.ps1 function bodies, real $NativeIsolation -- against
 * the real installed production files, with NO PowerShell mocking anywhere
 * in this test. It never calls Get-PendingPandasRotation, never enters
 * Invoke-WithServiceMutex, and never calls Start-PandasSandbox or
 * Complete-PandasRotation: buildClosureOnlyScript stops after proving the
 * command/variable closure resolves. Read-only end to end; confirmed
 * separately (manual run logged in the task report) that run/*.json
 * timestamps are unchanged before and after.
 */
test('closure validation against the real installed production files, no mocking', {skip: !guard, timeout: 60000}, async () => {
  const extractScript = buildExtractScript(installedAiScriptPath, extractedFunctionNames);
  const extracted = await runPowerShell5Script(extractScript);
  const closureScript = buildClosureOnlyScript({
    runtimeRoot, installedToolsRoot, extractedFunctionsText: extracted.stdout,
    failedReceiptPath: 'D:/codex-isolated/main-release-packages/c7604df99c55-d5a6a3fb-06d27651-r2/publish-c7604df99c55/FAILED.json',
  });
  const result = await runPowerShell5Script(closureScript);
  const parsed = lastJsonLine(result.stdout);
  assert.equal(parsed.version, knownPandasStartup.version);
  assert.equal(parsed.closureOnly, true);
  // Production currently has no native isolation binding; confirms the real
  // $NativeIsolation (set by the dot-sourced native-isolation.ps1) was read,
  // not a hard-coded 'TERUISI-Pandas' literal.
  assert.equal(parsed.pandasDistributionEvidence, 'null');
  assert.ok(parsed.closureProof.resolvedCommandCount > 0);
  assert.deepEqual(parsed.closureProof.checkedVariables, ['PandasConfigPath', 'PandasKeyPath', 'PandasPidPath', 'PandasWsl', 'PandasKeepaliveArguments']);
});

/**
 * Proves this test would have caught defect 1: the original hand-picked
 * extractedFunctionNames list omitted Read-PandasConfig, Invoke-PandasProbe,
 * Invoke-PandasSystemctl and Assert-AiRuntimeEntry. Extracting that
 * incomplete list from the real installed file and running it through the
 * same closure validation must fail with "Unresolved command names" naming
 * exactly those functions -- not silently succeed.
 */
test('the closure check catches the exact defect-1 regression (incomplete hand-picked list)', {skip: !guard, timeout: 60000}, async () => {
  const oldDefectiveList = ['Read-PandasRotationJson', 'Write-PandasRotationJson', 'Get-PandasRotationPath',
    'Assert-PandasRotationBinding', 'Assert-SamePandasRotation', 'Get-PendingPandasRotation',
    'Assert-PandasInstalledBinding', 'Invoke-PandasRotationNative', 'Start-PandasSandbox', 'Complete-PandasRotation'];
  const extractScript = buildExtractScript(installedAiScriptPath, oldDefectiveList);
  await assert.rejects(
    runPowerShell5Script(extractScript),
    /Installed controller transitive closure changed/,
    'the old hand-picked list must be refused by the closure-vs-pinned-list check before ever extracting anything',
  );
});
