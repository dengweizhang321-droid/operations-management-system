const naturalKeyFields = [
  "periodStart",
  "periodEnd",
  "category",
  "scope",
  "priceBandFilter",
  "rankingDimension",
  "skuCode",
] as const;

export const MAX_MARKET_IMPORT_ROWS = 5_000;

type MarketIdentitySource = Record<(typeof naturalKeyFields)[number], string>;

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

export function encodeMarketIdentity(parts: readonly string[]) {
  return `market-key-v2|${parts.map((part) => `${utf8Length(part)}:${part}`).join("|")}`;
}

export function marketNaturalKey(input: MarketIdentitySource) {
  return encodeMarketIdentity(naturalKeyFields.map((field) => input[field]));
}

export function normalizeMarketSkuCode(value: string) {
  return Array.from(value.trim()).slice(0, 80).join("");
}

export function marketImportRangeKey(input: { category: string; scope: string; rankingDimension: string; month: string }) {
  return encodeMarketIdentity([input.category, input.scope, input.rankingDimension, input.month]);
}

function sqlPart(expression: string) {
  return `length(CAST(COALESCE(${expression}, '') AS BLOB)) || ':' || COALESCE(${expression}, '')`;
}

export function marketNaturalKeySql(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const columns = ["period_start", "period_end", "category", "scope", "price_band_filter", "ranking_dimension", "sku_code"];
  return `'market-key-v2|' || ${columns.map((column) => sqlPart(`${prefix}${column}`)).join(" || '|' || ")}`;
}

export function isStrictMarketDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function assertMarketPeriod(periodStart: string, periodEnd: string) {
  if (!isStrictMarketDate(periodStart) || !isStrictMarketDate(periodEnd) || periodStart > periodEnd) {
    throw new Error(`市场数据周期无效：${periodStart || "空"} 至 ${periodEnd || "空"}`);
  }
}
