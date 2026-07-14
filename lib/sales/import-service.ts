import {
  parseSalesLedgerXlsx,
  type SalesLedgerRow,
} from "@/lib/imports/sales-ledger";
import {
  ensureSalesSchema,
  findSalesImportBatchByHash,
  getSalesDatabase,
  sanitizeSalesIssues,
  saveSalesImport,
  type SalesImportIssue,
  type SalesLineInput,
} from "@/lib/sales/database";

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
    shipTime: row.shipTime ?? row.lineShipTime ?? row.orderTime,
    lineShipTime: row.lineShipTime ?? "",
    businessType: row.businessType,
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
}): Promise<SalesImportExecution> {
  if (!isXlsxSignature(input.bytes)) {
    return { ok: false, status: "rejected", message: "文件签名不是有效的 .xlsx（ZIP）格式", warnings: [], errors: [{ code: "INVALID_XLSX_SIGNATURE", message: "文件签名无效" }], errorCount: 1 };
  }

  const fileHash = toHex(await sha256(input.bytes));
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const previous = await findSalesImportBatchByHash(db, fileHash);
  if (previous?.status === "completed") {
    return { ok: true, status: "duplicate", message: "该文件已经导入，无需重复处理", batch: previous, warnings: previous.warnings };
  }

  let parsed: Awaited<ReturnType<typeof parseSalesLedgerXlsx>>;
  try {
    parsed = await parseSalesLedgerXlsx(input.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Excel 文件解析失败";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "XLSX_PARSE_ERROR", message }], errorCount: 1 };
  }

  const parserErrors = sanitizeSalesIssues(parsed.errors ?? []);
  const mappedRows = parsed.rows.map(mapAnalysisSafeRow);
  const excludedBrushWarehouseRows = mappedRows.filter((row) => row.warehouse.trim() === "刷刷仓").length;
  const rows = mappedRows.filter((row) => row.warehouse.trim() !== "刷刷仓");
  const warnings = sanitizeSalesIssues([
    ...(parsed.warnings ?? []),
    ...(excludedBrushWarehouseRows > 0
      ? [{ code: "EXCLUDED_BRUSH_WAREHOUSE", message: `已剔除刷刷仓 ${excludedBrushWarehouseRows} 行，不写入经营分析数据` }]
      : []),
  ]);
  const rowErrors = validateRows(rows);
  const errors = [...parserErrors, ...rowErrors].slice(0, 200);
  if (errors.length > 0) {
    return {
      ok: false,
      status: "rejected",
      message: "文件校验未通过，未写入任何销售数据",
      warnings,
      errors,
      errorCount: (parsed.errors?.length ?? 0) + rowErrors.length,
    };
  }

  const result = await saveSalesImport(db, {
    fileHash,
    fileName: safeFileName(input.fileName),
    fileSizeBytes: input.fileSizeBytes,
    sheetName: parsed.sheetName,
    rows,
    warnings,
    totals: { ...parsed.totals, excludedBrushWarehouseRows },
  });
  return {
    ok: true,
    status: result.created ? "imported" : "duplicate",
    message: result.created ? "销售单明细账导入成功" : "该文件已经导入，无需重复处理",
    batch: result.batch,
    warnings,
  };
}
