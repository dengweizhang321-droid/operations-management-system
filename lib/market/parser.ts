import { parseXlsxFirstSheet, type XlsxCellValue } from "@/lib/imports/xlsx";
import type { MarketEntryInput, MarketImportIssue } from "@/lib/market/database";

type TabularRow = { rowNumber: number; values: Array<string | number | boolean | null> };

const aliases = {
  periodStart: ["开始日期", "周期起", "period_start", "start_date"],
  periodEnd: ["结束日期", "周期止", "日期", "period_end", "end_date", "business_date"],
  periodRange: ["日期区间", "统计周期", "周期", "date_range"],
  category: ["类目", "商品类目", "三级类目", "category"],
  scope: ["经营模式", "经营模式(自动)", "经营模式(人工)", "店铺类型", "口径", "scope"],
  rank: ["排名", "商品排名", "rank"],
  skuCode: ["商品编号", "商品编码", "SKU", "SKUID", "sku_id", "sku_code", "product_code"],
  productName: ["商品名称", "商品信息", "商品标题", "标题", "product_name", "name"],
  brand: ["品牌", "品牌名称", "brand"],
  price: ["价格", "成交客单价", "客单价", "price", "average_price"],
  gmv: ["成交金额", "交易金额", "GMV", "销售额", "gmv", "transaction_amount"],
  quantity: ["成交件数", "成交商品件数", "成交单量", "销量", "交易件数", "quantity", "transaction_quantity"],
  pageViews: ["商品浏览量", "浏览量", "PV", "page_views"],
  visitors: ["访客数", "UV", "visitors"],
  conversion: ["成交转化率", "转化率", "conversion_rate"],
  cartCustomers: ["加购人数", "加购客户数", "cart_customers"],
  searchClicks: ["搜索点击次数", "搜索点击数", "search_clicks"],
  imageUrl: ["图片", "图片链接", "商品图片", "主图", "首图链接", "image_url"],
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

function parsePercentBps(value: unknown): number | null {
  const number = parseNumeric(value);
  if (number === null) return null;
  const hasPercent = text(value).includes("%");
  const percentValue = hasPercent ? number : Math.abs(number) <= 1 ? number * 100 : number;
  return Math.round(percentValue * 100);
}

function isoDate(value: unknown, fallback: string) {
  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  }
  const source = text(value).replace(/[./年]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(source);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : fallback;
}

function dateRange(value: unknown): { start: string; end: string } | null {
  const matches = [...text(value).matchAll(/(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})日?/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  if (!matches.length) return null;
  return { start: matches[0], end: matches[1] ?? matches[0] };
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

export function parseMarketRows(input: {
  bytes: Uint8Array;
  fileName: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultCategory?: string;
  defaultScope?: string;
}): { sheetName: string; rows: MarketEntryInput[]; warnings: MarketImportIssue[] } {
  const isCsv = /\.csv$/i.test(input.fileName);
  const sheet = isCsv
    ? { sheetName: "CSV", rows: parseCsv(decodeCsv(input.bytes)) }
    : (() => {
      const workbook = parseXlsxFirstSheet(input.bytes, { maxRows: 100_001, maxCompressedBytes: 25 * 1024 * 1024 });
      return { sheetName: workbook.sheetName, rows: workbook.rows.map((row) => ({ rowNumber: row.rowNumber, values: row.cells as XlsxCellValue[] })) };
    })();
  if (sheet.rows.length < 2) throw new Error("文件没有可导入的数据行");
  const header = sheet.rows[0].values;
  const columns = columnMap(header);
  if (!columns.has("skuCode")) throw new Error("缺少商品编号/SKU/SKUID 列");
  const get = (row: TabularRow, field: keyof typeof aliases) => {
    const index = columns.get(field);
    return index === undefined ? null : row.values[index];
  };
  const warnings: MarketImportIssue[] = [];
  const rows: MarketEntryInput[] = [];
  const seen = new Set<string>();
  for (const source of sheet.rows.slice(1)) {
    const skuCode = text(get(source, "skuCode"));
    if (!skuCode) {
      if (source.values.some((value) => text(value))) warnings.push({ row: source.rowNumber, field: "商品编号", message: "商品编号为空，已跳过" });
      continue;
    }
    const embeddedRange = dateRange(get(source, "periodRange"));
    const periodStart = isoDate(get(source, "periodStart"), embeddedRange?.start ?? input.defaultStartDate);
    const periodEnd = isoDate(get(source, "periodEnd"), embeddedRange?.end ?? input.defaultEndDate);
    const category = text(get(source, "category")) || input.defaultCategory?.trim() || "未分类";
    const scope = text(get(source, "scope")) || input.defaultScope?.trim() || "全部";
    const naturalKey = `${periodStart}|${periodEnd}|${category}|${scope}|${skuCode}`;
    if (seen.has(naturalKey)) {
      warnings.push({ row: source.rowNumber, field: "商品编号", message: `同一周期重复 SKU ${skuCode}，已保留首行` });
      continue;
    }
    seen.add(naturalKey);
    const numeric = (field: keyof typeof aliases) => parseNumeric(get(source, field));
    const raw = Object.fromEntries(header.map((name, index) => [text(name) || `列${index + 1}`, source.values[index] ?? null]));
    const rank = numeric("rank");
    const price = numeric("price");
    rows.push({
      naturalKey,
      sourceRowNumber: source.rowNumber,
      periodStart,
      periodEnd,
      category,
      scope,
      rank: rank === null ? null : Math.max(1, Math.trunc(rank)),
      skuCode: skuCode.slice(0, 80),
      productName: text(get(source, "productName")).slice(0, 500),
      brand: text(get(source, "brand")).slice(0, 120),
      priceCents: price === null ? null : Math.round(price * 100),
      gmvCents: Math.round((numeric("gmv") ?? 0) * 100),
      quantity: Math.round(numeric("quantity") ?? 0),
      pageViews: Math.round(numeric("pageViews") ?? 0),
      visitors: Math.round(numeric("visitors") ?? 0),
      conversionBps: parsePercentBps(get(source, "conversion")),
      cartCustomers: Math.round(numeric("cartCustomers") ?? 0),
      searchClicks: Math.round(numeric("searchClicks") ?? 0),
      imageUrl: text(get(source, "imageUrl")).slice(0, 1000),
      productUrl: text(get(source, "productUrl")).slice(0, 1000),
      raw,
    });
  }
  if (!rows.length) throw new Error("没有识别到可导入的商品数据");
  return { sheetName: sheet.sheetName, rows, warnings };
}
