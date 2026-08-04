import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrowserAutomationClient } from "../lib/jackyun/cdp-client";
import { JackyunBrowserStateMachine } from "../lib/jackyun/browser-state-machine";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import {
  findLocalDownloadedFile,
  productModeState,
  waitForNestedControls,
} from "../tools/jackyun-browser-controller";

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
});
