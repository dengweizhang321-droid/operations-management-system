import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseWatchGrid, parseWatchPaste, parseWatchWorkbook, watchWorkbook, workbookBytes } from "../lib/inventory/guangdong-workbook";
import { createDjangoInventoryService, INVENTORY_GUANGDONG_PATH } from "../lib/django/inventory-service";

test("广东清单保留前导零、状态、备注及公式文本，导出可回导", () => {
  const rows = [{ productCode: "00123", active: false, notes: "=HYPERLINK(\"https://example.invalid\")" }];
  const bytes = watchWorkbook(rows);
  assert.deepEqual(parseWatchWorkbook(new Uint8Array(bytes).buffer), rows);
  const sheet = XLSX.read(bytes, { type: "array" }).Sheets["广东监控清单"];
  assert.equal(sheet.A2.t, "s"); assert.equal(sheet.C2.t, "s"); assert.equal(sheet.C2.f, undefined);
});

test("广东多行粘贴支持单列及完整表头，不猜测无效状态或数字编码", () => {
  assert.deepEqual(parseWatchPaste("00123\n00567"), [{ productCode: "00123", active: true, notes: "" }, { productCode: "00567", active: true, notes: "" }]);
  assert.equal(parseWatchPaste("货品编码\t监控状态\t备注\n00123\t暂停\t夏季")[0].active, false);
  assert.throws(() => parseWatchGrid([["货品编码", "监控状态", "备注"], [123, "启用", ""]]), /文本/);
  assert.throws(() => parseWatchPaste("00123\t未知\t"), /状态/);
  assert.throws(() => parseWatchGrid([["编码", "监控状态", "备注"], ["123", "", ""]]), /表头/);
});

test("广东文件拒绝公式、多表、超限与空集合", () => {
  const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([["货品编码", "监控状态", "备注"], ["P", "启用", ""]]);
  sheet.A2.f = 'TEXT(123,"00000")'; XLSX.utils.book_append_sheet(book, sheet, "清单");
  assert.throws(() => parseWatchWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), /公式/);
  assert.throws(() => parseWatchWorkbook(new Uint8Array(workbookBytes([{ name: "a", rows: [["a"]] }, { name: "b", rows: [["b"]] }])).buffer), /一个工作表/);
  assert.throws(() => parseWatchPaste(Array.from({ length: 5001 }, (_, i) => String(i)).join("\n")), /5000/);
  assert.throws(() => parseWatchWorkbook(new Uint8Array(watchWorkbook([])).buffer), /1–5000/);
});

test("广东网关允许有界reader读取，拒绝向reader提交清单写入", async () => {
  const service = createDjangoInventoryService({ readerBaseUrl: "http://127.0.0.1:8051", writerBaseUrl: "http://127.0.0.1:8052", internalSecret: "gd-local-isolated-signing-0123456789abcdef" });
  const principal = { email: "test@example.invalid", displayName: "Test", role: "admin" as const, scope: null };
  let requests = 0;
  const fetchImpl = async () => { requests++; return Response.json({ items: [] }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } }); };
  await service.requestJson(principal, { method: "GET", path: INVENTORY_GUANGDONG_PATH, service: "reader" }, { fetchImpl });
  await assert.rejects(() => service.requestJson(principal, { method: "POST", path: INVENTORY_GUANGDONG_PATH + "/import", service: "reader", payload: {} }, { fetchImpl }));
  assert.equal(requests, 1);
});
