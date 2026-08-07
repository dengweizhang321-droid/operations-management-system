import assert from "node:assert/strict";
import test from "node:test";

import { buildNetshopImportBatchListQuery } from "../lib/netshop/import-batch-list-query";

test("netshop batch list binds batchId together with source/platform/shop and preserves the no-id path", async () => {
  const narrowed = buildNetshopImportBatchListQuery({
    limit: 1, ids: ["batch-1"], sources: ["jd_sku_daily"], platforms: ["京东"], shops: ["测试店"],
  });
  assert.equal(narrowed.whereSql, "id IN (?) AND source IN (?) AND platform IN (?) AND shop_name IN (?)");
  assert.deepEqual(narrowed.bindings, ["batch-1", "jd_sku_daily", "京东", "测试店"]);
  assert.equal(narrowed.limit, 1);

  const compatible = buildNetshopImportBatchListQuery({ limit: 2, sources: ["jd_product_master"] });
  assert.doesNotMatch(compatible.whereSql, /id IN/);
  assert.deepEqual(compatible.bindings, ["jd_product_master"]);
  assert.equal(compatible.limit, 2);
});
