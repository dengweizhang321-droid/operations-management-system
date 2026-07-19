import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPolicyModuleOrder, firstIncompleteModuleIndex, runJackyunDaily, validateHandoff } from "../tools/jackyun-daily-runner";
import { JackyunBrowserStateMachine } from "../lib/jackyun/browser-state-machine";

const policy = JSON.parse(readFileSync(path.resolve("config/jackyun-daily-policy.json"), "utf8"));

test("daily policy order matches the executable order", () => {
  assert.doesNotThrow(() => assertPolicyModuleOrder(policy));
});

test("resume starts at the first incomplete module and rejects a broken completed prefix", () => {
  const base = {
    runId: "resume-test",
    updatedAt: "2026-07-17T01:00:00.000Z",
    strictOrder: ["products", "inventory", "inventory_age", "sales", "combos"] as const,
    modules: {
      products: { status: "completed" as const },
      inventory: { status: "completed" as const, salesCostSourcePath: "D:\\run\\inventory.xlsx" },
    },
  };
  assert.equal(firstIncompleteModuleIndex(base), 2);
  assert.throws(() => firstIncompleteModuleIndex({
    ...base,
    modules: {
      products: { status: "completed" as const },
      inventory_age: { status: "completed" as const },
    },
  }), /非连续/);
});

test("daily resume skips completed products and inventory and waits at inventory_age", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-daily-resume-test-"));
  const outputRoot = path.join(directory, "runs");
  const eventDirectory = path.join(directory, "events");
  const runId = "resume-integration";
  const runDirectory = path.join(outputRoot, runId);
  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      version: 1,
      runId,
      startedAt: "2026-07-17T01:00:00.000Z",
      updatedAt: new Date().toISOString(),
      strictOrder: ["products", "inventory", "inventory_age", "sales", "combos"],
      modules: {
        products: { status: "completed", outputPath: "products.xlsx", batchId: "products-batch" },
        inventory: { status: "completed", outputPath: "inventory.xlsx", batchId: "inventory-batch", salesCostSourcePath: "cost.xlsx" },
      },
    }), "utf8");
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(runDirectory, "browser-state.json"), runId, policyVersion: "old",
    });
    await machine.transition("products", "ENTER_MODULE", {});
    const abort = new AbortController();
    setTimeout(() => abort.abort(new Error("test abort")), 20);
    await assert.rejects(runJackyunDaily({
      runId,
      snapshotDate: shanghaiYesterdayForTest(),
      asOfDate: shanghaiYesterdayForTest(),
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      dryRun: false,
      resume: true,
      signal: abort.signal,
    }), /test abort/);
    const resumed = JSON.parse(await readFile(path.join(runDirectory, "browser-state.json"), "utf8"));
    assert.equal(resumed.currentModule, "inventory_age");
    assert.equal(resumed.status, "blocked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function shanghaiYesterdayForTest() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

test("combos handoff requires the fixed 2000-row confirmation evidence", () => {
  const base = {
    module: "combos" as const,
    filePath: "D:\\谷歌浏览器\\组合装及子件导出.xlsx",
    navigationIntentAt: "2026-07-16T01:00:00.000Z",
    tableStableAt: "2026-07-16T01:00:01.000Z",
    exportIntentAt: "2026-07-16T01:00:02.000Z",
    downloadEventAt: "2026-07-16T01:00:04.000Z",
    expectedSourceRows: 1914,
  };
  assert.throws(() => validateHandoff(base, "combos", policy), /必须记录导出确认框/);
  assert.doesNotThrow(() => validateHandoff({
    ...base,
    exportConfirmation: {
      prompt: "导出列中存在图片列，最多只能导出2000条，确定导出？",
      button: "确定",
      confirmedAt: "2026-07-16T01:00:03.000Z",
    },
  }, "combos", policy));
});
