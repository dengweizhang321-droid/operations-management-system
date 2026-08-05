import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJackyunInputContractHash } from "../lib/jackyun/run-contract";
import { isExactFailedSourceRowCountRepair } from "../tools/jackyun-download-runner";

const execFileAsync = promisify(execFile);

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

test("duplicate contract changes when any import-defining parameter changes", () => {
  const base = {
    module: "sales" as const,
    rawSha256: "raw-sha",
    snapshotDate: undefined,
    asOfDate: "2026-07-15",
    expectedSourceRows: 15186,
    costOutputSha256: "cost-sha",
    costSourcePath: "D:\\runs\\inventory.xlsx",
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
  assert.notEqual(createJackyunInputContractHash({ ...base, module: "inventory", snapshotDate: "2026-07-15" }), original);
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
