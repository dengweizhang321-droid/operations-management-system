import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import type { JdStore } from "../lib/jd/store-registry";
import type { RunnerAudit } from "../tools/jd-multi-store-runner";
import {
  jdHelperRequestError,
  planJdN8nRun,
  runJdN8nPlan,
  verifyJdN8nPlan,
} from "../tools/jd-n8n-pipeline";

function store(shopName = "测试京东店") : JdStore {
  return {
    storeKey: "jd-test", accountLabel: "测试", platform: "京东", shopName, shopId: "10001", enabled: true,
    browser: {
      executablePath: "unused/chromium.exe",
      userDataDir: "unused/user-data",
      profileName: "Default",
      profileDir: "unused/user-data/Default",
      debugPort: 9224,
      downloadDir: "unused/downloads",
    },
  };
}

function importResult(step: "jd_product_master" | "jd_sku_daily" | "spu_daily", shopName: string, batchId: string) {
  const daily = step !== "jd_product_master";
  return {
    status: "imported", batchId, rowCount: 3, batchStatus: "completed", warningCount: 0,
    platform: "京东", shopName, source: daily ? "jd_sku_daily" : "jd_product_master",
    dataset: step === "jd_product_master" ? "product_master" : step === "jd_sku_daily" ? "sku_daily" : "spu_daily",
    ...(daily ? { dateMin: "2026-07-01", dateMax: "2026-07-20" } : {}),
  };
}

test("JD helper binds one execution and rejects empty, foreign, out-of-order, and busy requests", () => {
  assert.equal(jdHelperRequestError("ready", false, "/jd/plan", "execution-1", null), null);
  assert.deepEqual(jdHelperRequestError("ready", false, "/jd/run", "execution-1", null), { error: "execution_not_claimed", expected: "/jd/plan" });
  assert.deepEqual(jdHelperRequestError("planned", false, "/jd/run", "other", "execution-1"), { error: "execution_mismatch" });
  assert.deepEqual(jdHelperRequestError("planned", true, "/jd/run", "execution-1", "execution-1"), { error: "pipeline_busy" });
  assert.deepEqual(jdHelperRequestError("planned", false, "/jd/verify", "execution-1", "execution-1"), { error: "invalid_stage", expected: "executed", actual: "planned" });
  assert.deepEqual(jdHelperRequestError("ready", false, "/jd/plan", null, null), { error: "missing_or_invalid_execution_id" });
});

test("JD plan fails closed when the n8n execution owner is missing or empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-n8n-owner-"));
  const base = {
    root, now: new Date("2026-07-21T01:00:00+08:00"), baseUrl: "http://localhost:3000",
    request: (async () => new Response("ok", { status: 200 })) as typeof fetch,
    profileStatus: async () => "ready" as const, runIdFactory: () => "jd-n8n-owner", stores: [store()],
  };
  await assert.rejects(() => planJdN8nRun({ ...base, executionId: "" }), /execution ID 无效/);
  await assert.rejects(() => planJdN8nRun(base as unknown as Parameters<typeof planJdN8nRun>[0]), /execution ID 无效/);
});

test("JD plan persists the full Shanghai-month range, binds store identity, and reopens only the same failed run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-n8n-plan-"));
  const request: typeof fetch = async () => new Response("ok", { status: 200 });
  const options = {
    root, now: new Date("2026-07-21T01:00:00+08:00"), baseUrl: "http://localhost:3000", request,
    profileStatus: async () => "ready" as const, runIdFactory: () => "jd-n8n-test-run", executionId: "execution-1", stores: [store()],
  };
  const plan = await planJdN8nRun(options);
  assert.deepEqual([plan.startDate, plan.endDate], ["2026-07-01", "2026-07-20"]);
  assert.deepEqual(plan.stores, [{ storeKey: "jd-test", shopId: "10001", shopName: "测试京东店" }]);
  const failedRun = await runJdN8nPlan(plan, {
    root, stores: [store()],
    run: async () => ({ ok: false, auditPath: path.join(root, "outputs", "jd-multi-store-runner", "run-1.json"), audit: { items: [] } as unknown as RunnerAudit }),
  }).catch((error) => error);
  assert.ok(failedRun instanceof Error);
  const resumed = await planJdN8nRun(options);
  assert.equal(resumed.runId, plan.runId);
  assert.equal(resumed.stage, "planned");
  let resumedAuditPath = "";
  await runJdN8nPlan(resumed, {
    root, stores: [store()],
    run: async (runOptions) => {
      resumedAuditPath = runOptions.resumeAuditPath ?? "";
      return { ok: false, auditPath: runOptions.resumeAuditPath!, audit: { items: [] } as unknown as RunnerAudit };
    },
  }).catch(() => undefined);
  assert.match(resumedAuditPath, /outputs[\\/]jd-multi-store-runner[\\/]run-1\.json$/);
  plan.stage = "completed";
  await writeFile(path.join(root, "outputs", "jd-n8n-pipeline", `plan-${plan.runId}.json`), JSON.stringify(plan), "utf8");
  const sameExecution = await planJdN8nRun({ ...options, runIdFactory: () => "must-not-create" });
  assert.equal(sameExecution.runId, plan.runId);
  const fresh = await planJdN8nRun({ ...options, executionId: "execution-2", runIdFactory: () => "jd-n8n-new-run" });
  assert.equal(fresh.runId, "jd-n8n-new-run");
  const changedStores = [store("已变更店铺")];
  const changed = await planJdN8nRun({ ...options, stores: changedStores, runIdFactory: () => "jd-n8n-changed" });
  assert.equal(changed.runId, "jd-n8n-changed");
});

test("JD C-stage rechecks the controlled audit and each exact published batch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-n8n-verify-"));
  const targetStore = store();
  const steps = ["jd_product_master", "jd_sku_daily", "spu_daily"] as const;
  const audit: RunnerAudit = {
    version: 1, baseUrl: "http://localhost:3000", startedAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:01:00.000Z",
    mode: "all", dryRun: false, startDate: "2026-07-01", endDate: "2026-07-20", storeKeys: [targetStore.storeKey],
    items: steps.map((step, index) => {
      const proof = importResult(step, targetStore.shopName, `batch-${index}`);
      return { storeKey: targetStore.storeKey, shopName: targetStore.shopName, step, status: "completed" as const, batchId: proof.batchId, rowCount: proof.rowCount, importResult: proof };
    }),
  };
  const auditPath = path.join(root, "outputs", "jd-multi-store-runner", "run-1.json");
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, JSON.stringify(audit), "utf8");
  const plan = {
    version: 1 as const, runId: "jd-n8n-verify", generatedAt: audit.startedAt, updatedAt: audit.updatedAt, baseUrl: audit.baseUrl, ownerExecutionId: "execution-1",
    startDate: "2026-07-01", endDate: "2026-07-20", storeKeys: [targetStore.storeKey],
    stores: [{ storeKey: targetStore.storeKey, shopId: targetStore.shopId, shopName: targetStore.shopName }], stage: "executed" as const, runnerAuditPath: auditPath,
  };
  const request: typeof fetch = async (input) => {
    const batchId = new URL(String(input)).searchParams.get("batchId")!;
    const index = Number(batchId.slice(-1));
    const proof = importResult(steps[index]!, targetStore.shopName, batchId);
    return Response.json({ items: [{ id: batchId, status: "completed", source: proof.source, dataset: proof.dataset, platform: proof.platform, shopName: proof.shopName, warningCount: 0, rowCount: 3, dateMin: proof.dateMin ?? null, dateMax: proof.dateMax ?? null }] });
  };
  const verified = await verifyJdN8nPlan(plan, { root, stores: [targetStore], request });
  assert.equal(verified.stage, "verify");
  assert.equal(plan.stage, "completed");
  const bad = { ...plan, stage: "executed" as const };
  await assert.rejects(() => verifyJdN8nPlan(bad, { root, stores: [targetStore], request: async () => Response.json({ items: [] }) }), /精确导入批次/);
});
