import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseXlsxFirstSheet, type XlsxCellValue } from "@/lib/imports/xlsx";
import type { MarketEntryInput, MarketImportIssue } from "@/lib/market/database";
import { assertMarketPeriod, isStrictMarketDate, marketNaturalKey, MAX_MARKET_IMPORT_ROWS, normalizeMarketSkuCode } from "@/lib/market/import-identity";

type TabularSheet = { sheetName: string; date1904: boolean; rows: TabularRow[] };
type TabularRow = { rowNumber: number; values: Array<string | number | boolean | null> };

export class MarketImportRowLimitError extends Error {
  constructor() {
    super(`市场分析单次最多导入 ${MAX_MARKET_IMPORT_ROWS} 条数据`);
    this.name = "MarketImportRowLimitError";
  }
}

const aliases = {
  periodStart: ["开始日期", "周期起", "period_start", "start_date"],
  periodEnd: ["结束日期", "周期止", "日期", "period_end", "end_date", "business_date"],
  periodRange: ["日期区间", "统计周期", "周期", "date_range"],
  category: ["类目", "商品类目", "三级类目", "行业名称", "category"],
  subcategory: ["细分类目", "细分品类", "品类细分", "segment", "subcategory"],
  rankingDimension: ["榜单维度", "榜单单位", "维度", "dimension"],
  scope: ["经营模式", "经营模式(自动)", "经营模式(人工)", "店铺类型", "口径", "渠道", "scope"],
  priceBandFilter: ["榜单价格段", "榜单价格带", "价格段筛选", "价格带筛选", "price_band_filter"],
  rank: ["排名", "商品排名", "序号", "rank"],
  skuCode: ["商品编号", "商品编码", "SKU", "SKUID", "sku_id", "sku_code", "product_code"],
  productName: ["商品名称", "商品信息", "商品标题", "标题", "product_name", "name"],
  storeName: ["所属店铺", "店铺名称", "店铺", "shop_name"],
  brand: ["品牌", "品牌名称", "brand"],
  price: ["价格", "成交客单价", "客单价", "price", "average_price"],
  gmv: ["成交金额", "交易金额", "GMV", "销售额", "gmv", "transaction_amount"],
  quantity: ["成交件数", "成交商品件数", "成交单量", "销量", "交易件数", "quantity", "transaction_quantity"],
  pageViews: ["商品浏览量", "浏览量", "PV", "page_views"],
  visitors: ["访客数", "UV", "visitors"],
  conversion: ["成交转化率", "转化率", "conversion_rate"],
  cartCustomers: ["加购人数", "加购客户数", "cart_customers"],
  searchClicks: ["搜索点击次数", "搜索点击数", "search_clicks"],
  imageUrl: ["图片", "图片链接", "图片URL(原图)", "商品图片", "主图", "首图链接", "image_url"],
  productUrl: ["商品链接", "链接", "product_url"],
} as const;

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().replace(/[\s（）()_\-]+/g, "").toLowerCase();
}

function columnMap(header: Array<string | number | boolean | null>) {
  const normalized = header.map(normalizeHeader);
  const result = new Map<keyof typeof aliases, number>();
  for (const [field, names] of Object.entries(aliases) as Array<[keyof typeof aliases, readonly string[]]>) {
    const index = normalized.findIndex((cell) => names.some((name) => cell === normalizeHeader(name)));
    if (index >= 0) result.set(field, index);
  }
  return result;
}

function text(value: unknown) { return String(value ?? "").trim(); }

function parseScalar(value: string): number | null {
  const source = value.replace(/[,，￥¥元件个次人]/g, "").trim();
  const match = /-?\d+(?:\.\d+)?/.exec(source);
  if (!match) return null;
  const multiplier = /亿/.test(source) ? 100_000_000 : /万/.test(source) ? 10_000 : /千/.test(source) ? 1_000 : 1;
  return Number(match[0]) * multiplier;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = text(value);
  if (!source || source === "-") return null;
  const range = source.split(/\s*[~～至]\s*/).map(parseScalar).filter((item): item is number => item !== null);
  if (range.length >= 2) return (range[0] + range[1]) / 2;
  return parseScalar(source);
}

export function parseRangeBounds(value: unknown): [number | null, number | null] {
  const parsed = parseNumericRange(value);
  const divisor = text(value).includes("%") ? 100 : 1;
  return [parsed.low === null ? null : parsed.low / divisor, parsed.high === null ? null : parsed.high / divisor];
}

export function parseRange(value: unknown): number | null {
  const parsed = parseNumericRange(value).value;
  return parsed === null ? null : parsed / (text(value).includes("%") ? 100 : 1);
}

function parseNumericRange(value: unknown): { value: number | null; low: number | null; high: number | null; estimated: boolean } {
  if (typeof value === "number") return Number.isFinite(value) ? { value, low: value, high: value, estimated: false } : { value: null, low: null, high: null, estimated: false };
  const source = text(value);
  if (!source || source === "-") return { value: null, low: null, high: null, estimated: false };
  const range = source.split(/\s*[~～至]\s*/).map(parseScalar).filter((item): item is number => item !== null);
  if (range.length >= 2) {
    const low = Math.min(range[0], range[1]);
    const high = Math.max(range[0], range[1]);
    return { value: (low + high) / 2, low, high, estimated: true };
  }
  const parsedValue = parseScalar(source);
  return { value: parsedValue, low: parsedValue, high: parsedValue, estimated: false };
}

function parsePercentBps(value: unknown): number | null {
  const number = parseNumeric(value);
  if (number === null) return null;
  const hasPercent = text(value).includes("%");
  const percentValue = hasPercent ? number : Math.abs(number) <= 1 ? number * 100 : number;
  return Math.round(percentValue * 100);
}

function rangePercentBps(value: number | null, rawValue: unknown): number | null {
  if (value === null) return null;
  if (text(rawValue).includes("%")) return Math.round(value * 100);
  return Math.round((Math.abs(value) <= 1 ? value * 100 : value) * 100);
}

function isoDate(value: unknown, date1904 = false): string | null {
  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    const wholeDays = Math.floor(value);
    const adjustedDays = date1904 ? wholeDays : wholeDays - (wholeDays >= 60 ? 1 : 0);
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const candidate = new Date(epoch + adjustedDays * 86_400_000).toISOString().slice(0, 10);
    return isStrictMarketDate(candidate) ? candidate : null;
  }
  const source = text(value).replace(/[./年]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(source);
  const match = compact ?? /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+00:00(?::00)?)?$/.exec(source);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return isStrictMarketDate(candidate) ? candidate : null;
}

function dateRange(value: unknown, date1904 = false): { start: string; end: string } | null {
  const single = isoDate(value, date1904);
  if (single) return { start: single, end: single };
  const matches = [...text(value).matchAll(/(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})日?/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  if (!matches.length || matches.some((candidate) => !isStrictMarketDate(candidate))) return null;
  const result = { start: matches[0], end: matches[1] ?? matches[0] };
  return result.start <= result.end ? result : null;
}

function parseCsv(source: string): TabularRow[] {
  const rows: TabularRow[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push({ rowNumber: rows.length + 1, values: row });
    if (rows.length > MAX_MARKET_IMPORT_ROWS + 1) throw new MarketImportRowLimitError();
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) pushCell();
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
    } else cell += char;
  }
  if (cell || row.length) pushRow();
  return rows;
}

function decodeCsv(bytes: Uint8Array) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
  const replacementRate = (utf8.match(/�/g)?.length ?? 0) / Math.max(1, utf8.length);
  if (replacementRate <= 0.002) return utf8;
  try { return new TextDecoder("gb18030").decode(bytes).replace(/^\uFEFF/, ""); }
  catch { return utf8; }
}

function parseLegacyXls(bytes: Uint8Array): TabularSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellText: false,
      dense: false,
    });
  } catch (error) {
    throw new Error(`XLS 文件无法解析：${error instanceof Error ? error.message : "未知格式错误"}`);
  }
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheetName || !worksheet?.["!ref"]) throw new Error("XLS 文件没有可读取的工作表");
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_MARKET_IMPORT_ROWS + 1) throw new MarketImportRowLimitError();
  if (columnCount > 512) throw new Error("XLS 文件列数超过 512 列限制");
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range,
  });
  const rows = matrix.map((values, index) => ({ rowNumber: range.s.r + index + 1, values }))
    .filter((row) => row.values.some((value) => text(value)));
  return { sheetName, date1904: Boolean(workbook.Workbook?.WBProps?.date1904), rows };
}

function inferredDimension(fileName: string): "SPU" | "SKU" | null {
  const upper = fileName.toUpperCase();
  if (upper.includes("SPU")) return "SPU";
  if (upper.includes("SKU")) return "SKU";
  return null;
}

function normalizeDimension(value: string, fallback: "SKU" | "SPU" | null): "SKU" | "SPU" {
  const upper = value.toUpperCase();
  if (upper.includes("SPU")) return "SPU";
  if (upper.includes("SKU")) return "SKU";
  return fallback ?? "SKU";
}

function normalizeOperationMode(value: string): "POP" | "自营" | "未知" {
  const source = value.trim().toLowerCase();
  if (!source) return "未知";
  if (source.includes("自营") || source.includes("self") || source.includes("jd")) return "自营";
  if (source.includes("pop") || source.includes("店铺") || source.includes("旗舰店")) return "POP";
  return "未知";
}

function derivedMarketCode(dimension: "SPU" | "SKU", storeName: string, productName: string): string {
  const digest = createHash("sha256")
    .update(`${dimension}\0${storeName}\0${productName}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `JD-MKT-${dimension}-${digest}`;
}

function dimensionScope(value: string, dimension: "SPU" | "SKU"): string {
  return value.toUpperCase().endsWith(dimension) ? value : `${value}${dimension}`;
}

export function parseMarketRows(input: {
  bytes: Uint8Array;
  fileName: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultCategory?: string;
  defaultScope?: string;
  defaultPriceBandFilter?: string;
}): { sheetName: string; rows: MarketEntryInput[]; warnings: MarketImportIssue[] } {
  assertMarketPeriod(input.defaultStartDate, input.defaultEndDate);
  const isCsv = /\.csv$/i.test(input.fileName);
  const isLegacyXls = /\.xls$/i.test(input.fileName);
  const sheet = isCsv
    ? { sheetName: "CSV", date1904: false, rows: parseCsv(decodeCsv(input.bytes)) }
    : isLegacyXls
      ? parseLegacyXls(input.bytes)
    : (() => {
      let workbook;
      try {
        workbook = parseXlsxFirstSheet(input.bytes, { maxRows: MAX_MARKET_IMPORT_ROWS + 1, maxCompressedBytes: 25 * 1024 * 1024 });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ROW_LIMIT") throw new MarketImportRowLimitError();
        throw error;
      }
      return { sheetName: workbook.sheetName, date1904: workbook.date1904, rows: workbook.rows.map((row) => ({ rowNumber: row.rowNumber, values: row.cells as XlsxCellValue[] })) };
    })();
  if (sheet.rows.length < 2) throw new Error("文件没有可导入的数据行");
  const header = sheet.rows[0].values;
  const columns = columnMap(header);
  const dimension = inferredDimension(input.fileName);
  const canDeriveMarketCode = isLegacyXls && Boolean(dimension) && columns.has("productName") && columns.has("storeName");
  if (!columns.has("skuCode") && !canDeriveMarketCode) throw new Error("缺少商品编号/SKU/SKUID 列");
  const get = (row: TabularRow, field: keyof typeof aliases) => {
    const index = columns.get(field);
    return index === undefined ? null : row.values[index];
  };
  const warnings: MarketImportIssue[] = [];
  if (!columns.has("skuCode") && canDeriveMarketCode) {
    warnings.push({ field: "商品编号", message: "源文件未提供商品 ID，已按商品名称和所属店铺生成稳定市场标识；该标识不用于自有商品自动匹配" });
  }
  const rows: MarketEntryInput[] = [];
  const seen = new Set<string>();
  const periodEndIndex = columns.get("periodEnd");
  const hasSingleDateColumn = !columns.has("periodStart") && !columns.has("periodRange")
    && periodEndIndex !== undefined && normalizeHeader(header[periodEndIndex]) === normalizeHeader("日期");
  for (const source of sheet.rows.slice(1)) {
    const productName = text(get(source, "productName"));
    const storeName = text(get(source, "storeName"));
    const explicitSkuCode = text(get(source, "skuCode"));
    const skuCode = explicitSkuCode || (canDeriveMarketCode && dimension && productName && storeName
      ? derivedMarketCode(dimension, storeName, productName)
      : "");
    if (!skuCode) {
      if (source.values.some((value) => text(value))) warnings.push({ row: source.rowNumber, field: "商品编号", message: "商品编号为空，已跳过" });
      continue;
    }
    const periodRangeValue = get(source, "periodRange");
    const embeddedRange = dateRange(periodRangeValue, sheet.date1904);
    if (text(periodRangeValue) && !embeddedRange) {
      warnings.push({ row: source.rowNumber, field: "统计周期", message: "统计周期不是有效日期区间，已跳过" });
      continue;
    }
    const periodEndValue = get(source, "periodEnd");
    const explicitPeriodEnd = isoDate(periodEndValue, sheet.date1904);
    if (text(periodEndValue) && !explicitPeriodEnd) {
      warnings.push({ row: source.rowNumber, field: "结束日期", message: "结束日期不是有效自然日，已跳过" });
      continue;
    }
    const periodStartValue = get(source, "periodStart");
    const explicitPeriodStart = isoDate(periodStartValue, sheet.date1904);
    if (text(periodStartValue) && !explicitPeriodStart) {
      warnings.push({ row: source.rowNumber, field: "开始日期", message: "开始日期不是有效自然日，已跳过" });
      continue;
    }
    const periodEnd = explicitPeriodEnd ?? embeddedRange?.end ?? input.defaultEndDate;
    const periodStart = hasSingleDateColumn
      ? periodEnd
      : explicitPeriodStart ?? embeddedRange?.start ?? input.defaultStartDate;
    if (!isStrictMarketDate(periodStart) || !isStrictMarketDate(periodEnd) || periodStart > periodEnd) {
      warnings.push({ row: source.rowNumber, field: "统计周期", message: "开始日期必须是不晚于结束日期的有效自然日，已跳过" });
      continue;
    }
    const category = text(get(source, "category")) || input.defaultCategory?.trim() || "未分类";
    const sourceScope = text(get(source, "scope")) || input.defaultScope?.trim() || "全部";
    const priceBandFilter = text(get(source, "priceBandFilter")) || input.defaultPriceBandFilter?.trim() || "全部";
    const rankingDimension = normalizeDimension(text(get(source, "rankingDimension")) || sourceScope || input.defaultScope || "", dimension);
    const scope = !explicitSkuCode && canDeriveMarketCode && dimension ? dimensionScope(sourceScope, dimension) : sourceScope;
    const operationMode = normalizeOperationMode(sourceScope);
    const subcategory = text(get(source, "subcategory")) || "";
    const normalizedSkuCode = normalizeMarketSkuCode(skuCode);
    const naturalKey = marketNaturalKey({ periodStart, periodEnd, category, scope, priceBandFilter, rankingDimension, skuCode: normalizedSkuCode });
    if (seen.has(naturalKey)) {
      warnings.push({ row: source.rowNumber, field: "商品编号", message: `同一周期重复 SKU ${skuCode}，已保留首行` });
      continue;
    }
    seen.add(naturalKey);
    const numeric = (field: keyof typeof aliases) => parseNumeric(get(source, field));
    const rawText = (field: keyof typeof aliases) => text(get(source, field));
    const raw = Object.fromEntries(header.map((name, index) => [text(name) || `列${index + 1}`, source.values[index] ?? null]));
    const rank = numeric("rank");
    const price = parseNumericRange(get(source, "price"));
    const gmv = parseNumericRange(get(source, "gmv"));
    const quantity = parseNumericRange(get(source, "quantity"));
    const pageViews = parseNumericRange(get(source, "pageViews"));
    const visitors = parseNumericRange(get(source, "visitors"));
    const conversion = parseNumericRange(get(source, "conversion"));
    const cartCustomers = parseNumericRange(get(source, "cartCustomers"));
    const searchClicks = parseNumericRange(get(source, "searchClicks"));
    rows.push({
      naturalKey,
      sourceRowNumber: source.rowNumber,
      periodStart,
      periodEnd,
      category,
      scope,
      priceBandFilter,
      rankingDimension,
      operationMode,
      subcategory: subcategory.slice(0, 120),
      rank: rank === null ? null : Math.max(1, Math.trunc(rank)),
      skuCode: normalizedSkuCode,
      productName: productName.slice(0, 500),
      brand: text(get(source, "brand")).slice(0, 120),
      priceCents: price.value === null ? null : Math.round(price.value * 100),
      priceLowCents: price.low === null ? null : Math.round(price.low * 100),
      priceHighCents: price.high === null ? null : Math.round(price.high * 100),
      priceEstimated: price.estimated,
      priceRaw: rawText("price"),
      gmvCents: Math.round((gmv.value ?? 0) * 100),
      gmvLowCents: gmv.low === null ? null : Math.round(gmv.low * 100),
      gmvHighCents: gmv.high === null ? null : Math.round(gmv.high * 100),
      gmvRaw: rawText("gmv"),
      quantity: Math.round(quantity.value ?? 0),
      quantityLow: quantity.low === null ? null : Math.round(quantity.low),
      quantityHigh: quantity.high === null ? null : Math.round(quantity.high),
      quantityRaw: rawText("quantity"),
      pageViews: Math.round(pageViews.value ?? 0),
      pageViewsRaw: rawText("pageViews"),
      visitors: Math.round(visitors.value ?? 0),
      visitorsLow: visitors.low === null ? null : Math.round(visitors.low),
      visitorsHigh: visitors.high === null ? null : Math.round(visitors.high),
      visitorsRaw: rawText("visitors"),
      conversionBps: parsePercentBps(get(source, "conversion")),
      conversionLowBps: rangePercentBps(conversion.low, get(source, "conversion")),
      conversionHighBps: rangePercentBps(conversion.high, get(source, "conversion")),
      conversionRaw: rawText("conversion"),
      cartCustomers: Math.round(cartCustomers.value ?? 0),
      cartCustomersRaw: rawText("cartCustomers"),
      searchClicks: Math.round(searchClicks.value ?? 0),
      searchClicksRaw: rawText("searchClicks"),
      imageUrl: text(get(source, "imageUrl")).slice(0, 1000),
      productUrl: text(get(source, "productUrl")).slice(0, 1000),
      raw,
    });
  }
  if (!rows.length) throw new Error("没有识别到可导入的商品数据");
  return { sheetName: sheet.sheetName, rows, warnings };
}
