import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const operatorPath = path.join(root, "tools", "django-postgres-maintenance.ps1");
const helperPath = path.join(root, "tools", "postgres-consistent-backup.py");
const powershell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const runtimePython = "D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe";

test("PostgreSQL maintenance operators parse under Windows PowerShell 5", async (t) => {
  if (process.platform !== "win32" || !existsSync(powershell)) {
    t.skip("Windows PowerShell 5 is unavailable");
    return;
  }
  const escapedPath = operatorPath.replaceAll("'", "''");
  const command = [
    "$tokens=$null; $errors=$null;",
    `$source=[IO.File]::ReadAllText('${escapedPath}',[Text.Encoding]::UTF8);`,
    "[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors) | Out-Null;",
    "if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}",
  ].join(" ");
  const result = spawnSync(powershell, [
    "-NoProfile", "-NonInteractive", "-Command", command,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("maintenance reuses the deployed service's strict v4 configuration contract", async () => {
  const script = await readFile(operatorPath, "utf8");
  const context = script.match(
    /function Assert-MaintenanceRuntimeContext \{([\s\S]*?)\r?\n\}/,
  )?.[1];
  assert.ok(context, "runtime context validator must remain discoverable");
  assert.match(context, /\$config = Get-ServiceConfig/);
  assert.match(context, /\$config\.postgresAddress -cne "127\.0\.0\.1:5432"/);
  assert.doesNotMatch(context, /config\.version -ne 3/);
});

test("daily backup is online read-only and never changes managed service state", async () => {
  const script = await readFile(operatorPath, "utf8");
  const backupBlock = script.match(
    /function Invoke-MaintenanceBackup \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction Assert-MaintenanceRehearsalListenerOwnership/,
  )?.[1];
  assert.ok(backupBlock, "backup function must remain discoverable");
  assert.match(backupBlock, /Assert-PostgresListenerOwnership/);
  assert.match(backupBlock, /Test-PostgresReady/);
  assert.match(backupBlock, /权威 PostgreSQL 当前未运行；日常备份不会自动启停服务/);
  assert.match(backupBlock, /postgres-consistent-backup\.py|\$evidenceTool/);
  assert.match(backupBlock, /serviceStateChanged = \$false/);
  assert.doesNotMatch(backupBlock, /Start-Postgres|Stop-Postgres|Start-ServiceStack|Stop-ServiceStack/);
  assert.doesNotMatch(script, /Invoke-WithServiceMutex/);
});

test("backup evidence and archive are bound to one exported PostgreSQL snapshot", async () => {
  const helper = await readFile(helperPath, "utf8");
  const operator = await readFile(operatorPath, "utf8");
  assert.match(helper, /ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(helper, /SELECT pg_export_snapshot\(\)/);
  assert.match(helper, /--snapshot=\{snapshot\}/);
  assert.match(helper, /--format=custom/);
  assert.match(helper, /--no-owner/);
  assert.match(helper, /--no-privileges/);
  assert.match(helper, /contentSha256/);
  assert.match(helper, /canonicalSha256/);
  assert.match(helper, /sales_write_authority/);
  assert.match(helper, /django_migrations/);
  assert.match(helper, /startswith\(ALLOWED_TABLE_PREFIXES\)/);
  assert.match(operator, /pg_restore\.exe/);
  assert.match(operator, /@\("--list", \$dumpPath\)/);
  assert.match(operator, /backup-manifest\.json\.sha256/);
  assert.match(operator, /Read-MaintenanceArchive \$workingDirectory/);
  assert.match(operator, /Move-Item -LiteralPath \$workingDirectory -Destination \$finalDirectory/);
});

test("credentials stay in bounded process environment and diagnostics are redacted", async () => {
  const helper = await readFile(helperPath, "utf8");
  const operator = await readFile(operatorPath, "utf8");
  assert.match(operator, /Invoke-MaintenancePgEnvironment/);
  assert.match(operator, /PGPASSWORD = \$secrets\.OwnerPassword/);
  assert.match(operator, /\[Environment\]::SetEnvironmentVariable\(\$name, \$previous\[\$name\], "Process"\)/);
  assert.doesNotMatch(operator, /--password|--database-url/i);
  assert.match(helper, /psycopg\.connect\(""\)/);
  assert.match(helper, /MAX_NATIVE_DIAGNOSTIC_BYTES/);
  assert.match(helper, /outputSha256/);
  assert.match(helper, /if ":\/\/" in message or "password" in message\.lower\(\)/);
  assert.doesNotMatch(helper, /print\([^\n]*(?:stderr|stdout)/);
});

test("restore rehearsal uses a separate cluster and never creates or drops a production database", async () => {
  const script = await readFile(operatorPath, "utf8");
  const helper = await readFile(helperPath, "utf8");
  const pgCtlStartBlock = script.match(
    /function Invoke-MaintenancePgCtlStart\(([\s\S]*?)\r?\n\}\r?\n\r?\nfunction Remove-MaintenanceRehearsalData/,
  )?.[1];
  const restoreBlock = script.match(
    /function Invoke-MaintenanceRestoreRehearsal \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction Get-MaintenancePrunePlan/,
  )?.[1];
  assert.ok(pgCtlStartBlock, "bounded pg_ctl start helper must remain discoverable");
  assert.ok(restoreBlock, "restore function must remain discoverable");
  assert.match(pgCtlStartBlock, /Start-Process -FilePath \$PgCtl/);
  assert.match(pgCtlStartBlock, /-WindowStyle Hidden/);
  assert.match(pgCtlStartBlock, /-RedirectStandardOutput \$stdoutPath/);
  assert.match(pgCtlStartBlock, /-RedirectStandardError \$stderrPath/);
  assert.match(pgCtlStartBlock, /\.WaitForExit\(45000\)/);
  assert.doesNotMatch(pgCtlStartBlock, /Start-Process[^\r\n]*\s-Wait(?:\s|$)/);
  assert.match(restoreBlock, /initdb\.exe/);
  assert.match(restoreBlock, /createuser\.exe/);
  assert.doesNotMatch(script, /createuser[\s\S]{0,800}--dbname/);
  assert.match(restoreBlock, /rehearsals\\postgres-restore/);
  assert.match(restoreBlock, /--auth-host=scram-sha-256/);
  assert.match(restoreBlock, /-h 127\.0\.0\.1/);
  assert.match(restoreBlock, /max_connections=10/);
  assert.match(restoreBlock, /shared_buffers=128MB/);
  assert.match(restoreBlock, /"restore"/);
  assert.match(restoreBlock, /--timeout-seconds", "1800"/);
  assert.match(helper, /"--single-transaction"/);
  assert.match(helper, /subprocess\.TimeoutExpired/);
  assert.match(restoreBlock, /expectedContentSha256/);
  assert.match(restoreBlock, /restoredContentSha256/);
  assert.match(restoreBlock, /productionDatabaseTouched = \$false/);
  assert.match(restoreBlock, /serviceStateChanged = \$false/);
  assert.match(restoreBlock, /Initialize-MaintenanceRehearsalRoles/);
  assert.match(
    restoreBlock,
    /Assert-MaintenanceRehearsalListenerOwnership[\s\S]*?Initialize-MaintenanceRehearsalRoles/,
  );
  assert.ok(
    restoreBlock.indexOf("Initialize-MaintenanceRehearsalRoles")
      < restoreBlock.indexOf('"restore"'),
    "policy roles must exist before pg_restore replays row-level policies",
  );
  for (const role of [
    "teruisi_sales_owner",
    "teruisi_sales_reader",
    "teruisi_sales_writer",
    "teruisi_erp_reference_sync",
    "teruisi_finance_reader",
    "teruisi_finance_writer",
  ]) {
    assert.match(script, new RegExp(`"${role}"`));
  }
  assert.match(
    restoreBlock,
    /Assert-MaintenanceRehearsalListenerOwnership[\s\S]*?\$isolatedStarted = \$true/,
  );
  assert.doesNotMatch(restoreBlock, /postgresSuperuser|Get-ErpRoleProvisioningSecrets/);
  assert.doesNotMatch(restoreBlock, /DROP DATABASE|CREATE DATABASE/);
  assert.doesNotMatch(restoreBlock, /(?:PGPORT|--port)[^\n]*5432/);
});

test("restore cleanup and retention deletion are constrained to exact child identities", async () => {
  const script = await readFile(operatorPath, "utf8");
  assert.match(script, /restore-\$ExpectedRehearsalId/);
  assert.match(script, /\[IO\.Path\]::GetFileName\(\$data\) -cne "data"/);
  assert.match(script, /@\(Get-PortListeners \$Port\)\.Count -ne 0/);
  assert.match(script, /daily-\[0-9\]\{8\}T\[0-9\]\{6\}Z-\[0-9a-f\]\{12\}/);
  assert.match(script, /minimumSuccessfulBackups/);
  assert.match(script, /ConfirmedPrune/);
  assert.match(script, /\.prune-\[0-9a-f\]\{32\}\\\.quarantine/);
  assert.doesNotMatch(script, /Remove-Item[^\n]*(?:\$RuntimeRoot|\$MaintenanceRequest\.RuntimeRoot)[^\n]*-Recurse/);
});

test("maintenance pure validation rejects schema drift under library mode", async (t) => {
  if (process.platform !== "win32" || !existsSync(powershell)) {
    t.skip("Windows PowerShell 5 is unavailable");
    return;
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "teruisi-pg-maintenance-"));
  try {
    const parent = path.join(tempRoot, "backups");
    const child = path.join(parent, "daily-20260830T010203Z-012345abcdef");
    const escapedScript = operatorPath.replaceAll("'", "''");
    const escapedParent = parent.replaceAll("'", "''");
    const escapedChild = child.replaceAll("'", "''");
    const command = [
      "$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1';",
      `. '${escapedScript}';`,
      `New-Item -ItemType Directory -Path '${escapedChild}' -Force | Out-Null;`,
      `$resolved=Resolve-MaintenanceDirectChildDirectory '${escapedChild}' '${escapedParent}' '^daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$' 'fixture';`,
      `if($resolved -ine [IO.Path]::GetFullPath('${escapedChild}')){exit 2};`,
      "$good=[pscustomobject][ordered]@{a=1;b=2};",
      "Assert-MaintenanceExactPropertySet $good @('a','b') 'fixture';",
      "try {Assert-MaintenanceExactPropertySet $good @('a') 'fixture'; exit 3} catch {};",
      "if(-not (Test-MaintenanceInteger ([int64]1))){exit 4};",
      "if(Test-MaintenanceInteger ([double]1)){exit 5};",
      "exit 0",
    ].join(" ");
    const result = spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", command,
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Python helper imports with the controlled runtime", async (t) => {
  if (!existsSync(runtimePython)) {
    t.skip("controlled Django Python runtime is unavailable");
    return;
  }
  const result = spawnSync(runtimePython, [helperPath, "--help"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\{backup,probe,restore\}/);
  assert.equal(result.stderr, "");
});

test("Python helper snapshot and restore behavior passes isolated unit fixtures", async (t) => {
  if (!existsSync(runtimePython)) {
    t.skip("controlled Django Python runtime is unavailable");
    return;
  }
  const fixture = path.join(root, "tests", "postgres-consistent-backup.test.py");
  const result = spawnSync(runtimePython, [fixture], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 5 tests/);
  assert.match(result.stderr, /OK/);
});
