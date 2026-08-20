import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildMarketOverviewAnalyticsSql, buildMarketRankingCtes } from "../lib/market/overview-sql";

test("market ranking limits candidate ids before expensive row enrichment", () => {
  const sql = buildMarketRankingCtes();
  assert.match(sql, /top_ranked_ids AS MATERIALIZED/);
  assert.match(sql, /LIMIT 200/);
  assert.ok(sql.indexOf("LIMIT 200") < sql.indexOf("market_image_cache"));
  assert.ok(sql.indexOf("LIMIT 200") < sql.indexOf("SELECT 1 FROM netshop_rows"));
  assert.doesNotMatch(sql, /market_effective_rows AS MATERIALIZED/);
});

test("market ranking can page a small candidate window before expensive enrichment", () => {
  const sql = buildMarketRankingCtes({ rankingLimit: 20, rankingOffset: 40 });
  assert.match(sql, /LIMIT 20 OFFSET 40/);
  assert.ok(sql.indexOf("LIMIT 20 OFFSET 40") < sql.indexOf("market_image_cache"));
  assert.ok(sql.indexOf("LIMIT 20 OFFSET 40") < sql.indexOf("SELECT 1 FROM netshop_rows"));
});

test("market price-band ranking still filters before the bounded enrichment stage", () => {
  const sql = buildMarketRankingCtes({
    factWhere: "WHERE m.category=?",
    where: "WHERE m.brand=?",
    priceBandWhere: "WHERE price_band IN (?3)",
  });
  assert.match(sql, /ranking_candidates AS MATERIALIZED/);
  assert.match(sql, /m\.category=\? AND m\.brand=\?/);
  assert.match(sql, /SELECT id FROM ranking_candidates WHERE price_band IN \(\?3\)/);
  assert.ok(sql.indexOf("SELECT id FROM ranking_candidates") < sql.indexOf("market_image_cache"));
});

test("market full analytics aggregates shared monthly rows without a section cross join", () => {
  const sql = buildMarketOverviewAnalyticsSql({ useEffectiveMetricsCache: true });
  assert.match(sql, /analytics_filtered AS MATERIALIZED/);
  assert.match(sql, /analytics_core AS MATERIALIZED/);
  assert.match(sql, /analytics_dimensions AS MATERIALIZED/);
  assert.doesNotMatch(sql, /CROSS JOIN analytics_sections/);
});

test("market read indexes cover ranking order and distinct image aggregation", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../lib/market/schema-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0047_market_read_indexes.sql", import.meta.url), "utf8"),
  ]);
  for (const source of [schema, migration]) {
    assert.match(source, /market_entries_rank_order_idx/);
    assert.match(source, /market_entries_image_url_idx/);
  }
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE market_ranking_entries (id INTEGER PRIMARY KEY, rank INTEGER, gmv_cents INTEGER, image_url TEXT)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) sqlite.exec(statement);
  const indexes = sqlite.prepare("PRAGMA index_list('market_ranking_entries')").all() as Array<{ name: string }>;
  assert.deepEqual(new Set(indexes.map((item) => item.name)), new Set(["market_entries_image_url_idx", "market_entries_rank_order_idx"]));
  sqlite.close();
});

test("inventory APIs bound response rows while preserving totals and recommendations", async () => {
  const [overview, age, route, page] = await Promise.all([
    readFile(new URL("../lib/inventory/overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/age-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(overview, /LIMIT \? OFFSET \?/);
  assert.match(overview, /returned: pageResult\.results\.length/);
  assert.match(overview, /recommendations/);
  assert.match(age, /LIMIT \? OFFSET \?/);
  assert.match(age, /returned: pageResult\.results\.length/);
  assert.match(route, /normalizeInventorySelections\(params\.getAll\(key\), options\)/);
  assert.match(route, /readInventorySelections\(params, "warehouse"/);
  assert.match(page, /debouncedInventoryQuery/);
  assert.match(page, /overviewGenerationRef/);
});

test("customer, sales, and product views avoid superseded or duplicate work", async () => {
  const [page, customerRoute, customerDatabase, sales] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/customer-service/conversations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/customer-service/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/summary.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /debouncedCustomerQuery/);
  assert.match(page, /includeOptions/);
  assert.match(page, /listControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /listGenerationRef\.current === generation/);
  assert.match(page, /listRequestKeyRef\.current === requestKey/);
  assert.match(page, /products\/summary\?\$\{params\}.*signal/s);
  assert.match(customerRoute, /includeOptions: url\.searchParams\.get\("includeOptions"\) !== "false"/);
  assert.doesNotMatch(customerDatabase, /SELECT COUNT\(\*\) AS total FROM customer_service_conversations \$\{where\}.*SELECT COUNT\(\*\) AS total, SUM/s);
  assert.match(sales, /\[currentRow, previousRow, yearAgoRow,[\s\S]+Promise\.all/);
});
