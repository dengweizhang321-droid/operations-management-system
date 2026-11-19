import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Fixture-only: each scenario lowers a short-lived child PowerShell process (never a
// production one), exercises Set-ServiceProcessNormalPriority against a temporary fake
// runtime root and exits. It starts no service and touches no runtime directory.
test("Django controller raises its own CPU/memory/IO priority before starting PostgreSQL", {
  skip: process.platform !== "win32" || !existsSync(powershell), timeout: 300_000,
}, () => {
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "tests/django-local-service-process-priority.test.ps1")],
  { encoding: "utf8", windowsHide: true, timeout: 280_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /failed=0/);
});
