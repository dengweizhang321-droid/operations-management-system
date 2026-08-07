import assert from "node:assert/strict";
import test from "node:test";
import { assertResumeAuditContract, JD_PIPELINE_RESULT_SENTINEL, parsePipelineResult, parseRunnerArgs, parseTrailingJson, shanghaiDefaultRange, validateStepResult, type RunnerAudit } from "../tools/jd-multi-store-runner";

test("runner mode all has no misleading dimension switch and extracts final JSON", () => {
  assert.equal(parseRunnerArgs([]).mode, "all");
  assert.throws(() => parseRunnerArgs(["--dimension", "SKU"]), /不再使用/);
  assert.deepEqual(parseTrailingJson("progress\n{\"old\":true}\n{\"savedPath\":\"D:/a.xlsx\",\"batchId\":\"b\",\"rowCount\":2}"), { savedPath: "D:/a.xlsx", batchId: "b", rowCount: 2 });
});

const store = { shopName: "A店" };
const dailyResult = (patch: Record<string, unknown> = {}) => ({ importResult: { status: "imported", batchId: "b", rowCount: 0, source: "jd_sku_daily", dataset: "sku_daily", platform: "京东", shopName: "A店", batchStatus: "completed", warningCount: 0, dateMin: "2026-07-01", dateMax: "2026-07-02", ...patch } });

test("runner rejects code-zero downloads without verified auto-import and mismatched daily identity", () => {
  assert.match(validateStepResult("jd_sku_daily", { status: "downloaded" }, store, { startDate: "2026-07-01", endDate: "2026-07-02" }) ?? "", /missing/);
  assert.match(validateStepResult("jd_sku_daily", dailyResult({ shopName: "B店" }), store, { startDate: "2026-07-01", endDate: "2026-07-02" }) ?? "", /identity/);
  assert.match(validateStepResult("jd_sku_daily", dailyResult({ dateMax: "2026-07-03" }), store, { startDate: "2026-07-01", endDate: "2026-07-02" }) ?? "", /date range/);
  assert.equal(validateStepResult("jd_sku_daily", dailyResult(), store, { startDate: "2026-07-01", endDate: "2026-07-02" }), null);
});

test("runner only accepts a single sentinel result and ignores tail telemetry JSON", () => {
  const valid = `${JD_PIPELINE_RESULT_SENTINEL}{"importResult":{"status":"imported"}}\n{"telemetry":true}`;
  assert.deepEqual(parsePipelineResult(valid), { importResult: { status: "imported" } });
  assert.equal(parsePipelineResult(`${valid}\n${JD_PIPELINE_RESULT_SENTINEL}{"other":true}`), null);
});

test("runner default range follows yesterday's Shanghai month on month boundary", () => {
  assert.deepEqual(shanghaiDefaultRange(new Date("2026-07-01T01:00:00+08:00")), { startDate: "2026-06-01", endDate: "2026-06-30" });
  assert.deepEqual(shanghaiDefaultRange(new Date("2026-07-21T01:00:00+08:00")), { startDate: "2026-07-01", endDate: "2026-07-20" });
});

test("runner resume only accepts a completed prefix followed by one failed step and planned suffix", () => {
  const steps = ["jd_product_master", "jd_sku_daily", "spu_daily"] as const;
  const master = { status: "imported", batchId: "master", rowCount: 1, source: "jd_product_master", dataset: "product_master", platform: "京东", shopName: "A店", batchStatus: "completed", warningCount: 0 };
  const audit: RunnerAudit = {
    version: 1, baseUrl: "http://localhost:3000", startedAt: "x", updatedAt: "x", mode: "all", dryRun: false, startDate: "2026-07-01", endDate: "2026-07-02", storeKeys: ["a"],
    items: [
      { storeKey: "a", shopName: "A店", step: steps[0], status: "completed", batchId: "master", rowCount: 1, importResult: master },
      { storeKey: "a", shopName: "A店", step: steps[1], status: "failed" },
      { storeKey: "a", shopName: "A店", step: steps[2], status: "planned" },
    ],
  };
  const options = { mode: "all", startDate: "2026-07-01", endDate: "2026-07-02", storeKey: undefined, dryRun: false };
  assert.doesNotThrow(() => assertResumeAuditContract(audit, options, [{ storeKey: "a", shopName: "A店" } as never], "http://localhost:3000"));
  const forged: RunnerAudit = { ...audit, items: [...audit.items] };
  forged.items[1] = { ...forged.items[1]!, status: "planned" };
  forged.items[2] = { ...forged.items[2]!, status: "completed", batchId: "spu", rowCount: 0, importResult: { ...dailyResult(), batchId: "spu", dataset: "spu_daily" } };
  assert.throws(() => assertResumeAuditContract(forged, options, [{ storeKey: "a", shopName: "A店" } as never], "http://localhost:3000"), /连续 completed 前缀/);
});
