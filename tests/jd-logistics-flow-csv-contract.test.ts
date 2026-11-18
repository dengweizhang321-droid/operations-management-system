import assert from "node:assert/strict";
import test from "node:test";
import type { JdLogisticsRow } from "../lib/inventory/jd-logistics-contract";
import { JD_FLOW_CSV_HEADERS, JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER, JD_SHOP_PRODUCTS_CSV_HEADERS, parseJdLogisticsCsv, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";

const context = { collectedAt: "2026-11-18T01:00:00+08:00" };
const record = (headers: readonly string[], overrides: Record<string, string> = {}) => headers.map(header => {
  const values: Record<string, string> = { 序号: "1", 业务发生时间: "2026-11-17 23:43:20", 事业部编码: "EBU0000000000001", 事业部名称: "合成事业部", 仓库编码: "WH001", 仓库名称: "合成仓",
    事业部商品编号: "SKU-1", 事业部商品名称: "合成商品", 京东单据编码: "JD-DOC-1", 业务类型: "销售出库", 实际原始库存: "10", 实际库存加减数量: "-1", 实际库存结存: "9",
    可用原始库存: "10", 可用库存加减数量: "-1", 可用库存结存: "9", 销售平台单号: "PLAT-0001", ...overrides };
  return `"${values[header] ?? ""}"`;
});
const csv = (headers: readonly string[], rows: string[][]) => new TextEncoder().encode([headers.join(","), ...rows.map(row => row.join(","))].join("\r\n"));
const attributes = (row: JdLogisticsRow) => row.sourceAttributes as unknown as Record<string, string | null>;
const parse = (bytes: Uint8Array) => parseJdLogisticsCsv(bytes, "flow", "EBU0000000000001", context);

test("the 31-column flow header is the 30-column contract plus a trailing 销售平台单号", () => {
  assert.equal(JD_FLOW_CSV_HEADERS.length, 30);
  assert.deepEqual([...JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER], [...JD_FLOW_CSV_HEADERS, "销售平台单号"]);
});

test("31-column flow CSV parses and keeps the platform order number as a source attribute", () => {
  const headers = JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER;
  const rows = parse(csv(headers, [record(headers), record(headers, { 序号: "2", 销售平台单号: "PLAT-0002" })]));
  assert.equal(rows.length, 2);
  assert.equal(attributes(rows[0])["销售平台单号"], "PLAT-0001");
  assert.equal(attributes(rows[1])["销售平台单号"], "PLAT-0002");
  assert.equal(rows[0].documentNo, "JD-DOC-1"); assert.equal(rows[0].actualChange, -1);
  // The real export puts a tab after quoted identifiers; that stays accepted.
  const tabbed = new TextEncoder().encode([headers.join(","), record(headers, { 销售平台单号: "PLAT-0003" }).map((cell, index) => index === 2 ? `${cell}\t` : cell).join(",")].join("\r\n"));
  assert.equal(attributes(parse(tabbed)[0])["销售平台单号"], "PLAT-0003");
});

test("the 30-column flow CSV behaves as before and has no platform order attribute", () => {
  const headers = JD_FLOW_CSV_HEADERS;
  const rows = parse(csv(headers, [record(headers)]));
  assert.equal(rows.length, 1); assert.equal("销售平台单号" in attributes(rows[0]), false);
});

test("only the two verified header contracts are accepted", () => {
  const long = [...JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER, "多余列"];
  assert.throws(() => parse(csv(long, [record(long)])), /CSV超过31列/);
  const renamed = [...JD_FLOW_CSV_HEADERS, "平台单号"];
  assert.throws(() => parse(csv(renamed, [record(renamed)])), /CSV表头必须匹配/);
  const duplicated = [...JD_FLOW_CSV_HEADERS.slice(0, 29), "序号", "销售平台单号"];
  assert.throws(() => parse(csv(duplicated, [record(duplicated)])), /CSV表头必须匹配/);
  const reordered = [...JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER.slice(1), "序号"];
  assert.equal(parse(csv(reordered, [record(reordered)])).length, 1); // same set: header set equality, as the 30-column contract always did
  const missing = JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER.filter(header => header !== "库存渠道");
  assert.throws(() => parse(csv(missing, [record(missing)])), /CSV表头必须匹配/);
});

test("data rows must match the selected contract's column count", () => {
  const headers = JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER;
  assert.throws(() => parse(csv(headers, [record(JD_FLOW_CSV_HEADERS)])), /CSV每行必须为31列/);
  assert.throws(() => parse(csv(headers, [record(headers), record(JD_FLOW_CSV_HEADERS)])), /CSV每行必须为31列/);
  const old = JD_FLOW_CSV_HEADERS;
  assert.throws(() => parse(csv(old, [record(JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER)])), /CSV每行必须为30列/);
  assert.throws(() => parse(csv(old, [record(old).slice(0, 29)])), /CSV每行必须为30列/);
});

test("other CSV safeguards still apply to the 31-column contract", () => {
  const headers = JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER;
  assert.throws(() => parse(csv(headers, [record(headers, { 销售平台单号: "=1+1" })])), /公式型文本/);
  assert.throws(() => parse(csv(headers, [record(headers, { 销售平台单号: "x".repeat(1001) })])), /1000字/);
  assert.throws(() => parseJdLogisticsWorkbook(csv(headers, [record(headers)]), "realtime_inventory", "EBU0000000000001", context), /只支持原始XLSX/);
});

test("the shop-products 13-column contract is unchanged", () => {
  const headers = JD_SHOP_PRODUCTS_CSV_HEADERS;
  const row = headers.map(header => `"${header === "商品状态" ? "启用" : header === "店铺" ? "合成店铺" : header === "店铺商品编码" ? "SP-1" : header === "事业部商品编码" ? "SKU-1" : header === "商品名称" ? "合成商品" : ""}"`);
  const ok = parseJdLogisticsCsv(csv(headers, [row]), "shop_products", "EBU0000000000001", { ...context, allowDeclaredBusinessUnit: true });
  assert.equal(ok.length, 1);
  const extra = [...headers, "销售平台单号"];
  assert.throws(() => parseJdLogisticsCsv(csv(extra, [[...row, '"x"']]), "shop_products", "EBU0000000000001", { ...context, allowDeclaredBusinessUnit: true }), /CSV超过13列/);
});
