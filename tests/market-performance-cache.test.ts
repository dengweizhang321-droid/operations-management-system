import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { buildMarketOverviewAnalyticsSql, buildMarketOverviewEnrichedSql } from "../lib/market/overview-sql";
import { marketBaseSchemaStatements } from "../lib/market/schema-core";
import { canonicalMarketOverviewCacheIdentity, getCachedMarketFilterOptions, getCachedMarketOverview } from "../lib/market/overview-response-cache";
import { prefetchMarketRankingOverview, requestMarketOverview } from "../app/market-view";

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

function installDeferredMarketOverviewFetch() {
  const originalFetch = globalThis.fetch;
  let completeResponse: ((payload: unknown) => void) | undefined;
  let resolveStarted: ((signal: AbortSignal) => void) | undefined;
  let fetchCount = 0;
  const started = new Promise<AbortSignal>((resolve) => { resolveStarted = resolve; });
  globalThis.fetch = (async (_input, init) => {
    fetchCount += 1;
    const signal = init?.signal;
    assert.ok(signal, "shared market request must own an abort signal");
    resolveStarted?.(signal);
    return await new Promise<Response>((resolve, reject) => {
      completeResponse = (payload) => resolve(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      signal.addEventListener("abort", () => {
        const error = new Error("internal request aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }) as typeof fetch;
  return {
    started,
    complete(payload: unknown) {
      assert.ok(completeResponse, "fetch must start before it can complete");
      completeResponse(payload);
    },
    fetchCount: () => fetchCount,
    restore: () => { globalThis.fetch = originalFetch; },
  };
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

test("effective-metrics refresh updates the cache without deleting every persisted row first", async () => {
  const database = await readFile(new URL("../lib/market/database.ts", import.meta.url), "utf8");
  const refresh = database.slice(
    database.indexOf("async function refreshEffectiveMetricsCache"),
    database.indexOf("export function ensureMarketEffectiveMetricsCache"),
  );
  assert.match(refresh, /ON CONFLICT\(market_entry_id\) DO UPDATE SET/);
  assert.match(refresh, /IS NOT excluded\.effective_gmv_cents/);
  assert.match(refresh, /DELETE FROM market_effective_metrics_cache[\s\S]*price_band_preference=1/);
  assert.doesNotMatch(refresh, /prepare\("DELETE FROM market_effective_metrics_cache"\)/);
  assert.match(refresh, /SELECT DISTINCT category FROM market_ranking_entries ORDER BY category/);
  assert.match(refresh, /marketEffectiveFactsCtes\("WHERE m\.category=\?"\)/);
  assert.match(refresh, /MARKET_EFFECTIVE_METRICS_SOURCE_CHANGED/);
  const upsertPosition = refresh.indexOf("ON CONFLICT(market_entry_id)");
  assert.ok(
    upsertPosition >= 0
      && upsertPosition < refresh.indexOf("market_effective_metrics_cache_state", upsertPosition),
    "the source revision must only be published after the cache rows are refreshed",
  );
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
  assert.match(route, /parseMarketOverviewQuery\(params\)/);
  assert.match(route, /getCachedMarketOverview/);
  assert.match(view, /prefetchMarketRankingOverview/);
  assert.match(view, /requestMarketOverview\(requestKey, signal, MARKET_OVERVIEW_RECENT_PREFETCH_MS\)/);
  assert.match(view, /requestMarketOverview\(params\.toString\(\), signal, maximumCacheAgeMs\)/);
  assert.match(view, /marketOverviewRequests\.get\(requestKey\)/);
  assert.match(view, /signal: controller\.signal/);
  assert.match(view, /request\.subscribers === 0 && !request\.settled/);
  assert.match(view, /rememberMarketOverview\(requestKey, payload\)/);
  assert.match(view, /const delay = isInitialLoad \? 0 : 350/);
  assert.match(view, /isInitialLoad \? MARKET_OVERVIEW_RECENT_PREFETCH_MS : 0/);
  assert.match(view, /MARKET_RANKING_PAGE_SIZE = 20/);
  assert.match(view, /params\.set\("page", String\(page\)\)/);
  assert.match(view, /params\.set\("pageSize", String\(MARKET_RANKING_PAGE_SIZE\)\)/);
  assert.match(view, /加载更多（每批/);
  assert.match(view, /loadMoreController\.current\?\.abort\(\)/);
  assert.match(route, /rankingPage: pagination\.page/);
  assert.match(database, /rankingOffset: \(rankingPage - 1\) \* rankingPageSize/);
  assert.match(database, /COUNT\(\*\) item_count/);
  assert.match(database, /pagination: \{/);
  assert.match(database, /await ensureMarketEffectiveMetricsCache\(db\)/);
  assert.match(database, /getCachedMarketFilterOptions/);
  assert.match(database, /WITH sources AS MATERIALIZED[\s\S]*SELECT DISTINCT image_url source_url/);
  assert.doesNotMatch(database, /COUNT\(DISTINCT CASE WHEN mic\.status='ready'/);
});

test("aborting the prefetch subscriber does not cancel a joined page load", async (context) => {
  const deferred = installDeferredMarketOverviewFetch();
  context.after(deferred.restore);
  const startDate = "2026-08-03";
  const endDate = "2026-08-04";
  const requestKey = `view=ranking&page=1&pageSize=20&dimension=SKU&startDate=${startDate}&endDate=${endDate}`;
  const prefetchController = new AbortController();
  const pageController = new AbortController();
  const prefetch = prefetchMarketRankingOverview(startDate, endDate, prefetchController.signal);
  const internalSignal = await deferred.started;
  const page = requestMarketOverview(requestKey, pageController.signal);
  const cancelledPrefetch = assert.rejects(prefetch, { name: "AbortError" });
  prefetchController.abort();
  await cancelledPrefetch;
  assert.equal(internalSignal.aborted, false);
  deferred.complete({ marker: "page-success" });
  assert.equal(((await page) as unknown as { marker: string }).marker, "page-success");
  assert.equal(deferred.fetchCount(), 1);
});

test("aborting the page subscriber does not cancel a joined prefetch", async (context) => {
  const deferred = installDeferredMarketOverviewFetch();
  context.after(deferred.restore);
  const startDate = "2026-08-05";
  const endDate = "2026-08-06";
  const requestKey = `view=ranking&page=1&pageSize=20&dimension=SKU&startDate=${startDate}&endDate=${endDate}`;
  const pageController = new AbortController();
  const prefetchController = new AbortController();
  const page = requestMarketOverview(requestKey, pageController.signal);
  const internalSignal = await deferred.started;
  const prefetch = prefetchMarketRankingOverview(startDate, endDate, prefetchController.signal);
  const cancelledPage = assert.rejects(page, { name: "AbortError" });
  pageController.abort();
  await cancelledPage;
  assert.equal(internalSignal.aborted, false);
  deferred.complete({ marker: "prefetch-success" });
  await prefetch;
  assert.equal(deferred.fetchCount(), 1);
});

test("the shared market request aborts only after its last subscriber leaves", async (context) => {
  const deferred = installDeferredMarketOverviewFetch();
  context.after(deferred.restore);
  const requestKey = "view=ranking&page=1&pageSize=20&dimension=SKU&startDate=2026-08-07&endDate=2026-08-08";
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = requestMarketOverview(requestKey, firstController.signal);
  const internalSignal = await deferred.started;
  const second = requestMarketOverview(requestKey, secondController.signal);
  const firstCancelled = assert.rejects(first, { name: "AbortError" });
  firstController.abort();
  await firstCancelled;
  assert.equal(internalSignal.aborted, false);
  const secondCancelled = assert.rejects(second, { name: "AbortError" });
  secondController.abort();
  await secondCancelled;
  assert.equal(internalSignal.aborted, true);
  assert.equal(deferred.fetchCount(), 1);
});

test("market overview response cache is canonical, version-invalidated, and coalesces duplicate loads", async () => {
  assert.match(canonicalMarketOverviewCacheIdentity({ view: "full", filters: {} }), /"formatVersion":3/);
  assert.notEqual(
    canonicalMarketOverviewCacheIdentity({ view: "ranking", filters: {}, pagination: { page: 1, pageSize: 20 } }),
    canonicalMarketOverviewCacheIdentity({ view: "ranking", filters: {}, pagination: { page: 2, pageSize: 20 } }),
  );
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

test("market filter options use a separate revision-aware cache", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE market_monthly_summary_cache_state (id INTEGER PRIMARY KEY, source_revision INTEGER NOT NULL);
    INSERT INTO market_monthly_summary_cache_state VALUES (1, 3);
    CREATE TABLE market_subcategory_taxonomy (status TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  for (const statement of marketBaseSchemaStatements.filter((sql) => sql.includes("market_overview_response_cache"))) {
    sqlite.exec(statement);
  }
  const db = asyncDatabase(sqlite);
  let loads = 0;
  const load = async () => ({ categories_json: JSON.stringify([{ value: "净水", count: ++loads }]) });

  const first = await getCachedMarketFilterOptions(db, load);
  const cached = await getCachedMarketFilterOptions(db, load);
  assert.deepEqual(cached, first);
  assert.equal(loads, 1);

  sqlite.exec("UPDATE market_monthly_summary_cache_state SET source_revision=4 WHERE id=1");
  const refreshed = await getCachedMarketFilterOptions(db, load);
  assert.equal(loads, 2);
  assert.notDeepEqual(refreshed, first);
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
