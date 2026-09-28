import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`startup final barrier preserves all domain ownership and failure cleanup (${shell})`, { skip: process.platform !== "win32", timeout: 60_000 }, () => {
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-File", "tests/startup-speed.test.ps1"],
      { encoding: "utf8", windowsHide: true, timeout: 55_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS:/);
  });
}
