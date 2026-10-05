import { record, rows, numberFields, stringFields, strings, nullableNumber, pagination } from "./view-response";

const fields = ["grossSalesCents", "refundAmountCents", "netSalesCents", "costAmountCents", "positiveQuantity",
  "returnQuantity", "netQuantity", "refundRate", "grossProfitCents", "grossMarginRate", "lineCount", "shareRate"];
const metric = (value: unknown) => record(value) && stringFields(value, ["category"]) && numberFields(value,
  [...fields, "productCount", "currentWeekNetSalesCents", "previousWeekNetSalesCents", "yearAgoNetSalesCents"])
  && nullableNumber(value.weekOverWeekRate) && nullableNumber(value.yearOverYearRate);
const range = (value: unknown, start: string, end: string) => record(value) && value.startDate === start && value.endDate === end
  && typeof value.endExclusive === "string" && value.timezone === "Asia/Shanghai";

export function validCategoryAnalysis(value: unknown, expected: {
  startDate: string; endDate: string; page: number; pageSize: number; granularity: string; sortBy: string; direction: string;
}): boolean {
  if (!record(value) || !range(value.range, expected.startDate, expected.endDate)
    || !numberFields(value.summary, [...fields.filter((key) => !["shareRate", "refundRate"].includes(key)), "productCount", "categoryCount"])
    || !record(value.filtersApplied) || !record(value.filtersApplied.dataScope) || typeof value.filtersApplied.dataScope.mode !== "string"
    || !record(value.uncategorized) || !numberFields(value.uncategorized, ["productCount", "netSalesCents", "shareRate"]) || typeof value.uncategorized.visible !== "boolean"
    || !record(value.structure) || !numberFields(value.structure, ["otherNetSalesCents", "otherShareRate", "contributionRateTotal"])
    || !rows(value.structure.items, (item) => metric(item) && numberFields(item, ["rank"]))
    || !rows(value.ranking, (item) => metric(item) && numberFields(item, ["rank"]))
    || !record(value.trend) || value.trend.granularity !== expected.granularity
    || !rows(value.trend.items, (item) => stringFields(item, ["period", "category"]) && numberFields(item,
      ["netSalesCents", "grossProfitCents", "positiveQuantity", "returnQuantity", "refundAmountCents"]))
    || !record(value.details) || !rows(value.details.items, (item) => record(item) && metric(item) && record(item.trend)
      && rows(item.trend.points, (point) => stringFields(point, ["period"]) && numberFields(point, ["netSalesCents"]))
      && nullableNumber(item.trend.changeRate) && ["up", "down", "flat", "insufficient"].includes(String(item.trend.direction)))
    || !pagination(value.details.pagination, (value.details.items as unknown[]).length) || !record(value.details.pagination)
    || value.details.pagination.page !== expected.page || value.details.pagination.pageSize !== expected.pageSize
    || !record(value.details.sort) || value.details.sort.by !== expected.sortBy || value.details.sort.direction !== expected.direction
    || !record(value.details.trend) || value.details.trend.granularity !== expected.granularity || !numberFields(value.details.trend, ["periodLimit"])) return false;
  const options = value.filterOptions;
  const comparisons = value.comparisonPeriods;
  return record(options) && ["categories", "channels", "platforms"].every((key) => strings(options[key]))
    && rows(options.outlets, (item) => stringFields(item, ["key", "platform", "name"])) && numberFields(options.totals, ["categories", "channels", "platforms", "outlets"])
    && numberFields(options, ["limit"]) && typeof options.truncated === "boolean"
    && record(comparisons) && stringFields(comparisons.yearAgo, ["startDate", "endDate"]) && record(comparisons.weekOverWeek)
    && stringFields(comparisons.weekOverWeek.current, ["startDate", "endDate"]) && stringFields(comparisons.weekOverWeek.previous, ["startDate", "endDate"]);
}

export function validCategoryDetail(value: unknown, start: string, end: string, category: string): boolean {
  return record(value) && range(value.range, start, end) && value.category === category
    && numberFields(value.totals, ["netSalesCents", "platformCount", "shopCount"])
    && rows(value.platforms, (item) => record(item) && stringFields(item, ["platform"]) && numberFields(item, [...fields, "shopCount"])
      && rows(item.shops, (shop) => stringFields(shop, ["shop"]) && numberFields(shop, fields)))
    && pagination(value.pagination) && numberFields(value.pagination, ["limit"]);
}
