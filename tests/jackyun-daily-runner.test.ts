import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  JackyunDailyRunError,
  assertPolicyModuleOrder,
  classifyJackyunDailyFailure,
  classifyJackyunModuleResult,
  firstIncompleteModuleIndex,
  runJackyunDaily,
  validateHandoff,
} from "../tools/jackyun-daily-runner";
import {
  assertJackyunDailyDatePolicy,
  runJackyunAutomationUnderLock,
  settleJackyunAutomationResults,
} from "../tools/jackyun-automation-runner";
import { JackyunBrowserStateMachine } from "../lib/jackyun/browser-state-machine";

const policy = JSON.parse(readFileSync(path.resolve("config/jackyun-daily-policy.json"), "utf8"));

const boundDownloadProvenance = (runId: string, module: "products" | "inventory" | "combos") => ({
  runId,
  module,
  policyVersion: policy.version,
  downloadId: "download-test-0001",
  method: "browser_event" as const,
  completedAt: "2026-07-16T01:00:04.000Z",
  originalFileName: "测试.xlsx",
  sha256: "a".repeat(64),
  bytes: 1024,
});

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

test("daily resume refuses a completed prefix whose archived audit evidence is missing", async () => {
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
    const snapshotDate = shanghaiYesterdayForTest();
    await writeFile(path.join(runDirectory, "daily-run-contract.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: policy.version,
      snapshotDate,
      asOfDate: snapshotDate,
      baseUrl: "http://localhost:3000",
      mode: "formal",
      createdAt: new Date().toISOString(),
    }), "utf8");
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(runDirectory, "browser-state.json"), runId, policyVersion: policy.version,
    });
    await machine.transition("products", "ENTER_MODULE", {});
    const abort = new AbortController();
    setTimeout(() => abort.abort(new Error("test abort")), 20);
    await assert.rejects(runJackyunDaily({
      runId,
      snapshotDate,
      asOfDate: snapshotDate,
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      dryRun: false,
      resume: true,
      signal: abort.signal,
    }), /审计|ENOENT|JSON 文件损坏或无法读取/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("direct automation preflight rejects unsafe existing runs before starting either worker", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-automation-preflight-test-"));
  const outputRoot = path.join(directory, "runs");
  const eventDirectory = path.join(directory, "events");
  const runId = "automation-preflight";
  const runDirectory = path.join(outputRoot, runId);
  let browserStarts = 0;
  let dailyStarts = 0;
  try {
    await mkdir(runDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
        version: 1,
        runId,
        updatedAt: "2026-08-05T01:00:10.000Z",
        strictOrder: ["products", "inventory", "inventory_age", "sales", "combos"],
        modules: {
          products: {
            module: "products",
            status: "completed",
            batchId: `products:${"a".repeat(64)}`,
          },
        },
      }), "utf8"),
      writeFile(path.join(runDirectory, "daily-run-contract.json"), JSON.stringify({
        version: 1,
        runId,
        policyVersion: policy.version,
        snapshotDate: "2026-08-05",
        asOfDate: "2026-08-05",
        baseUrl: "http://localhost:3000",
        mode: "formal",
        createdAt: "2026-08-05T01:00:00.000Z",
      }), "utf8"),
    ]);

    await assert.rejects(runJackyunAutomationUnderLock({
      runId,
      snapshotDate: "2026-08-05",
      asOfDate: "2026-08-05",
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      resume: true,
      dryRun: false,
      headless: true,
    }, {
      runBrowser: async () => {
        browserStarts += 1;
        return { status: "completed" } as never;
      },
      runDaily: async () => {
        dailyStarts += 1;
        return { status: "completed" } as never;
      },
    }), /审计|ENOENT|JSON 文件损坏或无法读取/);
    assert.equal(browserStarts, 0);
    assert.equal(dailyStarts, 0);
    await assert.rejects(runJackyunAutomationUnderLock({
      runId,
      snapshotDate: "2026-08-05",
      asOfDate: "2026-08-05",
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      resume: false,
      dryRun: false,
      headless: true,
    }, {
      runBrowser: async () => {
        browserStarts += 1;
        return { status: "completed" } as never;
      },
      runDaily: async () => {
        dailyStarts += 1;
        return { status: "completed" } as never;
      },
    }), /已经存在.*--resume/);
    assert.equal(browserStarts, 0);
    assert.equal(dailyStarts, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily rejects a prepared manifest instead of promoting dry-run state to completed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-daily-prepared-test-"));
  const outputRoot = path.join(directory, "runs");
  const eventDirectory = path.join(directory, "events");
  const runId = "prepared-cannot-resume";
  const runDirectory = path.join(outputRoot, runId);
  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      version: 1,
      runId,
      startedAt: "2026-07-17T01:00:00.000Z",
      updatedAt: new Date().toISOString(),
      strictOrder: ["products", "inventory", "inventory_age", "sales", "combos"],
      modules: { products: { module: "products", status: "prepared" } },
    }), "utf8");
    const snapshotDate = shanghaiYesterdayForTest();
    await writeFile(path.join(runDirectory, "daily-run-contract.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: policy.version,
      snapshotDate,
      asOfDate: snapshotDate,
      baseUrl: "http://localhost:3000",
      mode: "formal",
      createdAt: new Date().toISOString(),
    }), "utf8");
    await assert.rejects(runJackyunDaily({
      runId,
      snapshotDate,
      asOfDate: snapshotDate,
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      dryRun: false,
      resume: true,
    }), /prepared.*不得续跑|dry-run prepared/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily refuses to resume a legacy manifest without the current policy and date contract", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-daily-legacy-contract-test-"));
  const outputRoot = path.join(directory, "runs");
  const eventDirectory = path.join(directory, "events");
  const runId = "legacy-contract-cannot-resume";
  const runDirectory = path.join(outputRoot, runId);
  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      version: 1,
      runId,
      startedAt: "2026-08-05T01:00:00.000Z",
      updatedAt: "2026-08-05T01:10:00.000Z",
      strictOrder: ["products", "inventory", "inventory_age", "sales", "combos"],
      modules: { products: { module: "products", status: "completed" } },
    }), "utf8");
    const snapshotDate = shanghaiYesterdayForTest();
    await assert.rejects(runJackyunDaily({
      runId,
      snapshotDate,
      asOfDate: snapshotDate,
      eventDirectory,
      outputRoot,
      baseUrl: "http://localhost:3000",
      dryRun: false,
      resume: true,
    }), /缺少当前版本.*证据契约|不得续跑/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily runner result classification keeps prepared separate from verified completion", () => {
  assert.equal(classifyJackyunModuleResult({ status: "prepared" }, true), "prepared");
  assert.equal(classifyJackyunModuleResult({ status: "completed" }, false), "verified_completed");
  assert.equal(classifyJackyunModuleResult({ status: "duplicate_ignored", existing: { status: "completed" } }, false), "verified_completed");
  assert.throws(() => classifyJackyunModuleResult({ status: "prepared" }, false), /只接受已核验 completed/);
  assert.throws(() => classifyJackyunModuleResult({ status: "completed" }, true), /只能产生 prepared/);
  assert.throws(
    () => classifyJackyunModuleResult({ status: "duplicate_ignored", existing: { status: "prepared" } }, false),
    /只接受已核验 completed/,
  );
});

test("daily failure classification preserves structured codes and runner audit stages", () => {
  assert.deepEqual(classifyJackyunDailyFailure({
    error: Object.assign(new Error("exact batch mismatch"), { failureCode: "BATCH_VERIFY_FAILED", stage: "verify_exact_import_batch" }),
    dailyStage: "run_download_runner",
  }), { failureCode: "BATCH_VERIFY_FAILED", stage: "verify_exact_import_batch" });
  assert.deepEqual(classifyJackyunDailyFailure({
    error: new Error("download runner failed"),
    dailyStage: "run_download_runner",
    runnerAudit: { error: { stage: "verify_download_binding" } },
  }), { failureCode: "FILE_BINDING_FAILED", stage: "verify_download_binding" });
  assert.deepEqual(classifyJackyunDailyFailure({
    error: new Error("当前是吉客云登录页"),
    dailyStage: "wait_browser_handoff",
  }), { failureCode: "AUTH_REQUIRED", stage: "wait_browser_handoff" });
});

test("automation settlement reports a dry-run as prepared and rejects mixed formal states", () => {
  const prepared = settleJackyunAutomationResults({
    dryRun: true,
    runId: "dry-run",
    browserSettled: { status: "rejected", reason: new Error("products 下载后处理未完成。") },
    dailySettled: { status: "fulfilled", value: { status: "prepared", preparedModule: "products" } },
  });
  assert.equal((prepared.browserResult as { status: string }).status, "prepared");
  assert.equal((prepared.dailyResult as { status: string }).status, "prepared");
  assert.throws(() => settleJackyunAutomationResults({
    dryRun: false,
    runId: "formal",
    browserSettled: { status: "fulfilled", value: { status: "completed" } },
    dailySettled: { status: "fulfilled", value: { status: "prepared" } },
  }), /只能汇总 completed/);
  const structured = new JackyunDailyRunError("IMPORT_FAILED", "chunk_upload_and_import", "upload failed");
  assert.throws(() => settleJackyunAutomationResults({
    dryRun: false,
    runId: "formal-failed",
    browserSettled: { status: "rejected", reason: new Error("peer aborted") },
    dailySettled: { status: "rejected", reason: structured },
  }), (error) => error === structured);
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
    schemaVersion: 2 as const,
    runId: "run-1",
    policyVersion: policy.version,
    module: "combos" as const,
    filePath: "D:\\谷歌浏览器\\组合装及子件导出.xlsx",
    navigationIntentAt: "2026-07-16T01:00:00.000Z",
    tableStableAt: "2026-07-16T01:00:01.000Z",
    exportIntentAt: "2026-07-16T01:00:02.000Z",
    downloadEventAt: "2026-07-16T01:00:04.000Z",
    expectedSourceRows: 1914,
    downloadProvenance: boundDownloadProvenance("run-1", "combos"),
  };
  assert.throws(() => validateHandoff(base, "combos", policy, { runId: "run-1" }), /必须记录导出确认框/);
  assert.doesNotThrow(() => validateHandoff({
    ...base,
    exportConfirmation: {
      prompt: "导出列中存在图片列，最多只能导出2000条，确定导出？",
      button: "确定",
      confirmedAt: "2026-07-16T01:00:03.000Z",
    },
  }, "combos", policy, { runId: "run-1" }));
  assert.throws(() => validateHandoff({
    ...base,
    downloadEventAt: "2026-07-16T01:00:04.001Z",
    exportConfirmation: {
      prompt: "导出列中存在图片列，最多只能导出2000条，确定导出？",
      button: "确定",
      confirmedAt: "2026-07-16T01:00:03.000Z",
    },
  }, "combos", policy, { runId: "run-1" }), /FILE_BINDING_FAILED/);
});

test("historical snapshot handoffs require exact run, date, and timeline evidence", () => {
  const handoff = {
    schemaVersion: 2 as const,
    runId: "snapshot-run",
    policyVersion: policy.version,
    module: "inventory" as const,
    filePath: "D:\\谷歌浏览器\\分仓库存查询.xlsx",
    navigationIntentAt: "2026-07-16T01:00:00.000Z",
    queryIntentAt: "2026-07-16T01:00:02.000Z",
    tableStableAt: "2026-07-16T01:00:03.000Z",
    exportIntentAt: "2026-07-16T01:00:03.500Z",
    downloadEventAt: "2026-07-16T01:00:04.000Z",
    expectedSourceRows: 22_000,
    downloadProvenance: boundDownloadProvenance("snapshot-run", "inventory"),
    snapshotEvidence: {
      version: 1 as const,
      module: "inventory" as const,
      runId: "snapshot-run",
      source: "historical_date_control" as const,
      targetDate: "2026-07-15",
      observedDate: "2026-07-15",
      controlReadbackAt: "2026-07-16T01:00:01.000Z",
      queryIntentAt: "2026-07-16T01:00:02.000Z",
      queryRefreshSource: "module_network_request" as const,
      queryRefreshCompletedAt: "2026-07-16T01:00:02.500Z",
      tableStableAt: "2026-07-16T01:00:03.000Z",
    },
  };
  assert.doesNotThrow(() => validateHandoff(handoff, "inventory", policy, {
    runId: "snapshot-run",
    snapshotDate: "2026-07-15",
  }));
  assert.throws(() => validateHandoff({
    ...handoff,
    snapshotEvidence: { ...handoff.snapshotEvidence, queryRefreshSource: "miniui_grid_lifecycle" as const },
  }, "inventory", policy, {
    runId: "snapshot-run",
    snapshotDate: "2026-07-15",
  }), /FIELD_MISMATCH/);
  assert.throws(() => validateHandoff({
    ...handoff,
    snapshotEvidence: { ...handoff.snapshotEvidence, observedDate: "2026-07-14" },
  }, "inventory", policy, {
    runId: "snapshot-run",
    snapshotDate: "2026-07-15",
  }), /FIELD_MISMATCH/);
  assert.throws(() => validateHandoff({
    ...handoff,
    runId: "other-run",
  }, "inventory", policy, {
    runId: "snapshot-run",
    snapshotDate: "2026-07-15",
  }), /FILE_BINDING_FAILED/);
  assert.throws(() => validateHandoff({
    ...handoff,
    module: "products",
    downloadProvenance: boundDownloadProvenance("snapshot-run", "products"),
  }, "products", policy, { runId: "snapshot-run" }), /不允许携带历史快照/);
});

test("public daily automation boundary only accepts Shanghai yesterday for both dates", () => {
  const yesterday = shanghaiYesterdayForTest();
  assert.doesNotThrow(() => assertJackyunDailyDatePolicy(yesterday, yesterday));
  assert.throws(() => assertJackyunDailyDatePolicy("2026-08-01", yesterday), /北京时间昨天/);
  assert.throws(() => assertJackyunDailyDatePolicy(yesterday, "2026-08-01"), /北京时间昨天/);
});
