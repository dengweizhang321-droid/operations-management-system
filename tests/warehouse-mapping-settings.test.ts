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
import {
  buildWarehouseMappingWorkbook,
  parseWarehouseMappingWorkbook,
  WarehouseMappingWorkbookError,
} from "../lib/inventory/warehouse-mapping-workbook";
import { parseWarehouseMappingPayload } from "../lib/inventory/warehouse-mapping-contract";
import { parseInventoryStockXlsx } from "../lib/imports/inventory-stock";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import type { InventoryWarehouseMapping } from "../lib/inventory/warehouse-classification";

test("configured self-operated warehouses use owned type and preserve inventory exclusion", () => {
  for (const warehouse of ["润心仓", "自营测试点", "京东转自营测试仓"]) {
    for (const included of [true, false]) {
      assert.deepEqual(classifyInventoryWarehouse(warehouse, {
        [warehouse]: { category: "selfOperated", label: "自营仓", includeInInventory: included },
      }), {
        warehouseType: "owned", warehouseCategory: "selfOperated", includeInInventory: included,
        mappingLabel: "自营仓", mappingSource: "configured",
      });
    }
  }
});

test("inventory workbook parsing sends configured self-operated stock as owned without changing its facts", () => {
  const mapping: InventoryWarehouseMapping = {
    "润心仓": { category: "selfOperated", label: "自营仓", includeInInventory: true },
    "代发测试仓": { category: "dropship", label: "代发仓", includeInInventory: false },
  };
  const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [
    ["仓库", "货品编号", "货品名称", "库存数量", "可用库存", "固定成本价"],
    ["润心仓", "FIXTURE-1", "模拟货品", 12, 9, 25.5],
    ["代发测试仓", "FIXTURE-2", "模拟货品二", 7, 6, 10],
  ] }]);
  const parsed = parseInventoryStockXlsx(bytes, { warehouseMapping: mapping });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 2);
  const row = parsed.rows[0]!;
  assert.equal(row.warehouseType, "owned");
  assert.equal(row.warehouseCategory, "selfOperated");
  assert.equal(row.includeInInventory, true);
  assert.equal(row.sourceRowNumber, 2);
  assert.equal(row.rowKey, "润心仓\u001fFIXTURE-1");
  assert.equal(row.onHandQuantity, 12);
  assert.equal(row.availableQuantity, 9);
  assert.equal(row.unitCostCents, 2550);
  assert.equal(parsed.rows[1]!.warehouseType, "other");
  assert.equal(parsed.rows[1]!.includeInInventory, false);
});

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
      pendingConfirmation: false,
    },
  );
});

test("warehouse mapping filters combine category, inventory scope, and search", () => {
  const includedDropship = filterWarehouseMappings(warehouseMappingRows, {
    query: "膳师傅",
    category: "dropship",
    inventory: "included",
    confirmation: "all",
  });
  assert.deepEqual(includedDropship.map((row) => row.warehouse), ["膳师傅仓库"]);

  const excludedJd = filterWarehouseMappings(warehouseMappingRows, {
    query: "",
    category: "jd",
    inventory: "excluded",
    confirmation: "all",
  });
  assert.equal(excludedJd.length, 0);

  const labelSearch = filterWarehouseMappings(warehouseMappingRows, {
    query: "异常仓",
    category: "all",
    inventory: "all",
    confirmation: "all",
  });
  assert.equal(labelSearch.length, 1);
  assert.equal(labelSearch[0]?.warehouse, "自营异常仓（不要审核发货）");
});

test("newly discovered warehouses can be isolated for manual confirmation", () => {
  const pending = {
    ...warehouseMappingRows[0]!,
    warehouse: "首次发现测试仓",
    category: "selfOperated" as const,
    label: "自营仓",
    pendingConfirmation: true,
  };
  const filtered = filterWarehouseMappings([...warehouseMappingRows, pending], {
    query: "",
    category: "all",
    inventory: "all",
    confirmation: "pending",
  });
  assert.deepEqual(filtered, [pending]);

  const parsed = parseWarehouseMappingPayload({
    rows: [pending],
    mappingRevision: "a".repeat(64),
    pendingConfirmationCount: 1,
    updatedAt: null,
    updatedBy: null,
  });
  assert.equal(parsed.pendingConfirmationCount, 1);
  assert.equal(parsed.rows[0]?.category, "selfOperated");
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

test("warehouse mapping workbook export round-trips through the guarded importer", () => {
  const bytes = buildWarehouseMappingWorkbook(warehouseMappingRows);
  const parsed = parseWarehouseMappingWorkbook(bytes);
  assert.equal(parsed.length, 284);
  assert.deepEqual(parsed.find((row) => row.warehouse === "一个小太阳仓"), {
    warehouse: "一个小太阳仓",
    category: "dropship",
    includeInInventory: false,
  });
  assert.deepEqual(parsed.find((row) => row.warehouse === "膳师傅仓库"), {
    warehouse: "膳师傅仓库",
    category: "dropship",
    includeInInventory: true,
  });
});

test("warehouse mapping workbook importer rejects duplicate warehouses", async () => {
  const { utils, write } = await import("xlsx");
  const sheet = utils.aoa_to_sheet([
    ["仓库", "自定义仓库类型", "计入库存", "备注"],
    ["重复仓", "代发仓", "是", ""],
    ["重复仓", "京东仓", "否", ""],
  ]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "mapping");
  const bytes = write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
  assert.throws(() => parseWarehouseMappingWorkbook(bytes), WarehouseMappingWorkbookError);
});
