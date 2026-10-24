import assert from "node:assert/strict";
import test from "node:test";

import { parseInventoryStockXlsx } from "../lib/imports/inventory-stock";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

const HEADERS = ["仓库", "货品编号", "货品名称", "库存数量", "可用库存", "锁定数量", "在途数量", "固定成本价"];

function workbook(rows: unknown[][]) {
  return createXlsxWorkbookBytes([{ name: "库存", rows: [HEADERS, ...rows] }]);
}

test("小数数量四舍五入成功，产生 warning，不进入 parseErrors", () => {
  const bytes = workbook([
    ["广东仓", "SKU-1", "测试货品", 10.5, 9.5, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.onHandQuantity, 11);
  assert.equal(parsed.rows[0]!.availableQuantity, 10);
  assert.equal(parsed.warnings.length, 2);
  assert.ok(parsed.warnings.every((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY"));
  const onHandWarning = parsed.warnings.find((warning) => warning.field === "onHandQuantity");
  assert.ok(onHandWarning);
  assert.equal(onHandWarning!.sourceRowNumber, 2);
  assert.match(onHandWarning!.message, /10\.5/);
  assert.match(onHandWarning!.message, /11/);
});

test("真实故障值 3325.5 四舍五入为 3326（Math.round 规则：四舍六入五成双不适用，统一就近取整，.5 向上）", () => {
  const bytes = workbook([
    ["广东仓", "SKU-REAL", "真实故障货品", 3325.5, 3325.5, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.onHandQuantity, 3326);
  assert.equal(parsed.rows[0]!.availableQuantity, 3326);
  const fields = parsed.warnings.map((warning) => warning.field);
  assert.ok(fields.includes("onHandQuantity"));
  assert.ok(fields.includes("availableQuantity"));
});

test("非数字字符串仍然是 INVALID_NUMBER 阻断错误", () => {
  const bytes = workbook([
    ["广东仓", "SKU-2", "测试货品二", "abc", 1, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "onHandQuantity");
  assert.equal(parsed.warnings.length, 0);
});

test("负数且 nonNegative（锁定数量/在途数量）仍然阻断", () => {
  const bytes = workbook([
    ["广东仓", "SKU-3", "测试货品三", 10, 10, -1, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "lockedQuantity");
  assert.match(parsed.errors[0]!.message, /负数/);
});

test("超出安全整数范围仍然阻断", () => {
  const bytes = workbook([
    ["广东仓", "SKU-4", "测试货品四", Number.MAX_SAFE_INTEGER + 2, 1, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "onHandQuantity");
});

test("整数输入行为完全不变，不产生多余 warning", () => {
  const bytes = workbook([
    ["广东仓", "SKU-5", "测试货品五", 12, 9, 2, 1, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.onHandQuantity, 12);
  assert.equal(parsed.rows[0]!.availableQuantity, 9);
  assert.equal(parsed.rows[0]!.lockedQuantity, 2);
  assert.equal(parsed.rows[0]!.inTransitQuantity, 1);
});

test("成本价小数行为不变：不在本次数量容错放宽范围内", () => {
  const bytes = workbook([
    ["广东仓", "SKU-6", "测试货品六", 10, 10, 0, 0, 25.5],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows[0]!.unitCostCents, 2550);

  const invalidCostBytes = workbook([
    ["广东仓", "SKU-7", "测试货品七", 10, 10, 0, 0, "abc"],
  ]);
  const invalidCostParsed = parseInventoryStockXlsx(invalidCostBytes);
  assert.equal(invalidCostParsed.rows.length, 0);
  assert.equal(invalidCostParsed.errors.length, 1);
  assert.equal(invalidCostParsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(invalidCostParsed.errors[0]!.field, "unitCost");
});

test("前7/30天销量小数同样容错四舍五入", () => {
  const headers = [...HEADERS, "前7天销量", "前30天销量"];
  const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [
    headers,
    ["广东仓", "SKU-8", "测试货品八", 10, 10, 0, 0, 20, 7.4, 29.6],
  ] }]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0]!.sales7dQuantity, 7);
  assert.equal(parsed.rows[0]!.sales30dQuantity, 30);
  const fields = parsed.warnings.map((warning) => warning.field);
  assert.ok(fields.includes("sales7dQuantity"));
  assert.ok(fields.includes("sales30dQuantity"));
});
