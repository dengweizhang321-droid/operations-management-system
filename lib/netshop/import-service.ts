import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

import {
  parseXlsxFirstSheet,
  type XlsxCellValue,
} from "@/lib/imports/xlsx";
import type {
  NetshopImportBatch,
  NetshopImportIssue,
  NetshopRowInput,
  NetshopSource,
} from "@/lib/netshop/database";
import { netshopMasterRowKey } from "@/lib/netshop/batch-identity";
import { dailyDateCoverage, dailyRowKey, detectJdDailyDataset } from "@/lib/netshop/daily-contract";
import { resolveEnabledTmallShop } from "@/lib/netshop/tmall-store-catalog";

const DEFAULT_PLATFORM = "京东";
const DEFAULT_SHOP_NAME = "志高商用设备旗舰店";
export const TMALL_PLATFORM = "天猫";
export const TMALL_YIJIU_SHOP = "天猫-志高亿玖专卖店";
const MAX_TABULAR_ROWS = 50_000;
const MAX_TABULAR_COLUMNS = 120;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 25 * 1024 * 1024;

const sourceSet = new Set<NetshopSource>([
  "jd_shop_overview",
  "jd_sku_daily",
  "jd_promotion",
  "jd_b2b",
  "jd_product_master",
  "jd_cs",
  "jd_yimei_sku",
  "tmall_product_master",
  "tmall_product_daily",
  "tmall_promotion",
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
  verification?: {
    verified: boolean;
    parsedRowCount: number;
    readbackRowCount: number;
    dateMin: string | null;
    dateMax: string | null;
    dataset: string;
    platform: string;
    shopName: string;
    unmatchedProductCount: number;
  };
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error(`文本既不是有效 UTF-8，也无法按 GB18030 解码：${error instanceof Error ? error.message : "编码错误"}`);
    }
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
  const sheet = parseXlsxFirstSheet(bytes, {
    maxCompressedBytes: 25 * 1024 * 1024,
    maxUncompressedBytes: 100 * 1024 * 1024,
    maxWorksheetBytes: 75 * 1024 * 1024,
    maxRows: MAX_TABULAR_ROWS + 10,
  });
  if (sheet.maxColumns > MAX_TABULAR_COLUMNS) throw new Error(`表格超过 ${MAX_TABULAR_COLUMNS} 列上限`);
  return {
    sheetName: sheet.sheetName,
    rows: sheet.rows.map((row) => ({
      rowNumber: row.rowNumber,
      values: row.cells.map(cellValue),
    })),
  };
}

function parseLegacyXls(bytes: Uint8Array): ParsedTable {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellText: false,
      dense: true,
      sheetRows: MAX_TABULAR_ROWS + 10,
    });
  } catch (error) {
    throw new Error(`二进制 XLS 解析失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
  if (workbook.SheetNames.length !== 1) throw new Error("生意参谋 XLS 必须且只能包含一个工作表");
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (matrix.length > MAX_TABULAR_ROWS + 5) throw new Error(`表格超过 ${MAX_TABULAR_ROWS} 行上限`);
  const rows = matrix.map((values, index) => {
    if (values.length > MAX_TABULAR_COLUMNS) throw new Error(`第 ${index + 1} 行超过 ${MAX_TABULAR_COLUMNS} 列上限`);
    return { rowNumber: index + 1, values };
  });
  return { sheetName, rows };
}

function cellValue(cell: XlsxCellValue) {
  if (typeof cell !== "number") return cell;
  if (!Number.isFinite(cell)) return null;
  return cell;
}

function parseZip(bytes: Uint8Array, fileName: string, source: NetshopSource): ParsedTable {
  const archiveEntries: string[] = [];
  const zip = unzipSync(bytes, { filter(file) {
    if (file.name.endsWith("/")) return false;
    archiveEntries.push(file.name);
    if (file.originalSize > MAX_UNCOMPRESSED_ENTRY_BYTES) throw new Error("压缩包内文件解压后超过 25MB 上限");
    return /\.(xlsx|csv)$/i.test(file.name);
  } });
  const entries = Object.entries(zip).filter(([name]) => !name.endsWith("/") && /\.(xlsx|csv)$/i.test(name));
  if (source === "tmall_promotion" && (archiveEntries.length !== 1 || entries.length !== 1 || !/\.csv$/i.test(entries[0]?.[0] ?? ""))) {
    throw new Error("天猫推广 ZIP 必须且只能包含一个 CSV 文件");
  }
  if (entries.length !== 1) {
    throw new Error(`${fileName} 压缩包内没有可识别的 .xlsx 或 .csv 文件`);
  }
  const [innerName, innerBytes] = entries[0];
  return parseFile(innerBytes, innerName, source);
}

function parseFile(bytes: Uint8Array, fileName: string, source: NetshopSource): ParsedTable {
  if (/\.zip$/i.test(fileName)) return parseZip(bytes, fileName, source);
  if (isXlsx(bytes) || /\.xlsx$/i.test(fileName)) return parseXlsx(bytes);
  if (/\.xls$/i.test(fileName) && source === "tmall_product_daily") return parseLegacyXls(bytes);
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

function normalizedTmallValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  const text = normalizeText(value);
  return !text || text === "-" || text.toLowerCase() === "nan" ? null : text;
}

function tmallObjectFromRow(headers: readonly string[], values: readonly unknown[]) {
  return Object.fromEntries(headers.map((header, index) => [header, normalizedTmallValue(values[index])])) as Record<string, string | number | boolean | null>;
}

const tmallMasterHeaders = [
  "商品ID", "类目ID", "类目名称", "商品标题", "一口价", "导购标题", "商品商家编码", "商品发货时间",
  "最长发货时间", "销售属性", "属性对", "SKU发货时间", "SKUID", "SKU价格", "SKU库存", "SKU商家编码",
  "生产日期", "保质期",
] as const;

function findTmallHeader(source: NetshopSource, table: ParsedTable) {
  if (source === "tmall_product_master") {
    if (table.sheetName !== "发布模板") throw new Error("天猫货品文件首个工作表必须为“发布模板”");
    const index = table.rows.findIndex((row) => normalizeHeader(row.values[0]) === "商品Id" && normalizeHeader(row.values[12]) === "skuId");
    if (index < 0) throw new Error("天猫货品文件缺少商品Id/SKU 表头");
    return { index, headers: [...tmallMasterHeaders] };
  }
  if (source === "tmall_product_daily") {
    const index = table.rows.findIndex((row) => normalizeHeader(row.values[0]) === "统计日期" && normalizeHeader(row.values[1]) === "商品ID" && row.values.map(normalizeHeader).includes("支付金额"));
    if (index < 0) throw new Error("生意参谋商品文件缺少统计日期、商品ID或支付金额表头");
    return { index, headers: table.rows[index].values.map((value, cellIndex) => normalizeHeader(value) || `列${cellIndex + 1}`) };
  }
  if (source === "tmall_promotion") {
    const index = table.rows.findIndex((row) => normalizeHeader(row.values[0]) === "日期" && normalizeHeader(row.values[1]) === "主体ID" && row.values.map(normalizeHeader).includes("花费"));
    if (index < 0) throw new Error("天猫推广文件缺少日期、主体ID或花费表头");
    return { index, headers: table.rows[index].values.map((value, cellIndex) => normalizeHeader(value) || `列${cellIndex + 1}`) };
  }
  return findHeader(table);
}

function tmallRowObject(source: NetshopSource, headers: readonly string[], values: readonly unknown[]) {
  const raw = tmallObjectFromRow(headers, values);
  if (source === "tmall_product_master") {
    raw["商品名称"] = raw["商品标题"];
    raw["商品编码"] = raw["商品商家编码"];
    raw["商家SKU"] = raw["SKU商家编码"];
    raw["商品总库存"] = raw["SKU库存"];
    raw["商品可用库存"] = raw["SKU库存"];
  }
  return raw;
}

function moneyCents(value: unknown) {
  const numeric = numberFromUnknown(value);
  return numeric === null ? null : Math.round(numeric * 100);
}

function rateFromUnknown(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = normalizeText(value);
  const numeric = numberFromUnknown(value);
  if (numeric === null) return null;
  return text.includes("%") ? numeric / 100 : numeric;
}

function tmallMetrics(source: NetshopSource, raw: Record<string, string | number | boolean | null>): Record<string, number | string | null> {
  if (source === "tmall_product_master") {
    return {
      itemPriceCents: moneyCents(raw["一口价"]),
      skuPriceCents: moneyCents(raw["SKU价格"]),
      inventoryQuantity: numberFromUnknown(raw["SKU库存"]),
    };
  }
  if (source === "tmall_product_daily") {
    return {
      pageViews: numberFromUnknown(raw["商品浏览量"]),
      visitors: numberFromUnknown(raw["商品访客数"]),
      averageStaySeconds: numberFromUnknown(raw["平均停留时长"]),
      bounceRate: rateFromUnknown(raw["商品详情页跳出率"]),
      favorites: numberFromUnknown(raw["商品收藏人数"]),
      addCartQuantity: numberFromUnknown(raw["商品加购件数"]),
      addCartCustomers: numberFromUnknown(raw["商品加购人数"]),
      orderCustomers: numberFromUnknown(raw["下单买家数"]),
      orderQuantity: numberFromUnknown(raw["下单件数"]),
      orderAmountCents: moneyCents(raw["下单金额"]),
      orderConversionRate: rateFromUnknown(raw["下单转化率"]),
      transactionCustomers: numberFromUnknown(raw["支付买家数"]),
      transactionQuantity: numberFromUnknown(raw["支付件数"]),
      transactionAmountCents: moneyCents(raw["支付金额"]),
      conversionRate: rateFromUnknown(raw["商品支付转化率"]),
      newTransactionCustomers: numberFromUnknown(raw["支付新买家数"]),
      repeatTransactionCustomers: numberFromUnknown(raw["支付老买家数"]),
      repeatTransactionAmountCents: moneyCents(raw["老买家支付金额"]),
      juhuasuanTransactionAmountCents: moneyCents(raw["聚划算支付金额"]),
      uvValueCents: moneyCents(raw["访客平均价值"]),
      refundAmountCents: moneyCents(raw["成功退款金额"]),
      yearTransactionAmountCents: moneyCents(raw["年累计支付金额"]),
      monthTransactionAmountCents: moneyCents(raw["月累计支付金额"]),
      monthTransactionQuantity: numberFromUnknown(raw["月累计支付件数"]),
      searchConversionRate: rateFromUnknown(raw["搜索引导支付转化率"]),
      searchVisitors: numberFromUnknown(raw["搜索引导访客数"]),
      searchTransactionCustomers: numberFromUnknown(raw["搜索引导支付买家数"]),
    };
  }
  return {
    spendCents: moneyCents(raw["花费"]),
    netTransactionAmountCents: moneyCents(raw["净成交金额"]),
    grossTransactionAmountCents: moneyCents(raw["总成交金额"]),
    reportedNetRoas: numberFromUnknown(raw["净实际投产比"]),
    reportedGrossRoas: numberFromUnknown(raw["实际投产比"]),
    impressions: numberFromUnknown(raw["展现量"]),
    clicks: numberFromUnknown(raw["点击量"]),
    clickThroughRate: rateFromUnknown(raw["点击率"]),
    averageClickCostCents: moneyCents(raw["平均点击花费"]),
    cpmCents: moneyCents(raw["千次展现花费"]),
    netOrders: numberFromUnknown(raw["净成交笔数"]),
    grossOrders: numberFromUnknown(raw["总成交笔数"]),
    clickConversionRate: rateFromUnknown(raw["点击转化率"]),
    directNetTransactionAmountCents: moneyCents(raw["直接净成交金额"]),
    directNetOrders: numberFromUnknown(raw["直接净成交笔数"]),
    cartQuantity: numberFromUnknown(raw["总购物车数"]),
    directCartQuantity: numberFromUnknown(raw["直接购物车数"]),
    favorites: numberFromUnknown(raw["收藏宝贝数"]),
    directFavorites: numberFromUnknown(raw["直接收藏宝贝数"]),
    favoriteAndCartQuantity: numberFromUnknown(raw["宝贝收藏加购数"]),
  };
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
  if (typeof value === "number") return excelDateToIso(value) ?? "";
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
  if (source === "tmall_product_master") return "product_master";
  if (source === "tmall_product_daily") return "spu_daily";
  if (source === "tmall_promotion") return "promotion_daily";
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
  return source === "inv_selfop" || source === "jd_product_master" || source === "tmall_product_master";
}

function isTmallSource(source: NetshopSource) {
  return source === "tmall_product_master" || source === "tmall_product_daily" || source === "tmall_promotion";
}

function tmallMasterRowKey(input: {
  dataset: string;
  platform: string;
  shopName: string;
  snapshotDate: string;
  spuId: string;
  skuId: string;
  saleAttribute: string;
  rowNumber: number;
}) {
  const dimension = input.skuId || `${input.saleAttribute}|row:${input.rowNumber}`;
  return JSON.stringify([input.dataset, input.platform, input.shopName, input.snapshotDate, input.spuId, dimension]);
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
    if ((row.dataset === "sku_daily" || row.dataset === "spu_daily" || row.dataset === "promotion_daily") && !row.businessDate) {
      errors.push({ row: row.sourceRowNumber, field: "时间", code: "MISSING_BUSINESS_DATE", message: "分天数据缺少有效日期" });
    }
    if (row.dataset === "sku_daily" && !row.skuId) errors.push({ row: row.sourceRowNumber, field: "SKU", code: "MISSING_SKU_ID", message: "SKU 分天数据缺少 SKU" });
    if (row.dataset === "spu_daily" && !row.spuId) errors.push({ row: row.sourceRowNumber, field: "SPU", code: "MISSING_SPU_ID", message: "SPU 分天数据缺少 SPU" });
    if (row.dataset === "promotion_daily" && !row.spuId) errors.push({ row: row.sourceRowNumber, field: "主体ID", code: "MISSING_SUBJECT_ID", message: "推广分天数据缺少主体ID" });
    if (errors.length >= 200) break;
  }
  return errors;
}

type NetshopImportInput = {
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
};

function buildNetshopRows(input: NetshopImportInput, context: {
  parsed: ParsedTable;
  header: ReturnType<typeof findHeader>;
  dataset: string;
  platform: string;
  shopName: string;
  fileHash: string;
  snapshotDate: string;
}) {
  const snapshotSource = usesSnapshotDate(input.source);
  const rawRows = context.parsed.rows.slice(context.header.index + 1)
    .map((row) => ({
      rowNumber: row.rowNumber,
      raw: isTmallSource(input.source)
        ? tmallRowObject(input.source, context.header.headers, row.values)
        : objectFromRow(context.header.headers, row.values),
    }))
    .filter((row) => Object.values(row.raw).some((value) => normalizeText(value)))
    .filter((row) => !isDailyAggregateRow(input.source, row.raw));
  if (rawRows.length > MAX_TABULAR_ROWS) throw new Error(`单次最多导入 ${MAX_TABULAR_ROWS} 行`);

  const rows: NetshopRowInput[] = [];
  return (async () => {
    for (const row of rawRows) {
      const isProductMaster = input.source === "jd_product_master" || input.source === "tmall_product_master";
      const businessDate = isProductMaster ? "" : firstDate(row.raw);
      const tmallSpuId = input.source === "tmall_product_master"
        ? normalizeText(row.raw["商品ID"])
        : input.source === "tmall_product_daily"
          ? normalizeText(row.raw["商品ID"])
          : input.source === "tmall_promotion"
            ? normalizeText(row.raw["主体ID"])
            : "";
      const productCode = input.source === "tmall_product_master"
        ? normalizeText(row.raw["SKU商家编码"] ?? row.raw["商品商家编码"])
        : input.source === "tmall_product_daily"
          ? normalizeText(row.raw["货号"])
          : input.source === "jd_product_master"
            ? normalizeText(row.raw["商品编码"])
            : normalizeText(findValue(row.raw, [/货品编号/, /商品编码/, /商品编号/, /商品ID/i, /^sku$/i, /skuid/i]));
      const skuId = input.source === "tmall_product_master"
        ? normalizeText(row.raw["SKUID"])
        : normalizeText(findValue(row.raw, [/^sku$/i, /sku.?id/i, /skuid/i, /SKU编码/i]));
      const spuId = tmallSpuId || (input.source === "jd_product_master"
        ? productCode
        : normalizeText(findValue(row.raw, [/^spu$/i, /spu.?id/i, /spuid/i, /SPU编码/i])));
      const productName = input.source === "tmall_product_master"
        ? normalizeText(row.raw["商品标题"])
        : input.source === "tmall_promotion"
          ? normalizeText(row.raw["主体名称"])
          : normalizeText(findValue(row.raw, [/商品名称/, /货品名称/, /产品名称/, /名称/]));
      const rawJson = JSON.stringify(row.raw);
      const rowHash = await hashText(rawJson);
      const sourceRowKey = input.source === "tmall_product_master"
        ? tmallMasterRowKey({
            dataset: context.dataset,
            platform: context.platform,
            shopName: context.shopName,
            snapshotDate: context.snapshotDate,
            spuId,
            skuId,
            saleAttribute: normalizeText(row.raw["销售属性"]),
            rowNumber: row.rowNumber,
          })
        : context.dataset === "sku_daily" || context.dataset === "spu_daily" || context.dataset === "promotion_daily"
          ? dailyRowKey(context.dataset, context.platform, context.shopName, businessDate, context.dataset === "sku_daily" ? skuId : spuId)
          : netshopMasterRowKey({ source: input.source, platform: context.platform, shopName: context.shopName, fileHash: context.fileHash, rowNumber: row.rowNumber, rowHash });
      rows.push({
        sourceRowNumber: row.rowNumber,
        sourceRowKey,
        sourceRowHash: rowHash,
        source: input.source,
        dataset: context.dataset,
        platform: context.platform,
        shopName: context.shopName,
        businessDate,
        snapshotDate: snapshotSource ? context.snapshotDate : "",
        productCode,
        productName,
        skuId,
        spuId,
        warehouseType: input.source === "inv_selfop" ? warehouseType(input.fileName, row.raw) : "",
        metrics: isTmallSource(input.source) ? tmallMetrics(input.source, row.raw) : metricsFromRow(row.raw),
        raw: row.raw,
      });
    }
    return { rawRows, rows, snapshotSource };
  })();
}

export async function inspectTmallImportBytes(input: NetshopImportInput) {
  if (!isTmallSource(input.source)) throw new Error("样本检查器仅接受天猫三类来源");
  if (input.source === "tmall_product_master" && !/\.xlsx$/i.test(input.fileName)) throw new Error("天猫货品主数据只接受 .xlsx 文件");
  if (input.source === "tmall_product_daily" && !/\.xls$/i.test(input.fileName)) throw new Error("生意参谋商品日数据只接受二进制 .xls 文件");
  if (input.source === "tmall_promotion" && !/\.zip$/i.test(input.fileName)) throw new Error("天猫推广数据只接受包含单个 CSV 的 .zip 文件");
  const parsed = parseFile(input.bytes, input.fileName, input.source);
  const header = findTmallHeader(input.source, parsed);
  const dataset = detectDataset(input.source, input.fileName, header.headers);
  const snapshotDate = input.source === "tmall_product_master" ? isoDateFromValue(input.snapshotDate) : "";
  if (input.source === "tmall_product_master" && !snapshotDate) throw new Error("天猫货品主数据必须提供有效 snapshot_date=YYYY-MM-DD");
  const fileHash = toHex(await sha256(input.bytes));
  const tmallStore = resolveEnabledTmallShop(input.shopName);
  const built = await buildNetshopRows(input, {
    parsed,
    header,
    dataset,
    platform: TMALL_PLATFORM,
    shopName: tmallStore.shopName,
    fileHash,
    snapshotDate,
  });
  const errors = validateRows(built.rows);
  if (input.source === "tmall_promotion") {
    for (const row of built.rawRows) {
      if (normalizeText(row.raw["主体类型"]) !== "商品") {
        errors.push({ row: row.rowNumber, field: "主体类型", code: "UNSUPPORTED_SUBJECT_TYPE", message: "推广导入当前只接受主体类型为“商品”的数据" });
      }
    }
  }
  if (input.source === "tmall_product_daily" || input.source === "tmall_promotion") {
    const coverage = dailyDateCoverage(input.expectedStartDate, input.expectedEndDate, built.rows.map((row) => row.businessDate));
    if (!coverage.validRange) errors.push({ code: "MISSING_EXPECTED_DATE_RANGE", message: "分天导入必须提供有效的目标起止日期" });
    else {
      if (coverage.missingDates.length) errors.push({ code: "MISSING_EXPECTED_DATES", message: `目标区间缺少日期：${coverage.missingDates.join(", ")}` });
      if (coverage.outOfRangeDates.length) errors.push({ code: "OUT_OF_RANGE_DATES", message: `文件包含目标区间外日期：${coverage.outOfRangeDates.join(", ")}` });
    }
  }
  const sumMetric = (key: string) => built.rows.reduce((sum, row) => sum + Number(row.metrics[key] ?? 0), 0);
  const dates = built.rows.map((row) => row.businessDate).filter(Boolean).sort();
  return {
    dataset,
    platform: TMALL_PLATFORM,
    shopName: TMALL_YIJIU_SHOP,
    sheetName: parsed.sheetName,
    rows: built.rows,
    errors,
    totals: {
      rowCount: built.rows.length,
      uniqueProductCount: new Set(built.rows.map((row) => row.spuId).filter(Boolean)).size,
      uniqueSkuCount: new Set(built.rows.map((row) => row.skuId).filter(Boolean)).size,
      missingSkuCount: built.rows.filter((row) => !row.skuId).length,
      inventoryQuantity: sumMetric("inventoryQuantity"),
      transactionAmountCents: sumMetric("transactionAmountCents"),
      refundAmountCents: sumMetric("refundAmountCents"),
      spendCents: sumMetric("spendCents"),
      netTransactionAmountCents: sumMetric("netTransactionAmountCents"),
      impressions: sumMetric("impressions"),
      clicks: sumMetric("clicks"),
      netOrders: sumMetric("netOrders"),
      dateMin: dates[0] ?? null,
      dateMax: dates[dates.length - 1] ?? null,
    },
  };
}

export async function importNetshopBytes(input: NetshopImportInput): Promise<NetshopImportExecution> {
  const {
    ensureNetshopSchema,
    findNetshopImportBatchByHash,
    getNetshopDatabase,
    normalizeJdProductMasterRows,
    reconcileNetshopMasterProducts,
    sanitizeNetshopIssues,
    saveNetshopImport,
    verifyNetshopImportBatch,
  } = await import("@/lib/netshop/database");
  const fileHash = toHex(await sha256(input.bytes));
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);

  let parsed: ParsedTable;
  try {
    if (input.source === "tmall_product_master" && !/\.xlsx$/i.test(input.fileName)) throw new Error("天猫货品主数据只接受 .xlsx 文件");
    if (input.source === "tmall_product_daily" && !/\.xls$/i.test(input.fileName)) throw new Error("生意参谋商品日数据只接受二进制 .xls 文件");
    if (input.source === "tmall_promotion" && !/\.zip$/i.test(input.fileName)) throw new Error("天猫推广数据只接受包含单个 CSV 的 .zip 文件");
    parsed = parseFile(input.bytes, input.fileName, input.source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "PARSE_ERROR", message }], errorCount: 1 };
  }

  let header: ReturnType<typeof findHeader>;
  try {
    header = findTmallHeader(input.source, parsed);
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
  let platform: string;
  let shopName: string;
  try {
    platform = isTmallSource(input.source) ? TMALL_PLATFORM : normalizeText(input.platform) || DEFAULT_PLATFORM;
    shopName = isTmallSource(input.source)
      ? resolveEnabledTmallShop(input.shopName).shopName
      : normalizeText(input.shopName) || DEFAULT_SHOP_NAME;
  } catch (error) {
    const message = error instanceof Error ? error.message : "天猫店铺身份无效";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "TMALL_SHOP_NOT_ALLOWED", message }], errorCount: 1 };
  }
  const previous = await findNetshopImportBatchByHash(db, input.source, fileHash, { platform, shopName });
  const snapshotDate = input.source === "tmall_product_master"
    ? isoDateFromValue(input.snapshotDate)
    : isoDateFromValue(input.snapshotDate) || fileDate(input.fileName) || "";
  const snapshotSource = usesSnapshotDate(input.source);
  if (input.source === "tmall_product_master" && !snapshotDate) {
    const message = "天猫货品主数据必须提供有效 snapshot_date=YYYY-MM-DD";
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "MISSING_SNAPSHOT_DATE", message }], errorCount: 1 };
  }
  const rawRows = parsed.rows.slice(header.index + 1)
    .map((row) => ({ rowNumber: row.rowNumber, raw: isTmallSource(input.source) ? tmallRowObject(input.source, header.headers, row.values) : objectFromRow(header.headers, row.values) }))
    .filter((row) => Object.values(row.raw).some((value) => normalizeText(value)))
    .filter((row) => !isDailyAggregateRow(input.source, row.raw));
  if (rawRows.length > MAX_TABULAR_ROWS) {
    const message = `单次最多导入 ${MAX_TABULAR_ROWS} 行`;
    return { ok: false, status: "rejected", message, warnings: [], errors: [{ code: "ROW_LIMIT_EXCEEDED", message }], errorCount: 1 };
  }

  const rows: NetshopRowInput[] = [];
  for (const row of rawRows) {
    // 商品 SKU 导出中的“创建时间”属于商品主数据，不是经营发生日期。
    // 将它当作业务日期会把商品目录错误地混入日度经营口径。
    const isProductMaster = input.source === "jd_product_master" || input.source === "tmall_product_master";
    const businessDate = isProductMaster ? "" : firstDate(row.raw);
    const tmallSpuId = input.source === "tmall_product_master"
      ? normalizeText(row.raw["商品ID"])
      : input.source === "tmall_product_daily"
        ? normalizeText(row.raw["商品ID"])
        : input.source === "tmall_promotion"
          ? normalizeText(row.raw["主体ID"])
          : "";
    const productCode = input.source === "tmall_product_master"
      ? normalizeText(row.raw["SKU商家编码"] ?? row.raw["商品商家编码"])
      : input.source === "tmall_product_daily"
        ? normalizeText(row.raw["货号"])
      : input.source === "jd_product_master"
      ? normalizeText(row.raw["商品编码"])
      : normalizeText(findValue(row.raw, [/货品编号/, /商品编码/, /商品编号/, /商品ID/i, /^sku$/i, /skuid/i]));
    const skuId = input.source === "tmall_product_master"
      ? normalizeText(row.raw["SKUID"])
      : normalizeText(findValue(row.raw, [/^sku$/i, /sku.?id/i, /skuid/i, /SKU编码/i]));
    const spuId = tmallSpuId || (input.source === "jd_product_master"
      ? productCode
      : normalizeText(findValue(row.raw, [/^spu$/i, /spu.?id/i, /spuid/i, /SPU编码/i])));
    const productName = input.source === "tmall_product_master"
      ? normalizeText(row.raw["商品标题"])
      : input.source === "tmall_promotion"
        ? normalizeText(row.raw["主体名称"])
        : normalizeText(findValue(row.raw, [/商品名称/, /货品名称/, /产品名称/, /名称/]));
    const rawJson = JSON.stringify(row.raw);
    const rowHash = await hashText(rawJson);
    const sourceRowKey = input.source === "tmall_product_master"
      ? tmallMasterRowKey({
          dataset,
          platform,
          shopName,
          snapshotDate,
          spuId,
          skuId,
          saleAttribute: normalizeText(row.raw["销售属性"]),
          rowNumber: row.rowNumber,
        })
      : dataset === "sku_daily" || dataset === "spu_daily" || dataset === "promotion_daily"
        ? dailyRowKey(dataset, platform, shopName, businessDate, dataset === "sku_daily" ? skuId : spuId)
        : netshopMasterRowKey({ source: input.source, platform, shopName, fileHash, rowNumber: row.rowNumber, rowHash });
    rows.push({
      sourceRowNumber: row.rowNumber,
      sourceRowKey,
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
      metrics: isTmallSource(input.source) ? tmallMetrics(input.source, row.raw) : metricsFromRow(row.raw),
      raw: row.raw,
    });
  }

  const errors = validateRows(rows);
  if (input.source === "tmall_promotion") {
    for (const row of rawRows) {
      if (normalizeText(row.raw["主体类型"]) !== "商品") {
        errors.push({ row: row.rowNumber, field: "主体类型", code: "UNSUPPORTED_SUBJECT_TYPE", message: "推广导入当前只接受主体类型为“商品”的数据" });
      }
    }
  }
  if (input.source === "jd_sku_daily" || input.source === "tmall_product_daily" || input.source === "tmall_promotion") {
    const coverage = dailyDateCoverage(input.expectedStartDate, input.expectedEndDate, rows.map((row) => row.businessDate));
    if (!coverage.validRange) {
      errors.push({ code: "MISSING_EXPECTED_DATE_RANGE", message: "分天导入必须提供有效的目标起止日期" });
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
    return {
      ok: true,
      status: "duplicate",
      message: "该文件已经导入，无需重复处理",
      batch: previous,
      warnings: previous.warnings,
      verification: {
        verified: true,
        parsedRowCount: rows.length,
        readbackRowCount: previous.rowCount,
        dateMin: previous.dateMin,
        dateMax: previous.dateMax,
        dataset: previous.dataset,
        platform: previous.platform,
        shopName: previous.shopName,
        unmatchedProductCount: Number((previous.totals as { unmatchedProductCount?: number } | null)?.unmatchedProductCount ?? 0),
      },
    };
  }

  const missingDateRows = rows.filter((row) => !row.businessDate && !snapshotSource).length;
  const missingSnapshotRows = rows.filter((row) => snapshotSource && !row.snapshotDate).length;
  const missingSkuRows = input.source === "tmall_product_master" ? rows.filter((row) => !row.skuId).length : 0;
  const missingSkuMerchantCodeRows = input.source === "tmall_product_master"
    ? rows.filter((row) => !normalizeText(row.raw["SKU商家编码"])).length
    : 0;
  const merchantCodeCounts = new Map<string, number>();
  if (input.source === "tmall_product_master") {
    for (const row of rows) {
      const merchantSkuCode = normalizeText(row.raw["SKU商家编码"]);
      if (merchantSkuCode) merchantCodeCounts.set(merchantSkuCode, (merchantCodeCounts.get(merchantSkuCode) ?? 0) + 1);
    }
  }
  const duplicateMerchantCodeRows = [...merchantCodeCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const reconciliation = input.source === "tmall_product_daily" || input.source === "tmall_promotion"
    ? await reconcileNetshopMasterProducts(db, { platform, shopName, productIds: rows.map((row) => row.spuId) })
    : { masterAvailable: true, unmatchedCount: 0, unmatchedSample: [] as string[] };
  const warnings = sanitizeNetshopIssues([
    ...(missingDateRows > 0 ? [{ code: "MISSING_BUSINESS_DATE", message: `${missingDateRows} 行未识别到业务日期，overview 不会把这些行计入 date_max` }] : []),
    ...(missingSnapshotRows > 0 ? [{ code: "MISSING_SNAPSHOT_DATE", message: `${missingSnapshotRows} 行未识别到快照日期，请在上传时传 snapshot_date=YYYY-MM-DD` }] : []),
    ...(missingSkuRows > 0 ? [{ code: "MISSING_SKU_ID", message: `${missingSkuRows} 行缺少 SKU ID，已使用商品ID、销售属性和源行号构造隔离键` }] : []),
    ...(missingSkuMerchantCodeRows > 0 ? [{ code: "MISSING_MERCHANT_SKU_CODE", message: `${missingSkuMerchantCodeRows} 行缺少 SKU 商家编码；该字段仅保留作业务映射，不参与唯一键` }] : []),
    ...(duplicateMerchantCodeRows > 0 ? [{ code: "DUPLICATE_MERCHANT_CODE", message: `${duplicateMerchantCodeRows} 行使用重复 SKU 商家编码；商家编码仅作映射，不作为主键` }] : []),
    ...(!reconciliation.masterAvailable ? [{ code: "MASTER_DATA_UNAVAILABLE", message: "尚无该店铺货品主数据，商品日数据已保留，暂无法核验商品匹配" }] : []),
    ...(reconciliation.masterAvailable && reconciliation.unmatchedCount > 0 ? [{ code: "UNMATCHED_MASTER_PRODUCTS", message: `${reconciliation.unmatchedCount} 个商品ID未匹配最新货品主数据；样例：${reconciliation.unmatchedSample.join("、")}` }] : []),
  ]);

  const dateValues = rows.map((row) => row.businessDate).filter(Boolean);
  const sumMetric = (key: string) => rows.reduce((sum, row) => sum + Number(row.metrics[key] ?? 0), 0);
  const sortedDates = [...dateValues].sort();
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
      dateMin: sortedDates[0] ?? null,
      dateMax: sortedDates[sortedDates.length - 1] ?? null,
      unmatchedProductCount: reconciliation.unmatchedCount,
      uniqueProductCount: new Set(rows.map((row) => row.spuId).filter(Boolean)).size,
      uniqueSkuCount: new Set(rows.map((row) => row.skuId).filter(Boolean)).size,
      inventoryQuantity: sumMetric("inventoryQuantity"),
      transactionAmountCents: sumMetric("transactionAmountCents"),
      refundAmountCents: sumMetric("refundAmountCents"),
      spendCents: sumMetric("spendCents"),
      netTransactionAmountCents: sumMetric("netTransactionAmountCents"),
      impressions: sumMetric("impressions"),
      clicks: sumMetric("clicks"),
      netOrders: sumMetric("netOrders"),
    },
    note: normalizeText(input.note),
    replaceScope: (input.source === "tmall_product_daily" || input.source === "tmall_promotion") && input.expectedStartDate && input.expectedEndDate
      ? { startDate: input.expectedStartDate, endDate: input.expectedEndDate }
      : undefined,
  });

  if (input.source === "jd_product_master") await normalizeJdProductMasterRows(db, result.batch.id);

  const verification = await verifyNetshopImportBatch(db, result.batch, {
    rowCount: rows.length,
    dataset,
    platform,
    shopName,
    dateMin: sortedDates[0] ?? null,
    dateMax: sortedDates[sortedDates.length - 1] ?? null,
  });
  if (!verification.verified) {
    return {
      ok: false,
      status: "rejected",
      message: "数据写入后回查不一致，未确认导入成功",
      batch: result.batch,
      warnings,
      errors: [{ code: "READBACK_VERIFICATION_FAILED", message: "批次、行数、店铺、数据集或日期覆盖回查不一致" }],
      errorCount: 1,
      verification: { ...verification, unmatchedProductCount: reconciliation.unmatchedCount },
    };
  }

  return {
    ok: true,
    status: result.created ? "imported" : "duplicate",
    message: result.created ? `${platform}网店数据导入成功` : "该文件已经导入，无需重复处理",
    batch: result.batch,
    warnings,
    verification: { ...verification, unmatchedProductCount: reconciliation.unmatchedCount },
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
