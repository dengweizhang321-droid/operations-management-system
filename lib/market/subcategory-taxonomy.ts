import { DEFAULT_MARKET_SEGMENTS } from "@/lib/market/default-taxonomy";
import type { MarketSchemaDatabase } from "@/lib/market/schema-core";

const taxonomyBackfillMarker = "market-subcategory-taxonomy-v1";

export function marketSubcategoryTaxonomyId(category: string, subcategory: string) {
  return `market-subcategory-${category.length}:${category}${subcategory.length}:${subcategory}`;
}

async function tableNames(db: MarketSchemaDatabase) {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'market_%'").all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name));
}

export async function upsertMarketSubcategoryTaxonomy(
  db: MarketSchemaDatabase,
  values: Array<{ category: string; subcategory: string; sortOrder?: number }>,
  actor = "system",
) {
  const unique = [...new Map(values
    .map((item) => ({ category: item.category.trim().slice(0, 120), subcategory: item.subcategory.trim().slice(0, 120), sortOrder: item.sortOrder ?? 999 }))
    .filter((item) => item.category && item.subcategory)
    .map((item) => [`${item.category}\u0000${item.subcategory}`, item])).values()];
  for (let offset = 0; offset < unique.length; offset += 80) {
    await db.batch(unique.slice(offset, offset + 80).map((item) => db.prepare(`INSERT INTO market_subcategory_taxonomy
      (id, category, subcategory, status, sort_order, created_by, updated_by)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(category, subcategory) DO UPDATE SET status='active', updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
      .bind(marketSubcategoryTaxonomyId(item.category, item.subcategory), item.category, item.subcategory, item.sortOrder, actor, actor)));
  }
}

export async function listMarketSubcategoryTaxonomy(db: MarketSchemaDatabase, category: string) {
  const rows = await db.prepare(`SELECT subcategory FROM market_subcategory_taxonomy
    WHERE category=? AND status='active' ORDER BY sort_order, subcategory`).bind(category.trim().slice(0, 120)).all<{ subcategory: string }>();
  return (rows.results ?? []).map((row) => row.subcategory);
}

export async function ensureMarketSubcategoryTaxonomyData(db: MarketSchemaDatabase) {
  const marker = await db.prepare(`SELECT id FROM market_master_audit_logs
    WHERE entity_type='runtime_schema' AND entity_id=? LIMIT 1`).bind(taxonomyBackfillMarker).first<{ id: string }>();
  if (marker) return;

  await upsertMarketSubcategoryTaxonomy(db, Object.entries(DEFAULT_MARKET_SEGMENTS).flatMap(([category, segments]) =>
    segments.map((subcategory, sortOrder) => ({ category, subcategory, sortOrder }))), "system-default");

  const tables = await tableNames(db);
  const sources = [
    tables.has("market_ranking_entries") ? `SELECT category, subcategory FROM market_ranking_entries WHERE category<>'' AND subcategory<>''` : "",
    tables.has("market_sku_annotations") ? `SELECT category, segment subcategory FROM market_sku_annotations WHERE category<>'' AND segment<>''` : "",
    tables.has("market_annotation_items") ? `SELECT category, ai_segment subcategory FROM market_annotation_items WHERE category<>'' AND ai_segment<>''
      UNION SELECT category, reviewed_segment subcategory FROM market_annotation_items WHERE category<>'' AND reviewed_segment<>''` : "",
    tables.has("market_annotation_prompt_versions") ? `SELECT p.category, CAST(j.value AS TEXT) subcategory
      FROM market_annotation_prompt_versions p, json_each(p.segments_json) j
      WHERE p.category<>'' AND p.status<>'deleted' AND TRIM(CAST(j.value AS TEXT))<>''` : "",
  ].filter(Boolean);
  for (const source of sources) {
    await db.prepare(`INSERT OR IGNORE INTO market_subcategory_taxonomy
      (id, category, subcategory, status, sort_order, created_by, updated_by)
      SELECT 'market-subcategory-live-' || lower(hex(category)) || '-' || lower(hex(subcategory)), category, subcategory,
        'active', 999, 'system-migration', 'system-migration' FROM (${source}) GROUP BY category, subcategory`).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO market_master_audit_logs
    (id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
    VALUES (?, 'system', 'system', 'backfill_subcategory_taxonomy', 'runtime_schema', ?, '{}', '{"version":1}')`)
    .bind(taxonomyBackfillMarker, taxonomyBackfillMarker).run();
}
