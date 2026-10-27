import assert from "node:assert/strict";
import test from "node:test";
import { parseErpReferenceXlsx, type InventoryAgeImportRow } from "../lib/imports/erp-reference";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

const HEADERS = ["仓库", "货品编号", "货品名称", "可用库存", "库龄(天)", "固定成本价"];

function workbook(rows: unknown[][]) {
  return createXlsxWorkbookBytes([{ name: "库龄分析", rows: [HEADERS, ...(rows as never[])] }]);
}

test("可用库存为小数：四舍五入成功，产生 ROUNDED_DECIMAL_QUANTITY warning，不进入 errors", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-DEC", "测试货品", 180.7, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  const row = parsed.rows[0] as InventoryAgeImportRow;
  assert.equal(row.availableQuantity, 181);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0]!.code, "ROUNDED_DECIMAL_QUANTITY");
  assert.equal(parsed.warnings[0]!.field, "availableQuantity");
  assert.equal(parsed.warnings[0]!.sourceRowNumber, 2);
  assert.match(parsed.warnings[0]!.message, /180\.7/);
  assert.match(parsed.warnings[0]!.message, /181/);
});

test("可用库存 .5 临界小数按 Math.round 四舍五入", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-HALF", "测试货品", 180.5, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.deepEqual(parsed.errors, []);
  const row = parsed.rows[0] as InventoryAgeImportRow;
  assert.equal(row.availableQuantity, 181);
  assert.equal(parsed.warnings.length, 1);
});

test("可用库存非数字字符串仍然阻断", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-NAN", "测试货品", "abc", 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "availableQuantity");
  assert.equal(parsed.warnings.length, 0);
});

test("可用库存为负整数：阻断（库龄表无超卖业务含义先例，不同于库存表）", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-NEGINT", "测试货品", -5, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "availableQuantity");
  assert.match(parsed.errors[0]!.message, /负数/);
  assert.equal(parsed.warnings.length, 0);
});

test("可用库存为负小数：阻断，不被四舍五入吞掉", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-NEGDEC", "测试货品", -5.5, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "availableQuantity");
  assert.match(parsed.errors[0]!.message, /负数/);
  assert.equal(parsed.warnings.length, 0);
});

test("可用库存超出安全整数范围仍然阻断", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-OVERFLOW", "测试货品", Number.MAX_SAFE_INTEGER + 2, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "availableQuantity");
});

test("可用库存为整数：行为完全不变，不产生多余 warning", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-INT", "测试货品", 100, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  const row = parsed.rows[0] as InventoryAgeImportRow;
  assert.equal(row.availableQuantity, 100);
});

test("其他字段（仓库名称、货品编号）不受本次修复影响", () => {
  const bytes = workbook([
    ["", "", "测试货品", 10, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 2);
  const fields = parsed.errors.map((error) => error.field).sort();
  assert.deepEqual(fields, ["productCode", "warehouse"]);
  assert.equal(parsed.warnings.length, 0);
});

test("小数四舍五入 warning 超过上限时被截断，并保留可追溯的汇总提示", () => {
  // MAX_ISSUES = 200；每行产生 1 条 availableQuantity 四舍五入 warning，
  // 201 行即可让原始 warning 数超过上限。
  const rows = Array.from({ length: 201 }, (_, index) => [
    "测试仓",
    `SKU-AGE-OVERFLOW-${index}`,
    "测试货品",
    10.5,
    30,
    20,
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", workbook(rows));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 201);
  assert.ok(parsed.warnings.length <= 200, `warnings.length=${parsed.warnings.length} 必须 <= 200`);
  const overflowNotice = parsed.warnings.at(-1)!;
  assert.equal(overflowNotice.code, "ROUNDED_DECIMAL_QUANTITY");
  assert.match(overflowNotice.message, /还有.*未显示/);
  assert.match(overflowNotice.message, /200/);
});

test("小数数量不超限时不产生额外的截断汇总提示", () => {
  const bytes = workbook([
    ["测试仓", "SKU-AGE-NO-OVERFLOW", "测试货品", 10.5, 30, 20],
  ]);
  const parsed = parseErpReferenceXlsx("inventory_age", bytes);
  assert.equal(parsed.warnings.length, 1);
  assert.ok(!parsed.warnings[0]!.message.includes("未显示"));
});
