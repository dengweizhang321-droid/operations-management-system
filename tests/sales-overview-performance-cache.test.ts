import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  bumpSalesOverviewErpProductRevisionSql,
  bumpSalesOverviewFactsRevisionSql,
  salesOverviewCacheSchemaStatements,
} from "../lib/sales/overview-cache-schema";
import {
  canonicalSalesOverviewCacheIdentity,
  getCachedSalesOverview,
  SalesOverviewRevisionChangedError,
  salesOverviewBusinessDate,
} from "../lib/sales/overview-response-cache";

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

function installCacheSchema(sqlite: DatabaseSync) {
  for (const statement of salesOverviewCacheSchemaStatements) sqlite.exec(statement);
}

test("sales overview cache identity is canonical and rolls over with the Shanghai business date", () => {
  const left = canonicalSalesOverviewCacheIdentity({
    range: "month",
    businessDate: "2026-08-22",
    platforms: ["天猫", "京东", "天猫"],
    categories: ["B", "A"],
    outlets: [
      { platform: "天猫", shop: "二店" },
      { platform: "京东", shop: "一店" },
    ],
  });
  const right = canonicalSalesOverviewCacheIdentity({
    range: "month",
    businessDate: "2026-08-22",
    platforms: ["京东", "天猫"],
    categories: ["A", "B"],
    outlets: [
      { platform: "京东", shop: "一店" },
      { platform: "天猫", shop: "二店" },
    ],
  });
  assert.equal(left, right);
  assert.notEqual(left, canonicalSalesOverviewCacheIdentity({
    range: "month",
    businessDate: "2026-08-23",
    platforms: ["京东", "天猫"],
    categories: ["A", "B"],
  }));
  assert.notEqual(left, canonicalSalesOverviewCacheIdentity({
    range: "month",
    projection: "dashboard",
    businessDate: "2026-08-22",
    platforms: ["京东", "天猫"],
    categories: ["A", "B"],
  }));
  assert.equal(salesOverviewBusinessDate(new Date("2026-08-22T15:59:59Z")), "2026-08-22");
  assert.equal(salesOverviewBusinessDate(new Date("2026-08-22T16:00:00Z")), "2026-08-23");
});

test("sales overview response cache coalesces misses and invalidates on sales or ERP revisions", async () => {
  const sqlite = new DatabaseSync(":memory:");
  installCacheSchema(sqlite);
  const db = asyncDatabase(sqlite);
  const identity = { range: "month" as const, businessDate: "2026-08-22" };
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { revision: loads };
  };

  const [first, duplicate] = await Promise.all([
    getCachedSalesOverview(db, identity, load),
    getCachedSalesOverview(db, identity, load),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(new Set([first.status, duplicate.status]), new Set(["miss", "coalesced"]));
  assert.deepEqual((await getCachedSalesOverview(db, identity, load)).payload, { revision: 1 });
  assert.equal(loads, 1);

  sqlite.exec("UPDATE sales_overview_cache_state SET sales_revision = sales_revision + 1 WHERE id = 1");
  assert.deepEqual((await getCachedSalesOverview(db, identity, load)).payload, { revision: 2 });
  sqlite.exec("UPDATE sales_overview_cache_state SET erp_product_revision = erp_product_revision + 1 WHERE id = 1");
  assert.deepEqual((await getCachedSalesOverview(db, identity, load)).payload, { revision: 3 });
  assert.equal(loads, 3);
  sqlite.close();
});

test("a revision change during an expensive load retries once and only publishes a stable payload", async () => {
  const sqlite = new DatabaseSync(":memory:");
  installCacheSchema(sqlite);
  const db = asyncDatabase(sqlite);
  const identity = { range: "last7" as const, businessDate: "2026-08-22" };
  let loads = 0;

  const refreshed = await getCachedSalesOverview(db, identity, async () => {
    loads += 1;
    if (loads === 1) {
      sqlite.exec("UPDATE sales_overview_cache_state SET sales_revision = sales_revision + 1 WHERE id = 1");
    }
    return { loads };
  });
  assert.deepEqual(refreshed.payload, { loads: 2 });
  const cacheRowsAfterRace = sqlite.prepare("SELECT COUNT(*) AS count FROM sales_overview_response_cache").get() as { count: number };
  assert.equal(cacheRowsAfterRace.count, 1);
  assert.equal((await getCachedSalesOverview(db, identity, async () => ({ loads: ++loads }))).status, "hit");
  assert.equal(loads, 2);
  sqlite.close();
});

test("continuous sales revisions fail closed after one bounded retry", async () => {
  const sqlite = new DatabaseSync(":memory:");
  installCacheSchema(sqlite);
  const db = asyncDatabase(sqlite);
  const identity = { range: "last7" as const, businessDate: "2026-08-22" };
  let loads = 0;

  await assert.rejects(
    getCachedSalesOverview(db, identity, async () => {
      loads += 1;
      sqlite.exec("UPDATE sales_overview_cache_state SET sales_revision = sales_revision + 1 WHERE id = 1");
      return { loads };
    }),
    (error: unknown) => error instanceof SalesOverviewRevisionChangedError,
  );
  assert.equal(loads, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM sales_overview_response_cache").get() as { count: number }).count, 0);
  sqlite.close();
});

test("revision bumps are guarded by a processing owner and ignore completed duplicates", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sales_import_batches (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE erp_reference_import_batches (id TEXT PRIMARY KEY, source_key TEXT NOT NULL, status TEXT NOT NULL);
  `);
  installCacheSchema(sqlite);

  sqlite.exec("INSERT INTO sales_import_batches VALUES ('sales-done', 'completed'), ('sales-new', 'processing')");
  sqlite.prepare(bumpSalesOverviewFactsRevisionSql).run("sales-done");
  assert.equal((sqlite.prepare("SELECT sales_revision FROM sales_overview_cache_state WHERE id = 1").get() as { sales_revision: number }).sales_revision, 1);
  sqlite.prepare(bumpSalesOverviewFactsRevisionSql).run("sales-new");
  assert.equal((sqlite.prepare("SELECT sales_revision FROM sales_overview_cache_state WHERE id = 1").get() as { sales_revision: number }).sales_revision, 2);

  sqlite.exec(`INSERT INTO erp_reference_import_batches VALUES
    ('inventory', 'inventory_age', 'processing'),
    ('products-done', 'products', 'completed'),
    ('products-new', 'products', 'processing')`);
  sqlite.prepare(bumpSalesOverviewErpProductRevisionSql).run("inventory");
  sqlite.prepare(bumpSalesOverviewErpProductRevisionSql).run("products-done");
  assert.equal((sqlite.prepare("SELECT erp_product_revision FROM sales_overview_cache_state WHERE id = 1").get() as { erp_product_revision: number }).erp_product_revision, 1);
  sqlite.prepare(bumpSalesOverviewErpProductRevisionSql).run("products-new");
  assert.equal((sqlite.prepare("SELECT erp_product_revision FROM sales_overview_cache_state WHERE id = 1").get() as { erp_product_revision: number }).erp_product_revision, 2);
  sqlite.close();
});

test("sales overview route, runtime schemas, migration, and UI use the optimized contracts", async () => {
  const [salesView, dashboardView, route, summary, salesDatabase, erpDatabase, migration] = await Promise.all([
    readFile(new URL("../app/sales-module-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-module-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sales/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/erp-reference/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0064_sales_overview_response_cache.sql", import.meta.url), "utf8"),
  ]);
  assert.match(salesView, /window\.setTimeout\(\(\) => \{/);
  assert.match(salesView, /window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(salesView, /await Promise\.resolve\(\)/);
  assert.match(route, /getCachedSalesOverview/);
  assert.match(route, /x-sales-overview-cache/);
  assert.match(route, /businessDate: salesOverviewBusinessDate\(\)/);
  assert.match(dashboardView, /new URLSearchParams\(\{ range: apiRange, view: "dashboard" \}\)/);
  assert.match(dashboardView, /salesPayload\?\.projection !== "dashboard"/);
  assert.doesNotMatch(dashboardView, /setSales\(null\)|setInventory\(null\)/);
  assert.match(dashboardView, /经营看板刷新失败/);
  assert.match(route, /requestedView !== null && requestedView !== "dashboard"/);
  assert.match(route, /requestedViews\.length > 1/);
  assert.match(route, /projection: requestedView === "dashboard" \? "dashboard" : "full"/);
  assert.match(route, /const responsePayload = requestedView === "dashboard"/);
  assert.match(route, /error instanceof SalesOverviewRevisionChangedError/);
  assert.match(route, /"retry-after": "1"/);
  assert.match(summary, /const dashboardProjection = input\.projection === "dashboard"/);
  assert.match(summary, /dashboardProjection\s+\? Promise\.resolve\(null\)\s+: Promise\.all/);
  for (const source of [salesDatabase, erpDatabase, migration]) {
    assert.match(source, /sales_overview_cache_state|salesOverviewCacheSchemaStatements/);
    assert.match(source, /sales_overview_response_cache|salesOverviewCacheSchemaStatements/);
  }
  const saveSales = salesDatabase.slice(salesDatabase.indexOf("export async function saveSalesImport"));
  const saveProducts = erpDatabase.slice(
    erpDatabase.indexOf("export async function saveProductMasterImport"),
    erpDatabase.indexOf("export async function saveInventoryAgeImport"),
  );
  assert.ok(saveSales.indexOf("bumpSalesOverviewFactsRevisionSql") < saveSales.indexOf("SET status = 'completed'"));
  assert.ok(saveProducts.indexOf("bumpSalesOverviewErpProductRevisionSql") < saveProducts.indexOf("completeStatement(db, input.id"));

  const migrationSqlite = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    migrationSqlite.exec(statement);
  }
  assert.deepEqual(
    { ...migrationSqlite.prepare("SELECT sales_revision, erp_product_revision FROM sales_overview_cache_state WHERE id = 1").get() },
    { sales_revision: 1, erp_product_revision: 1 },
  );
  migrationSqlite.close();
});
