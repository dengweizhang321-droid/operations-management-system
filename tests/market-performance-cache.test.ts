import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildMarketOverviewAnalyticsSql, buildMarketOverviewEnrichedSql } from "../lib/market/overview-sql";
import { marketBaseSchemaStatements } from "../lib/market/schema-core";

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
  assert.match(database, /await ensureMarketEffectiveMetricsCache\(db\)/);
});
