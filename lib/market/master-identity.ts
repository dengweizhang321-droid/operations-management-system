import type { MarketSchemaDatabase } from "@/lib/market/schema-core";

const readyByDatabase = new WeakMap<object, Promise<void>>();

function buildLatestIdentitySelectSql(sourceFilter = "") {
  return `WITH ranked AS MATERIALIZED (
    SELECT source.id, source.category, source.scope, source.ranking_dimension, source.sku_code,
      ROW_NUMBER() OVER (
        PARTITION BY source.category, source.scope, source.ranking_dimension, source.sku_code
        ORDER BY source.period_end DESC, source.period_start DESC, source.id DESC
      ) identity_rank
    FROM market_ranking_entries source ${sourceFilter}
  )
  SELECT category, scope, ranking_dimension, sku_code, id latest_entry_id
  FROM ranked WHERE identity_rank=1`;
}

export function marketMasterIdentityRefreshStatements(db: MarketSchemaDatabase, batchId?: string) {
  if (batchId) {
    const affectedSql = `SELECT DISTINCT
        json_extract(row_json, '$.category') category,
        json_extract(row_json, '$.scope') scope,
        json_extract(row_json, '$.rankingDimension') ranking_dimension,
        json_extract(row_json, '$.skuCode') sku_code
      FROM market_import_staging_rows WHERE batch_id=?`;
    const identityMatch = `source.category=affected.category AND source.scope=affected.scope
      AND source.ranking_dimension=affected.ranking_dimension AND source.sku_code=affected.sku_code`;
    return [
      db.prepare(`DELETE FROM market_master_identities
        WHERE EXISTS (SELECT 1 FROM (${affectedSql}) affected
          WHERE market_master_identities.category=affected.category
            AND market_master_identities.scope=affected.scope
            AND market_master_identities.ranking_dimension=affected.ranking_dimension
            AND market_master_identities.sku_code=affected.sku_code)`).bind(batchId),
      db.prepare(`INSERT INTO market_master_identities
        (category, scope, ranking_dimension, sku_code, latest_entry_id, updated_at)
        SELECT category, scope, ranking_dimension, sku_code, latest_entry_id, CURRENT_TIMESTAMP
        FROM (${buildLatestIdentitySelectSql(`JOIN (${affectedSql}) affected ON ${identityMatch}`)})`)
        .bind(batchId),
    ];
  }
  return [
    db.prepare("DELETE FROM market_master_identities"),
    db.prepare(`INSERT INTO market_master_identities
      (category, scope, ranking_dimension, sku_code, latest_entry_id, updated_at)
      SELECT category, scope, ranking_dimension, sku_code, latest_entry_id, CURRENT_TIMESTAMP
      FROM (${buildLatestIdentitySelectSql()})`),
  ];
}

export async function refreshMarketMasterIdentities(db: MarketSchemaDatabase) {
  await db.batch(marketMasterIdentityRefreshStatements(db));
}

export async function ensureMarketMasterIdentities(db: MarketSchemaDatabase) {
  const key = db as object;
  let ready = readyByDatabase.get(key);
  if (!ready) {
    ready = (async () => {
      const state = await db.prepare(`SELECT
        EXISTS(SELECT 1 FROM market_ranking_entries LIMIT 1) has_source,
        EXISTS(SELECT 1 FROM market_master_identities LIMIT 1) has_cache`).first<{ has_source: number; has_cache: number }>();
      if (Number(state?.has_source ?? 0) === 1 && Number(state?.has_cache ?? 0) === 0) {
        await refreshMarketMasterIdentities(db);
      }
    })();
    readyByDatabase.set(key, ready);
    ready.catch(() => readyByDatabase.delete(key));
  }
  await ready;
}
