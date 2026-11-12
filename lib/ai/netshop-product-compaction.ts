import { briefMetric, NetshopAiCompaction, SOURCE_REFS_OMITTED_RULE } from "./netshop-ai-compaction";

/**
 * Product list view for the model. Input is a DTO the real decoder accepted.
 * Levels go from light to heavy; the caller takes the first level whose whole
 * envelope fits 40000 characters and refuses when none does.
 *
 * Source order facts (backend/netshop/product_insights.py):
 *  - sections.growth.data.items: one page (page/pageSize of the request) of the paired set ordered by
 *    payment delta (growth_desc: -delta, decline_desc: delta; line ~390). Source-ranked, so the first N
 *    of that page are the biggest movers on the page, not of the whole set.
 *  - sections.efficiency.watchlist: one page of the qualified low-conversion set ordered by -visitors
 *    (line ~555). Source-ranked by visitors.
 *  - sections.structure.categories / priceBands: `GROUP BY 1 ORDER BY 1` (line ~491), i.e. alphabetical
 *    by label. NOT a business ranking. Price bands are at most 5 fixed labels and are always kept whole;
 *    categories are kept whole when possible, else the top N by payment (re-ranked).
 */
export type ProductCompactionLevel = {
  /** First N ranking rows of the source-ranked growth page and watchlist; null keeps every row. */
  topN: number | null;
  /** Category buckets kept; null keeps all. A reduced set is the top N by payment (re-ranked). */
  categoriesTop: number | null;
  /** Current page rows: verbatim, or minimally slimmed. All metrics and comparisons stay. */
  slimPage: boolean;
  /** Omit sourceIds/coverageRef from scalar summary blocks. */
  stripScalars: boolean;
};

export const productCompactionLadder: ProductCompactionLevel[] = [
  { topN: null, categoriesTop: null, slimPage: false, stripScalars: false },
  { topN: null, categoriesTop: null, slimPage: true, stripScalars: true },
  { topN: null, categoriesTop: 10, slimPage: true, stripScalars: true },
  { topN: null, categoriesTop: 5, slimPage: true, stripScalars: true },
  { topN: 5, categoriesTop: 5, slimPage: true, stripScalars: true },
  { topN: 3, categoriesTop: 5, slimPage: true, stripScalars: true },
  { topN: 1, categoriesTop: 5, slimPage: true, stripScalars: true },
];

export const PRODUCT_RANK_ROW_RULE = "ranking_rows(identity,title,rankBasis)";
export const PRODUCT_PAGE_SLIM_RULE = "page_rows_slimmed(-baselineMetrics,-imageUrl,-productUrl,-categoryEvidence,-metric.sourceIds,-metric.coverageRef)";

type Plain = Record<string, any>;
const paymentOf = (bucket: Plain) => (typeof bucket.payment?.value === "number" ? bucket.payment.value : null);

export function compactProductInsightsForAi(data: Record<string, unknown>, level: ProductCompactionLevel): Record<string, unknown> {
  const c = new NetshopAiCompaction();
  const source = data as Plain;
  const sections = source.sections as Plain;
  const out: Plain = { ...sections };
  const next: Plain = { ...source };

  /** Ranking row: identity + title + the metrics the list is ordered/qualified by (the detail is the product page). */
  const growthRank = (row: Plain) => ({ identity: row.identity, title: row.title, rankBasis: row.paymentDelta ? { paymentDelta: briefMetric(row.paymentDelta) } : { payment: briefMetric(row.metrics?.payment) } });
  const watchRank = (row: Plain) => ({ identity: row.identity, title: row.title, rankBasis: { visitors: briefMetric(row.metrics?.visitors), conversion: briefMetric(row.metrics?.conversion) } });
  const rank = (path: string, rows: Plain[], rule: string, build: (row: Plain) => Plain) => {
    const kept = level.topN === null ? rows : rows.slice(0, level.topN);
    if (rows.length > 0) c.record(path, rows.length, kept.length, `${kept.length < rows.length ? `${rule}; ` : ""}${PRODUCT_RANK_ROW_RULE}`);
    return kept.map(build);
  };

  const growth = sections.growth as Plain | undefined;
  if (growth && growth.state === "ready" && growth.data) {
    out.growth = { ...growth, data: { ...growth.data, items: rank("sections.growth.data.items", growth.data.items as Plain[], `first_${level.topN}_of_ranked_page_by_payment_delta`, growthRank) } };
  }
  const efficiency = sections.efficiency as Plain | undefined;
  if (efficiency) {
    const hasWatchlist = Array.isArray(efficiency.watchlist);
    out.efficiency = hasWatchlist ? { ...efficiency, watchlist: rank("sections.efficiency.watchlist", efficiency.watchlist as Plain[], `first_${level.topN}_of_ranked_page_by_visitors_desc`, watchRank) } : { ...efficiency };
    if (level.stripScalars) {
      const { watchlist: keptWatchlist, ...rest } = out.efficiency;
      out.efficiency = hasWatchlist ? { ...c.stripProvenance({ ...rest, watchlist: [] }), watchlist: keptWatchlist } : c.stripProvenance(rest);
      c.record("sections.efficiency", 1, 1, SOURCE_REFS_OMITTED_RULE);
    }
  }
  const structure = sections.structure as Plain | undefined;
  if (structure) {
    const categories = structure.categories as Plain[];
    out.structure = {
      ...structure,
      // Source order is alphabetical by label; a reduced set is chosen by payment, not by position.
      categories: level.categoriesTop === null ? categories : c.keepTopBy("sections.structure.categories", categories, level.categoriesTop, paymentOf, `top_${level.categoriesTop}_by_payment_desc`),
      priceBands: structure.priceBands,
    };
    if (level.stripScalars) { out.structure = c.stripProvenance(out.structure); c.record("sections.structure", 1, 1, SOURCE_REFS_OMITTED_RULE); }
  }

  // Coverage: only complete, gap-free entries are folded; gaps stay (dates as ranges).
  const context = source.context as Plain;
  next.context = { ...context, coverageBySource: c.keepCoverageGaps("context.coverageBySource", context.coverageBySource) };

  // Current page rows: identity, every metric, every comparison, paymentDelta stay; only the listed duplicates go.
  if (level.slimPage && Array.isArray(sections.items)) {
    const items = sections.items as Plain[];
    out.items = items.map(row => {
      const { baselineMetrics: _baseline, imageUrl: _image, productUrl: _url, categoryEvidence: _evidence, ...rest } = row;
      return c.stripProvenance(rest);
    });
    c.record("sections.items[]", items.length, items.length, PRODUCT_PAGE_SLIM_RULE);
  }
  if (level.stripScalars) {
    for (const key of ["summary", "counts", "dataQuality"]) if (sections[key] !== undefined) out[key] = c.stripProvenance(sections[key]);
    c.record("sections.summary,counts,dataQuality", 3, 3, SOURCE_REFS_OMITTED_RULE);
    if (sections.baselineReads !== undefined) { out.baselineReads = c.stripProvenance(sections.baselineReads); c.record("sections.baselineReads", 2, 2, SOURCE_REFS_OMITTED_RULE); }
  }

  next.sections = out;
  next.aiCompaction = c.mark();
  return next;
}
