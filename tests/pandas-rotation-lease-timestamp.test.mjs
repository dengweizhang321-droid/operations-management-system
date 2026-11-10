import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import test from 'node:test';

const pwsh = 'D:/teruisi-runtime/tools/pwsh/pwsh.exe';
// One shared instant fed to both engine runs, so they parse byte-identical
// input instead of each generating its own now() a few hundred ms apart.
const fixedNowIso = new Date().toISOString().replace('Z', '0000Z');
const results = {};
for (const shell of ['powershell.exe', pwsh]) {
  test(`Pandas publication lease timestamps parse identically: ${shell}`, {timeout: 30000}, () => {
    assert.ok(shell === 'powershell.exe' || existsSync(shell), 'required PowerShell 7 host missing');
    const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'tests/pandas-rotation-lease-timestamp.test.ps1', '-FixedNowIso', fixedNowIso], {encoding: 'utf8', windowsHide: true, timeout: 25000});
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.passed, true);
    for (const check of ['extracted-real-functions', 'fresh-lease-not-expired', 'stale-lease-expired', 'sub-second-precision-preserved'])
      assert.ok(result.checks.includes(check), 'missing check: ' + check);
    results[shell] = result;
  });
}
test('both PowerShell engines agree on the exact same lease bytes', () => {
  assert.ok(results['powershell.exe'] && results[pwsh], 'both engine runs must have completed first');
  assert.equal(results['powershell.exe'].freshExpiresAtIso, results[pwsh].freshExpiresAtIso);
  assert.equal(results['powershell.exe'].expiredExpiresAtIso, results[pwsh].expiredExpiresAtIso);
  assert.equal(results['powershell.exe'].psEdition, 'Desktop');
  assert.equal(results[pwsh].psEdition, 'Core');
});
