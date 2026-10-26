import assert from "node:assert/strict";
import test from "node:test";

import type { AppPrincipal } from "../lib/auth/authorization";
import { importInventoryAgeToDjango } from "../lib/inventory/django-age-import-service";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

const principal: AppPrincipal = {
  email: "admin@example.test", displayName: "管理员", role: "admin", scope: null,
};
const envConfig = {
  TERUISI_DJANGO_INVENTORY_READER_BASE_URL: "http://127.0.0.1:28091",
  TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL: "http://127.0.0.1:28092",
  TERUISI_DJANGO_INTERNAL_SECRET: "erp-age-import-contract-secret-at-least-32-bytes",
};

const HEADERS = ["仓库", "货品编号", "货品名称", "可用库存", "库龄(天)", "固定成本价"];

function workbook(rows: unknown[][]) {
  return createXlsxWorkbookBytes([{ name: "库龄分析", rows: [HEADERS, ...(rows as never[])] }]);
}

async function capturePayload(t: import("node:test").TestContext, bytes: Uint8Array) {
  const previous = { ...process.env };
  Object.assign(process.env, envConfig);
  t.after(() => {
    for (const key of Object.keys(envConfig)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  let payload: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input as string | URL, init);
    if (request.method === "POST") {
      payload = JSON.parse(await request.text()) as Record<string, unknown>;
    }
    return Response.json({ ok: true, status: "committed" }, {
      headers: { "x-inventory-data-revision": "1:abcdef123456", "x-teruisi-write-replay": "0" },
    });
  };
  await importInventoryAgeToDjango(
    { principal, bytes, fileName: "inventory-age.xlsx", fileSizeBytes: bytes.byteLength, snapshotDate: "2026-10-26" },
    { fetchImpl, now: () => 1_800_000_000_000, requestId: () => "age-writer-1" },
  );
  return payload!;
}

test("小数明细 warning 与刷刷仓剔除 warning 共存时，固定告警排在最前且两者都保留", async (t) => {
  const rows = [
    ["广东仓", "SKU-AGE-DEC", "测试货品", 10.5, 30, 20],
    ["刷刷仓", "SKU-AGE-BRUSH", "测试货品二", 5, 10, 10],
  ];
  const payload = await capturePayload(t, workbook(rows));
  const warnings = payload.warnings as Array<{ code: string; message?: string }>;
  assert.ok(warnings.length >= 2);
  assert.equal(warnings[0]!.code, "EXCLUDED_BRUSH_WAREHOUSE");
  assert.match(warnings[0]!.message ?? "", /刷刷仓/);
  assert.ok(warnings.some((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY"));
});

test("小数明细 warning 超过 Django 侧 200 上限时，固定告警仍保留在截断后的数组中", async (t) => {
  // 刷刷仓剔除 1 行 + 199 行可用库存小数（每行 1 条 ROUNDED_DECIMAL_QUANTITY）。
  // parsed.warnings 在解析层按 MAX_ISSUES=200 截断后最多 199 条明细 + 1 条汇总提示 = 200 条；
  // 叠加 1 条 EXCLUDED_BRUSH_WAREHOUSE 后共 201 条，必须在服务层被再截断到 200 条，
  // 且固定告警必须保留（排在最前，被截掉的只能是排在最后的小数明细/汇总提示）。
  const decimalRows = Array.from({ length: 199 }, (_, index) => [
    "广东仓",
    `SKU-AGE-OVERFLOW-${index}`,
    "测试货品",
    10.5,
    30,
    20,
  ]);
  const rows = [...decimalRows, ["刷刷仓", "SKU-AGE-BRUSH-2", "测试货品三", 5, 10, 10]];
  const payload = await capturePayload(t, workbook(rows));
  const warnings = payload.warnings as Array<{ code: string; message?: string }>;
  assert.ok(warnings.length <= 200, `warnings.length=${warnings.length} 必须 <= 200`);
  assert.equal(warnings[0]!.code, "EXCLUDED_BRUSH_WAREHOUSE");
  assert.match(warnings[0]!.message ?? "", /刷刷仓/);
});

test("没有小数也没有刷刷仓时 warnings 为空", async (t) => {
  const rows = [["广东仓", "SKU-AGE-CLEAN", "测试货品", 10, 30, 20]];
  const payload = await capturePayload(t, workbook(rows));
  assert.deepEqual(payload.warnings, []);
});
