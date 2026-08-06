import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import {
  createJackyunInputContractHash,
  type JackyunHistoricalSnapshotEvidence,
  type JackyunInputContract,
} from "../lib/jackyun/run-contract";
import {
  getJackyunProfileStatus,
  jackyunHelperRequestError,
  jackyunN8nFailureDetails,
  normalizeJackyunLocalBaseUrl,
  planJackyunN8nRun,
  publicJackyunPlan,
  runJackyunN8nPlan,
  shanghaiDate,
  verifyCompletedJackyunRunArtifacts,
  verifyJackyunN8nPlan,
} from "../tools/jackyun-n8n-pipeline";
import { runJackyunAutomationUnderLock } from "../tools/jackyun-automation-runner";

const dailyPolicyVersion = JSON.parse(
  readFileSync(path.resolve("config/jackyun-daily-policy.json"), "utf8"),
) as { version: string };

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-n8n-test-"));
  const profileDirectory = path.join(root, ".runtime", "jackyun-chrome-profile");
  await mkdir(path.join(profileDirectory, "Default"), { recursive: true });
  await writeFile(path.join(profileDirectory, "Local State"), "{}\n", "utf8");
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config", "jackyun-daily-policy.json"), JSON.stringify({
    version: dailyPolicyVersion.version,
    moduleOrder: jackyunModuleOrder,
    browser: { controller: { profileDirectory } },
  }), "utf8");
  return { root, profileDirectory };
}

async function writeCompletedRun(root: string, runId: string, asOfDate: string, missingBatchModule?: string) {
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const eventDirectory = path.join(root, "outputs", "jackyun-browser-events", runId);
  const auditDirectory = path.join(runDirectory, "audit");
  const rawDirectory = path.join(runDirectory, "raw");
  const processedDirectory = path.join(runDirectory, "processed");
  await Promise.all([
    mkdir(auditDirectory, { recursive: true }),
    mkdir(rawDirectory, { recursive: true }),
    mkdir(processedDirectory, { recursive: true }),
    mkdir(eventDirectory, { recursive: true }),
  ]);
  const results = [];
  const manifestModules: Record<string, unknown> = {};
  for (const moduleKey of jackyunModuleOrder) {
    const auditPath = path.join(auditDirectory, `${moduleKey}.json`);
    const sourcePath = path.join(rawDirectory, `${moduleKey}.xlsx`);
    const outputPath = path.join(processedDirectory, `${moduleKey}.xlsx`);
    const sourceBytes = Buffer.from(`${moduleKey}-source`, "utf8");
    const outputBytes = Buffer.from(`${moduleKey}-processed`, "utf8");
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
    const batchId = moduleKey === "sales"
      ? "sales:batch"
      : moduleKey === "inventory"
        ? outputSha256
        : `${moduleKey}:${outputSha256}`;
    const snapshotDate = moduleKey === "inventory" || moduleKey === "inventory_age" ? asOfDate : null;
    const exportStart = "2026-08-05T01:00:04.000Z";
    const snapshotEvidence: JackyunHistoricalSnapshotEvidence | null = moduleKey === "inventory" || moduleKey === "inventory_age" ? {
      version: 1,
      module: moduleKey,
      runId,
      source: "historical_date_control" as const,
      targetDate: asOfDate,
      observedDate: asOfDate,
      controlReadbackAt: "2026-08-05T01:00:01.000Z",
      queryIntentAt: "2026-08-05T01:00:02.000Z",
      queryRefreshSource: "module_network_request" as const,
      queryRefreshCompletedAt: "2026-08-05T01:00:02.500Z",
      tableStableAt: "2026-08-05T01:00:03.000Z",
    } : null;
    const downloadProvenance = {
      runId,
      module: moduleKey,
      policyVersion: dailyPolicyVersion.version,
      downloadId: `${moduleKey}-download-0001`,
      method: "browser_event" as const,
      completedAt: "2026-08-05T01:00:05.000Z",
      originalFileName: `${moduleKey}.xlsx`,
      sha256: sourceSha256,
      bytes: sourceBytes.byteLength,
    };
    const requiresQuery = moduleKey === "inventory" || moduleKey === "inventory_age" || moduleKey === "sales";
    const handoffEvidence = {
      navigationIntentAt: "2026-08-05T01:00:00.000Z",
      ...(requiresQuery ? { queryIntentAt: "2026-08-05T01:00:02.000Z" } : {}),
      tableStableAt: "2026-08-05T01:00:03.000Z",
      exportIntentAt: exportStart,
      downloadEventAt: downloadProvenance.completedAt,
    };
    const inputContract: JackyunInputContract = {
      runId,
      policyVersion: dailyPolicyVersion.version,
      module: moduleKey,
      rawSha256: sourceSha256,
      ...(snapshotEvidence
        ? { snapshotDate: asOfDate, snapshotEvidence }
        : {}),
      ...(moduleKey === "sales" ? { asOfDate } : {}),
      expectedSourceRows: 10,
      exportStart,
      downloadEventAt: downloadProvenance.completedAt,
      downloadProvenance,
      handoffEvidence,
      baseUrl: "http://localhost:3000",
    };
    const inputContractHash = createJackyunInputContractHash(inputContract);
    await Promise.all([
      writeFile(sourcePath, sourceBytes),
      writeFile(outputPath, outputBytes),
      writeFile(auditPath, JSON.stringify({
        version: 1,
        runId,
        module: moduleKey,
        status: "completed",
        source: {
          path: sourcePath,
          copiedPath: sourcePath,
          fileName: `${moduleKey}.xlsx`,
          bytes: sourceBytes.byteLength,
          sha256: sourceSha256,
          exportStart,
          downloadEventAt: downloadProvenance.completedAt,
          expectedSourceRows: 10,
          inputContractHash,
          inputContract,
          handoffEvidence,
          downloadProvenance,
          snapshotEvidence,
        },
        sourceCountContract: moduleKey === "sales" ? {
          semantic: "xlsx_nonblank_data_rows",
          expected: 10,
          actual: 10,
          verified: true,
        } : null,
        output: { path: outputPath, bytes: outputBytes.byteLength, sha256: outputSha256 },
        import: {
          result: moduleKey === "sales" ? { salesPolicyVersion: "test-policy", postImportVerified: true } : {},
          batch: { id: batchId, status: "completed", rowCount: 10, warningCount: 0, snapshotDate },
        },
      }), "utf8"),
      writeFile(path.join(
        eventDirectory,
        `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`,
      ), JSON.stringify({
        schemaVersion: 2,
        runId,
        policyVersion: dailyPolicyVersion.version,
        module: moduleKey,
        filePath: sourcePath,
        ...handoffEvidence,
        expectedSourceRows: 10,
        downloadProvenance,
        snapshotEvidence: snapshotEvidence ?? undefined,
      }), "utf8"),
    ]);
    results.push({
      module: moduleKey,
      status: "completed",
      batchId: moduleKey === missingBatchModule ? null : batchId,
      rowCount: 10,
      warningCount: 0,
      auditPath,
    });
    manifestModules[moduleKey] = {
      module: moduleKey,
      status: "completed",
      batchId,
      sourcePath,
      sourceSha256,
      inputContractHash,
      outputPath,
      outputSha256,
    };
  }
  await Promise.all([
    writeFile(path.join(runDirectory, "daily-summary.json"), JSON.stringify({
      status: "completed",
      runId,
      policyVersion: dailyPolicyVersion.version,
      salesAsOfDate: asOfDate,
      results,
    }), "utf8"),
    writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify({
      runId,
      strictOrder: jackyunModuleOrder,
      modules: manifestModules,
    }), "utf8"),
    writeFile(path.join(runDirectory, "daily-run-contract.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: dailyPolicyVersion.version,
      snapshotDate: asOfDate,
      asOfDate,
      baseUrl: "http://localhost:3000",
      mode: "formal",
      createdAt: "2026-08-05T00:59:59.000Z",
    }), "utf8"),
  ]);
}

function publishedVerificationRequest(
  asOfDate: string,
  ownedRowCount = 10,
  inventoryIsCurrent = true,
): typeof fetch {
  const fixtureOutputSha256 = (moduleKey: string) => createHash("sha256")
    .update(Buffer.from(`${moduleKey}-processed`, "utf8"))
    .digest("hex");
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/api/imports/sales/verify") {
      return Response.json({
        policyVersion: "test-policy",
        period: { startDate: `${asOfDate.slice(0, 8)}01`, endDate: asOfDate },
        batch: {
          id: "sales:batch",
          status: "completed",
          rowCount: 10,
          totals: {
            rawFileHash: fixtureOutputSha256("sales"),
            systemCost: { sourceBatchId: fixtureOutputSha256("inventory") },
          },
        },
        stats: { rowCount: 10, excludedWarehouseRows: 0, rowsNotOwnedByBatch: 0 },
        nonWhitelistChannels: [],
      });
    }
    const source = url.searchParams.get("source") ?? "inventory";
    const requestedBatchId = url.searchParams.get("batchId");
    assert.ok(requestedBatchId);
    return Response.json({
      items: [{
        id: requestedBatchId,
        status: "completed",
        rowCount: 10,
        excludedCount: 0,
        ownedRowCount,
        ...(source === "inventory" ? { isCurrent: inventoryIsCurrent } : {}),
        snapshotDate: source === "inventory" || source === "inventory_age" ? asOfDate : null,
      }],
    });
  }) as typeof fetch;
}

async function writeResumablePartialRun(root: string, runId: string, inventoryAgeState: "navigated" | "zero_rows" | "retried_zero_rows" = "navigated") {
  const runDirectory = path.join(root, "outputs", "jackyun-import-runs", runId);
  const eventDirectory = path.join(root, "outputs", "jackyun-browser-events", runId);
  await writeCompletedRun(root, runId, "2026-08-03");
  await mkdir(eventDirectory, { recursive: true });
  const completedManifest = JSON.parse(await readFile(path.join(runDirectory, "run-manifest.json"), "utf8"));
  completedManifest.modules = {
    products: completedManifest.modules.products,
    inventory: completedManifest.modules.inventory,
  };
  await Promise.all([
    rm(path.join(runDirectory, "daily-summary.json"), { force: true }),
    ...jackyunModuleOrder.slice(2).flatMap((moduleKey) => [
      rm(path.join(runDirectory, "audit", `${moduleKey}.json`), { force: true }),
      rm(path.join(runDirectory, "raw", `${moduleKey}.xlsx`), { force: true }),
      rm(path.join(runDirectory, "processed", `${moduleKey}.xlsx`), { force: true }),
      rm(path.join(
        eventDirectory,
        `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`,
      ), { force: true }),
    ]),
  ]);
  await Promise.all([
    writeFile(path.join(runDirectory, "run-manifest.json"), JSON.stringify(completedManifest), "utf8"),
    writeFile(path.join(runDirectory, "browser-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: dailyPolicyVersion.version,
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
      policyVersion: dailyPolicyVersion.version,
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
    writeFile(path.join(runDirectory, "daily-run-contract.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: dailyPolicyVersion.version,
      snapshotDate: "2026-08-03",
      asOfDate: "2026-08-03",
      baseUrl: "http://localhost:3000",
      mode: "formal",
      createdAt: "2026-08-04T10:59:59.000Z",
    }), "utf8"),
    writeFile(path.join(runDirectory, "browser-state.json"), JSON.stringify({
      version: 1,
      runId,
      policyVersion: dailyPolicyVersion.version,
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
      policyVersion: dailyPolicyVersion.version,
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
      schemaVersion: 2,
      runId,
      policyVersion: dailyPolicyVersion.version,
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

test("Jackyun loopback stages bind one n8n execution and reject empty, stale, concurrent, and out-of-order calls", () => {
  const owner = "execution-100";
  const other = "execution-older";
  assert.deepEqual(jackyunHelperRequestError("ready", false, "/jackyun/plan", null, null), {
    error: "missing_or_invalid_execution_id",
  });
  assert.equal(jackyunHelperRequestError("ready", false, "/jackyun/plan", owner, null), null);
  assert.equal(jackyunHelperRequestError("planned", false, "/jackyun/plan", owner, owner), null);
  assert.equal(jackyunHelperRequestError("executed", false, "/jackyun/plan", owner, owner), null);
  assert.equal(jackyunHelperRequestError("failed", false, "/jackyun/plan", owner, owner), null);
  assert.deepEqual(jackyunHelperRequestError("planned", false, "/jackyun/plan", other, owner), {
    error: "execution_mismatch",
  });
  assert.match(JSON.stringify(jackyunHelperRequestError("running", false, "/jackyun/plan", owner, owner)), /invalid_stage/);
  assert.deepEqual(jackyunHelperRequestError("ready", false, "/jackyun/run", owner, null), {
    error: "execution_not_claimed",
    expected: "/jackyun/plan",
  });
  assert.deepEqual(jackyunHelperRequestError("ready", false, "/jackyun/run", owner, owner), {
    error: "invalid_stage",
    expected: "planned",
    actual: "ready",
  });
  assert.deepEqual(jackyunHelperRequestError("planned", true, "/jackyun/run", owner, owner), { error: "pipeline_busy" });
  assert.deepEqual(jackyunHelperRequestError("planned", true, "/jackyun/run", other, owner), {
    error: "execution_mismatch",
  });
  assert.deepEqual(jackyunHelperRequestError("planned", true, "/jackyun/run", null, owner), {
    error: "missing_or_invalid_execution_id",
  });
  assert.equal(jackyunHelperRequestError("planned", false, "/jackyun/run", owner, owner), null);
  assert.deepEqual(jackyunHelperRequestError("planned", false, "/jackyun/run", other, owner), {
    error: "execution_mismatch",
  });
  assert.equal(jackyunHelperRequestError("executed", false, "/jackyun/verify", owner, owner), null);
  assert.deepEqual(jackyunHelperRequestError("executed", false, "/jackyun/verify", other, owner), {
    error: "execution_mismatch",
  });
  assert.match(JSON.stringify(jackyunHelperRequestError("completed", false, "/jackyun/verify", owner, owner)), /invalid_stage/);
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

    const request = publishedVerificationRequest(plan.asOfDate);
    const verified = await verifyJackyunN8nPlan(plan, { root: fixture.root, request });
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
    const skippedVerify = await verifyJackyunN8nPlan(skipped, { root: fixture.root, request });
    assert.equal(skippedVerify.verifiedRunId, "n8n-complete-run");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n verify parses audits and rejects a batch mismatch hidden behind completed summaries", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-audit-mismatch-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    const auditPath = path.join(fixture.root, "outputs", "jackyun-import-runs", plan.runId, "audit", "sales.json");
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    audit.import.batch.id = "different-batch";
    await writeFile(auditPath, JSON.stringify(audit), "utf8");
    plan.stage = "executed";

    await assert.rejects(
      verifyJackyunN8nPlan(plan, { root: fixture.root }),
      /精确完成批次证据无效|汇总、清单与审计中的批次或行数不一致/,
    );
    assert.equal(plan.stage, "failed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun C-stage rejects a self-consistent foreign batch not derived from the archived output", async () => {
  const fixture = await createFixture();
  const runId = "n8n-foreign-batch-run";
  try {
    await writeCompletedRun(fixture.root, runId, "2026-08-04");
    const runDirectory = path.join(fixture.root, "outputs", "jackyun-import-runs", runId);
    const auditPath = path.join(runDirectory, "audit", "products.json");
    const manifestPath = path.join(runDirectory, "run-manifest.json");
    const summaryPath = path.join(runDirectory, "daily-summary.json");
    const [audit, manifest, summary] = await Promise.all([
      readFile(auditPath, "utf8").then(JSON.parse),
      readFile(manifestPath, "utf8").then(JSON.parse),
      readFile(summaryPath, "utf8").then(JSON.parse),
    ]);
    const foreignBatchId = `products:${"f".repeat(64)}`;
    audit.import.batch.id = foreignBatchId;
    manifest.modules.products.batchId = foreignBatchId;
    summary.results[0].batchId = foreignBatchId;
    await Promise.all([
      writeFile(auditPath, JSON.stringify(audit), "utf8"),
      writeFile(manifestPath, JSON.stringify(manifest), "utf8"),
      writeFile(summaryPath, JSON.stringify(summary), "utf8"),
    ]);

    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate: "2026-08-04", root: fixture.root }),
      /批次号未与本轮归档输出 SHA-256 绑定/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun completed-artifact verification hashes the archived source and output files", async () => {
  const fixture = await createFixture();
  const runId = "n8n-file-integrity-run";
  try {
    await writeCompletedRun(fixture.root, runId, "2026-08-04");
    const outputPath = path.join(
      fixture.root,
      "outputs",
      "jackyun-import-runs",
      runId,
      "processed",
      "products.xlsx",
    );
    await writeFile(outputPath, "tampered", "utf8");
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate: "2026-08-04", root: fixture.root }),
      /输出文件、字节数或哈希证据不一致|实际哈希与审计不一致/,
    );

    await writeCompletedRun(fixture.root, runId, "2026-08-04");
    const archivedSourcePath = path.join(
      fixture.root,
      "outputs",
      "jackyun-import-runs",
      runId,
      "raw",
      "inventory.xlsx",
    );
    await rm(archivedSourcePath, { force: true });
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate: "2026-08-04", root: fixture.root }),
      /归档源文件、字节数或哈希证据不一致|源文件或输入契约证据不一致/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun independent verification rejects unproven snapshot dates and unbound downloads", async () => {
  const fixture = await createFixture();
  const runId = "n8n-evidence-integrity-run";
  const asOfDate = "2026-08-04";
  try {
    await writeCompletedRun(fixture.root, runId, asOfDate);
    const inventoryAuditPath = path.join(
      fixture.root,
      "outputs",
      "jackyun-import-runs",
      runId,
      "audit",
      "inventory.json",
    );
    const inventoryAudit = JSON.parse(await readFile(inventoryAuditPath, "utf8"));
    inventoryAudit.source.snapshotEvidence.observedDate = "2026-08-03";
    await writeFile(inventoryAuditPath, JSON.stringify(inventoryAudit), "utf8");
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate, root: fixture.root }),
      /FIELD_MISMATCH|历史日期读回不一致|历史快照证据与输入契约不一致|原子 handoff 与归档审计证据不一致/,
    );

    await writeCompletedRun(fixture.root, runId, asOfDate);
    const productsAuditPath = path.join(
      fixture.root,
      "outputs",
      "jackyun-import-runs",
      runId,
      "audit",
      "products.json",
    );
    const productsAudit = JSON.parse(await readFile(productsAuditPath, "utf8"));
    productsAudit.source.downloadProvenance.sha256 = "f".repeat(64);
    await writeFile(productsAuditPath, JSON.stringify(productsAudit), "utf8");
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate, root: fixture.root }),
      /下载 provenance 未与输入契约和归档源精确绑定|下载事件没有与归档源文件/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun C-stage recomputes the evidence digest and rejects an invalid export timestamp", async () => {
  const fixture = await createFixture();
  const runId = "n8n-invalid-export-time-run";
  try {
    await writeCompletedRun(fixture.root, runId, "2026-08-04");
    const runDirectory = path.join(fixture.root, "outputs", "jackyun-import-runs", runId);
    const auditPath = path.join(runDirectory, "audit", "products.json");
    const manifestPath = path.join(runDirectory, "run-manifest.json");
    const handoffPath = path.join(
      fixture.root,
      "outputs",
      "jackyun-browser-events",
      runId,
      "01-products.json",
    );
    const [audit, manifest, handoff] = await Promise.all([
      readFile(auditPath, "utf8").then(JSON.parse),
      readFile(manifestPath, "utf8").then(JSON.parse),
      readFile(handoffPath, "utf8").then(JSON.parse),
    ]);
    audit.source.exportStart = "not-a-date";
    audit.source.handoffEvidence.exportIntentAt = "not-a-date";
    audit.source.inputContract.exportStart = "not-a-date";
    audit.source.inputContract.handoffEvidence.exportIntentAt = "not-a-date";
    handoff.exportIntentAt = "not-a-date";
    const recalculated = createJackyunInputContractHash(audit.source.inputContract);
    audit.source.inputContractHash = recalculated;
    manifest.modules.products.inputContractHash = recalculated;
    await Promise.all([
      writeFile(auditPath, JSON.stringify(audit), "utf8"),
      writeFile(manifestPath, JSON.stringify(manifest), "utf8"),
      writeFile(handoffPath, JSON.stringify(handoff), "utf8"),
    ]);
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate: "2026-08-04", root: fixture.root }),
      /handoff 时间线证据不完整|导出\/下载时间线无效/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun C-stage requires the immutable daily run contract", async () => {
  const fixture = await createFixture();
  const runId = "n8n-run-contract-tamper";
  try {
    await writeCompletedRun(fixture.root, runId, "2026-08-04");
    const contractPath = path.join(
      fixture.root,
      "outputs",
      "jackyun-import-runs",
      runId,
      "daily-run-contract.json",
    );
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    contract.snapshotDate = "2026-08-03";
    await writeFile(contractPath, JSON.stringify(contract), "utf8");
    await assert.rejects(
      verifyCompletedJackyunRunArtifacts({ runId, asOfDate: "2026-08-04", root: fixture.root }),
      /每日运行契约缺失|日期.*不一致/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n exposes stable inner failure code and stage", () => {
  const error = Object.assign(new Error("date control mismatch"), {
    failureCode: "FIELD_MISMATCH",
    stage: "field_readback",
  });
  assert.deepEqual(jackyunN8nFailureDetails(error, "JACKYUN_N8N_RUN_FAILED", "run"), {
    code: "FIELD_MISMATCH",
    stage: "field_readback",
    message: "date control mismatch",
  });
});

test("Jackyun n8n verify refuses completed artifacts when the exact published batch is absent", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-published-missing-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    plan.stage = "executed";
    const validRequest = publishedVerificationRequest(plan.asOfDate);
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/api/imports/inventory") return Response.json({ items: [] });
      return validRequest(input, init);
    }) as typeof fetch;

    await assert.rejects(
      verifyJackyunN8nPlan(plan, { root: fixture.root, request }),
      /inventory 精确批次未在运营系统落库历史中完成/,
    );
    assert.equal(plan.stage, "failed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n verify requires the exact batch to own the currently published non-sales facts", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-published-ownership-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    plan.stage = "executed";
    await assert.rejects(
      verifyJackyunN8nPlan(plan, {
        root: fixture.root,
        request: publishedVerificationRequest(plan.asOfDate, 9),
      }),
      /精确批次未在运营系统落库历史中完成/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n verify requires the inventory batch to be the snapshot currently selected by the system", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-inventory-current-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    plan.stage = "executed";
    await assert.rejects(
      verifyJackyunN8nPlan(plan, {
        root: fixture.root,
        request: publishedVerificationRequest(plan.asOfDate, 10, false),
      }),
      /inventory 精确批次未在运营系统落库历史中完成/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n verify rejects a live sales policy different from the child audit", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-sales-policy-mismatch-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    plan.stage = "executed";
    const validRequest = publishedVerificationRequest(plan.asOfDate);
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname !== "/api/imports/sales/verify") return validRequest(input, init);
      const response = await validRequest(input, init);
      const body = await response.json() as Record<string, unknown>;
      return Response.json({ ...body, policyVersion: "stale-sales-policy" });
    }) as typeof fetch;

    await assert.rejects(
      verifyJackyunN8nPlan(plan, { root: fixture.root, request }),
      /sales 精确批次或期间数据未通过独立落库回查/,
    );
    assert.equal(plan.stage, "failed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Jackyun n8n verify binds the sales batch to the archived output and this run's inventory cost source", async (t) => {
  for (const tamper of ["raw_file_hash", "cost_source_batch"] as const) {
    await t.test(tamper, async () => {
      const fixture = await createFixture();
      try {
        const now = new Date("2026-08-04T11:00:00.000Z");
        const plan = await planJackyunN8nRun({
          root: fixture.root,
          now,
          runIdFactory: () => `n8n-sales-${tamper}-run`,
          request: async () => new Response("ok", { status: 200 }),
        });
        await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
        plan.stage = "executed";
        const validRequest = publishedVerificationRequest(plan.asOfDate);
        const request = (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
          const response = await validRequest(input, init);
          if (url.pathname !== "/api/imports/sales/verify") return response;
          const body = await response.json() as {
            batch: { totals: { rawFileHash: string; systemCost: { sourceBatchId: string } } };
          } & Record<string, unknown>;
          if (tamper === "raw_file_hash") body.batch.totals.rawFileHash = "f".repeat(64);
          else body.batch.totals.systemCost.sourceBatchId = "f".repeat(64);
          return Response.json(body);
        }) as typeof fetch;

        await assert.rejects(
          verifyJackyunN8nPlan(plan, { root: fixture.root, request }),
          /sales 精确批次或期间数据未通过独立落库回查/,
        );
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("Jackyun n8n plan converts an executed response-loss run into a safe verification-only skip", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-executed-recovery-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeCompletedRun(fixture.root, plan.runId, plan.asOfDate);
    plan.stage = "executed";
    await writeFile(path.join(
      fixture.root,
      "outputs",
      "jackyun-n8n-pipeline",
      `plan-${plan.runId}.json`,
    ), JSON.stringify(plan), "utf8");

    const recovered = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "must-not-create-a-new-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(recovered.runId, plan.runId);
    assert.equal(recovered.existingRunId, plan.runId);
    assert.equal(recovered.skipped, true);
    assert.equal(recovered.stage, "planned");
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

test("Jackyun n8n refuses to resume a completed prefix without its atomic handoff", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-missing-prefix-handoff",
      request: async () => new Response("ok", { status: 200 }),
    });
    await writeResumablePartialRun(fixture.root, plan.runId);
    await rm(path.join(
      fixture.root,
      "outputs",
      "jackyun-browser-events",
      plan.runId,
      "01-products.json",
    ), { force: true });
    let browserStarts = 0;
    let dailyStarts = 0;
    await assert.rejects(runJackyunAutomationUnderLock({
      runId: plan.runId,
      snapshotDate: plan.snapshotDate,
      asOfDate: plan.asOfDate,
      eventDirectory: path.join(fixture.root, "outputs", "jackyun-browser-events"),
      outputRoot: path.join(fixture.root, "outputs", "jackyun-import-runs"),
      baseUrl: plan.baseUrl,
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
    }), /原子 handoff|JSON 文件损坏或无法读取|ENOENT/);
    assert.equal(browserStarts, 0);
    assert.equal(dailyStarts, 0);
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: "test failure", at: now.toISOString() };
    await writeFile(
      path.join(fixture.root, "outputs", "jackyun-n8n-pipeline", `plan-${plan.runId}.json`),
      JSON.stringify(plan),
      "utf8",
    );

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

test("Jackyun n8n reuses an untouched plan, but fails closed on a running plan or missing exact batch", async () => {
  const fixture = await createFixture();
  try {
    const now = new Date("2026-08-04T11:00:00.000Z");
    const plan = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-broken-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    const repeated = await planJackyunN8nRun({
      root: fixture.root,
      now,
      runIdFactory: () => "n8n-duplicate-run",
      request: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(repeated.runId, plan.runId);
    assert.equal(repeated.stage, "planned");

    plan.stage = "running";
    await writeFile(path.join(
      fixture.root,
      "outputs",
      "jackyun-n8n-pipeline",
      `plan-${plan.runId}.json`,
    ), JSON.stringify(plan), "utf8");
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
