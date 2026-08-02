import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { buildMarketOverviewAnalyticsSql, buildMarketOverviewEnrichedSql } from "../lib/market/overview-sql";
import { marketBaseSchemaStatements } from "../lib/market/schema-core";
import { canonicalMarketOverviewCacheIdentity, getCachedMarketOverview } from "../lib/market/overview-response-cache";

class AsyncSqliteStatement {
  constructor(
    private readonly statement: ReturnType<DatabaseSync["prepare"]>,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new AsyncSqliteStatement(this.statement, values as SQLInputValue[]);
  }

  async first<T>() {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async run() {
    return this.statement.run(...this.values);
  }
}

function asyncDatabase(sqlite: DatabaseSync) {
  return { prepare: (sql: string) => new AsyncSqliteStatement(sqlite.prepare(sql)) };
}

test("market overview can read precomputed effective metrics without rebuilding anchor windows", () => {
  const enriched = buildMarketOverviewEnrichedSql({ useEffectiveMetricsCache: true });
  const analytics = buildMarketOverviewAnalyticsSql({ useEffectiveMetricsCache: true });
  for (const sql of [enriched, analytics]) {
    assert.match(sql, /JOIN market_effective_metrics_cache cached ON cached\.market_entry_id=m\.id/);
    assert.doesNotMatch(sql, /anchor_segments AS MATERIALIZED/);
    assert.doesNotMatch(sql, /parsed_ranges AS MATERIALIZED/);
  }
});

test("market schema and migration persist cache rows and their source revision", async () => {
  const schema = marketBaseSchemaStatements.join("\n");
  const migration = await readFile(new URL("../drizzle/0046_market_effective_metrics_cache.sql", import.meta.url), "utf8");
  for (const sql of [schema, migration]) {
    assert.match(sql, /market_effective_metrics_cache/);
    assert.match(sql, /market_effective_metrics_cache_state/);
    assert.match(sql, /netshop_updated_at/);
  }
});

test("market and netshop mutations invalidate the persisted effective-metrics revision", async () => {
  const migration = await readFile(new URL("../drizzle/0046_market_effective_metrics_cache.sql", import.meta.url), "utf8");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE market_ranking_entries (id INTEGER PRIMARY KEY)");
  sqlite.exec("CREATE TABLE netshop_rows (id INTEGER PRIMARY KEY)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    sqlite.exec(statement);
  }
  const restoreState = () => sqlite.prepare(`INSERT OR REPLACE INTO market_effective_metrics_cache_state
    (id, market_row_count, market_updated_at, netshop_row_count, netshop_updated_at)
    VALUES (1, 0, '', 0, '')`).run();
  restoreState();
  sqlite.exec("INSERT INTO market_ranking_entries (id) VALUES (1)");
  assert.equal(sqlite.prepare("SELECT id FROM market_effective_metrics_cache_state WHERE id=1").get(), undefined);
  restoreState();
  sqlite.exec("INSERT INTO netshop_rows (id) VALUES (1)");
  assert.equal(sqlite.prepare("SELECT id FROM market_effective_metrics_cache_state WHERE id=1").get(), undefined);
  sqlite.close();
});

test("market UI requests lightweight ranking data and aborts superseded requests", async () => {
  const [view, route, database] = await Promise.all([
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/database.ts", import.meta.url), "utf8"),
  ]);
  assert.match(view, /requestedView = activeSection === "overview" \? "full" : "ranking"/);
  assert.match(view, /controller\.abort\(\)/);
  assert.match(view, /signal: controller\.signal|load\(controller\.signal\)/);
  assert.match(route, /params\.get\("view"\) === "ranking"/);
  assert.match(route, /getCachedMarketOverview/);
  assert.match(view, /initialLoad\.current \? 0 : 350/);
  assert.match(database, /await ensureMarketEffectiveMetricsCache\(db\)/);
  assert.match(database, /WITH sources AS MATERIALIZED[\s\S]*SELECT DISTINCT image_url source_url/);
  assert.doesNotMatch(database, /COUNT\(DISTINCT CASE WHEN mic\.status='ready'/);
});

test("market overview response cache is canonical, version-invalidated, and coalesces duplicate loads", async () => {
  assert.equal(
    canonicalMarketOverviewCacheIdentity({
      view: "ranking",
      filters: { categories: ["B", "A", "A"], rankingDimensions: ["SKU"] },
    }),
    canonicalMarketOverviewCacheIdentity({
      view: "ranking",
      filters: { categories: ["A", "B"], rankingDimensions: ["SKU"] },
    }),
  );

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE market_monthly_summary_cache_state (id INTEGER PRIMARY KEY, source_revision INTEGER NOT NULL);
    INSERT INTO market_monthly_summary_cache_state VALUES (1, 7);
    CREATE TABLE market_image_cache (status TEXT NOT NULL, attempt_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE market_import_batches (
      id TEXT NOT NULL, status TEXT NOT NULL, file_name TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT, row_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL, updated_count INTEGER NOT NULL, warning_count INTEGER NOT NULL
    );
    CREATE TABLE market_subcategory_taxonomy (status TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  for (const statement of marketBaseSchemaStatements.filter((sql) => sql.includes("market_overview_response_cache"))) {
    sqlite.exec(statement);
  }
  const db = asyncDatabase(sqlite);
  const identity = { view: "ranking" as const, filters: { rankingDimensions: ["SKU"] } };
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { revision: loads };
  };

  const [first, duplicate] = await Promise.all([
    getCachedMarketOverview(db, identity, load),
    getCachedMarketOverview(db, identity, load),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(new Set([first.status, duplicate.status]), new Set(["miss", "coalesced"]));
  assert.deepEqual((await getCachedMarketOverview(db, identity, load)).payload, { revision: 1 });
  assert.equal(loads, 1);

  sqlite.exec("UPDATE market_monthly_summary_cache_state SET source_revision=8 WHERE id=1");
  const invalidated = await getCachedMarketOverview(db, identity, load);
  assert.equal(invalidated.status, "miss");
  assert.deepEqual(invalidated.payload, { revision: 2 });
  sqlite.close();
});

test("market response cache schema is available in runtime setup and migration", async () => {
  const schema = marketBaseSchemaStatements.join("\n");
  const [migration, schemaCore] = await Promise.all([
    readFile(new URL("../drizzle/0050_market_overview_response_cache.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/schema-core.ts", import.meta.url), "utf8"),
  ]);
  for (const sql of [schema, migration, schemaCore]) {
    assert.match(sql, /market_overview_response_cache/);
  }
  for (const sql of [migration, schemaCore]) assert.match(sql, /market_image_cache_updated_idx/);
});

test("pending-price history starts from snapshots and uses the representative identity-month index", async () => {
  const service = await readFile(new URL("../lib/market/admin-service.ts", import.meta.url), "utf8");
  assert.match(service, /SELECT source\.\* FROM market_price_snapshots snapshot[\s\S]*candidate\.category=snapshot\.category[\s\S]*candidate\.period_end>=snapshot\.month\|\|'-01'[\s\S]*candidate\.period_end<date\(snapshot\.month\|\|'-01','\+1 month'\)/);
  const historyBranch = service.slice(service.indexOf("function masterBaseSql"), service.indexOf("async function getMarketItemTrendLite"));
  assert.doesNotMatch(historyBranch, /ROW_NUMBER\(\) OVER/);
});
