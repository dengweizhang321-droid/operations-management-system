import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
for (const shell of ['powershell.exe', 'pwsh.exe']) {
  test(`actual source function contracts in ${shell}: synthetic only`, () => {
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', path.resolve('tests/startup-status-receipt-safety.fixture.ps1'), '-RepositoryRoot', process.cwd()], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.cases, 45);
    assert.equal(new Set(evidence.names).size, 45);
    assert.equal(evidence.explicitReadOnlyStatusCalls, 7);
    assert.equal(evidence.productionCalls, 0);
  });
}
