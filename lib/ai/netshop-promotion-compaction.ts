import { NetshopAiCompaction, selectTopBy, SOURCE_REFS_OMITTED_RULE } from "./netshop-ai-compaction";

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
 *  - items (current page): never reduced beyond sourceIds/coverageRef.
 */
export type PromotionCompactionLevel = {
  /** First N per ranked contribution list (source-ranked). */
  topN: number;
  /** Shop rows kept; null keeps every shop. A reduced set is the top N by spend (re-ranked). */
  shopsTop: number | null;
  /** Newest trend points kept (chronological). */
  trendPoints: number;
  /** Current page rows: verbatim, or only sourceIds/coverageRef omitted. Never row-reduced. */
  stripItems: boolean;
  /** Omit sourceIds/coverageRef from summary/changes/matchedRange metrics. */
  stripScalars: boolean;
  /** Ranked/shop rows also carry period comparisons for spend, attributedPayment, roas. */
  rowComparisons: boolean;
};

export const promotionCompactionLadder: PromotionCompactionLevel[] = [
  { topN: 5, shopsTop: null, trendPoints: 14, stripItems: false, stripScalars: false, rowComparisons: true },
  { topN: 5, shopsTop: null, trendPoints: 14, stripItems: true, stripScalars: true, rowComparisons: true },
  { topN: 3, shopsTop: 10, trendPoints: 7, stripItems: true, stripScalars: true, rowComparisons: true },
  { topN: 2, shopsTop: 5, trendPoints: 3, stripItems: true, stripScalars: true, rowComparisons: false },
  { topN: 1, shopsTop: 3, trendPoints: 2, stripItems: true, stripScalars: true, rowComparisons: false },
];

type Plain = Record<string, any>;
const pick = (source: Plain | null | undefined, keys: readonly string[]) => {
  const out: Plain = {};
  if (!source) return out;
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
};
const ROW_KEYS = ["rowKey", "id", "platform", "shopKey", "shopName", "objectKind", "identityKind", "title", "planId", "unitId", "matchType", "coverageRef", "drillable"] as const;
/** Metrics kept on contribution / shop / trend rows. basis and aggregation stay on every metric. */
const KEY_METRICS = ["spend", "attributedPayment", "roas"] as const;
const PAY_KEYS = ["spend", "attributedPayment"] as const;

export function compactPromotionInsightsForAi(data: Record<string, unknown>, level: PromotionCompactionLevel): Record<string, unknown> {
  const c = new NetshopAiCompaction();
  const source = data as Plain;
  const sections = source.sections as Plain;
  const next: Plain = { ...source };
  const out: Plain = { ...sections };

  /** Shop row: identity, spend/attributedPayment/roas (+ their comparisons) and both period payment deltas. */
  const keyRow = (row: Plain) => ({
    ...pick(row, ROW_KEYS),
    mapping: row.mapping ? { status: row.mapping.status, linkIdentity: row.mapping.linkIdentity } : row.mapping,
    metrics: c.stripProvenance(pick(row.metrics, KEY_METRICS)),
    ...(level.rowComparisons ? { comparisons: pick(row.comparisons, KEY_METRICS) } : {}),
    changes: c.stripProvenance(row.changes),
  });
  /** Contribution row: same, but changes keep only `previous`, which is the list's ranking basis. */
  const contributionRow = (row: Plain) => {
    const shaped = keyRow(row);
    return { ...shaped, changes: c.stripProvenance(Object.fromEntries(PAY_KEYS.map(key => [key, { previous: row.changes?.[key]?.previous }]))) };
  };
  const keyRowRule = level.rowComparisons ? "rows_reduced_to_spend_attributedPayment_roas_with_comparisons" : "rows_reduced_to_spend_attributedPayment_roas";

  // Contribution lists: source-ranked by previous-period change, so the first N are a real Top N.
  const contributions = sections.contributions as Plain;
  const lists = contributions.previous as Record<string, Plain[]>;
  const keptLists: Record<string, Plain[]> = {};
  for (const [key, rows] of Object.entries(lists)) {
    const top = rows.slice(0, level.topN);
    keptLists[key] = top.map(contributionRow);
    const trimmed = top.length < rows.length;
    if (rows.length > 0) c.record(`sections.contributions.previous.${key}`, rows.length, top.length, `${trimmed ? `top_${level.topN}_source_ranked_by_previous_change; ` : ""}${keyRowRule}_previous_change_only`);
  }
  out.contributions = { ...contributions, previous: keptLists };

  // Shops: source order is shop-name order, not a ranking. Keep every shop when possible;
  // otherwise choose by spend (desc, unknown last) and say so in the rule name.
  const shops = sections.shops as Plain;
  const shopRows = shops.items as Plain[];
  const shopLimit = level.shopsTop ?? Math.max(shopRows.length, 1);
  const trimmedShops = shopRows.length > shopLimit;
  const keptShops = trimmedShops ? selectTopBy(shopRows, shopLimit, shop => (typeof shop.metrics?.spend?.value === "number" ? shop.metrics.spend.value : null)) : shopRows;
  out.shops = { ...shops, items: keptShops.map(shop => ({ ...keyRow(shop), ...(level.rowComparisons ? {} : { comparisons: pick(shop.comparisons, PAY_KEYS) }), spendShare: c.stripProvenance(shop.spendShare), ...(shop.matchedRange ? { matchedRange: c.stripProvenance(shop.matchedRange) } : pick(shop, ["matchedRange"])) })) };
  if (shopRows.length > 0) c.record("sections.shops.items", shopRows.length, keptShops.length, `${trimmedShops ? `top_${shopLimit}_by_spend_desc; ` : ""}${keyRowRule}`);

  // Trend is chronological; the newest points are kept.
  const trend = sections.trend as Plain;
  const trendRows = trend.items as Plain[];
  const latest = trendRows.slice(Math.max(0, trendRows.length - level.trendPoints));
  out.trend = { ...trend, items: latest.map(point => ({ ...pick(point, ["startDate", "endDate", "days", "truncatedPeriod", "coverageRef"]), metrics: c.stripProvenance(pick(point.metrics, KEY_METRICS)) })) };
  if (trendRows.length > 0) c.record("sections.trend.items", trendRows.length, latest.length, `${latest.length < trendRows.length ? `latest_${level.trendPoints}_points; ` : ""}points_reduced_to_spend_attributedPayment_roas`);

  // Coverage: only complete, gap-free entries are folded; gaps stay whole.
  out.coverage = c.keepCoverageGaps("sections.coverage", sections.coverage);
  const context = source.context as Plain;
  next.context = { ...context, coverageBySource: c.keepCoverageGaps("context.coverageBySource", context.coverageBySource) };

  // Current page rows are never reduced; at most their sourceIds/coverageRef metric references go.
  const items = sections.items as Plain[];
  if (level.stripItems) out.items = c.stripProvenanceAt("sections.items[]", items, items.length);

  if (level.stripScalars) {
    for (const key of ["summary", "changes"]) out[key] = c.stripProvenance(sections[key]);
    c.record("sections.summary,changes", 2, 2, SOURCE_REFS_OMITTED_RULE);
    if (sections.matchedRange) { out.matchedRange = { ...sections.matchedRange, metrics: c.stripProvenance(sections.matchedRange.metrics) }; c.record("sections.matchedRange.metrics", 1, 1, SOURCE_REFS_OMITTED_RULE); }
  }

  next.sections = out;
  next.aiCompaction = c.mark();
  return next;
}
