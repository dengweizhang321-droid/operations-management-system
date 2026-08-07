export type NetshopImportBatchListFilters = {
  limit?: number;
  ids?: string[];
  sources?: string[];
  platforms?: string[];
  shops?: string[];
};

/** Normalizes bounded filters and keeps every user value as a SQL binding. */
export function buildNetshopImportBatchListQuery(input: NetshopImportBatchListFilters = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
  const bounded = (values: string[] | undefined, maximum: number) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
  const ids = bounded(input.ids, 20);
  const sources = bounded(input.sources, 20);
  const platforms = bounded(input.platforms, 20);
  const shops = bounded(input.shops, 50);
  const where: string[] = [];
  const bindings: string[] = [];
  if (ids.length) { where.push(`id IN (${ids.map(() => "?").join(", ")})`); bindings.push(...ids); }
  if (sources.length) { where.push(`source IN (${sources.map(() => "?").join(", ")})`); bindings.push(...sources); }
  if (platforms.length) { where.push(`platform IN (${platforms.map(() => "?").join(", ")})`); bindings.push(...platforms); }
  if (shops.length) { where.push(`shop_name IN (${shops.map(() => "?").join(", ")})`); bindings.push(...shops); }
  return { limit, whereSql: where.join(" AND "), bindings };
}
