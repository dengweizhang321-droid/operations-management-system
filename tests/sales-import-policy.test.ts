import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedSalesChannel,
  isExcludedSalesWarehouse,
  isZeroCostProductName,
  salesImportPolicy,
} from "../lib/sales/import-policy";

test("sales import policy keeps the exact 21-shop whitelist", () => {
  assert.equal(salesImportPolicy.approvedSalesChannels.length, 21);
  assert.equal(isApprovedSalesChannel("天猫-志高亿用专卖店"), true);
  assert.equal(isApprovedSalesChannel("亿玖淘工厂"), true);
  assert.equal(isApprovedSalesChannel("天猫-非名单店铺"), false);
});

test("sales import policy uses exact normalized warehouse and price-adjustment values", () => {
  assert.equal(isExcludedSalesWarehouse(" 刷刷仓 "), true);
  assert.equal(isExcludedSalesWarehouse("刷刷仓备用"), false);
  assert.equal(isZeroCostProductName("补差价专用"), true);
  assert.equal(isZeroCostProductName("补差价专用-测试"), false);
});
