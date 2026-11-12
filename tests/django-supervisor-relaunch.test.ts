import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Fixture-only: the script uses a temporary fake runtime root and stubs every
// process-touching function; it never creates a process or touches production.
test("Django supervisor relaunch and stop-wait logic holds under PowerShell 5", {
  skip: process.platform !== "win32" || !existsSync(powershell), timeout: 120_000,
}, () => {
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "tests/django-supervisor-relaunch.test.ps1")],
  { encoding: "utf8", windowsHide: true, timeout: 100_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /failed=0/);
});
