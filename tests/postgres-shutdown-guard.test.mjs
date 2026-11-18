import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// The guard is Windows PowerShell 5.1 only (System.Windows.Forms, C# 5 compiler).
test('postgres shutdown guard handles session end against a stand-in pg_ctl', {timeout:180000}, () => {
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'tests/postgres-shutdown-guard.test.ps1'], {encoding:'utf8', windowsHide:true, timeout:170000});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
  assert.equal(result.passed, true);
  for (const name of ['query-end-session-allows-shutdown', 'running-stop-arguments', 'block-reason-created-before-stop-removed-after',
    'stop-failure-allows-shutdown-and-is-logged', 'stop-timeout-allows-shutdown-within-bound', 'stopped-database-not-stopped-again',
    'default-pg-ctl-path-is-fixed', 'default-data-directory-is-fixed', 'second-guard-exits-immediately', 'task-command-line',
    'plan-registers-nothing-and-copies-nothing', 'install-and-uninstall-refuse-without-execute']) {
    assert.ok(result.checks.includes(name), name);
  }
});

test('guard and registration scripts keep the UTF-8 BOM and never cancel or delay shutdown', () => {
  const guard = readFileSync('tools/postgres-shutdown-guard.ps1');
  assert.deepEqual([...guard.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'the guard contains Chinese text and needs a BOM for Windows PowerShell 5.1');
  const text = guard.toString('utf8');
  // WM_QUERYENDSESSION must always answer TRUE (allow); the only FALSE-style result is never produced.
  assert.match(text, /m\.Result = \(IntPtr\)1;/);
  assert.doesNotMatch(text, /m\.Result = \(IntPtr\)0;|m\.Result = IntPtr\.Zero;\s*\/\/ block/);
  // Stop only the fixed deployment: no process-name kills, no other stop modes.
  assert.doesNotMatch(text, /Stop-Process|taskkill|-m immediate|-m smart/i);
  assert.match(text, /-m fast -w -t/);
});
