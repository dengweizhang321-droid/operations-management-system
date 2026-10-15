import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { jdLogisticsWorkbookFields, parseJdLogisticsGrid, parseJdLogisticsWorkbook, JD_SHOP_PRODUCTS_CSV_HEADERS, JD_FLOW_CSV_HEADERS } from "../lib/inventory/jd-logistics-workbook";
import { readJdLogisticsLocation, type JdLogisticsSource } from "../lib/inventory/jd-logistics-contract";
import { createDjangoInventoryService, INVENTORY_JD_LOGISTICS_PATH } from "../lib/django/inventory-service";
import { logisticsContentHash } from "../lib/jd/logistics-manifest";

function grid(source: JdLogisticsSource, overrides: Record<string, unknown> = {}) {
  const fields = jdLogisticsWorkbookFields[source];
  const values: Record<string, unknown> = { businessUnitCode: "D001", goodsCode: "000123\t", goodsName: "合成测试商品", warehouseCode: "W1", businessTime: "2026-10-14 10:20:30", documentNo: "JD001", businessType: "仓间调拨出库回传", actualBegin: 4, actualChange: -2, actualEnd: 2, availableBegin: 4, availableChange: -2, availableEnd: 2, platform: "京东", shopName: "合成店铺", shopProductCode: "ESG001", productStatus: "启用", snapshotDate: "2026-10-14", availableQuantity: 0, ...overrides };
  return [fields.map(field => field.headers[1]), fields.map(field => values[field.key] ?? "")];
}

test("flow normalization preserves all six components and text identities, never folds event duplicates", () => {
  const source = grid("flow", { inventoryStatus: "良品", inventoryType: "内配出锁定", channel: "POP", merchantMark: "00100", relatedDocumentNo: "R1" });
  source.push([...source[1]]);
  const rows = parseJdLogisticsGrid(source, "flow", "D001");
  assert.equal(rows.length, 2); assert.equal(rows[0].goodsCode, "000123");
  assert.equal(rows[0].actualChange, -2); assert.equal(rows[0].availableEnd, 2);
  assert.equal(rows[0].inventoryType, "内配出锁定"); assert.equal(rows[0].merchantMark, "00100");
  assert.equal(rows[0].businessTime, "2026-10-14T10:20:30+08:00");
  assert.equal(parseJdLogisticsGrid(grid("flow", { businessTime: 46309.5 }), "flow", "D001")[0].businessTime, "2026-10-14T12:00:00+08:00");
  assert.throws(() => parseJdLogisticsGrid(grid("flow", { businessUnitCode: "OTHER" }), "flow", "D001"), /事业部/);
  assert.throws(() => parseJdLogisticsGrid(grid("flow", { goodsCode: 1000000000000000 }), "flow", "D001"), /15位/);
  assert.equal(parseJdLogisticsGrid(grid("flow", { merchantMark: 12345678901234 }), "flow", "D001")[0].merchantMark, "12345678901234");
  assert.throws(() => parseJdLogisticsGrid(grid("flow", { actualChange: "-1.5" }), "flow", "D001"), /整数/);
});

test("shop products retain one-to-many relations and unknown inventory is never coerced to zero", () => {
  const rows = grid("shop_products", { platformSku: "001", isvCode: "ISV001", isCombo: "否" });
  rows.push(grid("shop_products", { shopProductCode: "ESG002", platformSku: "002", isvCode: "ISV002" })[1]);
  const result = parseJdLogisticsGrid(rows, "shop_products", "D001");
  assert.equal(result.length, 2); assert.equal(result[0].isCombo, false); assert.equal(result[1].platformSku, "002");
  const stock = parseJdLogisticsGrid(grid("inventory_snapshot"), "inventory_snapshot", "D001")[0];
  assert.equal(stock.availableQuantity, 0); assert.equal(stock.onHandQuantity, null);
  assert.equal(parseJdLogisticsGrid(grid("realtime_inventory", { availableQuantity: "", purchaseInTransitQuantity: 0 }), "realtime_inventory", "D001")[0].availableQuantity, null);
  assert.throws(() => parseJdLogisticsGrid(grid("realtime_inventory", { availableQuantity: "" }), "realtime_inventory", "D001"), /全部库存和销量数量缺失/);
});

test("Excel numeric event timestamps preserve distinct fractional seconds in the complete content hash", () => {
  const first = parseJdLogisticsGrid(grid("flow", { businessTime: 46309.5 + 0.123 / 86400 }), "flow", "D001");
  const second = parseJdLogisticsGrid(grid("flow", { businessTime: 46309.5 + 0.987 / 86400 }), "flow", "D001");
  assert.equal(first[0].businessTime, "2026-10-14T12:00:00.123000+08:00");
  assert.equal(second[0].businessTime, "2026-10-14T12:00:00.987000+08:00");
  assert.notEqual(logisticsContentHash(first), logisticsContentHash(second));
  const sameText = parseJdLogisticsGrid(grid("flow", { businessTime: "2026-10-14T12:00:00.123000+08:00" }), "flow", "D001");
  assert.equal(logisticsContentHash(first), logisticsContentHash(sameText));
});

test("verified shop CSV preserves literal identifiers, missing platform and all source attributes", () => {
  const encode = (note = "普通,备注", goodsCode = "00003", status = "启用") => new TextEncoder().encode(`\ufeff${JD_SHOP_PRODUCTS_CSV_HEADERS.join(",")}\r\n合成店铺,00001,"00002"\t,${goodsCode},合成商品,00004,00005,否,${status},"${note.replace(/"/g, '""')}",普通,普通,否\r\n`);
  const rows = parseJdLogisticsWorkbook(encode(), "shop_products", "D001", { allowDeclaredBusinessUnit: true });
  assert.equal(rows.length, 1); assert.equal(rows[0].shopProductCode, "00001"); assert.equal(rows[0].platformSku, "00002");
  assert.equal(rows[0].platform, ""); assert.equal(rows[0].isvCode, ""); assert.equal(rows[0].isCombo, null);
  assert.equal((rows[0].sourceAttributes as Record<string,string>).商品条码, "00005");
  assert.equal((rows[0].sourceAttributes as Record<string,string>).备注, "普通,备注");
  assert.equal(Object.keys(rows[0].sourceAttributes as object).length, 6); assert.equal(rows[0].productStatus, "启用");
  const unlinked = parseJdLogisticsWorkbook(encode("普通备注", "", "启用"), "shop_products", "D001", { allowDeclaredBusinessUnit: true })[0];
  assert.equal(unlinked.goodsCode, ""); assert.equal(unlinked.shopProductCode, "00001");
  assert.throws(() => parseJdLogisticsWorkbook(encode("普通备注", "", "停用"), "shop_products", "D001", { allowDeclaredBusinessUnit: true }), /商品状态必须为启用/);
  assert.throws(() => parseJdLogisticsWorkbook(encode("=1+1"), "shop_products", "D001", { allowDeclaredBusinessUnit: true }), /公式型文本/);
  assert.throws(() => parseJdLogisticsWorkbook(encode(), "flow", "D001"), /30列/);
  assert.throws(() => parseJdLogisticsWorkbook(encode(), "realtime_inventory", "D001"), /CSV仅限/);
  assert.throws(() => parseJdLogisticsWorkbook(new Uint8Array([0xef,0xbb,0xbf,0xff]), "shop_products", "D001"), /UTF-8 BOM/);
  assert.throws(() => parseJdLogisticsWorkbook(new TextEncoder().encode("店铺,错误表头\n合成,文本"), "shop_products", "D001"), /13列/);
});

test("verified flow CSV preserves all 30 source columns, negative quantities and duplicate events", () => {
  const source = grid("flow");
  const values = new Map(source[0].map((header, index) => [String(header), source[1][index]]));
  values.set("序号", 1); values.set("商品等级编码", "GRADE-1"); values.set("颜色", "原色");
  const line = () => JD_FLOW_CSV_HEADERS.map(header => `"${String(values.get(header) ?? "").replace(/"/g, '""')}"`).join(",");
  const bytes = () => new TextEncoder().encode(`${JD_FLOW_CSV_HEADERS.join(",")}\r\n${line()}\r\n${line()}\r\n`);
  const rows = parseJdLogisticsWorkbook(bytes(), "flow", "D001");
  assert.equal(rows.length, 2); assert.equal(rows[0].actualChange, -2); assert.equal(rows[0].goodsCode, "000123");
  assert.equal((rows[0].sourceAttributes as Record<string,string>).商品等级编码, "GRADE-1");
  assert.equal((rows[0].sourceAttributes as Record<string,string>).颜色, "原色");
  values.set("实际库存加减数量", "-1+1");
  assert.throws(() => parseJdLogisticsWorkbook(bytes(), "flow", "D001"), /公式型文本/);
});

test("workbook parser rejects formulas, ambiguous headers and empty collections", () => {
  const data = grid("flow");
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, "库存流水");
  const bytes = () => new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  assert.equal(parseJdLogisticsWorkbook(bytes(), "flow", "D001").length, 1);
  sheet.A2.f = "1+1"; assert.throws(() => parseJdLogisticsWorkbook(bytes(), "flow", "D001"), /公式/);
  const ambiguous = grid("flow"); ambiguous[0].push("事业部商品编码"); ambiguous[1].push("OTHER");
  assert.throws(() => parseJdLogisticsGrid(ambiguous, "flow", "D001"), /歧义/);
  assert.throws(() => parseJdLogisticsGrid([data[0]], "flow", "D001"), /1–20000/);
});

test("POP location restores scope and limits arbitrary pages/tabs", () => {
  const value = readJdLogisticsLocation("/?module=inventory&view=inbound&jdInbound=pop&jdPopTab=mappings&jdDepartment=D1&jdWarehouse=W1&jdPage=2&jdQuery=0001");
  assert.equal(value.pop, true); assert.equal(value.tab, "mappings"); assert.equal(value.filters.page, 1); assert.equal(value.filters.q, "0001"); assert.equal(value.filters.warehouseCode, "");
  assert.equal(readJdLogisticsLocation("/?jdPopTab=garbage&jdPage=-3").tab, "mappings");
  assert.equal(readJdLogisticsLocation("/?jdPage=99999999999999999").filters.page, 1);
});

test("original C warehouse headers retain source names and collapse only identical repeated blocks", () => {
  const headers = ["事业部编码", "事业部名称", "仓库", "京东sku", "商家商品编码", "商家商品标识", "商品名称", "一级品类", "二级品类", "三级品类", "实时在库件数", "实时可用库存件数", "实时采购在途件数", "实时调拨在途件数", "实时锁定库存件数"];
  const values = ["D001", "合成事业部", "合成来源仓", "000123", "M001", 12345678901234, "合成测试商品", "", "", "", 100, 80, 10, 5, 20];
  const source = [[...headers, ...headers], [...values, ...values]];
  const context = { collectedAt: "2026-10-14T18:00:00Z", allowDeclaredBusinessUnit: true };
  const row = parseJdLogisticsGrid(source, "realtime_inventory", "D001", context)[0];
  assert.equal(row.goodsCodeKind, "jd_sku"); assert.equal(row.goodsCode, "000123");
  assert.equal(row.snapshotDate, "2026-10-15"); assert.equal(row.warehouseCode, "");
  assert.equal(row.warehouseIdentityKind, "name"); assert.equal(row.warehouseKey, "name:合成来源仓");
  assert.equal(row.onHandQuantity, 100); assert.equal(row.merchantMark, "12345678901234");
  source[1][25] = 999;
  assert.throws(() => parseJdLogisticsGrid(source, "realtime_inventory", "D001", context), /不一致/);
  assert.throws(() => parseJdLogisticsGrid([headers, values], "realtime_inventory", "D001"), /实际采集/);
  const snapshot = parseJdLogisticsGrid([["日期", "仓库名称", "京东SKU", "商家商品编码", "商家商品标识", "商品名称", "在库件数", "可用在库件数", "近7天销售出库件数", "近30天销售出库件数"], ["2026-10-14", "合成来源仓", "000123", "M001", 12345678901234, "合成测试商品", 90, 70, 14, 60]], "inventory_snapshot", "D001", context)[0];
  assert.equal(snapshot.businessUnitCode, "D001"); assert.equal(snapshot.sales30dQuantity, 60); assert.equal(snapshot.warehouseCode, "");
});

test("all unmapped source business columns survive and change the business fingerprint", () => {
  const original = grid("flow");
  original[0].push("序号", "商品等级编码", "颜色", "尺码");
  original[1].push(1, "GRADE-1", "原色", "XL");
  const first = parseJdLogisticsGrid(original, "flow", "D001");
  assert.deepEqual(first[0].sourceAttributes, { 商品等级编码: "GRADE-1", 颜色: "原色", 尺码: "XL" });
  const same = original.map(row => [...row]); same[1][same[1].length - 4] = 999;
  assert.equal(logisticsContentHash(first), logisticsContentHash(parseJdLogisticsGrid(same, "flow", "D001")));
  const changed = original.map(row => [...row]); changed[1][changed[1].length - 2] = "新色";
  assert.notEqual(logisticsContentHash(first), logisticsContentHash(parseJdLogisticsGrid(changed, "flow", "D001")));
  const duplicate = original.map(row => [...row]); duplicate[0].push("颜色"); duplicate[1].push("冲突");
  assert.throws(() => parseJdLogisticsGrid(duplicate, "flow", "D001"), /表头重复/);
  const stock = grid("inventory_snapshot", { sourceProvinceCity: "合成省市" }); stock[0].push("在库库存体积(cm³)", "近15天销售出库件数", "30天周转"); stock[1].push(12.5, 15, 0.3);
  const parsed = parseJdLogisticsGrid(stock, "inventory_snapshot", "D001")[0];
  assert.equal(parsed.sourceProvinceCity, "合成省市");
  assert.deepEqual(parsed.sourceAttributes, { "在库库存体积(cm³)": "12.5", 近15天销售出库件数: "15", "30天周转": "0.3" });
});

test("logistics gateway pins exact reader/writer methods and never widens descendants", async () => {
  const service = createDjangoInventoryService({ readerBaseUrl: "http://127.0.0.1:8051", writerBaseUrl: "http://127.0.0.1:8052", internalSecret: "logistics-test-only-isolated-secret-00000000" });
  const principal = { email: "test@example.invalid", displayName: "Test", role: "admin" as const, scope: null };
  const observed: string[] = [];
  const options = { fetchImpl: async (url: string | URL | Request) => { observed.push(String(url)); return Response.json({ success: true }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } }); } };
  await service.requestJson(principal, { method: "GET", path: INVENTORY_JD_LOGISTICS_PATH, service: "reader", rawQuery: "operation=options" }, options);
  await service.requestJson(principal, { method: "POST", path: INVENTORY_JD_LOGISTICS_PATH, service: "writer", payload: { operation: "import" } }, options);
  await assert.rejects(service.requestJson(principal, { method: "POST", path: INVENTORY_JD_LOGISTICS_PATH, service: "reader", payload: {} }, options));
  await assert.rejects(service.requestJson(principal, { method: "GET", path: `${INVENTORY_JD_LOGISTICS_PATH}/arbitrary`, service: "reader" }, options));
  assert.equal(observed.length, 2); assert.match(observed[0], /8051/); assert.match(observed[1], /8052/);
});
