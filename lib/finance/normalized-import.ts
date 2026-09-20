import type { findFinanceImportBatchByHash } from "./database";
import { parseFinanceWorkbook } from "./parser";
import type { FinanceImportIssue } from "./types";


export function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}


export function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}


export function safeFinanceFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "monthly-finance-report.xls";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}


export function isSupportedFinanceSignature(bytes: Uint8Array) {
  const isXlsx = bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isXls = bytes.length >= oleSignature.length
    && oleSignature.every((value, index) => bytes[index] === value);
  return isXlsx || isXls;
}


export function validateParsedWorkbook(parsed: ReturnType<typeof parseFinanceWorkbook>): FinanceImportIssue[] {
  const errors: FinanceImportIssue[] = [];
  if (parsed.months.length === 0) {
    errors.push({ code: "NO_FINANCE_MONTHS", message: "财报中没有可导入的月份工作表" });
  }
  for (const month of parsed.months) {
    if (!/^\d{4}-\d{2}$/.test(month.month)) {
      errors.push({ sheet: month.sheetName, month: month.month, code: "INVALID_MONTH", message: "财报月份无效" });
    }
    if (month.lines.length === 0) {
      errors.push({ sheet: month.sheetName, month: month.month, code: "EMPTY_MONTH", message: "月份工作表没有可导入数据" });
    }
    const businessSummary = month.lines.filter((line) => line.scopeType === "business" && line.section === "summary");
    if (!businessSummary.some((line) => line.metricKey === "net_sales")) {
      errors.push({ sheet: month.sheetName, month: month.month, code: "MISSING_NET_SALES", message: "经营汇总区缺少实际销售金额" });
    }
    if (!month.lines.some((line) => line.section === "kingdee" && line.subjectName === "销售费用")) {
      errors.push({ sheet: month.sheetName, month: month.month, code: "MISSING_SELLING_EXPENSE_TOTAL", message: "金蝶科目明细区缺少销售费用总额" });
    }
    if (month.lines.some((line) =>
      (line.amountCents !== null && !Number.isSafeInteger(line.amountCents))
      || (line.rateBps !== null && !Number.isSafeInteger(line.rateBps)),
    )) {
      errors.push({ sheet: month.sheetName, month: month.month, code: "UNSAFE_NUMBER", message: "财报中存在超出安全范围的金额或比率" });
    }
  }
  return errors.slice(0, 200);
}


export type FinanceImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: Awaited<ReturnType<typeof findFinanceImportBatchByHash>>;
  importedMonths?: string[];
  skippedMonths?: string[];
  warnings: FinanceImportIssue[];
  errors?: FinanceImportIssue[];
  errorCount?: number;
};


export type NormalizedFinanceImportPayload = {
  schemaVersion: "finance-normalized-v1";
  disposition: "prepared" | "rejected";
  fileName: string;
  fileSizeBytes: number;
  rawFileHash: string;
  warnings: FinanceImportIssue[];
  sourceSheetCount?: number;
  months?: ReturnType<typeof parseFinanceWorkbook>["months"];
  errors?: FinanceImportIssue[];
  message?: string;
};


/**
 * Parse and validate at the Worker boundary without touching a database. The
 * Django writer independently validates every field and recomputes the content
 * fingerprint before it can publish facts.
 */
export async function prepareNormalizedFinanceImport(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
}): Promise<NormalizedFinanceImportPayload> {
  const rawFileHash = toHex(await sha256(input.bytes));
  const base = {
    schemaVersion: "finance-normalized-v1" as const,
    fileName: safeFinanceFileName(input.fileName),
    fileSizeBytes: input.fileSizeBytes,
    rawFileHash,
  };
  if (!isSupportedFinanceSignature(input.bytes)) {
    const issue = { code: "INVALID_EXCEL_SIGNATURE", message: "文件签名不是有效的 .xls 或 .xlsx 格式" };
    return {
      ...base,
      disposition: "rejected",
      warnings: [],
      errors: [issue],
      message: issue.message,
    };
  }
  let parsed: ReturnType<typeof parseFinanceWorkbook>;
  try {
    parsed = parseFinanceWorkbook(input.bytes);
  } catch {
    const message = "月度财报解析失败，请确认文件格式和模板";
    return {
      ...base,
      disposition: "rejected",
      warnings: [],
      errors: [{ code: "FINANCE_PARSE_ERROR", message }],
      message,
    };
  }
  const errors = validateParsedWorkbook(parsed);
  if (errors.length > 0) {
    return {
      ...base,
      disposition: "rejected",
      warnings: parsed.warnings,
      errors,
      message: "财报结构校验未通过，未写入任何月份数据",
    };
  }
  return {
    ...base,
    disposition: "prepared",
    warnings: parsed.warnings,
    sourceSheetCount: parsed.sourceSheetCount,
    months: parsed.months,
  };
}
