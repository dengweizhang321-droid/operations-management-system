import { isXlsxSignature } from "@/lib/sales/import-service";
import {
  ERP_REFERENCE_SOURCE_LABELS,
  isErpReferenceSourceKey,
  parseErpReferenceXlsx,
  type ComboItemImportRow,
  type ErpReferenceIssue,
  type ErpReferenceSourceKey,
  type InventoryAgeImportRow,
  type ProductMasterRow,
} from "@/lib/imports/erp-reference";
import {
  ensureErpReferenceSchema,
  findErpReferenceBatch,
  getErpReferenceDatabase,
  saveComboImport,
  saveInventoryAgeImport,
  saveProductMasterImport,
  type ErpReferenceImportBatch,
} from "./database";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "erp-reference.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type ErpReferenceImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: ErpReferenceImportBatch | null;
  warnings: ErpReferenceIssue[];
  errors?: ErpReferenceIssue[];
  errorCount?: number;
};

export async function importErpReferenceBytes(input: {
  source: ErpReferenceSourceKey;
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  snapshotDate?: string;
}): Promise<ErpReferenceImportExecution> {
  if (!isErpReferenceSourceKey(input.source)) {
    return {
      ok: false,
      status: "rejected",
      message: "不支持的数据来源",
      warnings: [],
      errors: [{ code: "INVALID_SOURCE", message: "source 必须为 products、inventory_age 或 combos" }],
      errorCount: 1,
    };
  }
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

  const db = getErpReferenceDatabase();
  await ensureErpReferenceSchema(db);
  const fileHash = toHex(await sha256(input.bytes));
  const previous = await findErpReferenceBatch(db, input.source, fileHash);
  if (previous?.status === "completed") {
    return {
      ok: true,
      status: "duplicate",
      message: "该文件已经导入，无需重复处理",
      batch: previous,
      warnings: previous.warnings,
    };
  }

  const snapshotDate = input.snapshotDate?.trim();
  if (input.source === "inventory_age" && !isIsoDate(snapshotDate)) {
    return {
      ok: false,
      status: "rejected",
      message: "库龄报表必须提供有效快照日期",
      warnings: [],
      errors: [{ code: "INVALID_SNAPSHOT_DATE", message: "快照日期必须为 YYYY-MM-DD" }],
      errorCount: 1,
    };
  }

  let parsed: ReturnType<typeof parseErpReferenceXlsx>;
  try {
    parsed = parseErpReferenceXlsx(input.source, input.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${ERP_REFERENCE_SOURCE_LABELS[input.source]}解析失败`;
    return {
      ok: false,
      status: "rejected",
      message,
      warnings: [],
      errors: [{ code: "XLSX_PARSE_ERROR", message }],
      errorCount: 1,
    };
  }
  if (parsed.errors.length > 0 || parsed.rows.length === 0) {
    const errors = parsed.errors.length > 0
      ? parsed.errors.slice(0, 200)
      : [{ code: "NO_DATA_ROWS", message: "工作表中没有可导入的数据行" }];
    return {
      ok: false,
      status: "rejected",
      message: "文件校验未通过，未写入任何数据",
      warnings: parsed.warnings,
      errors,
      errorCount: parsed.errors.length || 1,
    };
  }

  const id = `${input.source}:${fileHash}`;
  const fileName = safeFileName(input.fileName);
  if (input.source === "products") {
    const rows = parsed.rows as ProductMasterRow[];
    const missingNames = rows.filter((row) => !row.productName).length;
    const warnings = [
      ...parsed.warnings,
      ...(missingNames > 0 ? [{ code: "MISSING_PRODUCT_NAME", message: `${missingNames} 行缺少货品名称，已保留货品编号` }] : []),
    ];
    const batch = await saveProductMasterImport(db, {
      id,
      fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHash,
      sheetName: parsed.sheetName,
      rows,
      warnings,
      totals: parsed.totals,
    });
    return { ok: true, status: "imported", message: "货品主数据导入成功", batch, warnings };
  }

  if (input.source === "inventory_age") {
    const allRows = parsed.rows as InventoryAgeImportRow[];
    const excludedRows = allRows.filter((row) => row.warehouse.trim() === "刷刷仓");
    const rows = allRows.filter((row) => row.warehouse.trim() !== "刷刷仓");
    const warnings = [
      ...parsed.warnings,
      ...(excludedRows.length > 0
        ? [{ code: "EXCLUDED_BRUSH_WAREHOUSE", message: `已从库龄分析中排除刷刷仓 ${excludedRows.length} 行，原文件批次仍保留审计记录` }]
        : []),
    ];
    const batch = await saveInventoryAgeImport(db, {
      id,
      fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHash,
      sheetName: parsed.sheetName,
      snapshotDate: snapshotDate!,
      rows,
      excludedCount: excludedRows.length,
      warnings,
      totals: { ...parsed.totals, excludedBrushWarehouseRows: excludedRows.length },
    });
    return { ok: true, status: "imported", message: "库龄快照导入成功", batch, warnings };
  }

  const rows = parsed.rows as ComboItemImportRow[];
  const batch = await saveComboImport(db, {
    id,
    fileName,
    fileSizeBytes: input.fileSizeBytes,
    fileHash,
    sheetName: parsed.sheetName,
    rows,
    warnings: parsed.warnings,
    totals: parsed.totals,
  });
  return { ok: true, status: "imported", message: "组合装及子件导入成功", batch, warnings: parsed.warnings };
}
