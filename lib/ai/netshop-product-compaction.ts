import { NetshopAiCompaction } from "./netshop-ai-compaction";

/**
 * Product list view for the model. Input is a DTO the real decoder accepted.
 * Levels go from light to heavy; the caller takes the first level whose whole
 * envelope fits 40000 characters and refuses when none does.
 */
export type ProductCompactionLevel = {
  /** Top N for growth rows, watchlist rows and structure buckets. */
  topN: number;
  /** verbatim: current page untouched; strip: provenance fields omitted. */
  items: "verbatim" | "strip";
  /** Omit provenance-only metric fields from scalar summary blocks and retained rows. */
  stripScalars: boolean;
  /** Rows in growth/watchlist drop baselineMetrics (comparisons already carry the deltas). */
  leanSideRows: boolean;
};

export const productCompactionLadder: ProductCompactionLevel[] = [
  { topN: 5, items: "verbatim", stripScalars: false, leanSideRows: false },
  { topN: 5, items: "strip", stripScalars: true, leanSideRows: true },
  { topN: 3, items: "strip", stripScalars: true, leanSideRows: true },
  { topN: 1, items: "strip", stripScalars: true, leanSideRows: true },
];

type Plain = Record<string, any>;

export function compactProductInsightsForAi(data: Record<string, unknown>, level: ProductCompactionLevel): Record<string, unknown> {
  const c = new NetshopAiCompaction();
  const source = data as Plain;
  const sections = source.sections as Plain;
  const out: Plain = { ...sections };
  const next: Plain = { ...source };

  const sideRow = (row: Plain) => {
    if (!level.leanSideRows) return row;
    const { baselineMetrics: _omitted, ...rest } = row;
    return c.stripProvenance(rest);
  };
  const keepRows = (path: string, rows: Plain[]) => {
    const kept = c.keepTop(path, rows, level.topN);
    if (level.leanSideRows && rows.length > 0) c.record(`${path}[]`, rows.length, kept.length, "baseline_metrics_and_provenance_omitted");
    return kept.map(sideRow);
  };

  // Paired-set growth ranking: Top N in the owning reader's order. State/pagination stay.
  const growth = sections.growth as Plain | undefined;
  if (growth && growth.state === "ready" && growth.data) {
    out.growth = { ...growth, data: { ...growth.data, items: keepRows("sections.growth.data.items", growth.data.items as Plain[]) } };
  }
  // Efficiency watchlist: Top N; rules/scanned/qualified/pagination keep the full-set facts.
  const efficiency = sections.efficiency as Plain | undefined;
  if (efficiency) {
    out.efficiency = { ...efficiency, watchlist: keepRows("sections.efficiency.watchlist", efficiency.watchlist as Plain[]) };
    if (level.stripScalars) { out.efficiency = c.stripProvenance(out.efficiency); c.record("sections.efficiency", 1, 1, "metric_provenance_omitted"); }
  }
  // Structure buckets: Top N; the complete denominator/top5/top10/classification stay whole.
  const structure = sections.structure as Plain | undefined;
  if (structure) {
    out.structure = {
      ...structure,
      categories: c.keepTop("sections.structure.categories", structure.categories as Plain[], level.topN),
      priceBands: c.keepTop("sections.structure.priceBands", structure.priceBands as Plain[], level.topN),
    };
    if (level.stripScalars) { out.structure = c.stripProvenance(out.structure); c.record("sections.structure", 1, 1, "metric_provenance_omitted"); }
  }

  // Coverage: only complete, gap-free entries are folded; gaps stay whole.
  const context = source.context as Plain;
  next.context = { ...context, coverageBySource: c.keepCoverageGaps("context.coverageBySource", context.coverageBySource) };

  if (level.items === "strip") {
    const items = sections.items as Plain[];
    out.items = c.stripProvenanceAt("sections.items[]", items, items.length);
  }
  if (level.stripScalars) {
    for (const key of ["summary", "counts", "dataQuality"]) if (sections[key] !== undefined) out[key] = c.stripProvenance(sections[key]);
    c.record("sections.summary,counts,dataQuality", 3, 3, "metric_provenance_omitted");
    if (sections.baselineReads !== undefined) { out.baselineReads = c.stripProvenance(sections.baselineReads); c.record("sections.baselineReads", 2, 2, "metric_provenance_omitted"); }
  }

  next.sections = out;
  next.aiCompaction = c.mark();
  return next;
}
