import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { parseTmallWarehouseGrid, parseTmallWarehouseWorkbook } from "../lib/inventory/tmall-warehouse-workbook";
import { createDjangoInventoryService, INVENTORY_TMALL_WAREHOUSE_PATH } from "../lib/django/inventory-service";

const headers = ["货品ID", "货品编码", "货品名称", "仓Code", "仓名称", "实仓可销", "实仓总数", "采购在途", "调拨在途", "供应商名称"];
const row = ["000100", "SKU-01", "合成切片机", "W-01", "合成华南仓", 0, 3, 2, 0, "合成供应商"];
function book(grid: unknown[][], second?: unknown[][]) {
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "导出数据");
  if (second) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(second), "另一个来源");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
test("real-time schema preserves literal identity, true zero, missing quantities and supplier attribute", () => {
  const data = parseTmallWarehouseWorkbook(book([headers, row]));
  assert.equal(data.sourceDate, undefined); assert.equal(data.sheetName, "导出数据");
  assert.equal(data.rows[0].goodsId, "000100"); assert.equal(data.rows[0].availableQuantity, 0);
  assert.equal(data.rows[0].onHandQuantity, 3); assert.equal(data.rows[0].sales30dQuantity, null);
  assert.equal(data.rows[0].owner, ""); assert.equal(data.rows[0].sourceAttributes.供应商名称, "合成供应商");
});
test("historical raw data selects its date, never treats unqualified sales as 30-day volume", () => {
  const result = parseTmallWarehouseGrid([["2026-09-29"], ["货品id", "货品", "仓库名称", "货主", "总库存", "可销库存", "残次", "采购在途", "调拨在途", "销售出库"], ["100", "合成商品", "合成仓", "合成货主", 10, 7, "None", 0, 0, 4]]);
  assert.equal(result.sourceDate, "2026-09-29"); assert.equal(result.rows[0].sales30dQuantity, null);
  assert.equal(result.rows[0].sourceAttributes.销售出库, "4"); assert.equal(result.rows[0].defectiveQuantity, null);
});
test("ambiguous, duplicated, unsafe identities and noninteger quantities fail instead of corrupting facts", () => {
  assert.throws(() => parseTmallWarehouseWorkbook(book([headers, row], [headers, row])), /唯一/);
  assert.throws(() => parseTmallWarehouseGrid([headers, row, row]), /重复/);
  assert.throws(() => parseTmallWarehouseGrid([[...headers, "可销库存"], [...row, 0]]), /多个同义/);
  assert.throws(() => parseTmallWarehouseGrid([headers, [10000000000000000, ...row.slice(1)]]), /15位/);
  assert.throws(() => parseTmallWarehouseGrid([headers, [...row.slice(0, 5), "1.2", ...row.slice(6)]]), /整数/);
  assert.throws(() => parseTmallWarehouseGrid([headers, [...row, "未命名业务值"]]), /没有表头/);
  assert.throws(() => parseTmallWarehouseWorkbook(new TextEncoder().encode("<html>login</html>")), /XLSX/);
});
test("formulas in source fields and unknown-only rows cannot publish a snapshot", () => {
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([headers, row]);
  sheet.F2 = { t: "n", f: "1+1", v: 2 }; XLSX.utils.book_append_sheet(workbook, sheet, "导出数据");
  assert.throws(() => parseTmallWarehouseWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), /公式/);
  assert.throws(() => parseTmallWarehouseGrid([headers, [...row.slice(0, 5), "", "", "None", "", "合成供应商"]]), /全部数量缺失/);
});
test("actual inflated length is checked even when ZIP size metadata is forged", () => {
  const files = unzipSync(book([headers, row])); files["padding.bin"] = new Uint8Array(33 * 1024 * 1024);
  const bytes = zipSync(files, { level: 9 }), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.byteLength - 46; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50 && strFromU8(bytes.subarray(i + 30, i + 30 + view.getUint16(i + 26, true))) === "padding.bin") view.setUint32(i + 22, 0, true);
    if (sig === 0x02014b50 && strFromU8(bytes.subarray(i + 46, i + 46 + view.getUint16(i + 28, true))) === "padding.bin") view.setUint32(i + 24, 0, true);
  }
  assert.throws(() => parseTmallWarehouseWorkbook(bytes), /实际解压|解压失败|ZIP/);
});
test("unselected worksheets are bounded before allocating a grid", () => {
  const files = unzipSync(book([headers, row], [["unselected"]]));
  files["xl/worksheets/sheet2.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet2.xml"]).replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:XFD20000"'));
  assert.throws(() => parseTmallWarehouseWorkbook(zipSync(files)), /行列/);
});
test("new path passes signed inventory transport with reader/writer separation", async () => {
  const calls: { url: string; method: string }[] = [];
  const service = createDjangoInventoryService({ readerBaseUrl: "http://127.0.0.1:31991", writerBaseUrl: "http://127.0.0.1:31992", internalSecret: "test-secret-at-least-thirty-two-characters" });
  const options = { fetchImpl: (async (input, init) => {
    assert.ok(new Headers(init?.headers).get("x-teruisi-signature"));
    calls.push({ url: String(input), method: String(init?.method) });
    return Response.json({ success: true, data: {} }, { headers: { "x-inventory-data-revision": "1:aaaaaaaaaaaa" } });
  }) as typeof fetch };
  const principal = { email: "fixture@example.invalid", displayName: "合成管理员", role: "admin" as const, scope: null };
  await service.requestJson(principal, { method: "GET", service: "reader", path: INVENTORY_TMALL_WAREHOUSE_PATH, rawQuery: "operation=monitor" }, options);
  await service.requestJson(principal, { method: "POST", service: "writer", path: INVENTORY_TMALL_WAREHOUSE_PATH, payload: { owner: "合成货主" } }, options);
  assert.deepEqual(calls.map(call => new URL(call.url).port), ["31991", "31992"]);
  await assert.rejects(service.requestJson(principal, { method: "POST", service: "reader", path: INVENTORY_TMALL_WAREHOUSE_PATH, payload: {} }, options));
});
