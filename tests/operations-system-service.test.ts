import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceBytes = readFileSync("tools/operations-system-service.ps1");
const service = serviceBytes.toString("utf8");
const launcher = readFileSync("运营系统.bat", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

function block(start: string, end: string) {
  const from = service.indexOf(start);
  const to = service.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from, `expected ${start} before ${end}`);
  return service.slice(from, to);
}

test("lifecycle service stays parseable by Windows PowerShell 5.1 with Chinese text", () => {
  assert.deepEqual([...serviceBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(service, /ValidateSet\("Start", "Stop", "Restart", "Status", "Logs"\)/);
  assert.match(service, /teruisi-operations-system-service-v1/);
  assert.match(service, /本脚本只用于 Windows 本机正式环境/);
  assert.doesNotMatch(service, /\?\?|\?\./, "PowerShell 7-only operators are not allowed");
});

test("Start never bypasses the unified controller and the single start engine", () => {
  const startBlock = block("function Invoke-Start", "function Invoke-StopWorkerOnly");
  assert.match(startBlock, /Invoke-ControlledScript \$WindowsPowerShellPath \$ControllerPath \$arguments "start"/);
  assert.doesNotMatch(startBlock, /\$DjangoServicePath/);
  assert.doesNotMatch(startBlock, /\$WorkerServicePath/);
  assert.doesNotMatch(service, /\$DjangoServicePath[^\n]*"Start"/);
  assert.doesNotMatch(service, /\$WorkerServicePath[^\n]*"-Action", "Start"/);
});

test("Stop halts the Worker through its identity gate before the Django stack, under the panel mutex", () => {
  const stopBlock = block("function Invoke-Stop {", "function Invoke-Restart");
  assert.ok(stopBlock.indexOf("Enter-SystemControlMutex") < stopBlock.indexOf("Invoke-StopWorkerOnly"));
  assert.ok(stopBlock.indexOf("Invoke-StopWorkerOnly") < stopBlock.indexOf("Invoke-StopDjango"));
  assert.match(stopBlock, /if \(-not \$KeepBackend\) \{ Invoke-StopDjango \}/);
  assert.match(stopBlock, /Exit-SystemControlMutex \$lease/);
  assert.match(service, /Local\\TERUISI\.Operations\.SystemControl\.v2/);
  assert.match(service, /WaitOne\(\[TimeSpan\]::Zero\)/);
  const workerStop = block("function Invoke-StopWorkerOnly", "function Invoke-StopDjango");
  assert.match(workerStop, /\$WorkerServicePath @\("-Action", "Stop"\)/);
  assert.match(workerStop, /@\("stopped", "already_stopped", "stale_receipt_cleared"\)/);
  const djangoStop = block("function Invoke-StopDjango", "function Invoke-Stop {");
  assert.match(djangoStop, /\$DjangoPowerShellPath \$DjangoServicePath @\("-Action", "Stop"/);
});

test("child scripts are waited on through file redirection, never an inherited pipeline", () => {
  const invocation = block("function Invoke-ControlledScript", "function Copy-NewOutput");
  assert.match(invocation, /Start-Process -FilePath \$Executable/);
  assert.match(invocation, /-RedirectStandardOutput \$logs\.Stdout -RedirectStandardError \$logs\.Stderr -PassThru/);
  assert.match(invocation, /\$process\.WaitForExit\(500\)/);
  assert.doesNotMatch(invocation, /=\s*&\s*\$Executable/);
  assert.match(service, /function Write-Line[\s\S]*Write-Host/);
  assert.doesNotMatch(block("function Copy-NewOutput", "function Get-SystemStatus"), /Write-Output/);
});

test("background mode detaches a hidden process and binds its receipt to the process start time", () => {
  const background = block("function Start-InBackground", "function Show-Status");
  assert.match(background, /-WindowStyle Hidden/);
  assert.match(background, /"-File", "`"\$PSCommandPath`"", "-Action", \$Action/);
  assert.match(background, /processStartedAtUnixMs = \$startedAt/);
  assert.match(background, /已有后台任务在执行/);
  const receipt = block("function Read-BackgroundReceipt", "function Start-InBackground");
  assert.match(receipt, /\(Get-ProcessStartUnixMilliseconds \$process\) -eq \[int64\]\$receipt\.processStartedAtUnixMs/);
  assert.match(service, /if \(\$Background -and \$Action -in @\("Start", "Stop", "Restart"\)\)/);
});

function findPowerShell(): string | null {
  for (const candidate of ["pwsh", "pwsh.exe", "powershell.exe"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0 && /^\d+/.test(probe.stdout.trim())) return candidate;
  }
  return null;
}

test("lifecycle service helpers pass their PowerShell unit test when a shell is available", (context) => {
  const shell = findPowerShell();
  if (!shell) {
    context.skip("no PowerShell on PATH");
    return;
  }
  const result = spawnSync(
    shell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "tests/operations-system-service.test.ps1"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: operations-system-service helpers/);
});

test("batch launcher and npm scripts route every action to the lifecycle service", () => {
  assert.match(launcher, /tools\\operations-system-service\.ps1/);
  for (const option of ["start", "start-bg", "stop", "stop-worker", "restart", "restart-bg", "status", "logs"]) {
    assert.match(launcher, new RegExp(`if /i "%CHOICE%"=="${option}"`));
  }
  assert.match(launcher, /-Action Stop -KeepBackend/);
  assert.match(launcher, /-Action Start -Open -Background/);
  for (const [name, action] of [
    ["system:start", "Start"],
    ["system:stop", "Stop"],
    ["system:restart", "Restart"],
    ["system:logs", "Logs"],
  ] as const) {
    assert.equal(
      packageJson.scripts[name],
      `powershell -NoProfile -ExecutionPolicy Bypass -File tools/operations-system-service.ps1 -Action ${action}`,
    );
  }
  assert.equal(packageJson.scripts["backend:dev"], "node tools/django-dev-backend.mjs start");
});
