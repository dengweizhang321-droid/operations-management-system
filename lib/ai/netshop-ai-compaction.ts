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

export const NETSHOP_AI_COMPACTION_NOTE = "完整集合见网店页面或缩小范围重读；aiCompaction.sections 列出的路径只保留了部分条目或精简了字段，不得把保留的条目当作全集求和。";

export type AiCompactionSection = { path: string; originalCount: number; keptCount: number; rule: string };
export type AiCompactionMark = { applied: true; sections: AiCompactionSection[]; note: string };

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain => value !== null && typeof value === "object" && !Array.isArray(value);

/** Fields that only describe where a metric came from; value/unit/status/reason stay. */
const PROVENANCE_KEYS = ["sourceIds", "basis", "aggregation", "coverageRef"] as const;

export class NetshopAiCompaction {
  readonly sections: AiCompactionSection[] = [];

  record(path: string, originalCount: number, keptCount: number, rule: string) {
    this.sections.push({ path, originalCount, keptCount, rule });
  }

  /** Keep the first `limit` entries in source order (the owning reader's ranking). */
  keepTop<T>(path: string, list: readonly T[], limit: number, rule = `top_${limit}_in_source_order`): T[] {
    if (list.length <= limit) return [...list];
    this.record(path, list.length, limit, rule);
    return list.slice(0, limit);
  }

  /** Keep the newest `limit` entries of a chronological list. */
  keepLatest<T>(path: string, list: readonly T[], limit: number): T[] {
    if (list.length <= limit) return [...list];
    this.record(path, list.length, limit, `latest_${limit}_points`);
    return list.slice(list.length - limit);
  }

  /**
   * Fold only complete, gap-free coverage entries away. Any entry that is
   * incomplete, has missing shop-dates or is truncated stays whole.
   */
  keepCoverageGaps(path: string, coverage: Record<string, unknown>): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    const entries = Object.entries(coverage);
    for (const [key, value] of entries) {
      const c = isPlain(value) ? value : null;
      const normal = c !== null && c.complete === true && Array.isArray(c.missingByShop) && c.missingByShop.length === 0 && c.truncated === false;
      if (!normal) kept[key] = value;
    }
    const keptCount = Object.keys(kept).length;
    if (keptCount < entries.length) this.record(path, entries.length, keptCount, "complete_coverage_folded_gaps_kept");
    return kept;
  }

  /** Drop provenance-only metric fields below `value`; returns a new tree. */
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
    this.record(path, count, count, "metric_provenance_omitted");
    return this.stripProvenance(value);
  }

  mark(): AiCompactionMark {
    return { applied: true, sections: this.sections, note: NETSHOP_AI_COMPACTION_NOTE };
  }
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
