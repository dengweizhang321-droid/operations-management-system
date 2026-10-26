import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  DjangoSalesServiceResponseError,
  SALES_STAGED_IMPORTS_PATH,
  requestDjangoSalesService,
} from "@/lib/django/sales-writer";
import {
  parseSalesLedgerXlsx,
  type SalesLedgerRow,
  type SalesLedgerTotals,
} from "@/lib/imports/sales-ledger";
import { findLatestAuthoritativeSystemCostSnapshot } from "@/lib/inventory/system-cost-reference";
import {
  sanitizeSalesIssues,
  type SalesImportBatch,
  type SalesImportIssue,
  type SalesLineInput,
} from "@/lib/sales/import-contract";
import {
  isApprovedSalesChannel,
  isExcludedSalesWarehouse,
  isZeroCostProductName,
  salesImportPolicy,
} from "@/lib/sales/import-policy";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_SALES_IMPORT_RANGE_DAYS = 366;
export const MAX_SALES_IMPORT_CHANNELS = 50;

const MAX_STAGED_ROWS = 500_000;
const MAX_ROWS_PER_STAGED_CHUNK = 1_000;
const TARGET_STAGED_BODY_BYTES = 6 * 1024 * 1024;
const encoder = new TextEncoder();

export function isXlsxSignature(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}

async function sha256Text(value: string) {
  return toHex(await sha256(encoder.encode(value)));
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "sales-ledger.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function mapAnalysisSafeRow(row: SalesLedgerRow): SalesLineInput {
  // Explicit allow-list: personal/account/logistics details stay outside the
  // analytics boundary before any data leaves the Worker.
  return {
    sourceRowNumber: row.sourceRowNumber,
    sourceLineKey: row.sourceLineKey,
    sourceRowHash: row.sourceRowHash,
    orderNo: row.orderNo,
    onlineOrderNo: row.onlineOrderNo,
    channel: row.channel,
    platform: row.platform,
    shopName: row.shopName,
    logisticsCompany: row.logisticsCompany,
    warehouse: row.warehouse,
    productCode: row.productCode,
    onlineSpecCode: row.onlineSpecCode,
    productName: row.productName,
    specification: row.specification,
    barcode: row.barcode,
    supplier: row.supplier,
    category: row.category,
    quantity: row.quantity,
    listUnitPriceCents: row.listUnitPriceCents,
    costAmountCents: row.costAmountCents,
    allocatedUnitPriceCents: row.allocatedUnitPriceCents,
    allocatedAmountCents: row.allocatedAmountCents,
    feeAllocationCents: row.feeAllocationCents,
    grossProfitCents: row.grossProfitCents,
    grossMarginBps: row.grossMarginBps ?? 0,
    untaxedGrossProfitCents: row.untaxedGrossProfitCents,
    untaxedGrossMarginBps: row.untaxedGrossMarginBps ?? 0,
    orderTime: row.orderTime,
    salesTime: row.salesTime,
    shipTime: row.shipTime ?? row.orderTime,
    lineShipTime: row.lineShipTime ?? "",
    businessType: row.businessType,
  };
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validateSalesImportChannels(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, channels: null };
  }
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ok: false as const, code: "INVALID_EXPECTED_CHANNELS", message: "expectedChannels 必须是 JSON 字符串数组" };
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_SALES_IMPORT_CHANNELS) {
    return { ok: false as const, code: "INVALID_EXPECTED_CHANNELS", message: `expectedChannels 必须包含 1 到 ${MAX_SALES_IMPORT_CHANNELS} 个销售渠道` };
  }
  const channels = parsed.map((item) => typeof item === "string" ? item.trim() : "");
  if (channels.some((channel) => !channel || channel.length > 100)) {
    return { ok: false as const, code: "INVALID_EXPECTED_CHANNELS", message: "expectedChannels 只能包含非空且不超过 100 字符的渠道名" };
  }
  const unique = [...new Set(channels)].sort((left, right) => left.localeCompare(right, "zh-CN"));
  if (unique.length !== channels.length) {
    return { ok: false as const, code: "DUPLICATE_EXPECTED_CHANNELS", message: "expectedChannels 不能包含重复渠道" };
  }
  const unapproved = unique.filter((channel) => !salesImportPolicy.approvedSalesChannels.includes(channel));
  if (unapproved.length > 0) {
    return { ok: false as const, code: "UNAPPROVED_EXPECTED_CHANNELS", message: `expectedChannels 包含未纳入白名单的渠道：${unapproved.join("、")}` };
  }
  return { ok: true as const, channels: unique };
}

function realIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2199) return null;
  const epochMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return { value, epochMs };
}

export function validateSalesImportDateRange(startDate: string, endDate: string) {
  const start = realIsoDate(startDate);
  const end = realIsoDate(endDate);
  if (!start || !end || start.epochMs > end.epochMs) {
    return { ok: false as const, code: "INVALID_EXPECTED_DATE_RANGE", message: "起止日期必须为真实的 YYYY-MM-DD 自然日，且开始日期不能晚于结束日期" };
  }
  const dayCount = Math.floor((end.epochMs - start.epochMs) / 86_400_000) + 1;
  if (dayCount > MAX_SALES_IMPORT_RANGE_DAYS) {
    return { ok: false as const, code: "EXPECTED_DATE_RANGE_TOO_LARGE", message: `单次销售导入日期范围最多 ${MAX_SALES_IMPORT_RANGE_DAYS} 天` };
  }
  return {
    ok: true as const,
    startDate: start.value,
    endDate: end.value,
    endExclusive: new Date(end.epochMs + 86_400_000).toISOString().slice(0, 10),
    dayCount,
  };
}

// 数量字段（quantity）单独容错：来源系统偶有录入错误输出小数（已查实的真实故障见
// 2026-10-27 吉客云销售表第 2492 行 quantity=1.5）。非负小数四舍五入为整数并记录
// warning（保留原值与行号），不再作为阻断错误；其余 10 个整数字段（sourceRowNumber、
// 各金额 Cents 字段、Bps 字段）继续走下方 Number.isSafeInteger 的原有阻断逻辑，本次
// 不扩大放宽范围——金额字段出现小数是另一个问题，这次不碰。
//
// 负数：与库存表（lib/imports/inventory-stock.ts 的 optionalQuantity）结论一致但
// 原因不同。已核实真实数据：lib/imports/sales-ledger.ts:532 把
// `quantity < 0 || allocatedAmountCents < 0` 判定为退货单 businessType="return"，
// 负整数 quantity 是退货的合法业务信号，并非录入错误；10-23 一次成功导入里就有 3205
// 行负整数全部正常导入，10-27 故障文件里也有 3290 行负整数（businessType=return）。
// 因此负整数必须放行、行为不变。负小数则一律阻断：Math.round 对负数向零偏移
// （Math.round(-3.5) === -3），四舍五入负小数会悄悄改写退货数量的真实值，且真实数据中
// 负小数始终是 0 行，阻断不会误伤任何已知业务数据。
function normalizeQuantity(
  row: SalesLineInput,
  errors: SalesImportIssue[],
  warnings: SalesImportIssue[],
) {
  const value = row.quantity;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ row: row.sourceRowNumber, field: "quantity", code: "INVALID_INTEGER", message: "quantity 必须是安全整数" });
    return;
  }
  if (Number.isSafeInteger(value)) return; // 整数路径：行为与修复前完全一致，包括负整数放行。
  if (value < 0) {
    // 独立错误码（而不是复用 INVALID_INTEGER）：便于监控区分"负小数"与"非数字/超范围"
    // 两类不同性质的问题。
    errors.push({ row: row.sourceRowNumber, field: "quantity", code: "NEGATIVE_DECIMAL_QUANTITY", message: "quantity 不能为负小数" });
    return;
  }
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) {
    errors.push({ row: row.sourceRowNumber, field: "quantity", code: "INVALID_INTEGER", message: "quantity 必须是安全整数" });
    return;
  }
  // 解析阶段（lib/imports/sales-ledger.ts 的 requiredNumber）本来就要求 quantity 非零；
  // 像 0.4 这种四舍五入后变成 0 的小数不能绕过这条既有契约。
  if (rounded === 0) {
    errors.push({ row: row.sourceRowNumber, field: "quantity", code: "INVALID_INTEGER", message: "quantity 四舍五入后不能为 0" });
    return;
  }
  row.quantity = rounded;
  warnings.push({
    row: row.sourceRowNumber,
    field: "quantity",
    code: "ROUNDED_DECIMAL_QUANTITY",
    message: `quantity 第${row.sourceRowNumber}行为小数 ${value}，已四舍五入为 ${rounded}`,
  });
}

function validateRows(rows: readonly SalesLineInput[]): { errors: SalesImportIssue[]; warnings: SalesImportIssue[] } {
  const errors: SalesImportIssue[] = [];
  const warnings: SalesImportIssue[] = [];
  const keys = new Set<string>();
  const integerFields = [
    "sourceRowNumber", "listUnitPriceCents", "costAmountCents",
    "allocatedUnitPriceCents", "allocatedAmountCents", "feeAllocationCents",
    "grossProfitCents", "grossMarginBps", "untaxedGrossProfitCents", "untaxedGrossMarginBps",
  ] as const;
  if (rows.length === 0) return { errors: [{ code: "NO_DATA_ROWS", message: "工作表中没有可导入的销售明细行" }], warnings };
  if (rows.length > MAX_STAGED_ROWS) return { errors: [{ code: "ROW_LIMIT", message: `销售明细总行数超过 ${MAX_STAGED_ROWS} 行上限` }], warnings };
  for (const row of rows) {
    if (!row.sourceLineKey || !row.sourceRowHash) {
      errors.push({ row: row.sourceRowNumber, code: "MISSING_ROW_KEY", message: "明细行缺少唯一标识" });
    } else if (keys.has(row.sourceLineKey)) {
      errors.push({ row: row.sourceRowNumber, code: "DUPLICATE_ROW_KEY", message: "文件内存在重复的销售明细行" });
    } else keys.add(row.sourceLineKey);
    if (!/^\d{4}-\d{2}-\d{2}/.test(row.salesTime)) {
      errors.push({ row: row.sourceRowNumber, field: "salesTime", code: "INVALID_SALES_TIME", message: "销售时间无效" });
    }
    if (!row.orderNo && !row.onlineOrderNo) {
      errors.push({ row: row.sourceRowNumber, field: "orderNo", code: "MISSING_ORDER_NO", message: "销售单号和线上单号不能同时为空" });
    }
    normalizeQuantity(row, errors, warnings);
    for (const field of integerFields) {
      if (!Number.isSafeInteger(row[field])) {
        errors.push({ row: row.sourceRowNumber, field, code: "INVALID_INTEGER", message: `${field} 必须是安全整数` });
      }
    }
    if (!( ["sale", "return", "zero"] as const).includes(row.businessType)) {
      errors.push({ row: row.sourceRowNumber, field: "businessType", code: "INVALID_BUSINESS_TYPE", message: "业务类型无效" });
    }
    if (errors.length >= 200) break;
  }
  return { errors, warnings };
}

function effectiveRowsForCost(
  rows: readonly SalesLineInput[],
  startDate: string,
  endDate: string,
  expectedChannels: readonly string[] | null,
) {
  const cutoff = addUtcDays(shanghaiToday(), -1);
  const channels = expectedChannels ? new Set(expectedChannels) : null;
  return rows.filter((row) => {
    const businessDate = row.shipTime.slice(0, 10);
    return businessDate >= startDate && businessDate <= endDate && businessDate <= cutoff
      && !isExcludedSalesWarehouse(row.warehouse)
      && isApprovedSalesChannel(row.channel)
      && (!channels || channels.has(row.channel));
  });
}

function hasCleanableZeroCostRows(rows: readonly SalesLineInput[]) {
  return rows.some((row) => row.costAmountCents === 0
    && row.productCode !== "ERP_PRICE_ADJUSTMENT"
    && !isZeroCostProductName(row.productName));
}

function splitRowsForStaging(rows: readonly SalesLineInput[]): SalesLineInput[][] {
  const chunks: SalesLineInput[][] = [];
  let current: SalesLineInput[] = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + (current.length === 0 ? 0 : 1);
    if (rowBytes + 64 > TARGET_STAGED_BODY_BYTES) {
      throw new Error("单行销售明细超过规范化分片请求上限");
    }
    if (current.length >= MAX_ROWS_PER_STAGED_CHUNK || bytes + rowBytes > TARGET_STAGED_BODY_BYTES) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += rowBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export type SalesImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  code?: string;
  batch?: SalesImportBatch;
  warnings: SalesImportIssue[];
  errors?: SalesImportIssue[];
  errorCount?: number;
};

function rejected(message: string, code: string, warnings: SalesImportIssue[] = []): SalesImportExecution {
  return {
    ok: false,
    status: "rejected",
    message,
    code,
    warnings,
    errors: [{ code, message }],
    errorCount: 1,
  };
}

function upstreamImportPayload(error: unknown): SalesImportExecution | null {
  if (!(error instanceof DjangoSalesServiceResponseError)) return null;
  const payload = error.payload;
  if (payload.status !== "rejected" || payload.ok !== false || typeof payload.message !== "string") return null;
  return {
    ok: false,
    status: "rejected",
    message: payload.message,
    ...(typeof payload.code === "string" ? { code: payload.code } : {}),
    warnings: sanitizeSalesIssues(Array.isArray(payload.warnings) ? payload.warnings : []),
    errors: sanitizeSalesIssues(Array.isArray(payload.errors) ? payload.errors : []),
    errorCount: Number.isSafeInteger(payload.errorCount) ? Number(payload.errorCount) : undefined,
  };
}

export async function importSalesLedgerBytes(input: {
  principal: AppPrincipal;
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  expectedStartDate: string;
  expectedEndDate: string;
  expectedChannels?: unknown;
  rawUploadId?: string;
  rawUploadOwnerToken?: string;
  fingerprint?: string;
}): Promise<SalesImportExecution> {
  const dateRange = validateSalesImportDateRange(input.expectedStartDate, input.expectedEndDate);
  if (!dateRange.ok) return rejected("销售导入必须提供有效的权威起止日期", dateRange.code);
  const channelScope = validateSalesImportChannels(input.expectedChannels);
  if (!channelScope.ok) return rejected("销售导入必须提供有效的权威渠道范围", channelScope.code);
  const expectedChannels = channelScope.channels;
  const rawFileHash = toHex(await sha256(input.bytes));
  const fileName = safeFileName(input.fileName);

  let sourceTotals: SalesLedgerTotals = {} as SalesLedgerTotals;
  let sheetName = "销售单明细账";
  let rows: SalesLineInput[] = [];
  let parserWarnings: SalesImportIssue[] = [];
  let parserErrors: SalesImportIssue[] = [];
  if (!isXlsxSignature(input.bytes)) {
    parserErrors = [{ code: "INVALID_XLSX_SIGNATURE", message: "文件签名不是有效的 .xlsx（ZIP）格式" }];
  } else {
    try {
      const parsed = await parseSalesLedgerXlsx(input.bytes);
      sourceTotals = parsed.totals;
      sheetName = parsed.sheetName || sheetName;
      rows = parsed.rows.map(mapAnalysisSafeRow);
      const { errors: rowErrors, warnings: rowWarnings } = validateRows(rows);
      // sanitizeSalesIssues 和下游 Django sanitize_issues 对 warnings 都有 200 条硬上限
      // （backend/sales/write_service.py 完成阶段还会在这 200 条之后追加
      // EXCLUDED_FUTURE_DATE_ROWS / EXCLUDED_BRUSH_WAREHOUSE / EXCLUDED_NON_WHITELIST_CHANNEL
      // 等固定业务告警，再整体重截断到 200——如果本次新增的逐行小数告警把 parserWarnings
      // 撑到 200 条，会把那些固定告警挤出结果）。
      //
      // 预算必须以 parsed.warnings（解析阶段产生的 GROSS_PROFIT_MISMATCH/
      // ALLOCATED_AMOUNT_MISMATCH 等固定业务告警，真实数据常见 100+ 条）的实际条数为
      // 分母，不能假设它是 0——否则"150 条小数明细上限"在真实基数下形同虚设
      // （真实文件 119 条 parsed.warnings + 149 条小数明细 = 268 条，早于后端固定告警
      // 追加前就已经超过 200，Django sanitize_issues 的截断会先吞掉本该保留的汇总提示
      // 或明细，而不是按预期截断）。
      // 固定告警（parsed.warnings）优先占位，逐行小数明细按剩余预算截断，汇总提示固定
      // 占最后 1 个名额（不会被尾部截断顶掉）；再为后端 complete 阶段追加的固定业务
      // 告警预留至少若干名额（WORKER_SIDE_BUDGET 设在 150，留 50 条给后端）。
      const WORKER_SIDE_WARNING_BUDGET = 150;
      const fixedWarnings = parsed.warnings ?? [];
      const remainingForRowWarnings = Math.max(0, WORKER_SIDE_WARNING_BUDGET - fixedWarnings.length);
      const rowWarningSlots = rowWarnings.length > remainingForRowWarnings
        ? Math.max(0, remainingForRowWarnings - 1) // 超限时预留 1 个名额放汇总提示
        : remainingForRowWarnings;
      const limitedRowWarnings = rowWarnings.slice(0, rowWarningSlots);
      const roundedOverflow = rowWarnings.length - limitedRowWarnings.length;
      const combinedWarnings = [...fixedWarnings, ...limitedRowWarnings];
      if (roundedOverflow > 0) {
        combinedWarnings.push({
          code: "ROUNDED_DECIMAL_QUANTITY",
          message: `还有 ${roundedOverflow} 条小数数量四舍五入提示未显示，已达 Worker 侧预算 ${WORKER_SIDE_WARNING_BUDGET}`,
        });
      }
      parserWarnings = sanitizeSalesIssues(combinedWarnings);
      parserErrors = sanitizeSalesIssues([...(parsed.errors ?? []), ...rowErrors]);
    } catch {
      parserErrors = [{ code: "XLSX_PARSE_ERROR", message: "销售 Excel 文件解析失败，请确认文件格式和模板" }];
    }
  }

  let systemCostSnapshot: Record<string, unknown> | null = null;
  if (parserErrors.length === 0
    && hasCleanableZeroCostRows(effectiveRowsForCost(rows, dateRange.startDate, dateRange.endDate, expectedChannels))) {
    const snapshot = await findLatestAuthoritativeSystemCostSnapshot(input.principal);
    if (snapshot) {
      systemCostSnapshot = {
        sourceBatchId: snapshot.batchId,
        snapshotDate: snapshot.snapshotDate,
        costs: snapshot.costs,
      };
    }
  }

  const chunks = parserErrors.length === 0 ? splitRowsForStaging(rows) : [];
  const scopeDigest = await sha256Text(JSON.stringify({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    channels: expectedChannels,
  }));
  const fingerprint = input.fingerprint?.trim()
    || `sales-stage-v1:${rawFileHash}:${scopeDigest}`;
  try {
    const initialized = await requestDjangoSalesService<{ session: { id: string; status: string; receivedChunkIndexes: number[] } }>(input.principal, {
      method: "POST",
      path: SALES_STAGED_IMPORTS_PATH,
      service: "writer",
      payload: {
        action: "init",
        ...(input.rawUploadId ? { rawUploadId: input.rawUploadId } : {}),
        ...(input.rawUploadOwnerToken ? { rawUploadOwnerToken: input.rawUploadOwnerToken } : {}),
        fingerprint,
        fileName,
        fileSizeBytes: input.fileSizeBytes,
        rawFileHash,
        sheetName,
        expectedStartDate: dateRange.startDate,
        expectedEndDate: dateRange.endDate,
        expectedChannels,
        chunkCount: Math.max(chunks.length, 1),
        sourceTotals,
        parserWarnings,
        parserErrors,
        systemCostSnapshot,
      },
    });
    const session = initialized.data.session;
    if (!session || typeof session.id !== "string" || !Array.isArray(session.receivedChunkIndexes)) {
      throw new Error("Django 返回的规范化导入会话无效");
    }
    const received = new Set(session.receivedChunkIndexes);
    for (let index = 0; index < chunks.length; index += 1) {
      if (received.has(index)) continue;
      await requestDjangoSalesService(input.principal, {
        method: "PUT",
        path: SALES_STAGED_IMPORTS_PATH,
        service: "writer",
        payload: {
          sessionId: session.id,
          chunkIndex: index,
          rows: chunks[index],
          ...(input.rawUploadOwnerToken ? { rawUploadOwnerToken: input.rawUploadOwnerToken } : {}),
        },
      });
    }
    const completed = await requestDjangoSalesService<SalesImportExecution>(input.principal, {
      method: "POST",
      path: SALES_STAGED_IMPORTS_PATH,
      service: "writer",
      payload: {
        action: "complete",
        sessionId: session.id,
        ...(input.rawUploadOwnerToken ? { rawUploadOwnerToken: input.rawUploadOwnerToken } : {}),
      },
    });
    return {
      ...completed.data,
      warnings: sanitizeSalesIssues(completed.data.warnings ?? []),
    };
  } catch (error) {
    const payload = upstreamImportPayload(error);
    if (payload) return payload;
    throw error;
  }
}
