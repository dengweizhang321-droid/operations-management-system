import {
  parseInventoryStockXlsx,
  type InventoryStockIssue,
} from "@/lib/imports/inventory-stock";
import { isXlsxSignature } from "@/lib/sales/import-service";
import {
  ensureInventorySchema,
  findInventoryImportBatchByHash,
  getInventoryDatabase,
  saveInventoryImport,
  type InventoryImportIssue,
} from "@/lib/inventory/database";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "inventory-stock.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function dateFromFileName(fileName: string): string | null {
  const compact = /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(fileName);
  const separated = /(?:^|\D)(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})日?(?:\D|$)/.exec(fileName);
  const match = compact ?? separated;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function mapIssue(issue: InventoryStockIssue): InventoryImportIssue {
  return {
    row: issue.sourceRowNumber,
    field: issue.field,
    code: issue.code,
    message: issue.message,
  };
}

export type InventoryImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: Awaited<ReturnType<typeof findInventoryImportBatchByHash>>;
  warnings: InventoryImportIssue[];
  errors?: InventoryImportIssue[];
  errorCount?: number;
};

export async function importInventoryStockBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
}): Promise<InventoryImportExecution> {
  if (!isXlsxSignature(input.bytes)) {
    return {
      ok: false,
      status: "rejected",
      message: "文件签名不是有效的 .xlsx（ZIP）格式",
      warnings: [],
      errors: [{ code: "INVALID_XLSX_SIGNATURE", message: "文件签名无效" }],
      errorCount: 1,
    };
  }

  const fileHash = toHex(await sha256(input.bytes));
  const db = getInventoryDatabase();
  await ensureInventorySchema(db);
  const previous = await findInventoryImportBatchByHash(db, fileHash);
  if (previous?.status === "completed") {
    return {
      ok: true,
      status: "duplicate",
      message: "该库存快照已经同步，无需重复处理",
      batch: previous,
      warnings: previous.warnings,
    };
  }

  let parsed: ReturnType<typeof parseInventoryStockXlsx>;
  try {
    parsed = parseInventoryStockXlsx(input.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "库存 Excel 文件解析失败";
    return {
      ok: false,
      status: "rejected",
      message,
      warnings: [],
      errors: [{ code: "XLSX_PARSE_ERROR", message }],
      errorCount: 1,
    };
  }

  const errors = parsed.errors.map(mapIssue).slice(0, 200);
  if (parsed.rows.length === 0 && errors.length === 0) {
    errors.push({ code: "NO_DATA_ROWS", message: "工作表中没有可导入的库存明细行" });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      status: "rejected",
      message: "文件校验未通过，未写入任何库存数据",
      warnings: [],
      errors,
      errorCount: parsed.errors.length,
    };
  }

  const rowDates = [...new Set(parsed.rows.map((row) => row.snapshotDate).filter((value): value is string => Boolean(value)))];
  if (rowDates.length > 1) {
    return {
      ok: false,
      status: "rejected",
      message: "库存报表包含多个快照日期，不能合并为同一库存批次",
      warnings: [],
      errors: [{ code: "MIXED_SNAPSHOT_DATES", message: `检测到 ${rowDates.length} 个不同的库存日期，请按日期拆分后重新上传` }],
      errorCount: 1,
    };
  }

  const fileNameDate = dateFromFileName(input.fileName);
  const snapshotDate = rowDates[0] ?? fileNameDate;
  if (!snapshotDate) {
    return {
      ok: false,
      status: "rejected",
      message: "无法确定库存快照日期",
      warnings: [],
      errors: [{ code: "MISSING_SNAPSHOT_DATE", message: "报表没有库存日期，请在文件名中加入日期，例如“分仓库存2026.07.11.xlsx”" }],
      errorCount: 1,
    };
  }

  const missingCostRows = parsed.rows.filter((row) => row.unitCostCents <= 0).length;
  const missingNameRows = parsed.rows.filter((row) => !row.productName).length;
  const warnings: InventoryImportIssue[] = [
    ...(missingCostRows > 0
      ? [{ code: "MISSING_UNIT_COST", message: `${missingCostRows} 行缺少成本价，货值将优先使用销售历史单位成本补全` }]
      : []),
    ...(missingNameRows > 0
      ? [{ code: "MISSING_PRODUCT_NAME", message: `${missingNameRows} 行缺少货品名称，页面将使用销售明细中的名称补全` }]
      : []),
    ...(!parsed.coverage.hasAvailableQuantity
      ? [{ code: "DERIVED_AVAILABLE_QUANTITY", message: "报表未提供可用库存，系统已按“实盘数量 - 锁定数量”推导" }]
      : []),
    ...(!parsed.coverage.hasLockedQuantity
      ? [{ code: "MISSING_LOCKED_QUANTITY", message: "报表未提供锁定数量，本批次暂按 0 处理" }]
      : []),
    ...(!parsed.coverage.hasInTransitQuantity
      ? [{ code: "MISSING_IN_TRANSIT_QUANTITY", message: "报表未提供采购在途，本批次暂按 0 处理；备货草稿与已确认计划仍会单独计入在途" }]
      : []),
    ...(rowDates[0] && fileNameDate && rowDates[0] !== fileNameDate
      ? [{ code: "SNAPSHOT_DATE_FILENAME_MISMATCH", message: `报表日期 ${rowDates[0]} 与文件名日期 ${fileNameDate} 不一致，已采用报表日期` }]
      : []),
  ];
  const result = await saveInventoryImport(db, {
    fileHash,
    fileName: safeFileName(input.fileName),
    fileSizeBytes: input.fileSizeBytes,
    sheetName: parsed.sheetName,
    snapshotDate,
    rows: parsed.rows,
    warnings,
    totals: parsed.totals,
  });

  return {
    ok: true,
    status: result.created ? "imported" : "duplicate",
    message: result.created ? "分仓库存快照同步成功" : "该库存快照已经同步，无需重复处理",
    batch: result.batch,
    warnings,
  };
}
