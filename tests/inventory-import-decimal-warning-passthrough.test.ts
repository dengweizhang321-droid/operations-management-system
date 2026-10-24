import assert from "node:assert/strict";
import test from "node:test";

import { importInventoryStockToDjango } from "../lib/inventory/django-import-service";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import {
  INVENTORY_IMPORTS_PATH,
  INVENTORY_SETTINGS_PATH,
  INVENTORY_WAREHOUSE_MAPPINGS_PATH,
} from "../lib/django/inventory-service";

const principal = { email: "test@example.invalid", displayName: "Test", role: "admin" as const, scope: null };

function withInventoryEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    reader: process.env.TERUISI_DJANGO_INVENTORY_READER_BASE_URL,
    writer: process.env.TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL,
    secret: process.env.TERUISI_DJANGO_INTERNAL_SECRET,
  };
  process.env.TERUISI_DJANGO_INVENTORY_READER_BASE_URL = "http://127.0.0.1:8061";
  process.env.TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL = "http://127.0.0.1:8062";
  process.env.TERUISI_DJANGO_INTERNAL_SECRET = "inventory-decimal-test-signing-key-0123456789abcdef";
  return run().finally(() => {
    if (previous.reader === undefined) delete process.env.TERUISI_DJANGO_INVENTORY_READER_BASE_URL;
    else process.env.TERUISI_DJANGO_INVENTORY_READER_BASE_URL = previous.reader;
    if (previous.writer === undefined) delete process.env.TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL;
    else process.env.TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL = previous.writer;
    if (previous.secret === undefined) delete process.env.TERUISI_DJANGO_INTERNAL_SECRET;
    else process.env.TERUISI_DJANGO_INTERNAL_SECRET = previous.secret;
  });
}

test("库存导入把小数数量四舍五入产生的 warning 透传进最终导入结果（parsed.warnings 不被吞掉）", async () => {
  await withInventoryEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [
      ["仓库", "货品编号", "货品名称", "库存数量", "可用库存", "固定成本价"],
      ["广东仓", "SKU-PASSTHROUGH", "测试货品", 10.5, 9.5, 20],
    ] }]);

    let writerPayload: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === INVENTORY_WAREHOUSE_MAPPINGS_PATH) {
        return Response.json({
          rows: [{ warehouse: "广东仓", category: "guangdong", label: "广东仓", includeInInventory: true, pendingConfirmation: false }],
          mappingRevision: "a".repeat(64),
          pendingConfirmationCount: 0,
          updatedAt: null,
          updatedBy: null,
        }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } });
      }
      if (url.pathname === INVENTORY_SETTINGS_PATH) {
        return Response.json({ allowNegativeInventory: false }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } });
      }
      if (url.pathname === INVENTORY_IMPORTS_PATH) {
        writerPayload = JSON.parse(String(init?.body ? Buffer.from(init.body as ArrayBuffer) : "{}"));
        return Response.json(
          { ok: true, status: "imported", message: "ok", warnings: (writerPayload?.warnings as unknown[]) ?? [] },
          { headers: { "x-inventory-data-revision": "2:abcdef123456" } },
        );
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as typeof fetch;

    const result = await importInventoryStockToDjango(
      { principal, bytes, fileName: "inventory-2026-10-24.xlsx", fileSizeBytes: bytes.byteLength },
      { fetchImpl },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, "imported");
    assert.ok(writerPayload, "writer POST 必须发生");
    const sentWarnings = (writerPayload as Record<string, unknown>).warnings as Array<{ code: string; field?: string; row?: number }>;
    const roundedWarnings = sentWarnings.filter((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY");
    assert.equal(roundedWarnings.length, 2, "onHandQuantity 和 availableQuantity 各产生一条 warning");
    const fields = roundedWarnings.map((warning) => warning.field);
    assert.ok(fields.includes("onHandQuantity"));
    assert.ok(fields.includes("availableQuantity"));
    assert.ok(roundedWarnings.every((warning) => warning.row === 2));
    assert.equal(result.warnings.some((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY"), true);
  });
});

// S5：固定业务告警（列缺失/明确零成本保留等）不能被小数明细挤出 Django 侧 200 条上限。
// 构造 210 行、每行 2 个小数字段（onHandQuantity、availableQuantity），原始小数明细
// 数量远超 200；同时不提供"在途数量"整列（触发 MISSING_IN_TRANSIT_QUANTITY），
// 并让其中一行成本价明确为 0（触发 RETAINED_ZERO_UNIT_COST）。断言这两条固定业务
// 告警仍在最终发给 Django 的 warnings 里，即使小数明细本身被截断。
test("固定业务告警不被小数明细挤出最终 warnings（S5：固定告警排在前，优先于小数明细保留）", async () => {
  await withInventoryEnv(async () => {
    const headerRow = ["仓库", "货品编号", "货品名称", "库存数量", "可用库存", "固定成本价"];
    const dataRows = Array.from({ length: 210 }, (_, index) => [
      "广东仓",
      `SKU-S5-${index}`,
      "测试货品",
      10.5,
      9.5,
      index === 0 ? 0 : 20, // 第一行明确零成本，触发 RETAINED_ZERO_UNIT_COST
    ]);
    const bytes = createXlsxWorkbookBytes([{ name: "库存", rows: [headerRow, ...dataRows] }]);

    let writerPayload: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === INVENTORY_WAREHOUSE_MAPPINGS_PATH) {
        return Response.json({
          rows: [{ warehouse: "广东仓", category: "guangdong", label: "广东仓", includeInInventory: true, pendingConfirmation: false }],
          mappingRevision: "a".repeat(64),
          pendingConfirmationCount: 0,
          updatedAt: null,
          updatedBy: null,
        }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } });
      }
      if (url.pathname === INVENTORY_SETTINGS_PATH) {
        return Response.json({ allowNegativeInventory: false }, { headers: { "x-inventory-data-revision": "1:abcdef123456" } });
      }
      if (url.pathname === INVENTORY_IMPORTS_PATH) {
        writerPayload = JSON.parse(String(init?.body ? Buffer.from(init.body as ArrayBuffer) : "{}"));
        return Response.json(
          { ok: true, status: "imported", message: "ok", warnings: (writerPayload?.warnings as unknown[]) ?? [] },
          { headers: { "x-inventory-data-revision": "2:abcdef123456" } },
        );
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as typeof fetch;

    const result = await importInventoryStockToDjango(
      { principal, bytes, fileName: "inventory-2026-10-24-s5.xlsx", fileSizeBytes: bytes.byteLength },
      { fetchImpl },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, "imported");
    assert.ok(writerPayload, "writer POST 必须发生");
    const sentWarnings = (writerPayload as Record<string, unknown>).warnings as Array<{ code: string }>;
    assert.ok(sentWarnings.length <= 200, `sentWarnings.length=${sentWarnings.length} 必须 <= 200`);
    const codes = sentWarnings.map((warning) => warning.code);
    assert.ok(codes.includes("MISSING_IN_TRANSIT_QUANTITY"), "固定业务告警 MISSING_IN_TRANSIT_QUANTITY 不能被挤掉");
    assert.ok(codes.includes("RETAINED_ZERO_UNIT_COST"), "固定业务告警 RETAINED_ZERO_UNIT_COST 不能被挤掉");
    assert.ok(codes.includes("ROUNDED_DECIMAL_QUANTITY"), "仍应保留部分小数明细（含截断汇总提示）");
    assert.ok(result.warnings.some((warning) => warning.code === "MISSING_IN_TRANSIT_QUANTITY"));
    assert.ok(result.warnings.some((warning) => warning.code === "RETAINED_ZERO_UNIT_COST"));
  });
});
