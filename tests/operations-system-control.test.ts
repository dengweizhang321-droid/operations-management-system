import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("tools/operations-system-control.ps1", "utf8");

test("control panel starts only the immutable Worker service and preserves launch diagnostics", () => {
  assert.match(panel, /\$LocalWorkerStarter = Join-Path \$ProjectRoot "tools\\worker-local-service\.ps1"/);
  assert.match(panel, /-File", "`"\$LocalWorkerStarter`"", "-Action", "Start"/);
  assert.match(panel, /-RedirectStandardOutput \$script:launchStdoutLog/);
  assert.match(panel, /-RedirectStandardError \$script:launchStderrLog/);
  assert.match(panel, /\$script:launchProcess\.WaitForExit\(\)/);
  assert.match(panel, /\$exitCode = "未知"/);
  assert.match(panel, /启动失败，退出码/);
  assert.doesNotMatch(panel, /\$VinextCli/);
  assert.doesNotMatch(panel, /start-local-worker\.mjs|--build/);
  assert.doesNotMatch(panel, /Start-Sleep -Seconds 1/);
});

test("control panel rechecks immutable service ownership immediately before launch", () => {
  assert.match(panel, /\$actionState = Get-SystemState/);
  assert.match(panel, /\$actionState\.State -in @\("Running", "D1Degraded", "Unresponsive"\)/);
  assert.match(panel, /\$actionState\.State -eq "PortInUse"/);
  assert.match(panel, /为避免覆盖运行中的构建，本次启动已取消/);
});

test("control panel checks loopback liveness before interpreting D1 readiness", () => {
  assert.match(panel, /\$LivenessUrl = "http:\/\/127\.0\.0\.1:3000\/_teruisi\/local\/health\/live"/);
  assert.match(panel, /\$ReadinessUrl = "http:\/\/127\.0\.0\.1:3000\/_teruisi\/local\/health\/ready"/);
  assert.match(panel, /\$handler\.UseProxy = \$false/);
  assert.match(panel, /\$client\.Timeout = \[TimeSpan\]::FromSeconds\(2\)/);
  assert.match(panel, /TryAddWithoutValidation\("x-teruisi-local-health", "1"\)/);

  const healthStateStart = panel.indexOf("function Get-SystemHealthState");
  const livenessProbe = panel.indexOf("Invoke-SystemHealthProbe -Uri $LivenessUrl", healthStateStart);
  const readinessProbe = panel.indexOf("Invoke-SystemHealthProbe -Uri $ReadinessUrl", healthStateStart);
  assert.ok(healthStateStart >= 0);
  assert.ok(livenessProbe > healthStateStart);
  assert.ok(readinessProbe > livenessProbe);
  assert.match(panel, /\$liveness\.StatusCode -eq 200[^\n]*\$livenessPayload\.ok -eq \$true[^\n]*\$livenessPayload\.status -eq "live"/);
});

test("control panel labels only the explicit D1 503 contract as degraded", () => {
  assert.match(panel, /\$healthState = "Unresponsive"/);
  assert.match(panel, /\$readiness\.StatusCode -eq 503/);
  assert.match(panel, /\$readinessPayload\.ok -eq \$false/);
  assert.match(panel, /\$readinessPayload\.status -eq "degraded"/);
  assert.match(panel, /\$readinessPayload\.code -eq "d1_unavailable"/);
  assert.match(panel, /\$healthState = "D1Degraded"/);
  assert.equal(panel.match(/\$healthState = "D1Degraded"/g)?.length, 1);
  assert.match(panel, /"D1Degraded"/);
  assert.match(panel, /D1 暂时降级/);
  assert.match(panel, /"Unresponsive"/);
  assert.match(panel, /Worker 无响应 \/ 重启中/);
  assert.match(panel, /State = \$state/);
  assert.match(panel, /系统会继续运行且不会因此重启/);
  assert.doesNotMatch(panel, /D1 尚未就绪；看门狗会在连续失败后受控重启/);
  assert.match(panel, /TotalSeconds -lt 10/);
});

test("reopened control panel delegates status to the immutable service", () => {
  const stateStart = panel.indexOf("function Get-SystemState");
  const stopTreeStart = panel.indexOf("function Stop-ProcessTree");
  assert.ok(stateStart >= 0);
  assert.ok(stopTreeStart > stateStart);
  const stateBlock = panel.slice(stateStart, stopTreeStart);
  assert.match(stateBlock, /-File \$LocalWorkerStarter -Action Status -Json/);
  assert.match(stateBlock, /\$releaseState\.state -eq "exact_release"/);
  assert.match(stateBlock, /SupervisorProcessId = \[int\]\$releaseState\.supervisorProcessId/);
});

test("reopened control panel delegates stop to the same fail-closed immutable service", () => {
  assert.match(panel, /function Stop-ControlledLocalWorker/);
  assert.match(panel, /-File \$LocalWorkerStarter -Action Stop -Json/);
  assert.match(panel, /\$result\.status -notin @\("stopped", "already_stopped", "stale_receipt_cleared"\)/);

  assert.match(panel, /\$stopResult = Stop-ControlledLocalWorker/);
  assert.match(panel, /为避免影响 n8n、Chromium 或其他 Node 服务，本次停止已取消/);
  assert.doesNotMatch(panel, /foreach \(\$processId in \$systemState\.ProcessIds\)/);

  const clickStart = panel.indexOf("$stopButton.Add_Click({");
  const clickEnd = panel.indexOf("$openButton.Add_Click({", clickStart);
  const clickBlock = panel.slice(clickStart, clickEnd);
  assert.ok(clickBlock.indexOf("Stop-ControlledLocalWorker") < clickBlock.indexOf("if ($script:launchProcess"));
  assert.match(clickBlock, /构建尚未监听 3000 时，只能停止当前面板亲自创建并持有句柄的启动进程/);
});

test("control panel exposes a headless stop entry that reuses the same ownership gate", () => {
  assert.match(panel, /\[switch\]\$StopWorker/);
  assert.match(panel, /if \(\$StopWorker\) \{[\s\S]*\$stopResult = Stop-ControlledLocalWorker/);
  assert.match(panel, /Stopped: local Worker supervisor and verified project descendants/);
  assert.match(panel, /Write-Error \$stopResult\.Reason[\s\S]*exit 1/);
});
