import assert from "node:assert/strict";
import test from "node:test";

import {
  filterWarehouseMappings,
  warehouseMappingRows,
} from "../app/warehouse-mapping-settings";
import {
  classifyInventoryWarehouse,
  inventoryWarehouseCategoryLabels,
  inventoryWarehouseCategoryOrder,
} from "../lib/inventory/warehouse-classification";

test("warehouse mapping workspace exposes the complete verified source", () => {
  assert.equal(warehouseMappingRows.length, 284);
  assert.equal(warehouseMappingRows.filter((row) => row.includeInInventory).length, 66);
  assert.equal(warehouseMappingRows.filter((row) => !row.includeInInventory).length, 218);
  assert.deepEqual(
    warehouseMappingRows.find((row) => row.warehouse === "膳师傅仓库"),
    {
      warehouse: "膳师傅仓库",
      category: "dropship",
      label: "代发仓",
      includeInInventory: true,
    },
  );
});

test("warehouse mapping filters combine category, inventory scope, and search", () => {
  const includedDropship = filterWarehouseMappings(warehouseMappingRows, {
    query: "膳师傅",
    category: "dropship",
    inventory: "included",
  });
  assert.deepEqual(includedDropship.map((row) => row.warehouse), ["膳师傅仓库"]);

  const excludedJd = filterWarehouseMappings(warehouseMappingRows, {
    query: "",
    category: "jd",
    inventory: "excluded",
  });
  assert.equal(excludedJd.length, 0);

  const labelSearch = filterWarehouseMappings(warehouseMappingRows, {
    query: "异常仓",
    category: "all",
    inventory: "all",
  });
  assert.equal(labelSearch.length, 1);
  assert.equal(labelSearch[0]?.warehouse, "自营异常仓（不要审核发货）");
});

test("inventory views and settings share the same warehouse category contract", () => {
  assert.deepEqual(inventoryWarehouseCategoryOrder.slice(0, 9), [
    "jd", "dropship", "afterSales", "guangdong", "sample", "cainiao", "overseas", "virtual", "exception",
  ]);
  assert.equal(inventoryWarehouseCategoryLabels.overseas, "海外仓");
  assert.deepEqual(classifyInventoryWarehouse("膳师傅仓库"), {
    warehouseType: "other",
    warehouseCategory: "dropship",
    includeInInventory: true,
    mappingLabel: "代发仓",
    mappingSource: "configured",
  });
});
