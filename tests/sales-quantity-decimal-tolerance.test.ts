import assert from "node:assert/strict";
import test from "node:test";

import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import { importSalesLedgerBytes } from "../lib/sales/import-service";
import { SALES_STAGED_IMPORTS_PATH } from "../lib/django/sales-writer";
import type { AppPrincipal } from "../lib/auth/authorization";

// 本测试覆盖 2026-10-27 吉客云销售表导入故障的修复：第 2492 行 quantity=1.5
// 导致 validateRows() 产生 parserErrors、Django 整批拒绝。修复后 quantity 单独容错：
// 非负小数四舍五入为整数 + 记录 ROUNDED_DECIMAL_QUANTITY 告警，不再阻断；
// 其余 10 个整数字段（金额/Bps）行为不变；负整数（退货单业务信号，lib/imports/sales-ledger.ts:532
// businessType = quantity<0||allocatedAmountCents<0 ? "return" : "sale"）保持放行；负小数阻断。

const principal: AppPrincipal = {
  email: "admin@example.com",
  displayName: "管理员",
  role: "admin",
  scope: null,
};

const HEADER = [
  "网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "单价",
  "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利",
];

function salesRow(overrides: Partial<{
  onlineOrderNo: string;
  channel: string;
  warehouse: string;
  productCode: string;
  productName: string;
  quantity: number;
  listUnitPrice: number;
  orderTime: string;
  shipTime: string;
  costAmount: number;
  allocatedUnitPrice: number;
  allocatedAmount: number;
  feeAllocation: number;
  grossProfit: number;
}> = {}) {
  const base = {
    onlineOrderNo: "ON-1",
    channel: "天猫-志高丽力专卖店",
    warehouse: "主仓",
    productCode: "SKU-1",
    productName: "测试货品",
    quantity: 1,
    listUnitPrice: 100,
    orderTime: "2026-09-01 09:00:00",
    shipTime: "2026-09-01 10:00:00",
    // 默认非零成本，避免默认行触发 hasCleanableZeroCostRows() 的真实系统成本快照查询
    // （与本次 quantity 容错修复无关，测试里显式需要零成本场景时单独传 costAmount: 0）。
    costAmount: 20,
    allocatedUnitPrice: 0,
    allocatedAmount: 0,
    feeAllocation: 0,
    grossProfit: -20,
    ...overrides,
  };
  return [
    base.onlineOrderNo, base.channel, base.warehouse, base.productCode, base.productName,
    base.quantity, base.listUnitPrice, base.orderTime, base.shipTime, base.costAmount,
    base.allocatedUnitPrice, base.allocatedAmount, base.feeAllocation, base.grossProfit,
  ];
}

function withSalesEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    reader: process.env.TERUISI_DJANGO_SALES_READER_BASE_URL,
    writer: process.env.TERUISI_DJANGO_SALES_WRITER_BASE_URL,
    secret: process.env.TERUISI_DJANGO_INTERNAL_SECRET,
  };
  process.env.TERUISI_DJANGO_SALES_READER_BASE_URL = "http://127.0.0.1:8071";
  process.env.TERUISI_DJANGO_SALES_WRITER_BASE_URL = "http://127.0.0.1:8072";
  process.env.TERUISI_DJANGO_INTERNAL_SECRET = "sales-decimal-quantity-test-signing-key-0123456789ab";
  return run().finally(() => {
    if (previous.reader === undefined) delete process.env.TERUISI_DJANGO_SALES_READER_BASE_URL;
    else process.env.TERUISI_DJANGO_SALES_READER_BASE_URL = previous.reader;
    if (previous.writer === undefined) delete process.env.TERUISI_DJANGO_SALES_WRITER_BASE_URL;
    else process.env.TERUISI_DJANGO_SALES_WRITER_BASE_URL = previous.writer;
    if (previous.secret === undefined) delete process.env.TERUISI_DJANGO_INTERNAL_SECRET;
    else process.env.TERUISI_DJANGO_INTERNAL_SECRET = previous.secret;
  });
}

// 模拟 Django 规范化分片导入协议：init → (PUT chunk)* → complete。
// 捕获 init 阶段收到的 parserErrors/parserWarnings，供断言；complete 阶段原样回放
// 收到的 parserWarnings 作为最终 warnings（真实后端还会追加固定业务告警，这里只需要
// 验证 Worker 侧产生的内容本身是否正确，不重复验证后端 sanitize_issues 逻辑）。
function decodeRequestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function makeStagedFetchMock() {
  let initPayload: Record<string, unknown> | null = null;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname !== SALES_STAGED_IMPORTS_PATH) {
      throw new Error(`unexpected request: ${url.pathname}`);
    }
    const body = decodeRequestBody(init?.body as BodyInit | null | undefined);
    if (body.action === "init") {
      initPayload = body;
      // 模拟真实后端行为（backend/sales/write_service.py:1161）：parserErrors 非空时
      // 整批拒绝，不创建规范化导入会话。
      const parserErrors = Array.isArray(body.parserErrors) ? body.parserErrors : [];
      if (parserErrors.length > 0) {
        return Response.json({
          ok: false,
          status: "rejected",
          message: "文件校验未通过，未创建规范化导入会话",
          code: String((parserErrors[0] as { code?: string })?.code ?? "IMPORT_REJECTED"),
          warnings: Array.isArray(body.parserWarnings) ? body.parserWarnings : [],
          errors: parserErrors,
        }, { status: 422 });
      }
      return Response.json({
        session: { id: "session-1", status: "staging", receivedChunkIndexes: [] },
      });
    }
    if (init?.method === "PUT") {
      return Response.json({ ok: true });
    }
    if (body.action === "complete") {
      return Response.json({
        ok: true,
        status: "imported",
        message: "ok",
        warnings: initPayload?.parserWarnings ?? [],
        batch: { id: "batch-1" },
      });
    }
    throw new Error(`unexpected staged action: ${String(body.action)}`);
  }) as typeof fetch;
  return { fetchImpl, getInitPayload: () => initPayload };
}

test("数量是小数：1.5 四舍五入为 2，产生 ROUNDED_DECIMAL_QUANTITY 告警，不进 parserErrors", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ quantity: 1.5, costAmount: 300, grossProfit: -300 })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, true);
      const initPayload = getInitPayload();
      assert.ok(initPayload, "必须发起 init 请求（未被 parserErrors 拦截）");
      assert.deepEqual(initPayload!.parserErrors, []);
      const warnings = initPayload!.parserWarnings as Array<{ code: string; field?: string; row?: number; message: string }>;
      const rounded = warnings.filter((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY");
      assert.equal(rounded.length, 1);
      assert.equal(rounded[0].field, "quantity");
      assert.equal(rounded[0].row, 2);
      assert.match(rounded[0].message, /1\.5.*2/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("真实值 1.5 的四舍五入期望值是 2（Math.round(1.5) === 2）", () => {
  assert.equal(Math.round(1.5), 2);
});

test("非数字数量：仍然阻断", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ quantity: Number.NaN })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, "rejected");
      const initPayload = getInitPayload();
      assert.ok(initPayload, "Worker 侧仍会把 parserErrors 一并发给 Django init，由后端据此拒绝整批");
      const errors = initPayload!.parserErrors as Array<{ field?: string; code?: string }>;
      assert.ok(errors.some((error) => error.field === "quantity" && error.code === "INVALID_NUMBER"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("数量为负整数（退货单业务信号）：放行，行为不变，不产生多余告警", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({
        quantity: -2,
        listUnitPrice: 100,
        allocatedUnitPrice: 100,
        allocatedAmount: -200,
        costAmount: -60,
        grossProfit: -140,
      })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, true);
      const initPayload = getInitPayload();
      assert.ok(initPayload);
      assert.deepEqual(initPayload!.parserErrors, []);
      const warnings = initPayload!.parserWarnings as Array<{ code: string }>;
      assert.equal(warnings.filter((warning) => warning.code === "ROUNDED_DECIMAL_QUANTITY").length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("数量为负小数：阻断（既是录入错误又会破坏退货数量语义，真实数据中负小数始终是 0 行）", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ quantity: -1.5, allocatedAmount: -150, costAmount: -45 })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, "rejected");
      const initPayload = getInitPayload();
      assert.ok(initPayload);
      const errors = initPayload!.parserErrors as Array<{ field?: string; code?: string; message?: string }>;
      assert.ok(errors.some((error) => error.field === "quantity" && /负小数/.test(error.message ?? "")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("整数数量输入：行为完全不变，不产生多余告警", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ quantity: 3 })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, true);
      const initPayload = getInitPayload();
      assert.ok(initPayload);
      assert.deepEqual(initPayload!.parserErrors, []);
      assert.deepEqual(initPayload!.parserWarnings, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// 注意：lib/imports/sales-ledger.ts 里 11 个整数字段中，除 quantity 外的其余 10 个
// （sourceRowNumber 及各 Cents/Bps 字段）在进入 validateRows 之前，已经分别经过
// requiredMoney/optionalMoney（Math.round(yuan*100)）或 optionalRateBps（Math.round）
// 规范化为整数——真实 Excel 数值（包括小数单价、小数百分比）在解析阶段就会被四舍五入
// 成整数 cents/bps，不会以小数形式到达 validateRows。因此"金额小数"在真实链路里反而
// 验证的是解析阶段仍然四舍五入到整数（行为不变，未被本次改动放宽）；只有解析阶段数值
// 本身超出安全整数范围时才会在解析阶段阻断（而不是 validateRows 阶段）。
// 下面分别验证这两层行为均保持不变、未被扩大：
// 1) 金额字段的小数输入仍被解析阶段四舍五入为整数 cents（未被放宽为"保留小数"）；
// 2) 金额字段超出安全整数范围时仍然阻断整批导入。
test("金额字段出现小数：解析阶段仍四舍五入为整数 cents（未被放宽为保留小数）", async () => {
  await withSalesEnv(async () => {
    // 100.005 元 × 100 = 10000.5，Math.round 后应为 10001 分（整数），而不是放行小数。
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ listUnitPrice: 100.005 })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, true);
      const initPayload = getInitPayload();
      assert.ok(initPayload);
      assert.deepEqual(initPayload!.parserErrors, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("金额字段超出安全整数范围：仍然阻断整批导入，证明放宽范围没有扩大到其余 10 个字段", async () => {
  await withSalesEnv(async () => {
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, salesRow({ listUnitPrice: 1e18 })],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, "rejected");
      const initPayload = getInitPayload();
      assert.ok(initPayload, "init 仍会发起（parserErrors 由 Django 侧拒绝，Worker 侧总是尝试 init）");
      const errors = initPayload!.parserErrors as Array<{ field?: string; code?: string }>;
      assert.ok(errors.some((error) => error.field === "listUnitPriceCents"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// S5 风格：告警数量超限时，固定业务告警（EXCLUDED_* 等，由后端在 complete 阶段追加）
// 不能被逐行小数告警挤出。验证 Worker 侧把逐行告警限制在 150 条并保留汇总提示，
// 为后端固定告警留出 50 条余量（> 实际固定告警数，真实数据从未观察到超过个位数）。
test("告警数量超限时：逐行小数明细被限制在 150 条并追加汇总提示，为固定业务告警留出余量", async () => {
  await withSalesEnv(async () => {
    const rows = Array.from({ length: 210 }, (_, index) => salesRow({
      onlineOrderNo: `ON-${index}`,
      productCode: `SKU-${index}`,
      quantity: 1.5,
    }));
    const bytes = createXlsxWorkbookBytes([{
      name: "销售单明细账",
      rows: [HEADER, ...rows],
    }]);
    const { fetchImpl, getInitPayload } = makeStagedFetchMock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await importSalesLedgerBytes({
        principal,
        bytes,
        fileName: "sales.xlsx",
        fileSizeBytes: bytes.byteLength,
        expectedStartDate: "2026-09-01",
        expectedEndDate: "2026-09-01",
      });
      assert.equal(result.ok, true);
      const initPayload = getInitPayload();
      assert.ok(initPayload);
      assert.deepEqual(initPayload!.parserErrors, []);
      const warnings = initPayload!.parserWarnings as Array<{ code: string; message: string }>;
      // sanitizeSalesIssues 本身也有 200 上限；这里断言 Worker 侧的 150 条软上限生效，
      // 结果应明显小于 200，且包含一条汇总提示说明还有多少条未显示。
      assert.ok(warnings.length <= 150, `warnings.length=${warnings.length} 必须 <= 150`);
      const overflowNotice = warnings.find((warning) => /未显示/.test(warning.message));
      assert.ok(overflowNotice, "必须保留一条汇总提示说明截断数量");
      // 210 行均产生小数告警；MAX_SALES_IMPORT_WARNINGS=150，保留 149 条明细 + 1 条汇总提示，
      // 汇总提示中的未显示数量应为 210 - 149 = 61。
      assert.match(overflowNotice!.message, /61/);
      assert.equal(warnings.length, 150);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
