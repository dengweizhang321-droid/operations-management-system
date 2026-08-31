import {
  parseSalesLedgerXlsx,
  type SalesLedgerRow,
  type SalesLedgerTotals,
} from "@/lib/imports/sales-ledger";
import {
  buildImportAttemptHash,
  buildImportContentFingerprint,
  auditRejectedImportResult,
  ensureImportFingerprintSchema,
  failImportFingerprint,
  nextImportScopeStateToken,
  readImportScopeStateToken,
  recordImportFingerprint,
  renewImportFingerprintReservation,
  reserveImportFingerprint,
} from "@/lib/imports/content-fingerprint";
import { findLatestSystemCostSnapshot } from "@/lib/inventory/database";
import {
  ensureSalesSchema,
  findSalesImportBatchByHash,
  findSalesImportBatchById,
  getSalesDatabase,
  sanitizeSalesIssues,
  saveSalesImport,
  type SalesImportIssue,
  type SalesLineInput,
} from "@/lib/sales/database";
import {
  isApprovedSalesChannel,
  isExcludedSalesWarehouse,
  isZeroCostProductName,
  salesImportPolicy,
} from "@/lib/sales/import-policy";
import { cleanZeroCostSalesRows } from "@/lib/sales/system-cost-cleaning";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "sales-ledger.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function mapAnalysisSafeRow(row: SalesLedgerRow): SalesLineInput {
  // Explicit allow-list: personal/account/logistics details remain outside analytics storage.
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
    // “补差价专用”等虚拟金额调整行没有实际发货时间。为保持发货时间
    // 为主口径，同时避免将这类订单金额排除在统计周期外，按货品级发货
    // 时间、下单时间依次兜底。
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

export const MAX_SALES_IMPORT_RANGE_DAYS = 366;
export const MAX_SALES_IMPORT_CHANNELS = 50;

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

function hasCleanableZeroCostRows(rows: readonly SalesLineInput[]) {
  return rows.some((row) => row.costAmountCents === 0
    && row.productCode !== "ERP_PRICE_ADJUSTMENT"
    && !isZeroCostProductName(row.productName));
}

function safeTotal(total: number, value: number, field: string) {
  const result = total + value;
  if (!Number.isSafeInteger(result)) throw new Error(`${field} 汇总超出安全整数范围`);
  return result;
}

function calculateStoredTotals(
  sourceTotals: SalesLedgerTotals,
  rows: readonly SalesLineInput[],
  input: {
    rawFileHash: string;
    excludedBrushWarehouseRows: number;
    excludedFutureDateRows: number;
    systemCost?: {
      sourceBatchId: string;
      snapshotDate: string;
      cleanedRows: number;
      matchedByWarehouseRows: number;
      matchedByProductFallbackRows: number;
      skippedPriceAdjustmentRows: number;
      unresolvedRows: number;
    };
  },
) {
  let saleRowCount = 0;
  let returnRowCount = 0;
  let quantity = 0;
  let netSalesCents = 0;
  let costAmountCents = 0;
  let feeAllocationCents = 0;
  let grossProfitCents = 0;
  let untaxedGrossProfitCents = 0;
  for (const row of rows) {
    if (row.businessType === "return") returnRowCount += 1;
    else saleRowCount += 1;
    quantity = safeTotal(quantity, row.quantity, "销售数量");
    netSalesCents = safeTotal(netSalesCents, row.allocatedAmountCents, "销售金额");
    costAmountCents = safeTotal(costAmountCents, row.costAmountCents, "货品成本");
    feeAllocationCents = safeTotal(feeAllocationCents, row.feeAllocationCents, "费用分摊");
    grossProfitCents = safeTotal(grossProfitCents, row.grossProfitCents, "毛利");
    untaxedGrossProfitCents = safeTotal(untaxedGrossProfitCents, row.untaxedGrossProfitCents, "未税毛利");
  }
  return {
    ...sourceTotals,
    rowCount: rows.length,
    saleRowCount,
    returnRowCount,
    quantity,
    netSalesCents,
    costAmountCents,
    feeAllocationCents,
    grossProfitCents,
    untaxedGrossProfitCents,
    rawFileHash: input.rawFileHash,
    excludedBrushWarehouseRows: input.excludedBrushWarehouseRows,
    excludedFutureDateRows: input.excludedFutureDateRows,
    ...(input.systemCost ? { systemCost: input.systemCost } : {}),
  };
}

function validateRows(rows: readonly SalesLineInput[]): SalesImportIssue[] {
  const errors: SalesImportIssue[] = [];
  const keys = new Set<string>();
  const integerFields = [
    "sourceRowNumber", "quantity", "listUnitPriceCents", "costAmountCents",
    "allocatedUnitPriceCents", "allocatedAmountCents", "feeAllocationCents",
    "grossProfitCents", "grossMarginBps", "untaxedGrossProfitCents", "untaxedGrossMarginBps",
  ] as const;

  if (rows.length === 0) return [{ code: "NO_DATA_ROWS", message: "工作表中没有可导入的销售明细行" }];

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
  return errors;
}

export type SalesImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: Awaited<ReturnType<typeof findSalesImportBatchByHash>>;
  warnings: SalesImportIssue[];
  errors?: SalesImportIssue[];
  errorCount?: number;
};

export async function importSalesLedgerBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  expectedStartDate: string;
  expectedEndDate: string;
  expectedChannels?: unknown;
}): Promise<SalesImportExecution> {
  const dateRange = validateSalesImportDateRange(input.expectedStartDate, input.expectedEndDate);
  const channelScope = validateSalesImportChannels(input.expectedChannels);
  const rawFileHash = toHex(await sha256(input.bytes));
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  await ensureImportFingerprintSchema(db);
  const reject = (result: SalesImportExecution) => auditRejectedImportResult(db, {
    domain: "sales",
    rawFileHash,
    scopeHint: {
      source: "sales_ledger",
      startDate: input.expectedStartDate,
      endDate: input.expectedEndDate,
      ...(channelScope.ok && channelScope.channels ? { channels: channelScope.channels } : {}),
    },
    metadata: { fileName: input.fileName, fileSizeBytes: input.fileSizeBytes },
  }, result);
  if (!isXlsxSignature(input.bytes)) {
    return reject({ ok: false, status: "rejected", message: "文件签名不是有效的 .xlsx（ZIP）格式", warnings: [], errors: [{ code: "INVALID_XLSX_SIGNATURE", message: "文件签名无效" }], errorCount: 1 });
  }
  if (!dateRange.ok) {
    return reject({ ok: false, status: "rejected", message: "销售导入必须提供有效的权威起止日期", warnings: [], errors: [{ code: dateRange.code, message: dateRange.message }], errorCount: 1 });
  }
  if (!channelScope.ok) {
    return reject({ ok: false, status: "rejected", message: "销售导入必须提供有效的权威渠道范围", warnings: [], errors: [{ code: channelScope.code, message: channelScope.message }], errorCount: 1 });
  }
  const expectedChannels = channelScope.channels;
  const expectedChannelSet = expectedChannels ? new Set(expectedChannels) : null;

  let parsed: Awaited<ReturnType<typeof parseSalesLedgerXlsx>>;
  try {
    parsed = await parseSalesLedgerXlsx(input.bytes);
  } catch {
    const message = "销售 Excel 文件解析失败，请确认文件格式和模板";
    return reject({ ok: false, status: "rejected", message, warnings: [], errors: [{ code: "XLSX_PARSE_ERROR", message }], errorCount: 1 });
  }

  const parserErrors = sanitizeSalesIssues(parsed.errors ?? []);
  const mappedRows = parsed.rows.map(mapAnalysisSafeRow);
  const today = shanghaiToday();
  const cutoffDate = addUtcDays(today, -1);
  const excludedFutureDateRows = mappedRows.filter((row) => row.shipTime.slice(0, 10) === today).length;
  const invalidFutureDateRows = mappedRows.filter((row) => row.shipTime.slice(0, 10) > today);
  const rowsWithinCutoff = mappedRows.filter((row) => row.shipTime.slice(0, 10) <= cutoffDate);
  const excludedBrushWarehouseRows = rowsWithinCutoff.filter((row) => isExcludedSalesWarehouse(row.warehouse)).length;
  let rows = rowsWithinCutoff.filter((row) => !isExcludedSalesWarehouse(row.warehouse));
  const unexpectedScopedChannelRows = expectedChannelSet
    ? rows.filter((row) => !expectedChannelSet.has(row.channel))
    : [];
  const disallowedChannelRows = rows.filter((row) => !isApprovedSalesChannel(row.channel));
  rows = rows.filter((row) => isApprovedSalesChannel(row.channel));
  const presentChannels = new Set(rows.map((row) => row.channel));
  const missingExpectedChannels = expectedChannels?.filter((channel) => !presentChannels.has(channel)) ?? [];
  const outOfScopeRows = rows.filter((row) => {
    const date = row.shipTime.slice(0, 10);
    return date < input.expectedStartDate || date > input.expectedEndDate;
  });
  const baseWarnings: Array<{ code: string; message: string; sourceRowNumber?: number }> = [
    ...(parsed.warnings ?? []),
    ...(excludedFutureDateRows > 0
      ? [{ code: "EXCLUDED_FUTURE_DATE_ROWS", message: `已剔除晚于截止日期的 ${excludedFutureDateRows} 行当天订单明细` }]
      : []),
    ...(excludedBrushWarehouseRows > 0
      ? [{ code: "EXCLUDED_BRUSH_WAREHOUSE", message: `已剔除刷刷仓 ${excludedBrushWarehouseRows} 行，不写入经营分析数据` }]
      : []),
    ...(disallowedChannelRows.length > 0
      ? [{ code: "EXCLUDED_NON_WHITELIST_CHANNEL", message: `已剔除白名单外店铺 ${disallowedChannelRows.length} 行，不写入经营分析数据` }]
      : []),
  ];
  let warnings = sanitizeSalesIssues(baseWarnings);
  const policyErrors: SalesImportIssue[] = invalidFutureDateRows.map((row) => ({
    row: row.sourceRowNumber,
    field: "shipTime",
    code: "INVALID_FUTURE_SHIP_TIME",
    message: `发货日期晚于执行当天，不能按当天订单自动剔除：${row.shipTime}`,
  }));
  const rowErrors = validateRows(rows);
  const errors = [...parserErrors, ...policyErrors, ...rowErrors].slice(0, 200);
  if (unexpectedScopedChannelRows.length > 0) {
    errors.unshift({ code: "UNEXPECTED_IMPORT_CHANNELS", message: `${unexpectedScopedChannelRows.length} 行销售渠道不属于本次权威渠道范围` });
  }
  if (missingExpectedChannels.length > 0) {
    errors.unshift({ code: "MISSING_EXPECTED_CHANNELS", message: `文件未覆盖本次声明的渠道：${missingExpectedChannels.join("、")}` });
  }
  if (outOfScopeRows.length > 0) {
    errors.unshift({ code: "OUT_OF_EXPECTED_DATE_RANGE", message: `${outOfScopeRows.length} 行发货日期超出权威导入范围 ${input.expectedStartDate} 至 ${input.expectedEndDate}` });
  }
  if (rows.length === 0) {
    errors.unshift({ code: "NO_DATA_ROWS", message: "剔除当天订单明细、刷刷仓和白名单外店铺后没有可导入的销售数据" });
  }
  if (errors.length > 0) {
    return reject({
      ok: false,
      status: "rejected",
      message: "文件校验未通过，未写入任何销售数据",
      warnings,
      errors,
      errorCount: (parsed.errors?.length ?? 0) + policyErrors.length + rowErrors.length,
    });
  }

  let systemCost: {
    sourceBatchId: string;
    snapshotDate: string;
    cleanedRows: number;
    matchedByWarehouseRows: number;
    matchedByProductFallbackRows: number;
    skippedPriceAdjustmentRows: number;
    unresolvedRows: number;
  } | undefined;
  if (hasCleanableZeroCostRows(rows)) {
    const snapshot = await findLatestSystemCostSnapshot(db);
    if (!snapshot) {
      return reject({
        ok: false,
        status: "rejected",
        message: "检测到货品成本为 0 的销售明细，但没有可用的系统成本快照",
        warnings,
        errors: [{
          code: "MISSING_SYSTEM_COST_SNAPSHOT",
          field: "costAmountCents",
          message: "请先同步包含正固定成本价的分仓库存快照，再重新导入销售明细",
        }],
        errorCount: 1,
      });
    }

    const cleaned = cleanZeroCostSalesRows(rows, snapshot.costs);
    rows = cleaned.rows;
    const cleanedRowNumbers = new Set(cleaned.cleanedRowNumbers);
    const unresolvedSamples = [...new Set(cleaned.unresolvedRows
      .map((row) => row.productCode || row.productName)
      .filter(Boolean))]
      .slice(0, 8)
      .join("、");
    warnings = sanitizeSalesIssues([
      ...baseWarnings.filter((warning) => !(warning.code === "GROSS_PROFIT_MISMATCH"
        && cleanedRowNumbers.has(Number(warning.sourceRowNumber)))),
      ...(cleaned.cleanedRowNumbers.length > 0
        ? [{
          code: "SYSTEM_COST_CLEANED",
          message: `已按系统成本快照 ${snapshot.snapshotDate} 清洗 ${cleaned.cleanedRowNumbers.length} 行原始成本为 0 的销售明细`,
        }]
        : []),
      ...(cleaned.unresolvedRows.length > 0
        ? [{
          code: "SYSTEM_COST_UNRESOLVED",
          message: `系统成本快照未匹配 ${cleaned.unresolvedRows.length} 行 0 成本明细，已保留原始 0 成本继续导入${unresolvedSamples ? `；样例：${unresolvedSamples}` : ""}`,
        }]
        : []),
      ...(cleaned.matchedByProductFallbackRows > 0
        ? [{
          code: "SYSTEM_COST_PRODUCT_FALLBACK",
          message: `${cleaned.matchedByProductFallbackRows} 行未匹配到同仓成本，已使用货品唯一系统成本`,
        }]
        : []),
    ]);
    systemCost = {
      sourceBatchId: snapshot.batchId,
      snapshotDate: snapshot.snapshotDate,
      cleanedRows: cleaned.cleanedRowNumbers.length,
      matchedByWarehouseRows: cleaned.matchedByWarehouseRows,
      matchedByProductFallbackRows: cleaned.matchedByProductFallbackRows,
      skippedPriceAdjustmentRows: cleaned.skippedPriceAdjustmentRows,
      unresolvedRows: cleaned.unresolvedRows.length,
    };
  }

  const scopeStart = input.expectedStartDate;
  const scopeEnd = input.expectedEndDate;
  const fingerprint = await buildImportContentFingerprint({
    domain: "sales",
    scope: {
      source: "sales_ledger",
      startDate: scopeStart,
      endDate: scopeEnd,
      ...(expectedChannels ? { channels: expectedChannels } : {}),
    },
    lockScope: { source: "sales_ledger" },
    rows,
    ignoredTopLevelKeys: ["sourceRowNumber", "sourceLineKey", "sourceRowHash"],
  });
  const readScopeOwnership = async () => {
    const channelClause = expectedChannels
      ? " AND channel IN (SELECT CAST(value AS TEXT) FROM json_each(?))"
      : "";
    const statement = db.prepare(
      `SELECT last_import_batch_id AS batch_id, COUNT(*) AS row_count
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?${channelClause}
       GROUP BY last_import_batch_id
       ORDER BY last_import_batch_id`,
    );
    const current = await (expectedChannels
      ? statement.bind(scopeStart, dateRange.endExclusive, JSON.stringify(expectedChannels))
      : statement.bind(scopeStart, dateRange.endExclusive))
      .all<{ batch_id: string; row_count: number }>();
    return current.results.map((row) => ({ batchId: row.batch_id, rowCount: Number(row.row_count) }));
  };
  const scopeOwnership = await readScopeOwnership();
  const currentStateToken = await readImportScopeStateToken(db, fingerprint);
  const currentBatchId = scopeOwnership.length === 1 && scopeOwnership[0]?.rowCount === rows.length
    ? scopeOwnership[0].batchId
    : null;
  const currentBatch = currentBatchId ? await findSalesImportBatchById(db, currentBatchId) : null;
  const currentTotals = currentBatch?.totals as { contentHash?: unknown; rawFileHash?: unknown } | null;
  if (currentBatch?.status === "completed" && currentBatch.rowCount === rows.length
    && currentTotals?.contentHash === fingerprint.contentHash) {
    await recordImportFingerprint(db, {
      ...fingerprint,
      batchId: currentBatch.id,
      importHash: currentBatch.fileHash,
      rawFileHash,
      publishedStateToken: currentStateToken,
      metadata: { fileName: input.fileName, fileSizeBytes: input.fileSizeBytes, warnings },
      outcome: "duplicate",
    });
    return { ok: true, status: "duplicate", message: "全部标准化销售资料与当前期间一致，无需重复导入", batch: currentBatch, warnings: currentBatch.warnings };
  }
  const fileHash = await buildImportAttemptHash({
    fingerprint,
    currentStateToken,
  });
  const reservation = await reserveImportFingerprint(db, {
    ...fingerprint,
    batchId: fileHash,
    importHash: fileHash,
    rawFileHash,
    currentStateToken,
    metadata: { fileName: input.fileName, fileSizeBytes: input.fileSizeBytes, warnings },
  });
  if (!reservation.claimed) {
    return { ok: false, status: "rejected", message: "同一销售期间已被更新，请重新提交最新文件", warnings, errors: [{ code: "IMPORT_SCOPE_CHANGED", message: "导入开始前当前期间版本已变化" }], errorCount: 1 };
  }
  await renewImportFingerprintReservation(db, { ...fingerprint, batchId: fileHash, attemptId: reservation.attemptId });

  try {
  const result = await saveSalesImport(db, {
    fileHash,
    fileName: safeFileName(input.fileName),
    fileSizeBytes: input.fileSizeBytes,
    sheetName: parsed.sheetName,
    rows,
    warnings,
    contentHash: fingerprint.contentHash,
    replaceStartDate: scopeStart,
    replaceEndDate: scopeEnd,
    replaceChannels: expectedChannels,
    reservationFence: {
      domain: fingerprint.domain,
      scopeKey: fingerprint.scopeKey,
      batchId: fileHash,
      attemptId: reservation.attemptId,
    },
    totals: {
      ...calculateStoredTotals(parsed.totals, rows, {
      rawFileHash,
      excludedBrushWarehouseRows,
      excludedFutureDateRows,
      systemCost,
      }),
      importScope: { startDate: scopeStart, endDate: scopeEnd, channels: expectedChannels },
      contentHash: fingerprint.contentHash,
    },
  });
  const postOwnership = await readScopeOwnership();
  if (result.batch.status !== "completed" || postOwnership.length !== 1
    || postOwnership[0]?.batchId !== result.batch.id || postOwnership[0].rowCount !== rows.length) {
    throw new Error("销售导入批次未完成或当前期间的落库事实与解析结果不一致");
  }
  await recordImportFingerprint(db, {
    ...fingerprint,
    batchId: result.batch.id,
    importHash: fileHash,
    rawFileHash,
    attemptId: reservation.attemptId,
    publishedStateToken: await nextImportScopeStateToken({
      previousStateToken: currentStateToken,
      batchId: result.batch.id,
      contentHash: fingerprint.contentHash,
      rowCount: fingerprint.rowCount,
    }),
    metadata: { fileName: input.fileName, fileSizeBytes: input.fileSizeBytes, warnings },
    outcome: result.created ? "imported" : "duplicate",
  });
  return {
    ok: true,
    status: result.created ? "imported" : "duplicate",
    message: result.created
      ? systemCost
        ? `销售单明细账导入成功，已用系统成本清洗 ${systemCost.cleanedRows} 行零成本明细`
        : "销售单明细账导入成功"
      : "全部标准化销售资料与当前期间一致，无需重复导入",
    batch: result.batch,
    warnings,
  };
  } catch (error) {
    await failImportFingerprint(db, { ...fingerprint, batchId: fileHash, importHash: fileHash, rawFileHash, attemptId: reservation.attemptId, metadata: { fileName: input.fileName, fileSizeBytes: input.fileSizeBytes, warnings }, errorCode: "SALES_IMPORT_FAILED" }).catch(() => undefined);
    throw error;
  }
}
