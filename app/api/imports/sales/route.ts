import {
  parseSalesLedgerXlsx,
  type SalesLedgerRow,
} from "@/lib/imports/sales-ledger";
import {
  ensureSalesSchema,
  findSalesImportBatchByHash,
  getSalesDatabase,
  listSalesImportBatches,
  sanitizeSalesIssues,
  saveSalesImport,
  type SalesImportIssue,
  type SalesLineInput,
} from "@/lib/sales/database";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function errorResponse(
  status: number,
  message: string,
  details: Record<string, unknown> = {},
) {
  return Response.json(
    { ok: false, status: "rejected", message, ...details },
    { status },
  );
}

function isXlsxSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "sales-ledger.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function mapAnalysisSafeRow(row: SalesLedgerRow): SalesLineInput {
  // This explicit allow-list is the privacy boundary. In particular, parser
  // fields such as customerCode/customerNote/logisticsNo are never persisted.
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
    shipTime: row.shipTime ?? "",
    lineShipTime: row.lineShipTime ?? "",
    businessType: row.businessType,
  };
}

function validateRows(rows: readonly SalesLineInput[]): SalesImportIssue[] {
  const errors: SalesImportIssue[] = [];
  const keys = new Set<string>();
  const integerFields = [
    "sourceRowNumber",
    "quantity",
    "listUnitPriceCents",
    "costAmountCents",
    "allocatedUnitPriceCents",
    "allocatedAmountCents",
    "feeAllocationCents",
    "grossProfitCents",
    "grossMarginBps",
    "untaxedGrossProfitCents",
    "untaxedGrossMarginBps",
  ] as const;

  if (rows.length === 0) {
    return [{ code: "NO_DATA_ROWS", message: "工作表中没有可导入的销售明细行" }];
  }

  for (const row of rows) {
    if (!row.sourceLineKey || !row.sourceRowHash) {
      errors.push({ row: row.sourceRowNumber, code: "MISSING_ROW_KEY", message: "明细行缺少唯一键" });
    } else if (keys.has(row.sourceLineKey)) {
      errors.push({ row: row.sourceRowNumber, code: "DUPLICATE_ROW_KEY", message: "文件内存在重复的销售明细行" });
    } else {
      keys.add(row.sourceLineKey);
    }

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

    if (!(["sale", "return", "zero"] as const).includes(row.businessType)) {
      errors.push({ row: row.sourceRowNumber, field: "businessType", code: "INVALID_BUSINESS_TYPE", message: "业务类型无效" });
    }

    if (errors.length >= 200) break;
  }

  return errors;
}

export async function GET(request: Request) {
  try {
    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
    const items = await listSalesImportBatches(db, limit);

    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取销售导入历史失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(415, "请使用 multipart/form-data 上传 .xlsx 文件");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FILE_BYTES + 1024 * 1024) {
      return errorResponse(413, "文件不能超过 15MB");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse(400, "无法读取上传表单");
    }

    const entry = formData.get("file");
    if (!(entry instanceof File)) {
      return errorResponse(400, "缺少名为 file 的 Excel 文件");
    }

    if (!entry.name.toLowerCase().endsWith(".xlsx")) {
      return errorResponse(400, "仅支持 .xlsx 格式的销售单明细账");
    }
    if (entry.size === 0) return errorResponse(400, "上传文件为空");
    if (entry.size > MAX_FILE_BYTES) return errorResponse(413, "文件不能超过 15MB");

    const bytes = new Uint8Array(await entry.arrayBuffer());
    if (!isXlsxSignature(bytes)) {
      return errorResponse(400, "文件签名不是有效的 .xlsx（ZIP）格式");
    }

    const fileHash = toHex(await crypto.subtle.digest("SHA-256", bytes));
    const db = getSalesDatabase();
    await ensureSalesSchema(db);

    const previous = await findSalesImportBatchByHash(db, fileHash);
    if (previous?.status === "completed") {
      return Response.json({
        ok: true,
        status: "duplicate",
        message: "该文件已经导入，无需重复处理",
        batch: previous,
        warnings: previous.warnings,
      });
    }

    let parsed: Awaited<ReturnType<typeof parseSalesLedgerXlsx>>;
    try {
      parsed = await parseSalesLedgerXlsx(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Excel 文件解析失败";
      return errorResponse(422, message, { errors: [{ code: "XLSX_PARSE_ERROR", message }] });
    }

    const parserErrors = sanitizeSalesIssues(parsed.errors ?? []);
    const warnings = sanitizeSalesIssues(parsed.warnings ?? []);
    const rows = parsed.rows.map((row) => mapAnalysisSafeRow(row));
    const rowErrors = validateRows(rows);
    const errors = [...parserErrors, ...rowErrors].slice(0, 200);

    if (errors.length > 0) {
      return errorResponse(422, "文件校验未通过，未写入任何销售数据", {
        errorCount: (parsed.errors?.length ?? 0) + rowErrors.length,
        errors,
        warnings,
      });
    }

    const result = await saveSalesImport(db, {
      fileHash,
      fileName: safeFileName(entry.name),
      fileSizeBytes: entry.size,
      sheetName: parsed.sheetName,
      rows,
      warnings,
      totals: parsed.totals,
    });
    const status = result.created ? "imported" : "duplicate";

    return Response.json(
      {
        ok: true,
        status,
        message: result.created ? "销售单明细账导入成功" : "该文件已经导入，无需重复处理",
        batch: result.batch,
        warnings,
      },
      { status: result.created ? 201 : 200, headers: { "x-import-content-type": XLSX_CONTENT_TYPE } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "销售数据导入失败";
    return Response.json({ ok: false, status: "rejected", message }, { status: 500 });
  }
}
