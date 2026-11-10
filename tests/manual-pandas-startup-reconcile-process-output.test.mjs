import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {runPowerShell5Script, frozenSourceRoot, nativeInvocation} from '../tools/manual-pandas-startup-reconcile.mjs';

const execute = promisify(execFile);

/**
 * A PS5.1 script shaped exactly like Start-PandasSandbox's pending branch:
 * it launches a long-lived grandchild via Start-Process with
 * -RedirectStandardOutput/-RedirectStandardError (the same call
 * Start-ManagedProcess makes for the WSL keepalive), prints its own JSON
 * result immediately, and exits. On Windows, .NET's Process.Start marks
 * this process's own inheritable handles -- including a pipe-based stdout/
 * stderr given to THIS script by its own parent -- as inheritable to that
 * grandchild, so a pipe-based runner never sees EOF until the grandchild
 * itself exits.
 */
function detachedChildScript(markerPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$stdoutFile = Join-Path $env:TEMP ('teruisi-detached-child-stdout-' + [Guid]::NewGuid().ToString('N') + '.log')",
    "$stderrFile = Join-Path $env:TEMP ('teruisi-detached-child-stderr-' + [Guid]::NewGuid().ToString('N') + '.log')",
    "$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60' -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -WindowStyle Hidden -PassThru",
    "[IO.File]::WriteAllText('" + markerPath.replaceAll('\\', '/') + "', [string]$proc.Id)",
    "Write-Output (@{started=$true; childPid=$proc.Id} | ConvertTo-Json -Compress)",
  ].join('\n');
}

async function killIfRunning(pid) {
  if (!pid) return;
  try {
    await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
      ['-NoProfile', '-Command', 'Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue']);
  } catch { /* already gone */ }
}

test('runPowerShell5Script (real process, no mocking): a script that launches a redirected long-lived grandchild still returns within seconds', {timeout: 30000}, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-detached-child-test-'));
  const markerPath = path.join(scratch, 'child-pid.txt');
  const script = detachedChildScript(markerPath);
  const scriptPath = path.join(scratch, 'detached-child.ps1');
  let childPid = null;
  const start = Date.now();
  try {
    const result = await runPowerShell5Script(script, {scriptPath, timeoutMs: 20000});
    const elapsedMs = Date.now() - start;
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.started, true);
    childPid = parsed.childPid;
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    // The whole point of the fix: this must resolve in on the order of a
    // second or two, not wait anywhere near the 20000ms timeout the way a
    // pipe-based runner would (observed before the fix: 15028ms against a
    // 15000ms timeout, for a script whose own body finished in well under
    // a second).
    assert.ok(elapsedMs < 10000, 'took ' + elapsedMs + 'ms; a pipe-based runner would have waited for the grandchild or the timeout');
  } finally {
    await killIfRunning(childPid);
    await fs.rm(scratch, {recursive: true, force: true});
  }
});

test('runPowerShell5Script (mocked runProcess): process_timeout sets unknownOutcome, a real failure does not', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'teruisi-timeout-mock-'));
  try {
    const timeoutRunProcess = async () => {
      const error = new Error('manual-pandas-startup-recovery超时：process_timeout');
      error.processEvidence = {version: 1, code: 'process_timeout', stage: 'output'};
      throw error;
    };
    await assert.rejects(
      runPowerShell5Script('Write-Output 1', {scriptPath: path.join(scratch, 'a.ps1'), runProcess: timeoutRunProcess}),
      error => {
        assert.equal(error.unknownOutcome, true);
        assert.equal(error.processEvidence.code, 'process_timeout');
        return true;
      },
    );

    const failureRunProcess = async () => {
      const error = new Error('manual-pandas-startup-recovery失败：exit=1');
      error.processEvidence = {version: 1, code: 'nonzero_exit', stage: 'completed'};
      throw error;
    };
    await assert.rejects(
      runPowerShell5Script('Write-Output 1', {scriptPath: path.join(scratch, 'b.ps1'), runProcess: failureRunProcess}),
      error => {
        assert.equal(error.unknownOutcome, false);
        assert.equal(error.processEvidence.code, 'nonzero_exit');
        return true;
      },
    );
  } finally {
    await fs.rm(scratch, {recursive: true, force: true});
  }
});

test('runPowerShell5Script: imports the real runProcess from the given frozen source by default', async () => {
  const api = await import(pathToFileURL(path.join(frozenSourceRoot, 'tools/worker-local-release.mjs')));
  assert.equal(typeof api.runProcess, 'function');
});

test('nativeInvocation: -File (not -EncodedCommand), scrubbed environment', () => {
  const invocation = nativeInvocation('C:/fake/script.ps1');
  assert.deepEqual(invocation.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/fake/script.ps1']);
  assert.ok(!('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY' in invocation.env));
  assert.ok(!('TERUISI_NATIVE_ISOLATION_FILE' in invocation.env));
  assert.equal(invocation.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
});
