import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import test from 'node:test';

const pwsh = 'D:/teruisi-runtime/tools/pwsh/pwsh.exe';
const fixedNowIso = new Date().toISOString().replace('Z', '0000Z');
const expectedChecks = ['extracted-real-functions', 'extracted-real-local-helper', 'spawned-live-node-children', 'found-absent-pid',
 'original-branch-still-passes', 'original-branch-expired-still-rejected', 'switch-site-rejects-resume-lease-without-allowresume',
 'resume-branch-all-satisfied-passes', 'resume-branch-rejects-live-original-owner', 'resume-branch-tolerates-recycled-pid',
 'resume-branch-rejects-dead-continuation', 'resume-branch-rejects-expired-continuation', 'resume-branch-rejects-extra-field',
 'resume-branch-rejects-missing-field', 'resume-branch-rejects-binding-pid-mismatch', 'resume-branch-rejects-maincommit-mismatch',
 'resume-branch-rejects-maintenanceid-mismatch', 'resume-branch-rejects-relative-attempt-path',
 'resume-branch-rejects-attempt-outside-release-packages', 'resume-branch-rejects-started-digest-mismatch',
 'resume-branch-rejects-failed-digest-mismatch', 'resume-branch-rejects-maintenance-not-started',
 'resume-branch-rejects-failed-maincommit-mismatch', 'resume-branch-rejects-started-owner-mismatch'];
const results = {};
for (const shell of ['powershell.exe', pwsh]) {
 test(`Pandas publication owner resume branch: ${shell}`, {timeout: 60000}, () => {
  assert.ok(shell === 'powershell.exe' || existsSync(shell), 'required PowerShell 7 host missing');
  const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'tests/pandas-publication-owner-resume.test.ps1', '-FixedNowIso', fixedNowIso], {encoding: 'utf8', windowsHide: true, timeout: 55000});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.passed, true);
  for (const check of expectedChecks) assert.ok(result.checks.includes(check), 'missing check: ' + check);
  results[shell] = result;
 });
}
test('both PowerShell engines ran the same resume-owner checks', () => {
 assert.ok(results['powershell.exe'] && results[pwsh], 'both engine runs must have completed first');
 assert.equal(results['powershell.exe'].psEdition, 'Desktop');
 assert.equal(results[pwsh].psEdition, 'Core');
});
