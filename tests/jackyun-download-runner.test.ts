import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertJackyunHistoricalSnapshotEvidence,
  createJackyunInputContractHash,
  type JackyunHistoricalSnapshotEvidence,
} from "../lib/jackyun/run-contract";
import { assertBoundDownloadProvenance } from "../lib/jackyun/download-provenance";
import {
  assertJackyunDownloadFreshness,
  assertNoJackyunPreparedPromotion,
  isExactFailedSourceRowCountRepair,
} from "../tools/jackyun-download-runner";

const execFileAsync = promisify(execFile);
const contractProvenance = {
  runId: "contract-run",
  module: "sales" as const,
  policyVersion: "test-policy",
  downloadId: "contract-download-0001",
  method: "browser_event" as const,
  completedAt: "2026-07-16T01:00:05.000Z",
  originalFileName: "2525143708216076928.xlsx",
  sha256: "a".repeat(64),
  bytes: 1024,
};

test("unified runner requires the stable page row count contract", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/jackyun-download-runner.ts"),
      "--module", "products",
      "--file", path.resolve("missing.xlsx"),
      "--run-id", "argument-contract-test",
      "--export-start", "2026-07-16T01:00:00.000Z",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
    (error: unknown) => {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      return stderr.includes("--expected-source-rows");
    },
  );
});

test("unified runner requires an explicit shared run id", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/jackyun-download-runner.ts"),
      "--module", "products",
      "--file", path.resolve("missing.xlsx"),
      "--export-start", "2026-07-16T01:00:00.000Z",
      "--expected-source-rows", "8000",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
    (error: unknown) => ((error as { stderr?: string }).stderr ?? "").includes("--run-id"),
  );
});

test("formal post-download CLI requires the controller handoff instead of self-asserted evidence", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/jackyun-download-runner.ts"),
      "--module", "products",
      "--file", path.resolve("missing.xlsx"),
      "--run-id", "handoff-contract-test",
      "--export-start", "2026-08-06T01:00:00.000Z",
      "--expected-source-rows", "8000",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
    (error: unknown) => ((error as { stderr?: string }).stderr ?? "").includes("--handoff-file"),
  );
});

test("duplicate contract changes when any import-defining parameter changes", () => {
  const base = {
    runId: "contract-run",
    policyVersion: "test-policy",
    module: "sales" as const,
    rawSha256: "raw-sha",
    snapshotDate: undefined,
    asOfDate: "2026-07-15",
    expectedSourceRows: 15186,
    costOutputSha256: "cost-sha",
    costSourcePath: "D:\\runs\\inventory.xlsx",
    exportStart: "2026-07-16T01:00:00.000Z",
    downloadEventAt: contractProvenance.completedAt,
    downloadProvenance: contractProvenance,
    handoffEvidence: {
      navigationIntentAt: "2026-07-16T00:59:58.000Z",
      queryIntentAt: "2026-07-16T00:59:59.000Z",
      tableStableAt: "2026-07-16T01:00:00.000Z",
      exportIntentAt: "2026-07-16T01:00:00.000Z",
      downloadEventAt: contractProvenance.completedAt,
    },
    baseUrl: "http://localhost:3000",
  };
  const original = createJackyunInputContractHash(base);
  assert.equal(createJackyunInputContractHash({ ...base }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, asOfDate: "2026-07-14" }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, expectedSourceRows: 15185 }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, previousComboRows: 4304 }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, costOutputSha256: "other-cost" }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, costSourcePath: "D:\\runs\\wrong.xlsx" }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, baseUrl: "http://localhost:3001" }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, policyVersion: "other-policy" }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, exportStart: "2026-07-16T00:59:59.000Z" }), original);
  assert.notEqual(createJackyunInputContractHash({
    ...base,
    handoffEvidence: { ...base.handoffEvidence, tableStableAt: "2026-07-16T00:59:59.500Z" },
  }), original);
  assert.notEqual(createJackyunInputContractHash({ ...base, module: "inventory", snapshotDate: "2026-07-15" }), original);
});

test("historical inventory evidence is bound to the run, target date, query, stable table, and export", () => {
  const evidence: JackyunHistoricalSnapshotEvidence = {
    version: 1,
    module: "inventory",
    runId: "snapshot-proof",
    source: "historical_date_control",
    targetDate: "2026-08-05",
    observedDate: "2026-08-05",
    controlReadbackAt: "2026-08-06T01:00:01.000Z",
    queryIntentAt: "2026-08-06T01:00:02.000Z",
    queryRefreshSource: "module_network_request",
    queryRefreshCompletedAt: "2026-08-06T01:00:03.000Z",
    tableStableAt: "2026-08-06T01:00:04.000Z",
  };
  const expected = {
    module: "inventory" as const,
    runId: "snapshot-proof",
    snapshotDate: "2026-08-05",
    navigationIntentAt: "2026-08-06T01:00:00.000Z",
    exportIntentAt: "2026-08-06T01:00:05.000Z",
  };

  assert.doesNotThrow(() => assertJackyunHistoricalSnapshotEvidence(evidence, expected));
  assert.throws(
    () => assertJackyunHistoricalSnapshotEvidence(undefined, expected),
    /FIELD_MISMATCH.*缺少历史快照页面证据/,
  );
  assert.throws(
    () => assertJackyunHistoricalSnapshotEvidence({ ...evidence, observedDate: "2026-08-06" }, expected),
    /FIELD_MISMATCH.*读回不一致/,
  );
  assert.throws(
    () => assertJackyunHistoricalSnapshotEvidence({ ...evidence, runId: "other-run" }, expected),
    /FIELD_MISMATCH.*运行身份不一致/,
  );
  assert.throws(
    () => assertJackyunHistoricalSnapshotEvidence({ ...evidence, tableStableAt: "2026-08-06T00:59:59.000Z" }, expected),
    /TABLE_TIMEOUT/,
  );
  assert.throws(
    () => assertJackyunHistoricalSnapshotEvidence({
      ...evidence,
      queryRefreshCompletedAt: "2026-08-06T01:00:01.500Z",
    }, expected),
    /TABLE_TIMEOUT.*刷新完成时间/,
  );

  const contract = {
    runId: "snapshot-proof",
    policyVersion: "test-policy",
    module: "inventory" as const,
    rawSha256: "a".repeat(64),
    snapshotDate: "2026-08-05",
    snapshotEvidence: evidence,
    expectedSourceRows: 100,
    exportStart: "2026-08-06T01:00:05.000Z",
    downloadEventAt: "2026-08-06T01:00:06.000Z",
    downloadProvenance: {
      ...contractProvenance,
      runId: "snapshot-proof",
      module: "inventory" as const,
      completedAt: "2026-08-06T01:00:06.000Z",
    },
    handoffEvidence: {
      navigationIntentAt: "2026-08-06T01:00:00.000Z",
      queryIntentAt: "2026-08-06T01:00:02.000Z",
      tableStableAt: "2026-08-06T01:00:04.000Z",
      exportIntentAt: "2026-08-06T01:00:05.000Z",
      downloadEventAt: "2026-08-06T01:00:06.000Z",
    },
    baseUrl: "http://localhost:3000",
  };
  assert.notEqual(
    createJackyunInputContractHash(contract),
    createJackyunInputContractHash({ ...contract, snapshotEvidence: { ...evidence, controlReadbackAt: "2026-08-06T01:00:01.500Z" } }),
  );
});

test("formal download provenance requires an event bound to exact bytes", () => {
  const base = {
    runId: "snapshot-proof",
    module: "inventory" as const,
    policyVersion: "test-policy",
    downloadId: "download-20260806",
    method: "browser_event" as const,
    completedAt: "2026-08-06T01:00:05.000Z",
    originalFileName: "分仓库存查询.xlsx",
  };
  assert.throws(() => assertBoundDownloadProvenance(undefined), /FILE_BINDING_FAILED/);
  assert.throws(() => assertBoundDownloadProvenance(base), /SHA-256.*字节数/);
  assert.doesNotThrow(() => assertBoundDownloadProvenance({ ...base, sha256: "a".repeat(64), bytes: 1024 }));
  assert.throws(() => assertBoundDownloadProvenance(
    { ...base, sha256: "a".repeat(64), bytes: 1024 },
    undefined,
    { runId: "other-run", module: "inventory", policyVersion: "test-policy" },
  ), /runId.*module.*policyVersion/);
});

test("direct post-download cannot promote a prepared module under the same run id", () => {
  assert.doesNotThrow(() => assertNoJackyunPreparedPromotion("prepared", true));
  assert.throws(() => assertNoJackyunPreparedPromotion("prepared", false), /不得.*升级|新的 run id/);
  assert.doesNotThrow(() => assertNoJackyunPreparedPromotion("completed", false));
});

test("unified runner rejects files older than the current export intent", () => {
  const exportStart = "2026-08-06T01:00:00.000Z";
  assert.doesNotThrow(() => assertJackyunDownloadFreshness(Date.parse(exportStart), exportStart));
  assert.throws(
    () => assertJackyunDownloadFreshness(Date.parse(exportStart) - 60_000, exportStart),
    /拒绝复用历史文件/,
  );
});

test("row-count contract repair requires an exact pre-import failed audit and one explicit correction", () => {
  const filePath = path.resolve("库龄分析(正式勿删).xlsx");
  const rawSha256 = "a".repeat(64);
  const base = {
    runId: "row-count-repair",
    module: "inventory_age" as const,
    filePath,
    rawSha256,
    expectedSourceRows: 5556,
    correction: {
      reason: "exact_total_after_approximate_count" as const,
      previousExpectedSourceRows: 51,
      exactExpectedSourceRows: 5556,
      observedAt: "2026-08-05T18:20:00.000Z",
    },
    priorModule: {
      module: "inventory_age",
      status: "failed",
      sourcePath: filePath,
      sourceSha256: rawSha256,
      inputContractHash: "old-contract",
    },
    failedAudit: {
      runId: "row-count-repair",
      module: "inventory_age",
      status: "failed",
      timings: { failedAt: "2026-08-05T18:19:00.000Z" },
      source: { path: filePath, sha256: rawSha256 },
      error: {
        stage: "validate_and_prepare_workbook",
        details: { expectedSourceRows: 51, actualSourceRows: 5556 },
      },
    },
  };
  assert.equal(isExactFailedSourceRowCountRepair(base), true);
  assert.equal(isExactFailedSourceRowCountRepair({ ...base, failedAudit: { ...base.failedAudit, import: { batch: "unexpected" } } }), false);
  assert.equal(isExactFailedSourceRowCountRepair({ ...base, correction: { ...base.correction, exactExpectedSourceRows: 5555 } }), false);
  assert.equal(isExactFailedSourceRowCountRepair({ ...base, correction: { ...base.correction, observedAt: "2026-08-05T18:18:00.000Z" } }), false);
});

test("daily sales runner rejects an as-of date other than Shanghai yesterday", async () => {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => todayParts.find((item) => item.type === type)?.value ?? "";
  const shanghaiToday = `${part("year")}-${part("month")}-${part("day")}`;
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/jackyun-download-runner.ts"),
      "--module", "sales",
      "--file", path.resolve("missing.xlsx"),
      "--run-id", "sales-date-contract-test",
      "--export-start", new Date().toISOString(),
      "--expected-source-rows", "10",
      "--as-of", shanghaiToday,
      "--cost-source", path.resolve("missing-cost.xlsx"),
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
    (error: unknown) => ((error as { stderr?: string }).stderr ?? "").includes("北京时间昨天"),
  );
});

test("daily snapshot runners reject a date other than Shanghai yesterday", async () => {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => todayParts.find((item) => item.type === type)?.value ?? "";
  const shanghaiToday = `${part("year")}-${part("month")}-${part("day")}`;
  for (const moduleKey of ["inventory", "inventory_age"]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        "--import", "tsx", path.resolve("tools/jackyun-download-runner.ts"),
        "--module", moduleKey,
        "--file", path.resolve("missing.xlsx"),
        "--run-id", `${moduleKey}-date-contract-test`,
        "--export-start", new Date().toISOString(),
        "--expected-source-rows", "10",
        "--snapshot", shanghaiToday,
      ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
      (error: unknown) => ((error as { stderr?: string }).stderr ?? "").includes("北京时间昨天"),
    );
  }
});
