import { NetshopAiCompaction } from "./netshop-ai-compaction";

/**
 * Promotion list view for the model. Input is a DTO the real decoder accepted.
 * Levels go from light to heavy; the caller takes the first level whose whole
 * envelope fits 40000 characters and refuses when none does.
 */
export type PromotionCompactionLevel = {
  /** Top N per ranked contribution list and for shop rows. */
  topN: number;
  /** Newest trend points kept (chronological). */
  trendPoints: number;
  /** verbatim: current page untouched; strip: provenance fields omitted; lean: essential fields only. */
  items: "verbatim" | "strip" | "lean";
  /** Omit provenance-only fields from the scalar summary blocks. */
  stripScalars: boolean;
};

export const promotionCompactionLadder: PromotionCompactionLevel[] = [
  { topN: 5, trendPoints: 14, items: "verbatim", stripScalars: false },
  { topN: 5, trendPoints: 14, items: "strip", stripScalars: true },
  { topN: 3, trendPoints: 7, items: "strip", stripScalars: true },
  { topN: 2, trendPoints: 3, items: "lean", stripScalars: true },
  { topN: 1, trendPoints: 2, items: "lean", stripScalars: true },
];

type Plain = Record<string, any>;
const pick = (source: Plain | null | undefined, keys: readonly string[]) => {
  const out: Plain = {};
  if (!source) return out;
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
};
const ROW_KEYS = ["rowKey", "id", "platform", "shopKey", "shopName", "objectKind", "identityKind", "title", "planId", "unitId", "matchType", "coverageRef", "drillable"] as const;
const KEY_METRICS = ["spend", "attributedPayment", "roas"] as const;
const PAY_COMPARISONS = ["spend", "attributedPayment"] as const;

export function compactPromotionInsightsForAi(data: Record<string, unknown>, level: PromotionCompactionLevel): Record<string, unknown> {
  const c = new NetshopAiCompaction();
  const source = data as Plain;
  const sections = source.sections as Plain;
  const next: Plain = { ...source };
  const out: Plain = { ...sections };

  /** Essential-fields projection used for ranked/aux rows; keeps ids, mapping state, key metrics and deltas. */
  // Ranked/aux rows: identity, mapping state, key metric values and the ranking basis (changes.*.previous).
  const leanRow = (row: Plain) => ({
    ...pick(row, ROW_KEYS),
    mapping: row.mapping ? { status: row.mapping.status, linkIdentity: row.mapping.linkIdentity } : row.mapping,
    metrics: c.stripProvenance(pick(row.metrics, KEY_METRICS)),
    changes: c.stripProvenance(Object.fromEntries(PAY_COMPARISONS.map(key => [key, { previous: row.changes?.[key]?.previous }]))),
  });

  // Ranked contribution lists: Top N in the owning reader's order, lean rows.
  const contributions = sections.contributions as Plain;
  const lists = contributions.previous as Record<string, Plain[]>;
  const keptLists: Record<string, Plain[]> = {};
  for (const [key, rows] of Object.entries(lists)) {
    const top = c.keepTop(`sections.contributions.previous.${key}`, rows, level.topN);
    keptLists[key] = top.map(leanRow);
    if (rows.length > 0) c.record(`sections.contributions.previous.${key}[]`, rows.length, top.length, "lean_row_fields");
  }
  out.contributions = { ...contributions, previous: keptLists };

  // Shops: Top N in source order, lean rows (matchedRange kept for its gap info).
  // Shop and current-page rows keep their own period comparisons and both deltas.
  const richRow = (row: Plain) => ({ ...leanRow(row), comparisons: pick(row.comparisons, PAY_COMPARISONS), changes: c.stripProvenance(row.changes), spendShare: c.stripProvenance(row.spendShare) });
  const shops = sections.shops as Plain;
  const shopRows = shops.items as Plain[];
  const topShops = c.keepTop("sections.shops.items", shopRows, level.topN);
  out.shops = { ...shops, items: topShops.map(shop => ({ ...richRow(shop), ...pick(shop, ["matchedRange"]) })) };
  if (shopRows.length > 0) c.record("sections.shops.items[]", shopRows.length, topShops.length, "lean_row_fields");

  // Trend: newest points, key metrics only.
  const trend = sections.trend as Plain;
  const trendRows = trend.items as Plain[];
  const latest = c.keepLatest("sections.trend.items", trendRows, level.trendPoints);
  out.trend = { ...trend, items: latest.map(point => ({ ...pick(point, ["startDate", "endDate", "days", "truncatedPeriod", "coverageRef"]), metrics: c.stripProvenance(pick(point.metrics, KEY_METRICS)) })) };
  if (trendRows.length > 0) c.record("sections.trend.items[]", trendRows.length, latest.length, "lean_row_fields");

  // Coverage: only complete, gap-free entries are folded; gaps stay whole.
  out.coverage = c.keepCoverageGaps("sections.coverage", sections.coverage);
  const context = source.context as Plain;
  next.context = { ...context, coverageBySource: c.keepCoverageGaps("context.coverageBySource", context.coverageBySource) };

  // Current page: verbatim first, then provenance-free, last resort lean.
  const items = sections.items as Plain[];
  if (level.items === "strip") out.items = c.stripProvenanceAt("sections.items[]", items, items.length);
  if (level.items === "lean") { out.items = items.map(richRow); c.record("sections.items[]", items.length, items.length, "lean_row_fields"); }

  if (level.stripScalars) {
    for (const key of ["summary", "changes"]) out[key] = c.stripProvenance(sections[key]);
    c.record("sections.summary,changes", 2, 2, "metric_provenance_omitted");
    if (sections.matchedRange) { out.matchedRange = { ...sections.matchedRange, metrics: c.stripProvenance(sections.matchedRange.metrics) }; c.record("sections.matchedRange.metrics", 1, 1, "metric_provenance_omitted"); }
  }

  next.sections = out;
  next.aiCompaction = c.mark();
  return next;
}
