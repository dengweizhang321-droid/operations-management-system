import { briefMetric, datesToRanges, NetshopAiCompaction, selectTopBy, SOURCE_REFS_OMITTED_RULE } from "./netshop-ai-compaction";

/**
 * Promotion list view for the model. Input is a DTO the real decoder accepted.
 * Levels go from light to heavy; the caller takes the first level whose whole
 * envelope fits 40000 characters and refuses when none does.
 *
 * Source order facts (backend/netshop/promotion_insights.py):
 *  - contributions.previous.*: sorted by the previous-period change in the named direction (line ~617),
 *    so the first N are a real Top N.
 *  - shops.items: built by iterating `names` (shop-name order, insights_common.py `sorted(effective)`);
 *    NOT a business ranking, so a reduced set is re-ranked by spend.
 *  - trend.items: chronological periods (line ~560); the newest N points are kept.
 *  - matchedRange.shopDates: current-period dates whose (shop, date) pair was matched (line ~262-296).
 *    A shop row's matchedRange (windows([n]), current period) repeats exactly that shop's entry in
 *    sections.matchedRange (windows(names)); matching is per (shop, date) key, so grouping cannot change it.
 *    The shop copy is omitted only after the two are compared at runtime.
 */
export type PromotionCompactionLevel = {
  /** First N rows per ranked contribution list (source-ranked); null keeps every row. */
  topN: number | null;
  /** Shop rows kept; null keeps every shop. A reduced set is the top N by spend (re-ranked). */
  shopsTop: number | null;
  /** Newest trend points kept (chronological). */
  trendPoints: number;
  /** Current page rows: verbatim, or minimally slimmed (see slimPageRow). All metrics and comparisons stay. */
  slimPage: boolean;
  /** Omit sourceIds/coverageRef from summary/changes/matchedRange metrics. */
  stripScalars: boolean;
  /** Shop rows carry period comparisons for spend, attributedPayment, roas (true) or spend, attributedPayment (false). */
  shopComparisonsFull: boolean;
};

export const promotionCompactionLadder: PromotionCompactionLevel[] = [
  { topN: null, shopsTop: null, trendPoints: 14, slimPage: false, stripScalars: false, shopComparisonsFull: true },
  { topN: null, shopsTop: null, trendPoints: 14, slimPage: true, stripScalars: true, shopComparisonsFull: true },
  { topN: 5, shopsTop: null, trendPoints: 7, slimPage: true, stripScalars: true, shopComparisonsFull: true },
  { topN: 5, shopsTop: 10, trendPoints: 7, slimPage: true, stripScalars: true, shopComparisonsFull: true },
  { topN: 5, shopsTop: 5, trendPoints: 3, slimPage: true, stripScalars: true, shopComparisonsFull: false },
  { topN: 3, shopsTop: 3, trendPoints: 2, slimPage: true, stripScalars: true, shopComparisonsFull: false },
  { topN: 1, shopsTop: 3, trendPoints: 2, slimPage: true, stripScalars: true, shopComparisonsFull: false },
];

type Plain = Record<string, any>;
const pick = (source: Plain | null | undefined, keys: readonly string[]) => {
  const out: Plain = {};
  if (!source) return out;
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
};
/** Metrics kept on shop rows, ranking rows and trend points. basis and aggregation stay on every kept metric. */
const KEY_METRICS = ["spend", "attributedPayment", "roas"] as const;
const PAY_KEYS = ["spend", "attributedPayment"] as const;
const RANK_METRIC: Record<string, "spend" | "attributedPayment"> = { spendIncrease: "spend", spendDecrease: "spend", attributedPaymentIncrease: "attributedPayment", attributedPaymentDecrease: "attributedPayment" };

export const PROMOTION_RANK_ROW_RULE = "ranking_rows(rowKey,id,shopKey,objectKind,title,spend/attributedPayment/roas value+unit,rankBasis=previous change)";
export const PROMOTION_PAGE_SLIM_RULE = "page_rows_slimmed(-observation,-mapping.advertisedSkuId/triggerSkuId/followSkuId,-metric.sourceIds,-metric.coverageRef)";

export function compactPromotionInsightsForAi(data: Record<string, unknown>, level: PromotionCompactionLevel): Record<string, unknown> {
  const c = new NetshopAiCompaction();
  const source = data as Plain;
  const sections = source.sections as Plain;
  const next: Plain = { ...source };
  const out: Plain = { ...sections };

  /** Ranking row: enough identity to call the detail tool (rowKey -> objectId, shopKey, objectKind) plus the ranking basis. */
  const rankRow = (row: Plain, listName: string) => {
    const metric = RANK_METRIC[listName];
    return {
      ...pick(row, ["rowKey", "id", "shopKey", "objectKind", "title"]),
      metrics: Object.fromEntries(KEY_METRICS.map(key => [key, { value: row.metrics?.[key]?.value ?? null, unit: row.metrics?.[key]?.unit }])),
      rankBasis: { metric, previous: briefMetric(row.changes?.[metric]?.previous) },
    };
  };

  // Contribution lists: source-ranked by previous-period change, so the first N are a real Top N.
  const contributions = sections.contributions as Plain;
  const lists = contributions.previous as Record<string, Plain[]>;
  const keptLists: Record<string, Plain[]> = {};
  for (const [key, rows] of Object.entries(lists)) {
    const top = level.topN === null ? rows : rows.slice(0, level.topN);
    keptLists[key] = top.map(row => rankRow(row, key));
    if (rows.length > 0) c.record(`sections.contributions.previous.${key}`, rows.length, top.length, `${top.length < rows.length ? `top_${level.topN}_source_ranked_by_previous_change; ` : ""}${PROMOTION_RANK_ROW_RULE}`);
  }
  out.contributions = { ...contributions, previous: keptLists };

  // Matched-range dates become inclusive ranges; each shop row's copy is dropped only when identical.
  const rangesOf = (matched: Plain) => (matched.shopDates as Array<{ shopKey: string; dates: string[] }>).map(({ shopKey, dates }) => ({ shopKey, dateRanges: datesToRanges(dates) }));
  const summaryMatched = sections.matchedRange as Plain | null;
  const summaryDates = new Map<string, string>(summaryMatched ? (summaryMatched.shopDates as Array<{ shopKey: string; dates: string[] }>).map(entry => [entry.shopKey, JSON.stringify(entry.dates)]) : []);
  let shopDatesOmitted = 0;
  const shopMatched = (shop: Plain) => {
    const matched = shop.matchedRange as Plain | null | undefined;
    if (!matched) return matched === null ? { matchedRange: null } : {};
    const own = matched.shopDates as Array<{ shopKey: string; dates: string[] }>;
    const duplicate = own.length === 1 && summaryDates.get(own[0].shopKey) === JSON.stringify(own[0].dates);
    const { shopDates: _dropped, ...rest } = matched;
    if (duplicate) shopDatesOmitted++;
    return { matchedRange: { ...c.stripProvenance(rest), ...(duplicate ? {} : { shopDates: rangesOf(matched) }) } };
  };

  // Shops: source order is shop-name order, not a ranking. Keep every shop when possible;
  // otherwise choose by spend (desc, unknown last) and say so in the rule name.
  const shops = sections.shops as Plain;
  const shopRows = shops.items as Plain[];
  const shopLimit = level.shopsTop ?? Math.max(shopRows.length, 1);
  const trimmedShops = shopRows.length > shopLimit;
  const keptShops = trimmedShops ? selectTopBy(shopRows, shopLimit, shop => (typeof shop.metrics?.spend?.value === "number" ? shop.metrics.spend.value : null)) : shopRows;
  out.shops = { ...shops, items: keptShops.map(shop => ({
    ...pick(shop, ["platform", "shopKey", "shopName", "coverageRef"]),
    metrics: c.stripProvenance(pick(shop.metrics, KEY_METRICS)),
    comparisons: pick(shop.comparisons, level.shopComparisonsFull ? KEY_METRICS : PAY_KEYS),
    changes: c.stripProvenance(Object.fromEntries(PAY_KEYS.map(key => [key, { previous: shop.changes?.[key]?.previous }]))),
    spendShare: c.stripProvenance(shop.spendShare),
    ...shopMatched(shop),
  })) };
  if (shopRows.length > 0) c.record("sections.shops.items", shopRows.length, keptShops.length, `${trimmedShops ? `top_${shopLimit}_by_spend_desc; ` : ""}shop_rows(metrics:spend/attributedPayment/roas; comparisons:${level.shopComparisonsFull ? "spend/attributedPayment/roas" : "spend/attributedPayment"}; changes:previous only; spendShare; matchedRange metrics)`);
  if (shopDatesOmitted > 0) c.record("sections.shops.items[].matchedRange.shopDates", shopDatesOmitted, 0, "omitted_duplicate_of_sections.matchedRange.shopDates");

  // Trend is chronological; the newest points are kept.
  const trend = sections.trend as Plain;
  const trendRows = trend.items as Plain[];
  const latest = trendRows.slice(Math.max(0, trendRows.length - level.trendPoints));
  out.trend = { ...trend, items: latest.map(point => ({ ...pick(point, ["startDate", "endDate", "days", "truncatedPeriod", "coverageRef"]), metrics: c.stripProvenance(pick(point.metrics, KEY_METRICS)) })) };
  if (trendRows.length > 0) c.record("sections.trend.items", trendRows.length, latest.length, `${latest.length < trendRows.length ? `latest_${level.trendPoints}_points; ` : ""}points_reduced_to_spend_attributedPayment_roas_values`);

  // Coverage: only complete, gap-free entries are folded; gaps stay (dates as ranges).
  out.coverage = c.keepCoverageGaps("sections.coverage", sections.coverage);
  const context = source.context as Plain;
  next.context = { ...context, coverageBySource: c.keepCoverageGaps("context.coverageBySource", context.coverageBySource) };

  // Current page rows: all fields, metrics and comparisons stay; only the listed duplicates go.
  const items = sections.items as Plain[];
  if (level.slimPage) {
    out.items = items.map(row => {
      const { observation: _observation, mapping, ...rest } = row;
      const slim: Plain = c.stripProvenance(rest);
      if (mapping) { const { advertisedSkuId: _a, triggerSkuId: _t, followSkuId: _f, ...keptMapping } = mapping; slim.mapping = keptMapping; }
      return slim;
    });
    c.record("sections.items[]", items.length, items.length, PROMOTION_PAGE_SLIM_RULE);
  }

  // matchedRange (summary level): metrics lose refs when scalars are stripped; dates become ranges.
  if (summaryMatched) {
    const { shopDates: _shopDates, ...rest } = summaryMatched;
    out.matchedRange = { ...(level.stripScalars ? { ...rest, metrics: c.stripProvenance(rest.metrics) } : rest), shopDates: rangesOf(summaryMatched) };
    c.record("sections.matchedRange.shopDates", summaryDates.size, summaryDates.size, "matched_dates_as_ranges");
  }
  if (level.stripScalars) {
    for (const key of ["summary", "changes"]) out[key] = c.stripProvenance(sections[key]);
    c.record("sections.summary,changes,matchedRange.metrics", 3, 3, SOURCE_REFS_OMITTED_RULE);
  }

  next.sections = out;
  next.aiCompaction = c.mark();
  return next;
}
