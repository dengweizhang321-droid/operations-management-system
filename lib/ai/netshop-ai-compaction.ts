/**
 * Model-facing compaction for the two netshop insight tools.
 *
 * Contract: every function here runs only on a response that already passed the
 * owning decoder (version, source, scope, owner-header checks). Nothing here
 * validates, repairs or relaxes the source DTO; it only builds a smaller view
 * and records every reduction in `aiCompaction`. Callers use it only when the
 * complete envelope is over budget; a still-oversized result must be refused,
 * never truncated as text.
 */

export const NETSHOP_AI_COMPACTION_NOTE = "完整集合见网店页面或缩小范围重读；aiCompaction.sections 列出的路径只保留了部分条目或精简了字段，不得把保留的条目当作全集求和。coverage / coverageBySource 中缺失的键表示该来源完整无缺口（缺口条目都保留）。缺口条目里的缺失日期改用 missingRanges（[{startDate,endDate,days}]，连续日期合并，左右端点都包含，可无损展开）表示。";
/** Appended when any list was re-ranked by a metric because the source order is not a business ranking. */
export const NETSHOP_AI_RERANK_NOTE = "规则名含 by_payment_desc / by_spend_desc 的列表来源并非业务排序（按标签或店名排列），已按该指标降序重排后选取，不是来源顺序。";

export type AiCompactionSection = { path: string; originalCount: number; keptCount: number; rule: string };
export type AiCompactionMark = { applied: true; sections: AiCompactionSection[]; note: string };

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Only references to where a metric came from. `basis` (product_day_sum / platform_attributed /
 * unverified ...) and `aggregation` (sum / ratio_of_sums ...) are the metric's definition (口径)
 * and always stay, as do value/unit/status/reasonCode.
 */
const PROVENANCE_KEYS = ["sourceIds", "coverageRef"] as const;
export const SOURCE_REFS_OMITTED_RULE = "metric_source_refs_omitted";

export type DateRange = { startDate: string; endDate: string; days: number };
/** Consecutive days merged into inclusive ranges (same output shape as the shared context projection's ranges). */
export function datesToRanges(dates: readonly string[]): DateRange[] {
  const result: DateRange[] = [];
  for (const day of [...dates].sort()) {
    const last = result.at(-1);
    if (last && Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last.endDate}T00:00:00Z`) === 86_400_000) { last.endDate = day; last.days++; }
    else result.push({ startDate: day, endDate: day, days: 1 });
  }
  return result;
}
export function expandDateRanges(ranges: readonly DateRange[]): string[] {
  const out: string[] = [];
  for (const range of ranges) for (let i = 0; i < range.days; i++) out.push(new Date(Date.parse(`${range.startDate}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Top `limit` by a metric: descending, null last, stable on ties. Does not record anything. */
export function selectTopBy<T>(list: readonly T[], limit: number, score: (item: T) => number | null): T[] {
  const ranked = list.map((item, index) => ({ item, index, value: score(item) }));
  ranked.sort((a, b) => (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) || (b.value ?? 0) - (a.value ?? 0) || a.index - b.index);
  return ranked.slice(0, limit).map(entry => entry.item);
}

export class NetshopAiCompaction {
  readonly sections: AiCompactionSection[] = [];

  record(path: string, originalCount: number, keptCount: number, rule: string) {
    this.sections.push({ path, originalCount, keptCount, rule });
  }

  /**
   * Keep `limit` entries chosen by a metric (descending, null last, stable). Use only where the
   * source order is NOT a business ranking; the rule name must say so (…_by_<metric>_desc).
   */
  keepTopBy<T>(path: string, list: readonly T[], limit: number, score: (item: T) => number | null, rule: string): T[] {
    if (list.length <= limit) return [...list];
    this.record(path, list.length, limit, rule);
    return selectTopBy(list, limit, score);
  }

  /**
   * Fold only complete, gap-free coverage entries away. Any entry that is incomplete, has missing
   * shop-dates or is truncated stays; its missing dates become lossless inclusive ranges.
   */
  keepCoverageGaps(path: string, coverage: Record<string, unknown>): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    const entries = Object.entries(coverage);
    let converted = 0;
    for (const [key, value] of entries) {
      const c = isPlain(value) ? value : null;
      const normal = c !== null && c.complete === true && Array.isArray(c.missingByShop) && c.missingByShop.length === 0 && c.truncated === false;
      if (normal) continue;
      if (c !== null && Array.isArray(c.missingByShop) && c.missingByShop.every(m => isPlain(m) && Array.isArray(m.dates))) {
        if (c.missingByShop.length > 0) converted++;
        kept[key] = { ...c, missingByShop: c.missingByShop.map(m => { const { dates, ...rest } = m as Plain; return { ...rest, missingRanges: datesToRanges(dates as string[]) }; }) };
      } else kept[key] = value;
    }
    const keptCount = Object.keys(kept).length;
    if (keptCount < entries.length) this.record(path, entries.length, keptCount, "complete_coverage_folded_gaps_kept");
    if (converted > 0) this.record(`${path}.*.missingByShop[].dates`, converted, converted, "missing_dates_as_ranges");
    return kept;
  }

  /** Drop source-reference fields (sourceIds, coverageRef) from metrics below `value`; returns a new tree. */
  stripProvenance<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => this.stripProvenance(item)) as T;
    if (!isPlain(value)) return value;
    const out: Plain = {};
    const metricLike = "status" in value;
    for (const [key, child] of Object.entries(value)) {
      if (metricLike && (PROVENANCE_KEYS as readonly string[]).includes(key)) continue;
      out[key] = this.stripProvenance(child);
    }
    return out as T;
  }

  /** Same as stripProvenance, but records the reduction for the path. */
  stripProvenanceAt<T>(path: string, value: T, count: number): T {
    this.record(path, count, count, SOURCE_REFS_OMITTED_RULE);
    return this.stripProvenance(value);
  }

  mark(): AiCompactionMark {
    const reranked = this.sections.some(section => /by_(payment|spend)_desc/.test(section.rule));
    return { applied: true, sections: this.sections, note: reranked ? `${NETSHOP_AI_COMPACTION_NOTE}${NETSHOP_AI_RERANK_NOTE}` : NETSHOP_AI_COMPACTION_NOTE };
  }
}

/** Ranking-basis view of a metric: value, unit, status, basis and a non-null reasonCode. */
export function briefMetric(metric: unknown): Plain | null {
  if (!isPlain(metric)) return null;
  const out: Plain = { value: metric.value, unit: metric.unit, status: metric.status, basis: metric.basis };
  if (metric.aggregation !== undefined) out.aggregation = metric.aggregation;
  if (metric.reasonCode !== null && metric.reasonCode !== undefined) out.reasonCode = metric.reasonCode;
  return out;
}

export function aiEnvelopeLength(toolName: string, data: unknown) {
  return JSON.stringify({ ok: true, toolName, data }).length;
}

/**
 * Return the owner DTO unchanged when its complete envelope fits; otherwise the
 * compacted view. Compaction stages are tried from lightest to heaviest and the
 * first one that fits wins; none fitting means refuse (null).
 */
export function fitNetshopAiResult(
  toolName: string,
  data: Record<string, unknown>,
  maxCharacters: number,
  stages: Array<(data: Record<string, unknown>) => Record<string, unknown>>,
): Record<string, unknown> | null {
  if (aiEnvelopeLength(toolName, data) <= maxCharacters) return { ...data };
  for (const stage of stages) {
    const candidate = stage(data);
    if (aiEnvelopeLength(toolName, candidate) <= maxCharacters) return candidate;
  }
  return null;
}
