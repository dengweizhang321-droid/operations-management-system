import { strFromU8, unzipSync } from "fflate";

import {
  parseXlsxFirstSheet,
  type XlsxCellValue,
} from "@/lib/imports/xlsx";
import {
  ensureNetshopSchema,
  findNetshopImportBatchByHash,
  getNetshopDatabase,
  normalizeJdProductMasterRows,
  sanitizeNetshopIssues,
  saveNetshopImport,
  type NetshopImportBatch,
  type NetshopImportIssue,
  type NetshopRowInput,
  type NetshopSource,
} from "@/lib/netshop/database";
import { netshopMasterRowKey } from "@/lib/netshop/batch-identity";
import { dailyDateCoverage, dailyRowKey, detectJdDailyDataset } from "@/lib/netshop/daily-contract";

const DEFAULT_PLATFORM = "京东";
const DEFAULT_SHOP_NAME = "志高商用设备旗舰店";

const sourceSet = new Set<NetshopSource>([
  "jd_shop_overview",
  "jd_sku_daily",
  "jd_promotion",
  "jd_b2b",
  "jd_product_master",
  "jd_cs",
  "jd_yimei_sku",
  "inv_selfop",
]);

export type NetshopImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: NetshopImportBatch | null;
  warnings: NetshopImportIssue[];
  errors?: NetshopImportIssue[];
  errorCount?: number;
};

type TabularRow = {
  rowNumber: number;
  values: Array<string | number | boolean | null>;
};

type ParsedTable = {
  sheetName: string;
  rows: TabularRow[];
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "netshop-import";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function isXlsx(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function normalizeSource(value: FormDataEntryValue | null): NetshopSource | null {
  if (typeof value !== "string") return null;
  const source = value.trim() as NetshopSource;
  return sourceSet.has(source) ? source : null;
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value).replace(/\uFEFF/g, "");
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s_\-（）()【】[\]：:./\\]/g, "");
}

function parseCsv(text: string): TabularRow[] {
  const rows: TabularRow[] = [];
  let current = "";
  let record: Array<string | null> = [];
  let rowNumber = 1;
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (char === "," || char === "\t")) {
      record.push(current);
      current = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(current);
      if (record.some((cell) => normalizeText(cell))) rows.push({ rowNumber, values: record });
      rowNumber += 1;
      record = [];
      current = "";
      continue;
    }
    current += char;
  }

  if (current || record.length) {
    record.push(current);
    if (record.some((cell) => normalizeText(cell))) rows.push({ rowNumber, values: record });
  }
  return rows;
}

function decodeText(bytes: Uint8Array) {
  const utf8 = strFromU8(bytes);
  const replacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  if (replacementCount <= 3) return utf8;
  try {
    return new TextDecoder("gb18030").decode(bytes);
  } catch {
    return utf8;
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function parseXlsx(bytes: Uint8Array): ParsedTable {
  const sheet = parseXlsxFirstSheet(bytes);
  return {
    sheetName: sheet.sheetName,
    rows: sheet.rows.map((row) => ({
      rowNumber: row.rowNumber,
      values: row.cells.map(cellValue),
    })),
  };
}

function cellValue(cell: XlsxCellValue) {
  if (typeof cell !== "number") return cell;
  if (!Number.isFinite(cell)) return null;
  return cell;
}

function parseZip(bytes: Uint8Array, fileName: string): ParsedTable {
  const zip = unzipSync(bytes);
  const entry = Object.entries(zip).find(([name]) => /\.(xlsx|csv)$/i.test(name));
  if (!entry) {
    throw new Error(`${fileName} 压缩包内没有可识别的 .xlsx 或 .csv 文件`);
  }
  const [innerName, innerBytes] = entry;
  return parseFile(innerBytes, innerName);
}

function parseFile(bytes: Uint8Array, fileName: string): ParsedTable {
  if (/\.zip$/i.test(fileName)) return parseZip(bytes, fileName);
  if (isXlsx(bytes) || /\.xlsx$/i.test(fileName)) return parseXlsx(bytes);
  const text = decodeText(bytes);
  if (/\.csv$/i.test(fileName)) return { sheetName: "csv", rows: parseCsv(text) };
  if (/\.xls$/i.test(fileName)) {
    const rows = parseCsv(/<table|<tr|<td|<th/i.test(text) ? stripHtml(text) : text);
    if (rows.length > 0) return { sheetName: "xls-text", rows };
  }
  throw new Error(`暂不支持该文件格式：${fileName}`);
}

function looksLikeHeader(values: readonly unknown[]) {
  const nonEmpty = values.map(normalizeHeader).filter(Boolean);
  if (nonEmpty.length < 2) return false;
  const joined = nonEmpty.join("|");
  return /日期|时间|SKU|SPU|商品|订单|会话|访客|库存|仓|金额|展现|点击|费用|销售|浏览|成交|编码|名称/i.test(joined);
}

function findHeader(table: ParsedTable) {
  const index = table.rows.findIndex((row) => looksLikeHeader(row.values));
  if (index < 0) throw new Error("没有识别到表头行");
  const headers = table.rows[index].values.map((value, cellIndex) => normalizeHeader(value) || `列${cellIndex + 1}`);
  return { index, headers };
}

function objectFromRow(headers: string[], values: readonly unknown[]) {
  const row: Record<string, string | number | boolean | null> = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const value = values[index] ?? null;
    if (value === null || value === "") row[header] = null;
    else row[header] = typeof value === "string" ? normalizeText(value) : value as number | boolean;
  }
  return row;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeText(value).replace(/[,￥¥%]/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function excelDateToIso(serial: number, date1904 = false) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 100000) return null;
  const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
  const date = new Date(epoch + Math.trunc(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function isoDateFromValue(value: unknown) {
  if (typeof value === "number") return excelDateToIso(value);
  const text = normalizeText(value);
  if (!text) return "";
  const compact = /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(text);
  const separated = /(?:^|\D)(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\D|$)/.exec(text);
  const match = compact ?? separated;
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fileDate(fileName: string) {
  return isoDateFromValue(fileName);
}

function findValue(row: Record<string, unknown>, patterns: RegExp[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    if (patterns.some((pattern) => pattern.test(key) || pattern.test(normalized))) return value;
  }
  return null;
}

function firstDate(row: Record<string, unknown>) {
  const direct = findValue(row, [/日期/, /时间/, /date/i, /day/i]);
  const date = isoDateFromValue(direct);
  if (date) return date;
  for (const value of Object.values(row)) {
    const fallback = isoDateFromValue(value);
    if (fallback) return fallback;
  }
  return "";
}

function isDailyAggregateRow(source: NetshopSource, row: Record<string, unknown>) {
  if (source !== "jd_sku_daily") return false;
  return normalizeText(findValue(row, [/^sku$/i, /^spu$/i])) === "合计";
}

export function detectDataset(source: NetshopSource, fileName: string, headers: readonly string[]) {
  const haystack = `${fileName} ${headers.join(" ")}`;
  if (source === "jd_shop_overview") return "trade_overview";
  if (source === "jd_promotion") return "ad";
  if (source === "jd_b2b") return "b2b";
  if (source === "jd_product_master") return "product_master";
  if (source === "jd_yimei_sku") return "yimei_sku";
  if (source === "inv_selfop") return "inv_selfop";
  if (source === "jd_cs") {
    if (/suggest|推荐订单/i.test(haystack)) return "cs_suggest";
    if (/促成订单|订单编号|下单时间/i.test(haystack)) return "cs_order";
    if (/会话|咨询|接待|聊天|客服/i.test(haystack)) return "cs_chat";
    return "cs";
  }
  if (source === "jd_sku_daily") {
    return detectJdDailyDataset(headers);
  }
  return source;
}

function warehouseType(fileName: string, row: Record<string, unknown>) {
  const text = `${fileName} ${Object.values(row).map(normalizeText).join(" ")}`;
  if (/配送中心/.test(text)) return "配送中心";
  if (/\bRDC\b/i.test(text)) return "RDC";
  return "";
}

function usesSnapshotDate(source: NetshopSource) {
  return source === "inv_selfop" || source === "jd_product_master";
}

function metricsFromRow(row: Record<string, string | number | boolean | null>) {
  const metrics: Record<string, number | string | null> = {};
  for (const [key, value] of Object.entries(row)) {
    const numeric = numberFromUnknown(value);
    if (numeric !== null) metrics[key] = numeric;
    else if (typeof value === "string" && value.length <= 80) metrics[key] = value;
  }
  return metrics;
}

async function hashText(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function validateRows(rows: readonly NetshopRowInput[]) {
  const errors: NetshopImportIssue[] = [];
  if (rows.length === 0) errors.push({ code: "NO_DATA_ROWS", message: "文件没有可导入的数据行" });
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.sourceRowKey) errors.push({ row: row.sourceRowNumber, code: "MISSING_ROW_KEY", message: "缺少行唯一标识" });
    else if (keys.has(row.sourceRowKey)) errors.push({ row: row.sourceRowNumber, code: "DUPLICATE_ROW_KEY", message: "文件内存在重复行" });
    else keys.add(row.sourceRowKey);
    if (!row.dataset) errors.push({ row: row.sourceRowNumber, code: "MISSING_DATASET", message: "未识别数据集" });
    if ((row.dataset === "sku_daily" || row.dataset === "spu_daily") && !row.businessDate) {
      errors.push({ row: row.sourceRowNumber, field: "时间", code: "MISSING_BUSINESS_DATE", message: "分天数据缺少有效日期" });
    }
    if (row.dataset === "sku_daily" && !row.skuId) errors.push({ row: row.sourceRowNumber, field: "SKU", code: "MISSING_SKU_ID", message: "SKU 分天数据缺少 SKU" });
    if (row.dataset === "spu_daily" && !row.spuId) errors.push({ row: row.sourceRowNumber, field: "SPU", code: "MISSING_SPU_ID", message: "SPU 分天数据缺少 SPU" });
    if (errors.length >= 200) break;
  }
  return errors;
}

export async function importNetshopBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  source: NetshopSource;
  platform?: string;
  shopName?: string;
  note?: string;
  snapshotDate?: string;
  expectedDataset?: "sku_daily" | "spu_daily";
  expectedStartDate?: string;
  expectedEndDate?: string;
}): Promise<NetshopImportExecution> {
  const fileHash = toHex(await sha256(input.bytes));
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);

  let parsed: ParsedTable;
  try {
    parsed = parseFile(input.bytes, input.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "PARSE_ERROR", message }], errorCount: 1 };
  }

  let header: ReturnType<typeof findHeader>;
  try {
    header = findHeader(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "表头识别失败";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "HEADER_NOT_FOUND", message }], errorCount: 1 };
  }

  let dataset: string;
  try {
    dataset = detectDataset(input.source, input.fileName, header.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据集识别失败";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "DATASET_HEADER_MISMATCH", message }], errorCount: 1 };
  }
  if (input.source === "jd_sku_daily" && input.expectedDataset && input.expectedDataset !== dataset) {
    const message = `上传文件数据集为 ${dataset}，与预期 ${input.expectedDataset} 不一致`;
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "EXPECTED_DATASET_MISMATCH", message }], errorCount: 1 };
  }
  const platform = normalizeText(input.platform) || DEFAULT_PLATFORM;
  const shopName = normalizeText(input.shopName) || DEFAULT_SHOP_NAME;
  const previous = await findNetshopImportBatchByHash(db, input.source, fileHash, { platform, shopName });
  const snapshotDate = isoDateFromValue(input.snapshotDate) || fileDate(input.fileName) || "";
  const snapshotSource = usesSnapshotDate(input.source);
  const rawRows = parsed.rows.slice(header.index + 1)
    .map((row) => ({ rowNumber: row.rowNumber, raw: objectFromRow(header.headers, row.values) }))
    .filter((row) => Object.values(row.raw).some((value) => normalizeText(value)))
    .filter((row) => !isDailyAggregateRow(input.source, row.raw));

  const rows: NetshopRowInput[] = [];
  for (const row of rawRows) {
    // 商品 SKU 导出中的“创建时间”属于商品主数据，不是经营发生日期。
    // 将它当作业务日期会把商品目录错误地混入日度经营口径。
    const businessDate = input.source === "jd_product_master" ? "" : firstDate(row.raw);
    const productCode = input.source === "jd_product_master"
      ? normalizeText(row.raw["商品编码"])
      : normalizeText(findValue(row.raw, [/货品编号/, /商品编码/, /商品编号/, /商品ID/i, /^sku$/i, /skuid/i]));
    const skuId = normalizeText(findValue(row.raw, [/^sku$/i, /sku.?id/i, /skuid/i, /SKU编码/i]));
    const spuId = input.source === "jd_product_master"
      ? productCode
      : normalizeText(findValue(row.raw, [/^spu$/i, /spu.?id/i, /spuid/i, /SPU编码/i]));
    const productName = normalizeText(findValue(row.raw, [/商品名称/, /货品名称/, /产品名称/, /名称/]));
    const rawJson = JSON.stringify(row.raw);
    const rowHash = await hashText(rawJson);
    rows.push({
      sourceRowNumber: row.rowNumber,
      sourceRowKey: dataset === "sku_daily" || dataset === "spu_daily"
        ? dailyRowKey(dataset, platform, shopName, businessDate, dataset === "sku_daily" ? skuId : spuId)
        : netshopMasterRowKey({ source: input.source, platform, shopName, fileHash, rowNumber: row.rowNumber, rowHash }),
      sourceRowHash: rowHash,
      source: input.source,
      dataset,
      platform,
      shopName,
      businessDate,
      snapshotDate: snapshotSource ? snapshotDate : "",
      productCode,
      productName,
      skuId,
      spuId,
      warehouseType: input.source === "inv_selfop" ? warehouseType(input.fileName, row.raw) : "",
      metrics: metricsFromRow(row.raw),
      raw: row.raw,
    });
  }

  const errors = validateRows(rows);
  if (input.source === "jd_sku_daily") {
    const coverage = dailyDateCoverage(input.expectedStartDate, input.expectedEndDate, rows.map((row) => row.businessDate));
    if (!coverage.validRange) {
      errors.push({ code: "MISSING_EXPECTED_DATE_RANGE", message: "商智分天导入必须提供有效的目标起止日期" });
    } else {
      if (coverage.missingDates.length) errors.push({ code: "MISSING_EXPECTED_DATES", message: `目标区间缺少日期：${coverage.missingDates.join(", ")}` });
      if (coverage.outOfRangeDates.length) errors.push({ code: "OUT_OF_RANGE_DATES", message: `文件包含目标区间外日期：${coverage.outOfRangeDates.join(", ")}` });
    }
  }
  if (errors.length > 0) {
    return { ok: false, status: "rejected", message: "文件校验未通过，未写入数据", warnings: [], errors, errorCount: errors.length };
  }

  // A file imported before these guards existed must not bypass the new
  // schema and date-coverage validation merely because its hash is known.
  if (previous?.status === "completed") {
    if (input.source === "jd_product_master") await normalizeJdProductMasterRows(db, previous.id);
    return { ok: true, status: "duplicate", message: "该文件已经导入，无需重复处理", batch: previous, warnings: previous.warnings };
  }

  const missingDateRows = rows.filter((row) => !row.businessDate && !snapshotSource).length;
  const missingSnapshotRows = rows.filter((row) => snapshotSource && !row.snapshotDate).length;
  const warnings = sanitizeNetshopIssues([
    ...(missingDateRows > 0 ? [{ code: "MISSING_BUSINESS_DATE", message: `${missingDateRows} 行未识别到业务日期，overview 不会把这些行计入 date_max` }] : []),
    ...(missingSnapshotRows > 0 ? [{ code: "MISSING_SNAPSHOT_DATE", message: `${missingSnapshotRows} 行未识别到快照日期，请在上传时传 snapshot_date=YYYY-MM-DD` }] : []),
  ]);

  const dateValues = rows.map((row) => row.businessDate).filter(Boolean);
  const result = await saveNetshopImport(db, {
    source: input.source,
    dataset,
    platform,
    shopName,
    fileHash,
    fileName: safeFileName(input.fileName),
    fileSizeBytes: input.fileSizeBytes,
    sheetName: parsed.sheetName,
    rows,
    warnings,
    totals: {
      sourceRowCount: rawRows.length,
      rowCount: rows.length,
      dataset,
      dateMin: dateValues.sort()[0] ?? null,
      dateMax: dateValues.sort()[dateValues.length - 1] ?? null,
    },
    note: normalizeText(input.note),
  });

  if (input.source === "jd_product_master") await normalizeJdProductMasterRows(db, result.batch.id);

  return {
    ok: true,
    status: result.created ? "imported" : "duplicate",
    message: result.created ? "京东网店数据导入成功" : "该文件已经导入，无需重复处理",
    batch: result.batch,
    warnings,
  };
}

export function readNetshopForm(formData: FormData) {
  const source = normalizeSource(formData.get("source"));
  const file = formData.get("file");
  return {
    source,
    file,
    platform: typeof formData.get("platform") === "string" ? String(formData.get("platform")) : undefined,
    shopName: typeof formData.get("shop_name") === "string"
      ? String(formData.get("shop_name"))
      : typeof formData.get("shopName") === "string"
        ? String(formData.get("shopName"))
        : undefined,
    note: typeof formData.get("note") === "string" ? String(formData.get("note")) : undefined,
    snapshotDate: typeof formData.get("snapshot_date") === "string"
      ? String(formData.get("snapshot_date"))
      : typeof formData.get("snapshotDate") === "string"
        ? String(formData.get("snapshotDate"))
        : undefined,
    expectedDataset: (formData.get("expected_dataset") ?? formData.get("expectedDataset")) === "sku_daily"
      ? "sku_daily"
      : (formData.get("expected_dataset") ?? formData.get("expectedDataset")) === "spu_daily"
        ? "spu_daily"
        : undefined,
    expectedStartDate: typeof (formData.get("expected_start_date") ?? formData.get("expectedStartDate")) === "string"
      ? String(formData.get("expected_start_date") ?? formData.get("expectedStartDate"))
      : undefined,
    expectedEndDate: typeof (formData.get("expected_end_date") ?? formData.get("expectedEndDate")) === "string"
      ? String(formData.get("expected_end_date") ?? formData.get("expectedEndDate"))
      : undefined,
  };
}
