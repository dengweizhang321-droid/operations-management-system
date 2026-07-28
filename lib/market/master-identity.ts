import type { MarketSchemaDatabase } from "@/lib/market/schema-core";

const readyByDatabase = new WeakMap<object, Promise<void>>();

const latestIdentitySelectSql = `WITH ranked AS MATERIALIZED (
    SELECT id, category, scope, ranking_dimension, sku_code,
      ROW_NUMBER() OVER (
        PARTITION BY category, scope, ranking_dimension, sku_code
        ORDER BY period_end DESC, period_start DESC, id DESC
      ) identity_rank
    FROM market_ranking_entries
  )
  SELECT category, scope, ranking_dimension, sku_code, id latest_entry_id
  FROM ranked WHERE identity_rank=1`;

export async function refreshMarketMasterIdentities(db: MarketSchemaDatabase) {
  await db.batch([
    db.prepare("DELETE FROM market_master_identities"),
    db.prepare(`INSERT INTO market_master_identities
      (category, scope, ranking_dimension, sku_code, latest_entry_id, updated_at)
      SELECT category, scope, ranking_dimension, sku_code, latest_entry_id, CURRENT_TIMESTAMP
      FROM (${latestIdentitySelectSql})`),
  ]);
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
