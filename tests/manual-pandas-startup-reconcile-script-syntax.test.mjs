import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildRecoveryScript, buildExtractScript} from '../tools/manual-pandas-startup-reconcile.mjs';

const pwsh = 'D:/teruisi-runtime/tools/pwsh/pwsh.exe';

/** Parse-only check (never executes): both generated scripts must be syntactically valid PowerShell. */
function assertParsesCleanly(shell, scriptText) {
  const dir = mkdtempSync(path.join(tmpdir(), 'teruisi-pandas-recovery-syntax-'));
  const file = path.join(dir, 'candidate.ps1');
  writeFileSync(file, scriptText, {encoding: 'utf8'});
  try {
    const probe = [
      '$tokens=$null;$errors=$null',
      "$null=[System.Management.Automation.Language.Parser]::ParseFile('" + file.replaceAll('\\', '/') + "',[ref]$tokens,[ref]$errors)",
      'if($errors.Count){$errors | ForEach-Object { Write-Output $_.Message }; exit 1}',
      "Write-Output 'PARSE_OK'",
    ].join('\n');
    const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')], {encoding: 'utf8', windowsHide: true, timeout: 15000});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /PARSE_OK/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

for (const shell of ['powershell.exe', pwsh]) {
  test(`buildRecoveryScript check-mode output parses as valid PowerShell: ${shell}`, () => {
    const script = buildRecoveryScript({
      runtimeRoot: 'C:/fake/runtime', installedToolsRoot: 'C:/fake/tools',
      extractedFunctionsText: 'function Start-PandasSandbox { return $true }\nfunction Complete-PandasRotation { return "{}" }\nfunction Get-PendingPandasRotation { return $null }\nfunction Assert-SamePandasRotation { }\nfunction Assert-PandasInstalledBinding { }',
      failedReceiptPath: 'C:/fake/FAILED.json', check: true,
    });
    assertParsesCleanly(shell, script);
  });
  test(`buildRecoveryScript execute-mode output parses as valid PowerShell: ${shell}`, () => {
    const script = buildRecoveryScript({
      runtimeRoot: 'C:/fake/runtime', installedToolsRoot: 'C:/fake/tools',
      extractedFunctionsText: 'function Start-PandasSandbox { return $true }\nfunction Complete-PandasRotation { return "{}" }\nfunction Get-PendingPandasRotation { return $null }\nfunction Assert-SamePandasRotation { }\nfunction Assert-PandasInstalledBinding { }',
      failedReceiptPath: 'C:/fake/FAILED.json', check: false,
    });
    assertParsesCleanly(shell, script);
  });
  test(`buildExtractScript output parses as valid PowerShell: ${shell}`, () => {
    const script = buildExtractScript('C:/fake/django-ai.ps1', ['Start-PandasSandbox', 'Complete-PandasRotation']);
    assertParsesCleanly(shell, script);
  });
}
