import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrowserAutomationClient } from "../lib/jackyun/cdp-client";
import { JackyunBrowserStateMachine, isSafePreExportBlockedResume } from "../lib/jackyun/browser-state-machine";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import {
  autoLoginWithSavedBrowserCredentials,
  classifyJackyunSession,
  extractStockAgeOwnerId,
  findLocalDownloadedFile,
  productModeState,
  readRowCountTextState,
  readStockAgeOwnerIdFromPage,
  retryOnceAfterAmbiguousBrowserResult,
  shouldIssueModuleQuery,
  shouldRetryZeroRowQuery,
  waitForNestedControls,
} from "../tools/jackyun-browser-controller";

test("row-count readback requests the exact total before accepting a page-sized grid count", () => {
  assert.deepEqual(readRowCountTextState("共 50+ 条 查看总数"), { approximate: true, exactCounts: [] });
  assert.deepEqual(readRowCountTextState("共 5,556 条"), { approximate: false, exactCounts: [5556] });
  assert.deepEqual(readRowCountTextState("共 0 条"), { approximate: false, exactCounts: [0] });
});

test("dedicated Chrome session classification distinguishes login from authenticated menus", () => {
  assert.equal(classifyJackyunSession("忘记密码 为企业注册吉客号 忘记吉客号 登录"), "login_required");
  assert.equal(classifyJackyunSession("主菜单 货品查询 分仓库存查询"), "authenticated");
  assert.equal(classifyJackyunSession("页面加载中"), "unknown");
});

test("saved-password login submits only Chrome-autofilled fields and never transports secrets", async () => {
  let expression = "";
  const client = {
    async send(_method: string, params?: Record<string, unknown>) {
      expression = String(params?.expression ?? "");
      return { result: { value: { attempted: true, submitted: true, reason: "submitted" } } };
    },
    on() { return () => undefined; },
    close() {},
  } as BrowserAutomationClient;
  assert.deepEqual(await autoLoginWithSavedBrowserCredentials(client, 0), {
    attempted: true,
    submitted: true,
    reason: "submitted",
  });
  assert.match(expression, /:-webkit-autofill/);
  assert.doesNotMatch(expression, /(?:account|password)\.value\b|JACKYUN_(?:USERNAME|PASSWORD)|credentials\.json/i);

  const controllerSource = readFileSync(path.resolve("tools/jackyun-browser-controller.ts"), "utf8");
  const loginSource = readFileSync(path.resolve("tools/jackyun-browser-login.ts"), "utf8");
  assert.doesNotMatch(controllerSource, /JACKYUN_(?:USERNAME|PASSWORD)|valueLength|bodyPreview/);
  assert.doesNotMatch(loginSource, /credentials\.json|\.username\b|\.password\b/);
});

test("daily module order puts sales fourth and combos last", () => {
  assert.deepEqual(jackyunModuleOrder, ["products", "inventory", "inventory_age", "sales", "combos"]);
});

test("browser state machine rejects skipped and out-of-order module states", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-state-test-"));
  try {
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(directory, "state.json"),
      runId: "state-test",
      policyVersion: "test",
    });
    await assert.rejects(machine.transition("inventory", "ENTER_MODULE", {}), /当前模块是 products/);
    await machine.transition("products", "ENTER_MODULE", {});
    await assert.rejects(machine.transition("products", "EXPORT_ONCE", {}), /非法状态转换/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("combo export supports one explicit confirmation state before waiting for download", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-combo-confirm-state-test-"));
  try {
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(directory, "state.json"),
      runId: "combo-confirm-state-test",
      policyVersion: "test",
    });
    const snapshot = machine.snapshot();
    snapshot.currentModule = "combos";
    snapshot.currentState = "EXPORT_ONCE";
    await rm(path.join(directory, "state.json"), { force: true });
    const statePath = path.join(directory, "combo-state.json");
    await writeFile(statePath, JSON.stringify(snapshot), "utf8");
    const comboMachine = await JackyunBrowserStateMachine.load(statePath);
    await comboMachine.transition("combos", "CONFIRM_EXPORT_DIALOG", {
      prompt: "导出列中存在图片列，最多只能导出2000条，确定导出？",
      button: "确定",
    });
    await comboMachine.transition("combos", "WAIT_EVENT_AND_FILE", { confirmedAt: new Date().toISOString() });
    assert.equal(comboMachine.snapshot().currentState, "WAIT_EVENT_AND_FILE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocked or interrupted state can reconcile to the manifest's next module", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-state-resume-test-"));
  try {
    const statePath = path.join(directory, "state.json");
    const machine = await JackyunBrowserStateMachine.create({ statePath, runId: "resume-test", policyVersion: "test" });
    await machine.transition("products", "ENTER_MODULE", {});
    await machine.block("CONNECTION_LOST", "test");
    await machine.reconcileForResume("inventory_age", { manifestVerified: true });
    assert.equal(machine.snapshot().status, "running");
    assert.equal(machine.snapshot().currentModule, "inventory_age");
    assert.equal(machine.snapshot().currentState, "ENTER_MODULE");
    assert.equal(machine.snapshot().failureCode, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocked resume is allowed only before query, export, download, or import intent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-safe-resume-test-"));
  try {
    const statePath = path.join(directory, "state.json");
    const machine = await JackyunBrowserStateMachine.create({ statePath, runId: "safe-resume", policyVersion: "test" });
    await machine.transition("products", "ENTER_MODULE", {});
    await machine.block("DAILY_RUNNER_FAILED", "login required");
    const state = machine.snapshot();
    assert.equal(isSafePreExportBlockedResume(state, "products", { status: "navigated", navigationIntentAt: new Date().toISOString() }), true);
    assert.equal(isSafePreExportBlockedResume(state, "products", { status: "queried", queryIntentAt: new Date().toISOString() }), false);
    const zeroRowState = {
      status: "queried" as const,
      queryIntentAt: new Date().toISOString(),
      tableReadbackFailure: { code: "zero_rows" as const, observedAt: new Date().toISOString() },
    };
    assert.equal(shouldRetryZeroRowQuery(zeroRowState), true);
    assert.equal(isSafePreExportBlockedResume(state, "products", zeroRowState), true);
    assert.equal(shouldRetryZeroRowQuery({ ...zeroRowState, queryRetryCount: 1 }), false);
    assert.equal(isSafePreExportBlockedResume(state, "products", { ...zeroRowState, queryRetryCount: 1 }), false);
    assert.equal(isSafePreExportBlockedResume(state, "products", { status: "export_armed", exportIntentAt: new Date().toISOString() }), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a new browser run only accepts a workbook created after its own export intent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-download-intent-test-"));
  const oldFile = path.join(directory, "货品导出 (1).xlsx");
  const currentFile = path.join(directory, "货品导出 (2).xlsx");
  try {
    const exportIntentMs = Date.now();
    await Promise.all([
      writeFile(oldFile, "old", "utf8"),
      writeFile(currentFile, "current", "utf8"),
    ]);
    await utimes(oldFile, new Date(exportIntentMs - 60_000), new Date(exportIntentMs - 60_000));
    await utimes(currentFile, new Date(exportIntentMs), new Date(exportIntentMs));

    assert.equal(
      await findLocalDownloadedFile(directory, "products", new Date(exportIntentMs).toISOString()),
      currentFile,
    );
    await rm(currentFile, { force: true });
    assert.equal(
      await findLocalDownloadedFile(directory, "products", new Date(exportIntentMs).toISOString()),
      undefined,
    );

    const controllerSource = readFileSync(path.resolve("tools/jackyun-browser-controller.ts"), "utf8");
    assert.doesNotMatch(controllerSource, /findPreExistingDownload|下载目录有可用文件，跳过登录继续导入/);
    assert.match(controllerSource, /browserClientBrowser\.close\(\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser download binding rejects multiple different files but tolerates byte-identical duplicates", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-download-ambiguity-test-"));
  const first = path.join(directory, "货品导出.xlsx");
  const second = path.join(directory, "货品导出 (1).xlsx");
  try {
    const exportIntentMs = Date.now() - 1_000;
    await Promise.all([writeFile(first, "first", "utf8"), writeFile(second, "second", "utf8")]);
    await Promise.all([
      utimes(first, new Date(exportIntentMs + 100), new Date(exportIntentMs + 100)),
      utimes(second, new Date(exportIntentMs + 200), new Date(exportIntentMs + 200)),
    ]);
    await assert.rejects(
      findLocalDownloadedFile(directory, "products", new Date(exportIntentMs).toISOString()),
      /多个不同内容的下载候选/,
    );

    await writeFile(first, "same", "utf8");
    await writeFile(second, "same", "utf8");
    const duplicateIntentMs = Date.now() - 1_000;
    await Promise.all([
      utimes(first, new Date(duplicateIntentMs + 100), new Date(duplicateIntentMs + 100)),
      utimes(second, new Date(duplicateIntentMs + 200), new Date(duplicateIntentMs + 200)),
    ]);
    assert.equal(
      await findLocalDownloadedFile(directory, "products", new Date(duplicateIntentMs).toISOString()),
      first,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("product navigation waits for the nested mode control instead of accepting dashboard text", () => {
  assert.equal(productModeState("驾驶舱 货品查询 公告 系统目录"), "loading");
  assert.equal(productModeState("货品查询 货品模式"), "goods");
  assert.equal(productModeState("货品查询 规格模式(SKU) 货品编号 规格编号"), "sku");
  assert.equal(productModeState("货品查询 规格模式（SKU）"), "sku");
});

test("nested module controls are polled instead of failing on the outer wrapper", async () => {
  let attempts = 0;
  const client = {
    async send() {
      attempts += 1;
      return { result: { value: attempts >= 2 } };
    },
    on() { return () => undefined; },
    close() {},
  } as BrowserAutomationClient;

  await waitForNestedControls(
    client,
    "branch_stock_main",
    [{ controlId: "warehouseCom" }],
    100,
    0,
  );
  assert.equal(attempts, 2);

  const controllerSource = readFileSync(path.resolve("tools/jackyun-browser-controller.ts"), "utf8");
  assert.match(
    controllerSource,
    /await clickAnyTextEventually\(\s*client,\s*\["筛选", "查询"\]/,
  );
  assert.doesNotMatch(controllerSource, /for \(const grid of grids\) \{\s*const fileExport/);
  assert.match(controllerSource, /if \(missing\.length\) continue;/);
  assert.doesNotMatch(controllerSource, /ownerId:\s*"\d{6,32}"/);
});

test("an ambiguous browser result is retried once and can recover by readback", async () => {
  let attempts = 0;
  const result = await retryOnceAfterAmbiguousBrowserResult(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("execution context changed");
    return { count: 245, already: true };
  }, 0);
  assert.deepEqual(result, { count: 245, already: true });
  assert.equal(attempts, 2);
});

test("a persistent browser error still fails after one bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(
    retryOnceAfterAmbiguousBrowserResult(async () => {
      attempts += 1;
      throw new Error("still broken");
    }, 0),
    /still broken/,
  );
  assert.equal(attempts, 2);
});

test("a browser timeout is never retried while the first page action may still be running", async () => {
  let attempts = 0;
  await assert.rejects(
    retryOnceAfterAmbiguousBrowserResult(async () => {
      attempts += 1;
      const error = new Error("page action timed out");
      error.name = "JackyunBrowserTimeoutError";
      throw error;
    }, 0),
    (error: Error) => error.name === "JackyunBrowserTimeoutError",
  );
  assert.equal(attempts, 1);
});

test("stock-age owner scope can be read back and an unconfirmed query is reissued", async () => {
  let expression = "";
  const client = {
    async send(_method: string, params?: Record<string, unknown>) {
      expression = String(params?.expression ?? "");
      return { result: { value: "1639245045540225536" } };
    },
    on() { return () => undefined; },
    close() {},
  } as BrowserAutomationClient;
  assert.equal(await readStockAgeOwnerIdFromPage(client), "1639245045540225536");
  assert.ok(expression.includes("/^\\d{6,32}$/"));
  assert.equal(shouldIssueModuleQuery(true, { status: "navigated", queryIntentAt: "2026-08-04T18:18:11.952Z" }), true);
  assert.equal(shouldIssueModuleQuery(true, { status: "queried", queryIntentAt: "2026-08-04T18:18:11.952Z" }), false);
});

test("stock-age export derives the owner scope from the current query request", () => {
  assert.equal(
    extractStockAgeOwnerId('conditionJson=%7B%22ownerId%22%3A%22987654321012345678%22%7D'),
    "987654321012345678",
  );
  assert.equal(extractStockAgeOwnerId('{"ownerId":"123456"}'), "123456");
  assert.equal(extractStockAgeOwnerId('{"ownerId":""}'), undefined);
  assert.equal(extractStockAgeOwnerId('{"ownerId":"not-an-id"}'), undefined);
});
