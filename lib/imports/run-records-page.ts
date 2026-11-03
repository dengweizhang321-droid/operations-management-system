import type { ImportRecord, ImportRecordsPage } from "./run-records-contract";
import { PublicApiError } from "@/lib/http/api-error";

export type RecordReader = (page: number, size: number) => Promise<ImportRecordsPage & { revision?: string | null }>;

function unavailable() { return new PublicApiError(503, "service_unavailable", "运行记录来源不完整或读取期间发生变化，请刷新重试。不能据此判断记录不存在。"); }

function validate(result: ImportRecordsPage) {
  const p = result.pagination;
  if (!p || !Number.isSafeInteger(p.total) || p.total < 0 || !Array.isArray(result.items) || p.returned !== result.items.length || !Array.isArray(result.sources)
    || result.items.some((item) => !item.id || !item.sourceKey || !Number.isFinite(Date.parse(item.sortAt)))) throw unavailable();
}

/** Merge bounded, identically ordered SQL pages. Never send domain prefixes to the browser. */
export async function readImportRecordsPage(readers: RecordReader[], page: number, pageSize: number): Promise<ImportRecordsPage> {
  const chunk = Math.min(100, page * pageSize);
  const initial = await Promise.all(readers.map((read) => read(1, chunk)));
  initial.forEach(validate);
  const total = initial.reduce((sum, result) => sum + result.pagination.total, 0);
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const end = current * pageSize;
  // Bounded deep-page cost; never pretend the cap is the true dataset size.
  if (end > 10000) throw new PublicApiError(400, "invalid_request", "联合运行记录最多翻阅前 10000 条，请缩小数据类型或状态筛选后查询。");
  const groups = await Promise.all(initial.map(async (first, index) => {
    const items = [...first.items];
    const required = Math.min(end, first.pagination.total);
    while (items.length < required) {
      const next = await readers[index](items.length / chunk + 1, chunk);
      validate(next);
      if (next.pagination.total !== first.pagination.total || next.revision !== first.revision || !next.items.length) throw unavailable();
      items.push(...next.items);
    }
    return items;
  }));
  const compare = (a: ImportRecord, b: ImportRecord) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0)
    || (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rows = groups.flat().sort(compare);
  const offset = (current - 1) * pageSize;
  const items = rows.slice(offset, end);
  const truncated = offset + items.length < total;
  return { items, sources: [...new Map(initial.flatMap((result) => result.sources).map((source) => [source.key, source])).values()],
    pagination: { page: current, pageSize, total, returned: items.length, truncated, completeness: truncated ? "truncated_do_not_infer_absence" : "complete" } };
}
