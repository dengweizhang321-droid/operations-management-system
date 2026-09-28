import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`Wrangler failures retain stages and native exit codes in ${shell}`, {
    skip: process.platform !== "win32",
    timeout: 60_000,
  }, () => {
    const result = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "tests/django-wrangler-self-check.test.ps1", "-Mode", "negative"], {
      encoding: "utf8", windowsHide: true, timeout: 50_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: negative/);
  });
}
