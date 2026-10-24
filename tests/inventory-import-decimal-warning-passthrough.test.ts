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
