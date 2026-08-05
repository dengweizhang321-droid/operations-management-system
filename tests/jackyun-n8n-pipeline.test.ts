import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import {
  getJackyunProfileStatus,
  jackyunHelperRequestError,
  normalizeJackyunLocalBaseUrl,
  planJackyunN8nRun,
  publicJackyunPlan,
  runJackyunN8nPlan,
  shanghaiDate,
  verifyJackyunN8nPlan,
} from "../tools/jackyun-n8n-pipeline";

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-n8n-test-"));
  const profileDirectory = path.join(root, ".runtime", "jackyun-chrome-profile");
  await mkdir(path.join(profileDirectory, "Default"), { recursive: true });
  await writeFile(path.join(profileDirectory, "Local State"), "{}\n", "utf8");
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config", "jackyun-daily-policy.json"), JSON.stringify({
    version: "test-policy",
    moduleOrder: jackyunModuleOrder,
    browser: { controller: { profileDirectory } },
  }), "utf8");
  return { root, profileDirectory };
}

async function writeCompletedRun(root: string, runId: string, asOfDate: string, missingBatchModule?: string) {
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const auditDirectory = path.join(runDirectory, "audit");
  await mkdir(auditDirectory, { recursive: true });
  const results = [];
  for (const moduleKey of jackyunModuleOrder) {
    const auditPath = path.join(auditDirectory, `${moduleKey}.json`);
    await writeFile(auditPath, "{}\n", "utf8");
    results.push({
      module: moduleKey,
      status: "completed",
      batchId: moduleKey === missingBatchModule ? null : `${moduleKey}:batch`,
      rowCount: 10,
      warningCount: 0,
      auditPath,
    });
  }
  await Promise.all([
    writeFile(path.join(runDirectory, "daily-summary.json"), JSON.stringify({
      status: "completed",
      runId,
      policyVersion: "test-policy",
      salesAsOfDate: asOfDate,
      results,
    }), "utf8"),
    writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      runId,
      strictOrder: jackyunModuleOrder,
      modules: Object.fromEntries(jackyunModuleOrder.map((moduleKey) => [moduleKey, { status: "completed", batchId: `${moduleKey}:batch` }])),
    }), "utf8"),
  ]);
}

async function writeResumablePartialRun(root: string, runId: string, inventoryAgeState: "navigated" | "zero_rows" | "retried_zero_rows" = "navigated") {
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const eventDirectory = path.join(root, "outputs", "jackyun-browser-events", runId);
  await Promise.all([mkdir(runDirectory, { recursive: true }), mkdir(eventDirectory, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      runId,
      strictOrder: jackyunModuleOrder,
      modules: {
        products: { status: "completed", batchId: "products:batch" },
        inventory: { status: "completed", batchId: "inventory:batch" },
      },
    }), "utf8"),
    writeFile(path.join(runDirectory, "browser-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: "test-policy",
      status: "blocked",
      currentModule: "inventory_age",
      currentState: "BLOCKED",
      stateEnteredAt: "2026-08-04T11:00:10.000Z",
      events: [
        { module: "inventory_age", state: "ENTER_MODULE", enteredAt: "2026-08-04T11:00:00.000Z", elapsedMs: 10_000, evidence: {} },
      ],
    }), "utf8"),
    writeFile(path.join(runDirectory, "browser-controller-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: "test-policy",
      modules: {
        products: { status: "completed" },
        inventory: { status: "completed" },
        inventory_age: inventoryAgeState === "navigated"
          ? { status: "navigated", navigationIntentAt: "2026-08-04T11:00:00.000Z" }
          : {
              status: "queried",
              navigationIntentAt: "2026-08-04T11:00:00.000Z",
              queryIntentAt: "2026-08-04T11:00:01.000Z",
              queryRetryCount: inventoryAgeState === "retried_zero_rows" ? 1 : 0,
              tableReadbackFailure: { code: "zero_rows", observedAt: "2026-08-04T11:00:10.000Z" },
            },
      },
    }), "utf8"),
    writeFile(path.join(eventDirectory, "01-products.json.result.json"), JSON.stringify({ status: "completed" }), "utf8"),
    writeFile(path.join(eventDirectory, "02-inventory.json.result.json"), JSON.stringify({ status: "completed" }), "utf8"),
  ]);
}

async function writeBlockedBeforeFirstExport(root: string, runId: string, unsafeExportIntent = false) {
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const eventDirectory = path.join(root, "outputs", "jackyun-browser-events", runId);
  await Promise.all([mkdir(runDirectory, { recursive: true }), mkdir(eventDirectory, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(runDirectory, "browser-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: "test-policy",
      status: "blocked",
      currentModule: "products",
      currentState: "BLOCKED",
      stateEnteredAt: "2026-08-04T11:00:10.000Z",
      events: [
        { module: "products", state: "PRECHECKED", enteredAt: "2026-08-04T11:00:00.000Z", elapsedMs: 1, evidence: {} },
        { module: "products", state: "ENTER_MODULE", enteredAt: "2026-08-04T11:00:00.001Z", elapsedMs: 9_999, evidence: {} },
      ],
      failureCode: "DAILY_RUNNER_FAILED",
      failureMessage: "login required",
    }), "utf8"),
    writeFile(path.join(runDirectory, "browser-controller-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: "test-policy",
      modules: {
        products: unsafeExportIntent
          ? { status: "export_armed", exportIntentAt: "2026-08-04T11:00:09.000Z" }
          : { status: "navigated", navigationIntentAt: "2026-08-04T11:00:00.000Z" },
      },
    }), "utf8"),
  ]);
}

async function writeExactRowCountRepairRun(root: string, runId: string) {
  await writeResumablePartialRun(root, runId);
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const eventDirectory = path.join(root, "outputs", "jackyun-browser-events", runId);
  const filePath = path.join(root, "downloads", "库龄分析(正式勿删).xlsx");
  const rawSha256 = "a".repeat(64);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "fixture", "utf8");
  const manifest = JSON.parse(await readFile(path.join(runDirectory, "run-manifest.json"), "utf8"));
  manifest.modules.inventory_age = {
    module: "inventory_age",
    status: "failed",
    sourcePath: filePath,
    sourceSha256: rawSha256,
    inputContractHash: "old-contract",
  };
  const controller = JSON.parse(await readFile(path.join(runDirectory, "browser-controller-state.json"), "utf8"));
  controller.modules.inventory_age = {
    status: "handed_off",
    filePath,
    expectedSourceRows: 5556,
    exportIntentAt: "2026-08-04T11:00:02.000Z",
    downloadEventAt: "2026-08-04T11:00:03.000Z",
  };
  const correction = {
    reason: "exact_total_after_approximate_count",
    previousExpectedSourceRows: 51,
    exactExpectedSourceRows: 5556,
    observedAt: "2026-08-04T11:01:00.000Z",
  };
  await Promise.all([
    writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify(manifest), "utf8"),
    writeFile(path.join(runDirectory, "browser-controller-state.json"), JSON.stringify(controller), "utf8"),
    writeFile(path.join(eventDirectory, "03-inventory_age.json"), JSON.stringify({
      module: "inventory_age",
      filePath,
      navigationIntentAt: "2026-08-04T11:00:00.000Z",
      queryIntentAt: "2026-08-04T11:00:01.000Z",
      tableStableAt: "2026-08-04T11:00:01.500Z",
      exportIntentAt: "2026-08-04T11:00:02.000Z",
      downloadEventAt: "2026-08-04T11:00:03.000Z",
      expectedSourceRows: 5556,
      sourceRowCountCorrection: correction,
    }), "utf8"),
    mkdir(path.join(runDirectory, "audit"), { recursive: true }).then(() => writeFile(
      path.join(runDirectory, "audit", "inventory_age.json"),
      JSON.stringify({
        runId,
        module: "inventory_age",
        status: "failed",
        timings: { failedAt: "2026-08-04T11:00:30.000Z" },
        source: { path: filePath, sha256: rawSha256 },
        error: {
          stage: "validate_and_prepare_workbook",
          details: { expectedSourceRows: 51, actualSourceRows: 5556 },
        },
      }),
      "utf8",
    )),
  ]);
}

test("Jackyun n8n plan uses Shanghai yesterday and only a local operations URL", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-test-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(shanghaiDate(now), "2026-08-04");
    assert.equal(plan.snapshotDate, "2026-08-03");
    assert.equal(plan.asOfDate, "2026-08-03");
    assert.equal(plan.stage, "planned");
    assert.equal(plan.skipped, false);
    assert.deepEqual(publicJackyunPlan(plan).moduleOrder, ["products", "inventory", "inventory_age", "sales", "combos"]);
    assert.equal(normalizeJackyunLocalBaseUrl("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
    assert.throws(() => normalizeJackyunLocalBaseUrl("https://example.com"), /只允许连接本机/);
    assert.equal(await getJackyunProfileStatus(fixture.profileDirectory, fixture.root), "ready");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun loopback stages reject concurrency and out-of-order calls", () => {
  assert.equal(jackyunHelperRequestError("ready", false, "/jackyun/plan"), null);
  assert.deepEqual(jackyunHelperRequestError("ready", false, "/jackyun/run"), {
    error: "invalid_stage",
    expected: "planned",
    actual: "ready",
  });
  assert.deepEqual(jackyunHelperRequestError("planned", true, "/jackyun/run"), { error: "pipeline_busy" });
  assert.equal(jackyunHelperRequestError("planned", false, "/jackyun/run"), null);
  assert.equal(jackyunHelperRequestError("executed", false, "/jackyun/verify"), null);
  assert.match(JSON.stringify(jackyunHelperRequestError("completed", false, "/jackyun/verify")), /invalid_stage/);
});

test("Jackyun n8n run keeps the five-module order and verify requires exact batches and audits", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-complete-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    let capturedOrder: readonly string[] = [];
    const runResult = await runJackyunN8nPlan(plan, {
      root: fixture.root,
      runAutomation: async (options) => {
        capturedOrder = jackyunModuleOrder;
        await writeCompletedRun(fixture.root, options.runId, options.asOfDate);
        return {
          browserResult: { status: "completed", runId: options.runId },
          dailyResult: {
            status: "completed",
            results: jackyunModuleOrder.map((moduleKey) => ({ module: moduleKey })),
          },
        } as never;
      },
    });
    assert.deepEqual(capturedOrder, ["products", "inventory", "inventory_age", "sales", "combos"]);
    assert.equal(runResult.skipped, false);
    assert.equal(plan.stage, "executed");

    const verified = await verifyJackyunN8nPlan(plan, { root: fixture.root });
    assert.equal(verified.ok, true);
    assert.equal(verified.modules.length, 5);
    assert.equal(plan.stage, "completed");

    const skipped = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-be-used",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.existingRunId, "n8n-complete-run");
    const skippedRun = await runJackyunN8nPlan(skipped, { root: fixture.root });
    assert.equal(skippedRun.skipped, true);
    const skippedVerify = await verifyJackyunN8nPlan(skipped, { root: fixture.root });
    assert.equal(skippedVerify.verifiedRunId, "n8n-complete-run");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n resumes only an exact failed partial prefix", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-resume-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeResumablePartialRun(fixture.root, plan.runId);
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "test failure", at: now.toISOString() };
    await writeFile(path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");

    const resumed = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-create-a-new-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(resumed.runId, plan.runId);
    assert.equal(resumed.resume, true);
    assert.equal(publicJackyunPlan(resumed).resume, true);

    let capturedResume = false;
    await runJackyunN8nPlan(resumed, {
      root: fixture.root,
      runAutomation: async (options) => {
        capturedResume = options.resume;
        await writeCompletedRun(fixture.root, options.runId, options.asOfDate);
        return {
          browserResult: { status: "completed", runId: options.runId },
          dailyResult: { status: "completed", results: jackyunModuleOrder.map((module) => ({ module })) },
        } as never;
      },
    });
    assert.equal(capturedResume, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n safely resumes a first-module login failure with no export or import evidence", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-login-resume-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeBlockedBeforeFirstExport(fixture.root, plan.runId);
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "login required", at: now.toISOString() };
    await writeFile(path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");

    const resumed = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-create-a-new-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(resumed.runId, plan.runId);
    assert.equal(resumed.resume, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n permits one exact zero-row query retry and refuses a second", async () => {
  for (const [mode, resumable] of [["zero_rows", true], ["retried_zero_rows", false]] as const) {
    const fixture = await createFixture();
    try {
      const now = new Date("2026-08-04T11:00:00.000Z");
      const plan = await planJackyunN8nRun({
        root: fixture.root,
        now,
        runIdFactory: () => `n8n-${mode}-run`,
        request: async () => new Response("ok", { status: 200 }),
      });
      await writeResumablePartialRun(fixture.root, plan.runId, mode);
      plan.stage = "failed";
      plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "zero rows", at: now.toISOString() };
      await writeFile(path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");

      const next = planJackyunN8nRun({
        root: fixture.root,
        now,
        runIdFactory: () => "must-not-create-a-new-run",
        request: async () => new Response("ok", { status: 200 }),
      });
      if (resumable) {
        assert.equal((await next).resume, true);
      } else {
        await assert.rejects(next, /未闭环/);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("Jackyun n8n resumes an exact pre-import row-count metadata repair without re-export", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-row-count-repair-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeExactRowCountRepairRun(fixture.root, plan.runId);
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "page 51, file 5556", at: now.toISOString() };
    await writeFile(path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");

    const resumed = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-create-a-new-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(resumed.runId, plan.runId);
    assert.equal(resumed.resume, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n refuses automatic resume after any first-module export intent", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-unsafe-resume-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeBlockedBeforeFirstExport(fixture.root, plan.runId, true);
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "export uncertain", at: now.toISOString() };
    await writeFile(path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");

    await assert.rejects(planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-create-a-new-run",
      request: async () => new Response("ok", { status: 200 }),
    }), /未闭环/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n fails closed on an unclosed plan or a missing exact batch", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-broken-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await assert.rejects(planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-duplicate-run",
      request: async () => new Response("ok", { status: 200 }),
    }), /未闭环/);

    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate, "sales");
    plan.stage = "executed";
    await assert.rejects(verifyJackyunN8nPlan(plan, { root: fixture.root }), /缺少完成状态或精确批次号/);
    assert.equal(plan.stage, "failed");
    const stored = JSON.parse(await readFile(path.join(
      fixture.root,
      "outputs",
      "jackyun-n8n-pipeline",
      `plan-${plan.runId}.json`,
    ), "utf8"));
    assert.equal(stored.failure.code, "JACKYUN_N8N_VERIFY_FAILED");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
