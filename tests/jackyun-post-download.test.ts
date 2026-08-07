import assert from "node:assert/strict";
import test from "node:test";
import {
  assertComboRelationBaseline,
  JackyunValidationError,
  prepareJackyunWorkbook,
} from "../lib/jackyun/post-download";
import { parseXlsxFirstSheet, type XlsxCellValue } from "../lib/imports/xlsx";
import { parseInventoryStockXlsx } from "../lib/imports/inventory-stock";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

test("products validation keeps the original workbook and reports true data rows", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["货品编号", "货品名称", "固定成本价", "基础单位"],
      ["SKU-1", "测试货品", 12.5, "台"],
    ],
  }]);

  const prepared = prepareJackyunWorkbook("products", workbook, { minimumRows: 1 });
  assert.equal(prepared.importBytes, workbook);
  assert.equal(prepared.validation.sourceRowCount, 1);
  assert.equal(prepared.expectedBatchRowCount, 1);
  assert.equal(prepared.preprocessing.kind, "none");
});

test("products validation uses unique product codes as the expected batch row count", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["货品编号", "货品名称", "固定成本价", "基础单位"],
      ["SKU-1", "旧名称", 10, "台"],
      ["SKU-1", "新名称", 12, "台"],
    ],
  }]);

  const prepared = prepareJackyunWorkbook("products", workbook, { minimumRows: 1 });
  assert.equal(prepared.expectedBatchRowCount, 1);
  assert.equal(prepared.validation.duplicateKeyRows, 1);
});

test("inventory processing removes the exact brush warehouse and non-positive costs", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["货品编号", "货品名称", "规格", "单位", "仓库", "固定成本价", "库存数量"],
      ["SKU-1", "货品一", "标准", "台", "正常仓", 10, 3],
      ["SKU-2", "货品二", "标准", "台", " 刷刷仓 ", 10, 4],
      ["SKU-3", "货品三", "标准", "台", "刷刷仓备用", 12, 5],
      ["SKU-4", "货品四", "标准", "台", "正常仓", 0, 6],
      ["SKU-5", "货品五", "标准", "台", "正常仓", -1, 7],
    ],
  }]);

  const prepared = prepareJackyunWorkbook("inventory", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" });
  assert.equal(prepared.validation.sourceRowCount, 5);
  assert.equal(prepared.validation.importRowCount, 2);
  assert.equal(prepared.preprocessing.excludedBrushWarehouseRows, 1);
  assert.equal(prepared.preprocessing.excludedZeroCostRows, 2);
  assert.deepEqual(prepared.preprocessing.similarWarehouseNames, ["刷刷仓备用"]);

  const parsed = parseXlsxFirstSheet(prepared.importBytes);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows.map((row) => row.cells[4]), ["仓库", "正常仓", "刷刷仓备用"]);
  assert.deepEqual(parsed.rows.map((row) => row.cells[5]), ["固定成本价", 10, 12]);
  const inventoryRows = parseInventoryStockXlsx(prepared.importBytes).rows;
  assert.equal(inventoryRows.length, prepared.expectedBatchRowCount);
  assert.ok(inventoryRows.every((row) => row.unitCostCents > 0));
});

test("inventory row identity is stable when workbook rows are reordered", () => {
  const workbook = (rows: XlsxCellValue[][]) => createXlsxWorkbookBytes([{
    name: "库存",
    rows: [
      ["货品编号", "货品名称", "仓库", "固定成本价", "库存数量"],
      ...rows,
    ],
  }]);
  const first = parseInventoryStockXlsx(workbook([
    ["P1", "货品一", "正常仓", 10, 1],
    ["P2", "货品二", "正常仓", 10, 2],
  ])).rows;
  const reordered = parseInventoryStockXlsx(workbook([
    ["P2", "货品二", "正常仓", 10, 2],
    ["P1", "货品一", "正常仓", 10, 1],
  ])).rows;
  assert.deepEqual(
    Object.fromEntries(first.map((row) => [row.productCode, row.rowKey])),
    Object.fromEntries(reordered.map((row) => [row.productCode, row.rowKey])),
  );
  assert.deepEqual(first.map((row) => row.rowKey).sort(), [
    JSON.stringify(["正常仓", "P1"]),
    JSON.stringify(["正常仓", "P2"]),
  ]);
});

test("inventory age uses the same exact warehouse filter and required schema", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["仓库", "货品编号", "货品名称", "库存数量", "库龄(天)"],
      ["刷刷仓", "SKU-1", "货品一", 2, 10],
      ["主仓", "SKU-2", "货品二", 3, 20],
    ],
  }]);

  const prepared = prepareJackyunWorkbook("inventory_age", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" });
  assert.equal(prepared.preprocessing.excludedBrushWarehouseRows, 1);
  assert.equal(prepared.expectedBatchRowCount, 1);
});

test("inventory validation applies the minimum row gate after warehouse and cost filtering", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["货品编号", "货品名称", "规格", "单位", "仓库", "固定成本价", "库存数量"],
      ["SKU-1", "货品一", "标准", "台", "刷刷仓", 10, 3],
    ],
  }]);

  assert.throws(
    () => prepareJackyunWorkbook("inventory", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" }),
    (error) => error instanceof JackyunValidationError && error.details.actualRows === 0,
  );
});

test("inventory age validation matches backend warehouse and product deduplication", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["仓库", "货品编号", "货品名称", "库存数量", "库龄(天)"],
      ["主仓", "SKU-1", "货品一", 2, 10],
      ["主仓", "SKU-1", "货品一", 3, 20],
    ],
  }]);

  const prepared = prepareJackyunWorkbook("inventory_age", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" });
  assert.equal(prepared.expectedBatchRowCount, 1);
  assert.equal(prepared.validation.duplicateKeyRows, 1);
});

test("combo validation counts unique relations and preserves duplicate warnings for importer", () => {
  const workbook = createXlsxWorkbookBytes([
    {
      name: "sheet",
      rows: [
        ["货品编号", "货品名称"],
        ["P-1", "组合一"],
      ],
    },
    {
      name: "sheet1",
      rows: [
        ["母件编号", "编号", "名称", "数量"],
        ["P-1", "C-1", "子件一", 1],
        ["P-1", "C-1", "子件一", 2],
        ["P-1", "C-2", "子件二", 1],
      ],
    },
  ]);

  const prepared = prepareJackyunWorkbook("combos", workbook, { minimumRows: 1 });
  assert.equal(prepared.validation.sourceRowCount, 3);
  assert.equal(prepared.validation.duplicateRelationRows, 1);
  assert.equal(prepared.expectedBatchRowCount, 2);
});

test("combo validation reports bounded samples for invalid quantities", () => {
  const workbook = createXlsxWorkbookBytes([
    { name: "sheet", rows: [["货品编号", "货品名称"], ["P-1", "组合一"]] },
    { name: "sheet1", rows: [["母件编号", "编号", "名称", "数量"], ["P-1", "C-1", "子件一", 0]] },
  ]);

  assert.throws(
    () => prepareJackyunWorkbook("combos", workbook, { minimumRows: 1 }),
    (error) => error instanceof JackyunValidationError
      && error.details.invalidQuantityRowCount === 1
      && Array.isArray(error.details.samples),
  );
});

test("combo validation rejects blank parent or child codes before upload", () => {
  const workbook = createXlsxWorkbookBytes([
    { name: "sheet", rows: [["货品编号", "货品名称"], ["P-1", "组合一"]] },
    { name: "sheet1", rows: [["母件编号", "编号", "名称", "数量"], ["P-1", "", "子件一", 1]] },
  ]);

  assert.throws(
    () => prepareJackyunWorkbook("combos", workbook, { minimumRows: 1 }),
    (error) => error instanceof JackyunValidationError
      && error.details.invalidValueCount === 1
      && Array.isArray(error.details.samples),
  );
});

test("combo minimum row gate is applied after relation deduplication", () => {
  const duplicateRows = Array.from({ length: 100 }, () => ["P-1", "C-1", "子件一", 1]);
  const workbook = createXlsxWorkbookBytes([
    { name: "sheet", rows: [["货品编号", "货品名称"], ["P-1", "组合一"]] },
    { name: "sheet1", rows: [["母件编号", "编号", "名称", "数量"], ...duplicateRows] },
  ]);

  assert.throws(
    () => prepareJackyunWorkbook("combos", workbook, { minimumRows: 2 }),
    (error) => error instanceof JackyunValidationError && error.details.actualRows === 1,
  );
});

test("combo coverage gate blocks a complete parent sheet with a truncated child relation sheet", () => {
  const workbook = createXlsxWorkbookBytes([
    {
      name: "sheet",
      rows: [["货品编号", "货品名称"], ["P-1", "组合一"], ["P-2", "组合二"]],
    },
    {
      name: "sheet1",
      rows: [["母件编号", "编号", "名称", "数量"], ["P-1", "C-1", "子件一", 1]],
    },
  ]);
  assert.throws(
    () => prepareJackyunWorkbook("combos", workbook, { minimumRows: 1 }),
    (error) => error instanceof JackyunValidationError
      && error.details.missingRelationParentCount === 1
      && error.details.orphanRelationParentCount === 0,
  );
});

test("combo historical baseline allows normal drift but blocks a significant relation drop", () => {
  assert.equal(
    assertComboRelationBaseline(95, { id: "combos:prior", rowCount: 100 }).status,
    "passed",
  );
  assert.throws(
    () => assertComboRelationBaseline(94, { id: "combos:prior", rowCount: 100 }),
    (error) => error instanceof JackyunValidationError
      && error.details.minimumAllowedRowCount === 95
      && error.details.currentRowCount === 94,
  );
  assert.throws(
    () => assertComboRelationBaseline(100, null),
    (error) => error instanceof JackyunValidationError && error.details.previousBatchId === null,
  );
});

test("snapshot workbooks are deterministic within a date and differ across dates", () => {
  const workbook = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      ["仓库", "货品编号", "货品名称", "库存数量", "库龄(天)"],
      ["主仓", "SKU-1", "货品一", 2, 10],
    ],
  }]);

  const first = prepareJackyunWorkbook("inventory_age", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" });
  const retry = prepareJackyunWorkbook("inventory_age", workbook, { minimumRows: 1, snapshotDate: "2026-07-15" });
  const nextDay = prepareJackyunWorkbook("inventory_age", workbook, { minimumRows: 1, snapshotDate: "2026-07-16" });
  assert.deepEqual(first.importBytes, retry.importBytes);
  assert.notDeepEqual(first.importBytes, nextDay.importBytes);
});
