import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ensureMarketMonthlySummaryCache,
  isMarketMonthlySummaryCacheEligible,
  type MonthlySummaryCacheDatabase,
} from "../lib/market/monthly-summary-cache";
import {
  buildMarketCachedOverviewAnalyticsSql,
  buildMarketMonthlySummaryRefreshSql,
  buildMarketOverviewAnalyticsSql,
} from "../lib/market/overview-sql";
import { ensureMarketSchemaCore, type MarketSchemaDatabase } from "../lib/market/schema-core";

function sqliteAdapter(sqlite: DatabaseSync): MonthlySummaryCacheDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as MonthlySummaryCacheDatabase;
}

function createSourceSchema(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE market_ranking_entries (
      id INTEGER PRIMARY KEY, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL, category TEXT NOT NULL,
      scope TEXT NOT NULL, price_band_filter TEXT NOT NULL DEFAULT '', ranking_dimension TEXT NOT NULL,
      operation_mode TEXT NOT NULL, subcategory TEXT NOT NULL, rank INTEGER, sku_code TEXT NOT NULL,
      product_name TEXT NOT NULL, brand TEXT NOT NULL, price_cents INTEGER,
      page_views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE market_effective_metrics_cache (
      market_entry_id INTEGER PRIMARY KEY, effective_gmv_cents INTEGER, real_gmv_cents INTEGER,
      gmv_out_of_band INTEGER, effective_quantity INTEGER,
      effective_average_transaction_price_cents INTEGER, effective_conversion_bps INTEGER
    );
    CREATE TABLE market_price_snapshots (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, scope TEXT NOT NULL, sku_code TEXT NOT NULL,
      ranking_dimension TEXT NOT NULL, month TEXT NOT NULL, confirmed_market_price_cents INTEGER,
      confirmation_status TEXT, ai_price_type TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE market_price_band_versions (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      effective_from TEXT NOT NULL
    );
    CREATE TABLE market_price_band_items (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, label TEXT NOT NULL,
      min_cents INTEGER, max_cents INTEGER, sort_order INTEGER NOT NULL
    );
    CREATE TABLE netshop_rows (
      id INTEGER PRIMARY KEY, sku_id TEXT NOT NULL DEFAULT '', spu_id TEXT NOT NULL DEFAULT '',
      product_code TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE sales_order_lines (
      id INTEGER PRIMARY KEY, product_code TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO market_price_band_versions VALUES ('default-band','*',1,'published','2020-01-01');
    INSERT INTO market_price_band_items VALUES
      ('low','default-band','0-499',0,50000,1),('high','default-band','500+',50000,NULL,2);
  `);
}

async function applyMonthlyCacheMigration(sqlite: DatabaseSync) {
  const migration = await readFile(new URL("../drizzle/0048_market_monthly_summary_cache.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) sqlite.exec(statement);
}

test("runtime schema fast path creates monthly cache tables and indexes for an existing database", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as unknown as MarketSchemaDatabase;
  await ensureMarketSchemaCore(db);
  sqlite.exec(`
    DROP TABLE market_monthly_summary_cache;
    DROP TABLE market_monthly_summary_cache_state;
    DROP TABLE market_monthly_summary_dirty_keys;
    DROP TABLE market_monthly_summary_dirty_scopes;
    DROP TABLE market_monthly_summary_dirty_products;
  `);
  await ensureMarketSchemaCore(db);
  assert.ok(sqlite.prepare("SELECT 1 FROM market_monthly_summary_cache_state LIMIT 1").get() === undefined);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='market_monthly_summary_month_idx'").get());
  sqlite.close();
});

function insertMarketRow(sqlite: DatabaseSync, id: number, sku: string, gmv: number) {
  sqlite.prepare(`INSERT INTO market_ranking_entries
    (id,period_start,period_end,category,scope,ranking_dimension,operation_mode,subcategory,rank,sku_code,product_name,brand,price_cents,page_views,visitors)
    VALUES (?, '2026-06-01','2026-06-30','家电','POP','SKU','POP','厨房',?,? ,?,'品牌甲',39900,1000,500)`)
    .run(id, id, sku, `商品${sku}`);
  sqlite.prepare(`INSERT INTO market_effective_metrics_cache
    (market_entry_id,effective_gmv_cents,real_gmv_cents,gmv_out_of_band,effective_quantity,effective_average_transaction_price_cents,effective_conversion_bps)
    VALUES (?,?,0,0,10,?,200)`).run(id, gmv, Math.round(gmv / 10));
}

test("monthly summary migration invalidates every material source", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createSourceSchema(sqlite);
  await applyMonthlyCacheMigration(sqlite);
  const revision = () => Number((sqlite.prepare("SELECT source_revision revision FROM market_monthly_summary_cache_state WHERE id=1").get() as { revision: number }).revision);
  const initial = revision();
  insertMarketRow(sqlite, 1, "SKU-1", 100000);
  assert.ok(revision() > initial);
  assert.equal((sqlite.prepare("SELECT month FROM market_monthly_summary_dirty_keys WHERE sku_code='SKU-1'").get() as { month: string }).month, "2026-06");
  sqlite.exec("INSERT INTO market_price_snapshots (id,category,scope,sku_code,ranking_dimension,month) VALUES ('p','家电','POP','SKU-1','SKU','2026-06')");
  sqlite.exec("INSERT INTO netshop_rows (id,sku_id) VALUES (1,'SKU-1')");
  sqlite.exec("INSERT INTO sales_order_lines (id,product_code) VALUES (1,'SKU-1')");
  sqlite.exec("UPDATE market_price_band_versions SET version=2 WHERE id='default-band'");
  assert.ok(revision() >= initial + 5);
  assert.ok(sqlite.prepare("SELECT 1 FROM market_monthly_summary_dirty_products WHERE product_code='SKU-1'").get());
  assert.ok(sqlite.prepare("SELECT 1 FROM market_monthly_summary_dirty_scopes WHERE category='*'").get());
  sqlite.close();
});

test("monthly summary refresh is revisioned, incremental, and analytics-equivalent", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createSourceSchema(sqlite);
  await applyMonthlyCacheMigration(sqlite);
  insertMarketRow(sqlite, 1, "SKU-1", 100000);
  insertMarketRow(sqlite, 2, "SKU-2", 200000);
  const db = sqliteAdapter(sqlite);
  assert.equal(await ensureMarketMonthlySummaryCache(db), true);
  const firstRows = sqlite.prepare(`SELECT sku_code sku,gmv_cents gmv,refreshed_revision revision
    FROM market_monthly_summary_cache ORDER BY sku_code`).all() as Array<{ sku: string; gmv: number; revision: number }>;
  assert.deepEqual(firstRows.map((row) => [row.sku, row.gmv]), [["SKU-1", 100000], ["SKU-2", 200000]]);

  const live = sqlite.prepare(buildMarketOverviewAnalyticsSql({ useEffectiveMetricsCache: true })).all();
  const cached = sqlite.prepare(buildMarketCachedOverviewAnalyticsSql()).all();
  assert.deepEqual(cached, live);

  sqlite.exec("UPDATE market_ranking_entries SET updated_at='2026-07-01 00:00:00' WHERE id=1");
  sqlite.exec("UPDATE market_effective_metrics_cache SET effective_gmv_cents=300000 WHERE market_entry_id=1");
  assert.equal(await ensureMarketMonthlySummaryCache(db), true);
  const secondRows = sqlite.prepare(`SELECT sku_code sku,gmv_cents gmv,refreshed_revision revision
    FROM market_monthly_summary_cache ORDER BY sku_code`).all() as Array<{ sku: string; gmv: number; revision: number }>;
  assert.equal(secondRows[0].gmv, 300000);
  assert.ok(secondRows[0].revision > firstRows[0].revision);
  assert.equal(secondRows[1].revision, firstRows[1].revision);
  const state = sqlite.prepare("SELECT source_revision source,built_revision built,status FROM market_monthly_summary_cache_state WHERE id=1").get() as { source: number; built: number; status: string };
  assert.deepEqual({ ...state }, { source: state.source, built: state.source, status: "ready" });
  sqlite.close();
});

test("monthly cache only serves whole-month date boundaries", () => {
  assert.equal(isMarketMonthlySummaryCacheEligible({}), true);
  assert.equal(isMarketMonthlySummaryCacheEligible({ startDate: "2026-06-01", endDate: "2026-06-30" }), true);
  assert.equal(isMarketMonthlySummaryCacheEligible({ startDate: "2026-06-02" }), false);
  assert.equal(isMarketMonthlySummaryCacheEligible({ endDate: "2026-06-29" }), false);
  assert.match(buildMarketMonthlySummaryRefreshSql(), /dirty_revision<=\?1/);
  assert.match(buildMarketCachedOverviewAnalyticsSql(), /source_revision=built_revision/);
});
