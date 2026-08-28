import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = readFileSync("tools/django-local-service.ps1", "utf8");

test("Django local service binds PostgreSQL and Waitress to loopback with bounded requests", () => {
  assert.match(script, /127\.0\.0\.1:5432\/teruisi_sales/);
  assert.match(script, /--listen=127\.0\.0\.1:8001/);
  assert.match(script, /--max-request-header-size=\$MaxHeaderBytes/);
  assert.match(script, /--max-request-body-size=\$MaxBodyBytes/);
  assert.doesNotMatch(script, /--listen=0\.0\.0\.0|listen_addresses\s*=\s*['"]\*/);
});

test("Django local service uses deterministic production secrets and least-privilege roles", () => {
  assert.match(script, /ConvertTo-SecureString \$ProtectedValue/);
  assert.match(script, /databaseWriter/);
  assert.match(script, /teruisi_sales_writer/);
  assert.match(script, /TERUISI_DJANGO_ENVIRONMENT = "production"/);
  assert.match(script, /TERUISI_DJANGO_PROCESS_ROLE = \$ProcessRole/);
  assert.match(script, /statement_timeout=\$StatementTimeoutMilliseconds/);
  assert.match(script, /\$ReaderStatementTimeoutMs = 7000/);
  assert.doesNotMatch(script, /teruisi_sales_owner/);
  assert.doesNotMatch(script, /--(?:password|secret|database-url)/i);
});

test("managed PID ownership survives venv launchers without weakening identity checks", () => {
  assert.match(script, /creationDate = \$snapshot\.CreationDate/);
  assert.match(script, /launcherPath = Get-CanonicalPath \$Executable/);
  assert.match(script, /executablePath = \$snapshot\.ExecutablePath/);
  assert.match(script, /\$snapshot\.CommandLine -ceq \[string\]\$record\.commandLine/);
  assert.match(script, /\[string\]\$record\.service -cne \$Service/);
  assert.match(script, /Test-ExactStringArray \$recordArguments \$ExpectedArguments/);
  assert.match(script, /Test-CommandLineReferencesPath \$snapshot\.CommandLine \$ExpectedLauncher/);
  assert.doesNotMatch(script, /\$snapshot\.ExecutablePath -ieq \(Get-CanonicalPath \$ExpectedLauncher\)/);
});

test("PostgreSQL reuse proves listener executable and exact data directory before credentials", () => {
  assert.match(script, /Get-NetTCPConnection -State Listen -ErrorAction Stop/);
  assert.match(script, /LocalPort -eq \$Port/);
  assert.match(script, /Assert-PostgresListenerOwnership/);
  assert.match(script, /\[regex\]::Matches\(\$snapshot\.CommandLine, '[^']*-D/);
  assert.match(script, /Get-CanonicalPath \$PostgresData/);
  assert.match(script, /Invoke-PgCtl/);
  assert.match(script, /WaitForExit\(\$TimeoutSeconds \* 1000\)/);
  assert.doesNotMatch(script, /& \$pgCtl start/);
});

test("startup is mutexed, catch-up gated, rollback-safe, and logged with retention", () => {
  assert.match(script, /\[Threading\.Mutex\]::new/);
  assert.match(script, /Invoke-ProjectionCatchUp/);
  assert.match(script, /projection_caught_up/);
  assert.match(script, /if \(\$syncStarted\) \{\s+try \{ Stop-OwnedProcess/);
  assert.match(script, /if \(\$djangoStarted\) \{\s+try \{ Stop-OwnedProcess/);
  assert.match(script, /if \(\$postgresStarted\) \{\s+try \{ Stop-Postgres/);
  assert.match(script, /launcher\.jsonl/);
  assert.match(script, /Remove-OldServiceLogs/);
});

test("runtime deployment and ACL hardening precede an exact startup shortcut", () => {
  assert.match(script, /"DeployApp", "HardenAcl"/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /SetAccessRuleProtection\(\$false, \$false\)/);
  assert.match(script, /Assert-RuntimeAclHardened/);
  assert.match(script, /\$InstalledScriptPath/);
  assert.match(script, /-RuntimeRoot `"\$RuntimeRoot`"/);
  assert.match(script, /Assert-DeployedApplication/);
  assert.match(script, /__pycache__/);
  assert.match(script, /\.pyc/);
  assert.match(script, /Start 必须从受保护的 runtime app 启动脚本执行/);
  assert.match(script, /RemoveStartup/);
});

test(
  "Windows managed-process round trip accepts protected venv launchers",
  { skip: process.platform !== "win32" || !existsSync("D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe") },
  () => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests\\django-local-service-process-identity.test.ps1"],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: launcher=/);
  },
);
