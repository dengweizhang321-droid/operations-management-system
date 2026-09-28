import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`combined backup and maintenance gates preserve admission (${shell})`, {
    skip: process.platform !== "win32", timeout: 60_000,
  }, () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "teruisi-integration-"));
    try {
      const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", "tests/optimization-integration.test.ps1", "-Scratch", scratch], {
        encoding: "utf8", windowsHide: true, timeout: 50_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /PASS: combined/);
    } finally {
      assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
      assert.ok(path.basename(scratch).startsWith("teruisi-integration-"));
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
