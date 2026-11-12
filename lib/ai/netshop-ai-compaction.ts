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

export const NETSHOP_AI_COMPACTION_NOTE = "完整集合见网店页面或缩小范围重读；aiCompaction.sections 列出的路径只保留了部分条目或精简了字段，不得把保留的条目当作全集求和。coverage / coverageBySource 中缺失的键表示该来源完整无缺口（缺口条目都保留）。缺口条目里的缺失日期在改写后更短时写成 missingRanges（字符串数组，\"2026-09-01~2026-09-07\" 表示含首尾的连续日期，单日直接写 \"2026-09-01\"，可无损展开）；改写不更短时保持 dates 原样。matchedRange 的 dateRanges 同此写法。";
/** Appended when identical gap entries were grouped. */
export const NETSHOP_AI_GAP_GROUPS_NOTE = "coverage / coverageBySource 里的 _groupedByValue 是 [{refs:[覆盖键…],value:{缺口条目}}]：refs 中每个键的缺口条目都等于 value（取值完全相同才分组）；查某个 coverageRef 时先看同名键，没有再看各组 refs，两处都没有才表示该来源完整。分组不丢任何缺口条目。";
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
export const COVERAGE_GAPS_GROUPED_RULE = "coverage_gaps_grouped_by_value";
export const GAP_GROUPS_KEY = "_groupedByValue";

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

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Compact text for inclusive consecutive runs: "2026-09-01~2026-09-07", a single day as "2026-09-01". */
export function datesToRangeStrings(dates: readonly string[]): string[] {
  return datesToRanges(dates).map(range => (range.days === 1 ? range.startDate : `${range.startDate}~${range.endDate}`));
}
export function expandRangeStrings(ranges: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of ranges) {
    const [start, end = start] = text.split("~");
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    out.push(...expandDateRanges([{ startDate: start, endDate: end, days }]));
  }
  return out;
}
/**
 * Date list as `{dates}` or, only when the compact form is strictly shorter (key names included), `{[rangesKey]: string[]}`.
 * Conversion needs strictly ascending valid days, so expanding returns exactly the original list; anything else stays as is.
 */
export function compactDates<K extends string>(dates: readonly string[], rangesKey: K): { dates: string[] } | { [P in K]: string[] } {
  const ascending = dates.every((day, i) => DAY.test(day) && (i === 0 || dates[i - 1] < day));
  if (ascending) {
    const ranges = datesToRangeStrings(dates);
    if (JSON.stringify(ranges).length + rangesKey.length < JSON.stringify(dates).length + "dates".length) return { [rangesKey]: ranges } as { [P in K]: string[] };
  }
  return { dates: [...dates] };
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
   * shop-dates or is truncated stays; its missing dates become compact ranges when that is shorter.
   * Gap entries with exactly equal content are then grouped ([{refs,value}] under GAP_GROUPS_KEY) when
   * that is shorter; restoreCoverageGaps undoes both steps losslessly.
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
        kept[key] = { ...c, missingByShop: c.missingByShop.map(m => {
          const { dates, ...rest } = m as Plain;
          const compact = compactDates(dates as string[], "missingRanges");
          if (!("dates" in compact)) converted++;
          return { ...rest, ...compact };
        }) };
      } else kept[key] = value;
    }
    const keptCount = Object.keys(kept).length;
    if (keptCount < entries.length) this.record(path, entries.length, keptCount, "complete_coverage_folded_gaps_kept");
    if (converted > 0) this.record(`${path}.*.missingByShop[].dates`, converted, converted, "missing_dates_as_ranges");
    return this.groupCoverageGaps(path, kept);
  }

  private groupCoverageGaps(path: string, kept: Record<string, unknown>): Record<string, unknown> {
    if (GAP_GROUPS_KEY in kept) return kept;
    const byValue = new Map<string, string[]>();
    for (const [key, value] of Object.entries(kept)) {
      const text = JSON.stringify(value);
      byValue.set(text, [...(byValue.get(text) ?? []), key]);
    }
    const out: Record<string, unknown> = {};
    const groups: Array<{ refs: string[]; value: unknown }> = [];
    let grouped = 0;
    const done = new Set<string>();
    for (const [key, value] of Object.entries(kept)) {
      const text = JSON.stringify(value);
      const refs = byValue.get(text)!;
      const separate = refs.reduce((n, ref) => n + JSON.stringify(ref).length + 1 + text.length + 1, 0);
      if (refs.length < 2 || JSON.stringify({ refs, value }).length >= separate) { out[key] = value; continue; }
      if (done.has(text)) continue;
      done.add(text);
      groups.push({ refs, value });
      grouped += refs.length;
    }
    if (groups.length === 0) return kept;
    out[GAP_GROUPS_KEY] = groups;
    this.record(path, grouped, grouped, COVERAGE_GAPS_GROUPED_RULE);
    return out;
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
    const grouped = this.sections.some(section => section.rule === COVERAGE_GAPS_GROUPED_RULE);
    return { applied: true, sections: this.sections, note: `${NETSHOP_AI_COMPACTION_NOTE}${grouped ? NETSHOP_AI_GAP_GROUPS_NOTE : ""}${reranked ? NETSHOP_AI_RERANK_NOTE : ""}` };
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

/** Inverse of keepCoverageGaps' grouping and date rewriting: the original key -> gap entry map (complete entries were folded away on purpose). */
export function restoreCoverageGaps(kept: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(kept)) {
    if (key === GAP_GROUPS_KEY && Array.isArray(value)) for (const group of value as Array<{ refs: string[]; value: unknown }>) for (const ref of group.refs) flat[ref] = group.value;
    else flat[key] = value;
  }
  const restore = (item: unknown): unknown => {
    if (!isPlain(item) || !Array.isArray(item.missingByShop)) return item;
    return { ...item, missingByShop: item.missingByShop.map(m => {
      if (!isPlain(m) || !Array.isArray(m.missingRanges)) return m;
      const { missingRanges, ...rest } = m;
      return { ...rest, dates: expandRangeStrings(missingRanges as string[]) };
    }) };
  };
  return Object.fromEntries(Object.entries(flat).map(([key, value]) => [key, restore(value)]));
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
