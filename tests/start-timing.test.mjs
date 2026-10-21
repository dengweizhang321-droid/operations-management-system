import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import test from 'node:test';

const pwsh = 'D:/teruisi-runtime/tools/pwsh/pwsh.exe';
for (const shell of ['powershell.exe', pwsh]) {
  test(`phase budgets, async receiver and failure gates: ${shell}`, {timeout:60000}, () => {
    assert.ok(shell==='powershell.exe'||existsSync(shell), 'required PowerShell 7 host missing');
    const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File','tests/start-timing.test.ps1','-ChildShell',shell],{encoding:'utf8',windowsHide:true,timeout:55000});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const result=JSON.parse(run.stdout.trim());
    assert.equal(result.passed,true);
    assert.ok(result.checks.length>=33);
  });
}
test('publication receipts and lifecycle gates remain outside this candidate',()=>{
  const diff=spawnSync('git',['diff','--name-only','origin/main'],{encoding:'utf8'});
  assert.equal(diff.status,0,diff.stderr);
  assert.doesNotMatch(diff.stdout,/tools\/(?:main-prebuild-queue\.mjs|django-local-service\.ps1|publish-main-[^\n]+|release-scope-plan\.mjs)/);
  const source=readFileSync('tools/worker-local-service.ps1','utf8');
  assert.doesNotMatch(source,/['"](?:STARTED|FAILED)\.json['"]/);
  assert.match(source,/status='unknown';processEvidence=\$processEvidence/);
  assert.match(source,/Assert-WorkerMaintenanceInactive/);
  assert.match(source,/Assert-WorkerReleaseDrain \$MaintenanceId/);
  assert.match(source,/while \(\$true\) \{\s+\[void\]\(Get-ProcessRemaining \$WorkerOperationDeadline\)/);
});
