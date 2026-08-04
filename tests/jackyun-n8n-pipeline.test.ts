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
