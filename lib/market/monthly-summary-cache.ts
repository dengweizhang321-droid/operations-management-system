import { buildMarketMonthlySummaryRefreshSql } from "@/lib/market/overview-sql";

type CacheStatement = {
  bind(...values: unknown[]): CacheStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

export type MonthlySummaryCacheDatabase = {
  prepare(sql: string): CacheStatement;
  batch(statements: CacheStatement[]): Promise<unknown>;
};

export type MonthlySummaryCacheFilters = {
  startDate?: string;
  endDate?: string;
};

type MonthlySummaryCacheState = {
  source_revision: number;
  built_revision: number;
  status: string;
};

const refreshByDatabase = new WeakMap<object, Promise<boolean>>();
const triggersByDatabase = new WeakMap<object, Promise<void>>();
const bumpSql = `UPDATE market_monthly_summary_cache_state
  SET source_revision=source_revision+1,status='stale' WHERE id=1`;
const revisionSql = `(SELECT source_revision FROM market_monthly_summary_cache_state WHERE id=1)`;

function dirtyKeySql(reference: "OLD" | "NEW") {
  return `INSERT INTO market_monthly_summary_dirty_keys
    (category,scope,ranking_dimension,sku_code,month,dirty_revision)
    VALUES (${reference}.category,${reference}.scope,${reference}.ranking_dimension,${reference}.sku_code,substr(${reference}.period_end,1,7),${revisionSql})
    ON CONFLICT(category,scope,ranking_dimension,sku_code,month) DO UPDATE
    SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`;
}

function dirtyPriceSql(reference: "OLD" | "NEW") {
  return `INSERT INTO market_monthly_summary_dirty_keys
    (category,scope,ranking_dimension,sku_code,month,dirty_revision)
    VALUES (${reference}.category,${reference}.scope,${reference}.ranking_dimension,${reference}.sku_code,${reference}.month,${revisionSql})
    ON CONFLICT(category,scope,ranking_dimension,sku_code,month) DO UPDATE
    SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`;
}

function dirtyScopeValueSql(categorySql: string) {
  return `INSERT INTO market_monthly_summary_dirty_scopes (category,dirty_revision)
    VALUES (${categorySql},${revisionSql})
    ON CONFLICT(category) DO UPDATE SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`;
}

function dirtyScopeSelectSql(selectSql: string) {
  return `INSERT INTO market_monthly_summary_dirty_scopes (category,dirty_revision)
    SELECT category,${revisionSql} ${selectSql}
    ON CONFLICT(category) DO UPDATE SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`;
}

function dirtyProductsSql(valuesSql: string) {
  return `INSERT INTO market_monthly_summary_dirty_products (product_code,dirty_revision)
    SELECT value,${revisionSql} FROM json_each(json_array(${valuesSql})) WHERE value<>''
    ON CONFLICT(product_code) DO UPDATE SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`;
}

export const monthlySummaryTriggerStatements = [
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_market_insert AFTER INSERT ON market_ranking_entries BEGIN
    ${bumpSql}; ${dirtyKeySql("NEW")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_market_update AFTER UPDATE ON market_ranking_entries BEGIN
    ${bumpSql}; ${dirtyKeySql("OLD")}; ${dirtyKeySql("NEW")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_market_delete AFTER DELETE ON market_ranking_entries BEGIN
    ${bumpSql}; ${dirtyKeySql("OLD")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_price_insert AFTER INSERT ON market_price_snapshots BEGIN
    ${bumpSql}; ${dirtyPriceSql("NEW")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_price_update AFTER UPDATE ON market_price_snapshots BEGIN
    ${bumpSql}; ${dirtyPriceSql("OLD")}; ${dirtyPriceSql("NEW")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_price_delete AFTER DELETE ON market_price_snapshots BEGIN
    ${bumpSql}; ${dirtyPriceSql("OLD")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_version_insert AFTER INSERT ON market_price_band_versions BEGIN
    ${bumpSql}; ${dirtyScopeValueSql("NEW.category")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_version_update AFTER UPDATE ON market_price_band_versions BEGIN
    ${bumpSql}; ${dirtyScopeValueSql("OLD.category")}; ${dirtyScopeValueSql("NEW.category")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_version_delete BEFORE DELETE ON market_price_band_versions BEGIN
    ${bumpSql}; ${dirtyScopeValueSql("OLD.category")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_item_insert AFTER INSERT ON market_price_band_items BEGIN
    ${bumpSql}; ${dirtyScopeSelectSql("FROM market_price_band_versions WHERE id=NEW.version_id")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_item_update AFTER UPDATE ON market_price_band_items BEGIN
    ${bumpSql}; ${dirtyScopeSelectSql("FROM market_price_band_versions WHERE id IN (OLD.version_id,NEW.version_id)")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_band_item_delete BEFORE DELETE ON market_price_band_items BEGIN
    ${bumpSql}; ${dirtyScopeSelectSql("FROM market_price_band_versions WHERE id=OLD.version_id")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_netshop_insert AFTER INSERT ON netshop_rows BEGIN
    ${bumpSql}; ${dirtyProductsSql("NEW.sku_id,NEW.spu_id,NEW.product_code")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_netshop_update AFTER UPDATE ON netshop_rows BEGIN
    ${bumpSql}; ${dirtyProductsSql("OLD.sku_id,OLD.spu_id,OLD.product_code,NEW.sku_id,NEW.spu_id,NEW.product_code")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_netshop_delete AFTER DELETE ON netshop_rows BEGIN
    ${bumpSql}; ${dirtyProductsSql("OLD.sku_id,OLD.spu_id,OLD.product_code")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_sales_insert AFTER INSERT ON sales_order_lines WHEN NEW.product_code<>'' BEGIN
    ${bumpSql}; ${dirtyProductsSql("NEW.product_code")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_sales_update AFTER UPDATE ON sales_order_lines BEGIN
    ${bumpSql}; ${dirtyProductsSql("OLD.product_code,NEW.product_code")}; END`,
  `CREATE TRIGGER IF NOT EXISTS market_monthly_summary_sales_delete AFTER DELETE ON sales_order_lines WHEN OLD.product_code<>'' BEGIN
    ${bumpSql}; ${dirtyProductsSql("OLD.product_code")}; END`,
] as const;

function ensureInvalidationTriggers(db: MonthlySummaryCacheDatabase): Promise<void> {
  const key = db as object;
  const ready = triggersByDatabase.get(key);
  if (ready) return ready;
  const setup = db.batch([
    db.prepare(`INSERT OR IGNORE INTO market_monthly_summary_cache_state
      (id,source_revision,built_revision,status) VALUES (1,1,-1,'stale')`),
    ...monthlySummaryTriggerStatements.map((statement) => db.prepare(statement)),
    db.prepare(`INSERT INTO market_monthly_summary_dirty_scopes (category,dirty_revision)
      SELECT '*',source_revision FROM market_monthly_summary_cache_state WHERE id=1 AND built_revision<0
      ON CONFLICT(category) DO UPDATE SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`),
  ]).then(() => undefined).catch((error: unknown) => {
    triggersByDatabase.delete(key);
    throw error;
  });
  triggersByDatabase.set(key, setup);
  return setup;
}

async function refresh(db: MonthlySummaryCacheDatabase): Promise<boolean> {
  await ensureInvalidationTriggers(db);
  const current = await db.prepare(`SELECT source_revision,built_revision,status
    FROM market_monthly_summary_cache_state WHERE id=1`).first<MonthlySummaryCacheState>();
  if (current && current.source_revision === current.built_revision && current.status === "ready") return true;

  const leaseToken = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE market_monthly_summary_cache_state
    SET lease_token=?,lease_expires_at=datetime('now','+2 minutes'),status='refreshing',error_code=''
    WHERE id=1 AND source_revision<>built_revision
      AND (lease_token='' OR lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)
    RETURNING source_revision,built_revision`).bind(leaseToken).first<MonthlySummaryCacheState>();
  if (!claimed) return false;
  const revision = Number(claimed.source_revision);

  try {
    await db.batch([
      db.prepare(`INSERT INTO market_monthly_summary_dirty_keys
        (category,scope,ranking_dimension,sku_code,month,dirty_revision)
        SELECT m.category,m.scope,m.ranking_dimension,m.sku_code,substr(m.period_end,1,7),MAX(d.dirty_revision)
        FROM market_ranking_entries m JOIN market_monthly_summary_dirty_scopes d
          ON d.dirty_revision<=? AND (d.category='*' OR d.category=m.category)
        GROUP BY m.category,m.scope,m.ranking_dimension,m.sku_code,substr(m.period_end,1,7)
        ON CONFLICT(category,scope,ranking_dimension,sku_code,month) DO UPDATE
        SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`).bind(revision),
      db.prepare(`INSERT INTO market_monthly_summary_dirty_keys
        (category,scope,ranking_dimension,sku_code,month,dirty_revision)
        SELECT m.category,m.scope,m.ranking_dimension,m.sku_code,substr(m.period_end,1,7),MAX(d.dirty_revision)
        FROM market_ranking_entries m JOIN market_monthly_summary_dirty_products d
          ON d.dirty_revision<=? AND d.product_code=m.sku_code
        GROUP BY m.category,m.scope,m.ranking_dimension,m.sku_code,substr(m.period_end,1,7)
        ON CONFLICT(category,scope,ranking_dimension,sku_code,month) DO UPDATE
        SET dirty_revision=MAX(dirty_revision,excluded.dirty_revision)`).bind(revision),
    ]);

    await db.batch([
      db.prepare(`DELETE FROM market_monthly_summary_cache WHERE EXISTS (
        SELECT 1 FROM market_monthly_summary_dirty_keys dirty
        WHERE dirty.dirty_revision<=? AND dirty.category=market_monthly_summary_cache.category
          AND dirty.scope=market_monthly_summary_cache.scope
          AND dirty.ranking_dimension=market_monthly_summary_cache.ranking_dimension
          AND dirty.sku_code=market_monthly_summary_cache.sku_code
          AND dirty.month=market_monthly_summary_cache.month
      )`).bind(revision),
      db.prepare(buildMarketMonthlySummaryRefreshSql()).bind(revision),
      db.prepare("DELETE FROM market_monthly_summary_dirty_keys WHERE dirty_revision<=?").bind(revision),
      db.prepare("DELETE FROM market_monthly_summary_dirty_scopes WHERE dirty_revision<=?").bind(revision),
      db.prepare("DELETE FROM market_monthly_summary_dirty_products WHERE dirty_revision<=?").bind(revision),
      db.prepare(`UPDATE market_monthly_summary_cache_state SET
          built_revision=?,status='ready',lease_token='',lease_expires_at=NULL,
          row_count=(SELECT COUNT(*) FROM market_monthly_summary_cache),
          refreshed_at=CURRENT_TIMESTAMP,error_code=''
        WHERE id=1 AND source_revision=? AND lease_token=?`).bind(revision, revision, leaseToken),
      db.prepare(`UPDATE market_monthly_summary_cache_state SET
          status='stale',lease_token='',lease_expires_at=NULL,error_code='revision_changed'
        WHERE id=1 AND lease_token=? AND source_revision<>?`).bind(leaseToken, revision),
    ]);
    const ready = await db.prepare(`SELECT source_revision,built_revision,status
      FROM market_monthly_summary_cache_state WHERE id=1`).first<MonthlySummaryCacheState>();
    return Boolean(ready && ready.source_revision === ready.built_revision && ready.status === "ready");
  } catch {
    await db.prepare(`UPDATE market_monthly_summary_cache_state SET
      status='stale',lease_token='',lease_expires_at=NULL,error_code='refresh_failed'
      WHERE id=1 AND lease_token=?`).bind(leaseToken).run().catch(() => undefined);
    return false;
  }
}

export function ensureMarketMonthlySummaryCache(db: MonthlySummaryCacheDatabase): Promise<boolean> {
  const key = db as object;
  const running = refreshByDatabase.get(key);
  if (running) return running;
  const task = refresh(db).finally(() => refreshByDatabase.delete(key));
  refreshByDatabase.set(key, task);
  return task;
}

function isMonthEnd(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isMarketMonthlySummaryCacheEligible(filters: MonthlySummaryCacheFilters) {
  return (!filters.startDate || filters.startDate.endsWith("-01"))
    && (!filters.endDate || isMonthEnd(filters.endDate));
}
