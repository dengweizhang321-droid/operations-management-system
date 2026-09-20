import assert from "node:assert/strict";
import test from "node:test";
import { dailyDateCoverage, dailyRowKey, detectJdDailyDataset } from "../lib/netshop/daily-contract";
import { netshopBatchId, netshopMasterRowKey, sameNetshopBatchIdentity } from "../lib/netshop/batch-identity";

test("JD daily dataset is determined by exact headers, never by an SPU-looking file name", () => {
  assert.equal(detectJdDailyDataset(["时间", "SKU", "SKU名称"]), "sku_daily");
  assert.equal(detectJdDailyDataset(["时间", "SPU", "SPU名称"]), "spu_daily");
  assert.throws(
    () => detectJdDailyDataset(["时间", "SKU", "SKU名称", "SPU", "SPU名称"]),
    /必须且只能包含/,
  );
});

test("JD daily coverage reports a missing middle day and out-of-range data", () => {
  const coverage = dailyDateCoverage("2026-07-01", "2026-07-03", ["2026-07-01", "2026-07-03", "2026-07-04"]);
  assert.equal(coverage.validRange, true);
  assert.deepEqual(coverage.missingDates, ["2026-07-02"]);
  assert.deepEqual(coverage.outOfRangeDates, ["2026-07-04"]);
});

test("JD daily natural keys are stable across files and distinct across dimensions", () => {
  const first = dailyRowKey("sku_daily", "京东", "志高商用设备旗舰店", "2026-07-01", "SKU-1");
  const regenerated = dailyRowKey("sku_daily", "京东", "志高商用设备旗舰店", "2026-07-01", "SKU-1");
  const spu = dailyRowKey("spu_daily", "京东", "志高商用设备旗舰店", "2026-07-01", "SKU-1");
  assert.equal(first, regenerated);
  assert.notEqual(first, spu);
});

test("same workbook hash is idempotent per shop but not shared across shops", () => {
  const first = { source: "jd_sku_daily" as const, platform: "京东", shopName: "A店", fileHash: "hash" };
  const second = { ...first, shopName: "B店" };
  assert.equal(netshopBatchId(first), netshopBatchId(first));
  assert.notEqual(netshopBatchId(first), netshopBatchId(second));
  assert.equal(sameNetshopBatchIdentity(first, first), true);
  assert.equal(sameNetshopBatchIdentity(first, second), false);
});

test("product-master file rows coexist across shops and remain stable within one shop", () => {
  const base = { source: "jd_product_master", platform: "京东", shopName: "A店", fileHash: "hash", rowNumber: 2, rowHash: "abcdef0123456789" };
  assert.equal(netshopMasterRowKey(base), netshopMasterRowKey(base));
  assert.notEqual(netshopMasterRowKey(base), netshopMasterRowKey({ ...base, shopName: "B店" }));
});
