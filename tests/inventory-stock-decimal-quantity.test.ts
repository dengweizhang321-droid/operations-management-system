import assert from "node:assert/strict";
import test from "node:test";

import { parseInventoryStockXlsx } from "../lib/imports/inventory-stock";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import type { XlsxCellValue } from "../lib/imports/xlsx";

const HEADERS = ["仓库", "货品编号", "货品名称", "库存数量", "可用库存", "锁定数量", "在途数量", "固定成本价"];

function workbook(rows: XlsxCellValue[][]) {
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

test("真实故障值 3325.5 四舍五入为 3326（正数 .5 用 Math.round 向上取整；负数不适用此规则，见下方负数专项测试）", () => {
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

test("负数整数且 nonNegative（锁定数量/在途数量）仍然阻断", () => {
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

// 回归防护：真实文件里有 1180+ 行 onHandQuantity/availableQuantity 是负整数
// （例如 -118、-5、-7974，表示超卖/欠货等既有业务状态）。这些字段没有传 nonNegative，
// 修复前这类负整数一直被原样放行。下面的 M1/M2 修复只收紧"负小数"的处理，
// 不能把负整数一并纳入阻断范围，否则会制造新的整批拒绝故障（已在真实文件回归中验证过）。
test("负整数在未传 nonNegative 的库存数量/可用库存字段上行为不变（不阻断、不产生 warning）", () => {
  const bytes = workbook([
    ["广东仓", "SKU-NEG-INT", "测试货品", -118, -5, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.onHandQuantity, -118);
  assert.equal(parsed.rows[0]!.availableQuantity, -5);
});

test("负整数在前7/30天销量字段上行为不变（同样未传 nonNegative）", () => {
  const headers = [...HEADERS, "前7天销量", "前30天销量"];
  const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [
    headers,
    ["广东仓", "SKU-NEG-SALES-INT", "测试货品", 10, 10, 0, 0, 20, -3, -1],
  ] }]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows[0]!.sales7dQuantity, -3);
  assert.equal(parsed.rows[0]!.sales30dQuantity, -1);
});

// M1：负小数在所有数量字段上一律阻断，不论调用方是否传 nonNegative——这是新增的
// 容错边界，不是收紧原有的负整数校验（上面两个测试证明负整数行为不受影响）。
// Math.round 对负数向零偏移（Math.round(-3.5) === -3，不是 -4），如果未传 nonNegative
// 的字段对负小数也走"四舍五入通过"，会把真实负值悄悄改小，等于比原值更"好看"但失真。
for (const [field, columnIndex, label] of [
  ["onHandQuantity", 3, "库存数量"],
  ["availableQuantity", 4, "可用库存"],
] as const) {
  test(`负小数在未传 nonNegative 的字段 ${label}（${field}）上仍然阻断，不被四舍五入吞掉`, () => {
    for (const negativeValue of [-3.5, -2.5, -1.5, -0.4]) {
      const row = ["广东仓", "SKU-NEG", "测试货品", 10, 10, 0, 0, 20];
      row[columnIndex] = negativeValue;
      const parsed = parseInventoryStockXlsx(workbook([row]));
      assert.equal(parsed.rows.length, 0, `value=${negativeValue}`);
      assert.equal(parsed.errors.length, 1, `value=${negativeValue}`);
      assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER", `value=${negativeValue}`);
      assert.equal(parsed.errors[0]!.field, field, `value=${negativeValue}`);
      assert.match(parsed.errors[0]!.message, /负数/, `value=${negativeValue}`);
      assert.equal(parsed.warnings.length, 0, `value=${negativeValue} 不应产生 warning`);
    }
  });
}

test(`负小数在前7/30天销量字段上同样阻断（销量字段也未传 nonNegative）`, () => {
  const headers = [...HEADERS, "前7天销量", "前30天销量"];
  for (const negativeValue of [-1.5, -0.4]) {
    const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [
      headers,
      ["广东仓", "SKU-NEG-SALES", "测试货品", 10, 10, 0, 0, 20, negativeValue, 0],
    ] }]);
    const parsed = parseInventoryStockXlsx(bytes);
    assert.equal(parsed.rows.length, 0, `value=${negativeValue}`);
    assert.equal(parsed.errors.length, 1, `value=${negativeValue}`);
    assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER", `value=${negativeValue}`);
    assert.equal(parsed.errors[0]!.field, "sales7dQuantity", `value=${negativeValue}`);
    assert.match(parsed.errors[0]!.message, /负数/, `value=${negativeValue}`);
  }
});

// M2：(-0.5, 0) 区间的负小数四舍五入后得到 -0；-0 < 0 为 false，必须用 Object.is
// 识别 -0 并同样阻断，否则这个区间的负值信号会被静默吞掉而不留痕。
test("-0.4 和 -0.5 在 nonNegative=true 的锁定数量/在途数量字段上仍然阻断（M2：-0 不能绕过负值门禁）", () => {
  for (const negativeValue of [-0.4, -0.5]) {
    const lockedRow = ["广东仓", "SKU-NEG-ZERO", "测试货品", 10, 10, negativeValue, 0, 20];
    const lockedParsed = parseInventoryStockXlsx(workbook([lockedRow]));
    assert.equal(lockedParsed.rows.length, 0, `locked value=${negativeValue}`);
    assert.equal(lockedParsed.errors.length, 1, `locked value=${negativeValue}`);
    assert.equal(lockedParsed.errors[0]!.code, "INVALID_NUMBER", `locked value=${negativeValue}`);
    assert.equal(lockedParsed.errors[0]!.field, "lockedQuantity", `locked value=${negativeValue}`);
    assert.match(lockedParsed.errors[0]!.message, /负数/, `locked value=${negativeValue}`);

    const inTransitRow = ["广东仓", "SKU-NEG-ZERO-2", "测试货品", 10, 10, 0, negativeValue, 20];
    const inTransitParsed = parseInventoryStockXlsx(workbook([inTransitRow]));
    assert.equal(inTransitParsed.rows.length, 0, `inTransit value=${negativeValue}`);
    assert.equal(inTransitParsed.errors.length, 1, `inTransit value=${negativeValue}`);
    assert.equal(inTransitParsed.errors[0]!.code, "INVALID_NUMBER", `inTransit value=${negativeValue}`);
    assert.equal(inTransitParsed.errors[0]!.field, "inTransitQuantity", `inTransit value=${negativeValue}`);
    assert.match(inTransitParsed.errors[0]!.message, /负数/, `inTransit value=${negativeValue}`);
  }
});

test("-0.4 在未传 nonNegative 的库存数量字段上也阻断（M2 同样适用于非 nonNegative 字段的负小数）", () => {
  const row = ["广东仓", "SKU-NEG-ZERO-3", "测试货品", -0.4, 10, 0, 0, 20];
  const parsed = parseInventoryStockXlsx(workbook([row]));
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]!.code, "INVALID_NUMBER");
  assert.equal(parsed.errors[0]!.field, "onHandQuantity");
  assert.match(parsed.errors[0]!.message, /负数/);
  assert.equal(parsed.warnings.length, 0);
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

// S1：warnings 数组不能无上限增长。每个小数单元格产生 1 条 warning，单行最多 6 个
// 数量字段都是小数时就是 6 条；下游 Django 对 warnings 数组有硬性上限 200
// （backend/inventory/import_service.py 的 MAX_WARNINGS），超限会把整批拒绝。
// 解析层必须像 errors 一样主动截断，并保留一条可追溯的"还有 N 条未显示"提示，
// 否则故障模式只是从"小数阻断"平移成"warning 超限阻断"。
test("小数数量产生的 warning 超过上限时被截断，并保留可追溯的汇总提示（S1）", () => {
  // 每行 2 个小数字段（onHandQuantity、availableQuantity）产生 2 条 warning；
  // 110 行即可让原始 warning 数超过 200 上限（110*2=220）。
  const rows = Array.from({ length: 110 }, (_, index) => [
    "广东仓",
    `SKU-OVERFLOW-${index}`,
    "测试货品",
    10.5,
    9.5,
    0,
    0,
    20,
  ]);
  const parsed = parseInventoryStockXlsx(workbook(rows));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 110);
  assert.ok(parsed.warnings.length <= 200, `warnings.length=${parsed.warnings.length} 必须 <= 200`);
  const overflowNotice = parsed.warnings.at(-1)!;
  assert.equal(overflowNotice.code, "ROUNDED_DECIMAL_QUANTITY");
  assert.match(overflowNotice.message, /还有.*未显示/);
  assert.match(overflowNotice.message, /200/);
});

test("小数数量不超限时不产生额外的截断汇总提示", () => {
  const bytes = workbook([
    ["广东仓", "SKU-NO-OVERFLOW", "测试货品", 10.5, 9.5, 0, 0, 20],
  ]);
  const parsed = parseInventoryStockXlsx(bytes);
  assert.equal(parsed.warnings.length, 2);
  assert.ok(parsed.warnings.every((warning) => !warning.message.includes("未显示")));
});
