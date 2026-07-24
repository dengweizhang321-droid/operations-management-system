import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("tools/operations-system-control.ps1", "utf8");

test("control panel starts the built local Worker and preserves launch diagnostics", () => {
  assert.match(panel, /\$LocalWorkerStarter = Join-Path \$ProjectRoot "tools\\start-local-worker\.mjs"/);
  assert.match(panel, /-ArgumentList @\("`"\$LocalWorkerStarter`"", "--build"\)/);
  assert.match(panel, /-RedirectStandardOutput \$script:launchStdoutLog/);
  assert.match(panel, /-RedirectStandardError \$script:launchStderrLog/);
  assert.match(panel, /启动失败，退出码/);
  assert.doesNotMatch(panel, /\$VinextCli/);
  assert.doesNotMatch(panel, /Start-Sleep -Seconds 1/);
});
