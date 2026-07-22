import assert from "node:assert/strict";
import test from "node:test";
import { JD_PIPELINE_RESULT_SENTINEL, parsePipelineResult, parseRunnerArgs, parseTrailingJson, shanghaiDefaultRange, validateStepResult } from "../tools/jd-multi-store-runner";

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
