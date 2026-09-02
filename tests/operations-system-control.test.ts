import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelBytes = readFileSync("tools/operations-system-control.ps1");
const panel = panelBytes.toString("utf8");
const workerService = readFileSync("tools/worker-local-service.ps1", "utf8");

test("unified controller stays parseable by Windows PowerShell when Chinese text is present", () => {
  assert.deepEqual([...panelBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(panel, /teruisi-operations-system-control-v2/);
  assert.match(panel, /ValidateSet\("Panel", "Start", "Status", "StopWorker"\)/);
});

test("all public start modes share one nonblocking system mutex", () => {
  assert.match(panel, /Local\\TERUISI\.Operations\.SystemControl\.v2/);
  assert.match(panel, /WaitOne\(\[TimeSpan\]::Zero\)/);
  assert.match(panel, /status = "start_in_progress"/);
  assert.match(panel, /本次请求未重复启动任何组件/);
  assert.match(panel, /唯一总控正在启动系统；为避免交错/);
  const startBlock = panel.slice(
    panel.indexOf("function Invoke-SystemStart"),
    panel.indexOf("function Invoke-StopWorker"),
  );
  assert.ok(startBlock.indexOf("Enter-SystemControlMutex") < startBlock.indexOf("Assert-ControllerDependencies"));
});

test("controller checks every authoritative Django PostgreSQL domain", () => {
  assert.match(panel, /django-local-service\.ps1/);
  assert.match(panel, /django-netshop-service\.ps1/);
  assert.match(panel, /django-market-service\.ps1/);
  assert.match(panel, /django-products-service\.ps1/);
  for (const component of ["core", "finance", "netshop", "market", "products"]) {
    assert.match(panel, new RegExp(`${component} = Test-`));
  }
  assert.match(panel, /ErpReferenceSync -ceq "caught_up"/);
  assert.match(panel, /RuntimeAclVerification -ceq "root_only_status"/);
  assert.match(panel, /AuthorityProperty "PostgreSQLAuthority"/);
  assert.match(panel, /AuthorityProperty\]\.Value -cne "postgres"/);
});

test("controller delegates mutation to one start engine and performs final health gates", () => {
  const startBlock = panel.slice(
    panel.indexOf("function Invoke-SystemStart"),
    panel.indexOf("function Invoke-StopWorker"),
  );
  assert.match(startBlock, /调用唯一启动引擎/);
  assert.match(startBlock, /Invoke-VisibleServiceAction -ScriptPath \$LocalWorkerStarter -Arguments @\("-Action", "Start"\)/);
  assert.doesNotMatch(startBlock, /-ScriptPath \$DjangoService -Arguments @\("-Action", "Start"\)/);
  assert.match(startBlock, /finalState\.state -notin @\("Running", "D1Degraded"\)/);
  assert.match(startBlock, /pageProbe\.StatusCode -ne 200/);
});

test("canonical start engine enforces Django readiness before Worker verification", () => {
  const startBlock = workerService.slice(
    workerService.indexOf('if ($Action -eq "Start")'),
    workerService.indexOf('if ($Action -eq "Stop")'),
  );
  assert.ok(startBlock.indexOf("Ensure-DjangoSystemReady") < startBlock.indexOf("Invoke-ReleaseVerification"));
  assert.match(workerService, /DjangoNetshopService/);
  assert.match(workerService, /DjangoMarketService/);
  assert.match(workerService, /DjangoProductsService/);
  assert.match(workerService, /ErpReferenceSync -ceq "caught_up"/);
  assert.match(workerService, /RuntimeAclVerification -ceq "root_only_status"/);
  assert.match(workerService, /function Test-IsIsolatedTestRuntime/);
  assert.match(workerService, /actualRuntime\.Equals\(\$productionRuntime/);
  assert.match(workerService, /if \(Test-IsIsolatedTestRuntime\) \{ return \}/);
});

test("canonical engine clears only an exact validated stale receipt", () => {
  const startBlock = workerService.slice(
    workerService.indexOf('if ($Action -eq "Start")'),
    workerService.indexOf('if ($Action -eq "Stop")'),
  );
  assert.match(startBlock, /status\.State -eq "stale_or_invalid_receipt" -and -not \$status\.Supervisor -and \$status\.Receipt/);
  assert.match(startBlock, /Remove-ExactProcessReceipt \$identity/);
  assert.match(startBlock, /status\.State -ne "stopped"/);
  assert.ok(startBlock.indexOf("Ensure-DjangoSystemReady") < startBlock.lastIndexOf("$status = Get-WorkerStatusInternal $identity"));
  assert.match(startBlock, /unknown\/ambiguous; refusing takeover/);
});

test("controller verifies Worker liveness, readiness and helper health without proxying", () => {
  assert.match(panel, /_teruisi\/local\/health\/live/);
  assert.match(panel, /_teruisi\/local\/health\/ready/);
  assert.match(panel, /127\.0\.0\.1:5791\/health/);
  assert.match(panel, /httpHandler\.UseProxy = \$false/);
  assert.match(panel, /TryAddWithoutValidation\("x-teruisi-local-health", "1"\)/);
  assert.match(panel, /readinessPayload\.code -eq "d1_unavailable"/);
  assert.equal(panel.match(/healthState = "D1Degraded"/g)?.length, 1);
});

test("desktop panel launches the same controller instead of a lower-level service", () => {
  const clickBlock = panel.slice(
    panel.indexOf("$startButton.Add_Click({"),
    panel.indexOf("$stopButton.Add_Click({"),
  );
  assert.match(clickBlock, /-File", "`"\$ControllerPath`"", "-Action", "Start"/);
  assert.doesNotMatch(clickBlock, /-File", "`"\$LocalWorkerStarter/);
  assert.match(panel, /-RedirectStandardOutput \$script:launchStdoutLog/);
  assert.match(panel, /-RedirectStandardError \$script:launchStderrLog/);
  assert.match(panel, /Get-LaunchLogSummary/);
  assert.match(panel, /完整性校验可能需要数分钟/);
});

test("pause remains narrowly scoped to the exact immutable Worker", () => {
  const stopBlock = panel.slice(
    panel.indexOf("function Invoke-StopWorker"),
    panel.indexOf('if ($Action -ne "Panel")'),
  );
  assert.match(stopBlock, /-ScriptPath \$LocalWorkerStarter -Arguments @\("-Action", "Stop"\)/);
  assert.match(stopBlock, /Django\/PostgreSQL 后端继续运行/);
  assert.doesNotMatch(stopBlock, /DjangoService[\s\S]*"Stop"/);
  assert.doesNotMatch(stopBlock, /Stop-Process|taskkill/);
  assert.match(panel, /暂停网页服务/);
});

test("controller never invokes legacy build or development launchers", () => {
  assert.doesNotMatch(panel, /start-local-worker\.mjs|vinext\s+(?:dev|start)|wrangler\s+dev|--build/);
  assert.match(panel, /tools\\worker-local-service\.ps1/);
  assert.match(panel, /pwsh\.exe/);
});
