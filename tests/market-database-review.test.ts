import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { saveMarketImportCore, type MarketEntryForImport } from "../lib/market/import-core";
import { buildMarketOverviewAnalyticsSql, marketOverviewFilterOptionsSql } from "../lib/market/overview-sql";
import { ensureMarketSchemaCore, officialPriceBandSql, type MarketSchemaDatabase } from "../lib/market/schema-core";

function sqliteAdapter(sqlite: DatabaseSync): MarketSchemaDatabase {
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
  };
}

async function oldMarketDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["../drizzle/0015_market_analysis.sql", "../drizzle/0020_market_image_cache.sql"]) {
    sqlite.exec(await readFile(new URL(migration, import.meta.url), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO market_import_batches
      (id, source_type, file_name, file_size_bytes, file_hash, sheet_name, status, row_count)
    VALUES
      ('batch-sku','jd','market_POP_SKU_2026-06.csv',100,'old-hash-sku','CSV','completed',1),
      ('batch-spu','jd','market_self_SPU_2026-06.csv',100,'old-hash-spu','CSV','completed',1);
    INSERT INTO market_image_cache
      (source_url, status, object_key, content_sha256, mime_type, size_bytes)
    VALUES
      ('https://img10.360buyimg.com/imgzone/a.jpg','ready','market/a.jpg','hash-a','image/jpeg',10),
      ('https://img10.360buyimg.com/imgzone/b.jpg','ready','market/b.jpg','hash-b','image/jpeg',10);
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, rank, sku_code, product_name, brand, price_cents, gmv_cents, quantity, visitors, image_url, raw_json, last_import_batch_id)
    VALUES
      ('2026-06-01|2026-06-30|净水|pop|SKU-1',1,'2026-06-01','2026-06-30','净水','pop',1,'SKU-1','商品1','品牌1',199900,1000000,5,100,'https://img10.360buyimg.com/imgzone/a.jpg','{"dimension":"SKU"}','batch-sku'),
      ('2026-06-01|2026-06-30|净水|自营|SPU-1',2,'2026-06-01','2026-06-30','净水','自营',2,'SPU-1','商品2','品牌2',299900,3000000,10,200,'https://img10.360buyimg.com/imgzone/b.jpg','{"dimension":"SPU"}','batch-spu');
  `);
  sqlite.exec(`
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, rank, sku_code, product_name, brand, price_cents, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES
      ('legacy-duplicate-a',10,'2026-06-01','2026-06-30','category-duplicate','pop',10,'DUP-1','duplicate old A','brand',100,1000,1,1,'{"dimension":"SKU"}','batch-sku'),
      ('legacy-duplicate-b',11,'2026-06-01','2026-06-30','category-duplicate','pop',11,'DUP-1','duplicate old B','brand',200,2000,2,2,'{"dimension":"SKU"}','batch-sku'),
      ('legacy-scope-pop',12,'2026-06-01','2026-06-30','category-scope','pop',1,'SCOPE-1','scope pop','brand',300,3000,3,3,'{"dimension":"SKU"}','batch-sku'),
      ('legacy-scope-self',13,'2026-06-01','2026-06-30','category-scope','自营',1,'SCOPE-1','scope self','brand',400,4000,4,4,'{"dimension":"SKU"}','batch-spu');
  `);
  return sqlite;
}

test("0020 old market database upgrades columns, indexes, snapshots, and backfill deterministically", async () => {
  const sqlite = await oldMarketDatabase();
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const changesAfterUpgrade = (sqlite.prepare("SELECT total_changes() changes").get() as { changes: number }).changes;
  await ensureMarketSchemaCore(db);
  assert.equal((sqlite.prepare("SELECT total_changes() changes").get() as { changes: number }).changes, changesAfterUpgrade);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE entity_type='runtime_schema' AND entity_id='market-runtime-schema-v2'").get() as { count: number }).count, 1);
  const columnNames = (table: string) => new Set((sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name));
  assert.ok(columnNames("market_brand_suggestions").has("ai_brand"));
  for (const column of ["ranking_dimension", "operation_mode", "subcategory", "price_low_cents", "price_high_cents", "price_estimated"]) {
    assert.ok(columnNames("market_ranking_entries").has(column), column);
  }
  for (const column of ["scope", "image_content_sha256", "source_import_batch_id", "average_transaction_price_cents"]) {
    assert.ok(columnNames("market_price_snapshots").has(column), column);
  }

  const rows = sqlite.prepare("SELECT sku_code sku, operation_mode mode, ranking_dimension dimension, natural_key naturalKey FROM market_ranking_entries ORDER BY sku_code").all() as Array<{ sku: string; mode: string; dimension: string; naturalKey: string }>;
  assert.deepEqual(rows.filter((row) => ["SKU-1", "SPU-1"].includes(row.sku)).map((row) => [row.sku, row.mode, row.dimension]), [["SKU-1", "POP", "SKU"], ["SPU-1", "自营", "SPU"]]);
  assert.ok(rows.every((row) => row.naturalKey.split("|").length === 6));

  const snapshot = sqlite.prepare("SELECT source_price_cents sourcePrice, average_transaction_price_cents avgPrice, image_content_sha256 hash, image_url imageUrl, source_import_batch_id batchId FROM market_price_snapshots WHERE sku_code='SKU-1'").get() as { sourcePrice: number; avgPrice: number; hash: string; imageUrl: string; batchId: string };
  assert.deepEqual({ ...snapshot }, {
    sourcePrice: 199900,
    avgPrice: 200000,
    hash: "hash-a",
    imageUrl: "https://img10.360buyimg.com/imgzone/a.jpg",
    batchId: "batch-sku",
  });
  const duplicate = sqlite.prepare("SELECT COUNT(*) count, SUM(gmv_cents) gmv FROM market_ranking_entries WHERE sku_code='DUP-1'").get() as { count: number; gmv: number };
  assert.deepEqual({ ...duplicate }, { count: 1, gmv: 2000 });
  const scopeSnapshots = sqlite.prepare("SELECT scope, source_price_cents sourcePrice FROM market_price_snapshots WHERE category='category-scope' ORDER BY scope").all() as Array<{ scope: string; sourcePrice: number }>;
  assert.deepEqual(scopeSnapshots.map((row) => ({ ...row })), [{ scope: "pop", sourcePrice: 300 }, { scope: "自营", sourcePrice: 400 }]);

  const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const index of ["market_entries_dimension_idx", "market_entries_subcategory_idx", "market_entries_canonical_uq", "market_price_snapshots_sku_month_uq"]) {
    assert.ok(indexes.has(index), index);
  }
  sqlite.close();
});

test("0026 forward migrations deduplicate facts and preserve mapping/download scope", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrationFiles = [
    "0015_market_analysis.sql", "0016_market_sku_annotations.sql", "0017_market_annotation_reliability.sql",
    "0019_young_ozymandias.sql", "0020_market_image_cache.sql",
    "0021_market_analysis_2.sql", "0022_market_analysis_review_fixes.sql", "0023_market_annotation_monthly_price.sql",
    "0024_market_master_workflow.sql", "0025_market_scope_and_executor.sql", "0026_market_mapping_and_download_scope.sql",
  ];
  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
    if (file === "0021_market_analysis_2.sql") {
      sqlite.exec(`
      INSERT INTO market_ranking_entries
        (natural_key, source_row_number, period_start, period_end, category, scope, sku_code, raw_json, last_import_batch_id, gmv_cents, quantity, price_cents)
      VALUES
        ('legacy-a',1,'2026-07-01','2026-07-31','migration-category','pop','MIG-1','{"dimension":"SKU"}','batch-a',1000,1,100),
        ('legacy-b',2,'2026-07-01','2026-07-31','migration-category','pop','MIG-1','{"dimension":"SKU"}','batch-a',2000,2,200),
        ('legacy-c',3,'2026-07-02','2026-07-30','migration-category','pop','MIG-1','{"dimension":"SKU"}','batch-a',1500,1,150),
        ('legacy-self',4,'2026-07-01','2026-07-31','migration-category','自营','MIG-1','{"dimension":"SKU"}','batch-a',3000,3,300),
        ('separator-a',5,'2026-07-01','2026-07-31','a','pop','b-SKU-c','{"dimension":"SKU"}','batch-a',1000,1,100),
        ('separator-b',6,'2026-07-01','2026-07-31','a-SKU-b','pop','c','{"dimension":"SKU"}','batch-a',1000,1,100);
      `);
    }
  }
  const facts = sqlite.prepare("SELECT COUNT(*) count FROM market_ranking_entries WHERE category='migration-category' AND sku_code='MIG-1'").get() as { count: number };
  const snapshots = sqlite.prepare("SELECT scope, source_price_cents sourcePrice FROM market_price_snapshots WHERE category='migration-category' AND sku_code='MIG-1' ORDER BY scope").all() as Array<{ scope: string; sourcePrice: number }>;
  assert.equal(facts.count, 3);
  assert.deepEqual(snapshots.map((row) => ({ ...row })), [{ scope: "pop", sourcePrice: 200 }, { scope: "自营", sourcePrice: 300 }]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_snapshots WHERE sku_code IN ('b-SKU-c','c')").get() as { count: number }).count, 2);
  assert.ok((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='market_price_snapshots_sku_month_uq'").get() as { name: string } | undefined)?.name);
  const source = sqlite.prepare("SELECT source_brand sourceBrand, source_operation_mode sourceMode FROM market_ranking_entries WHERE category='migration-category' LIMIT 1").get() as { sourceBrand: string; sourceMode: string };
  assert.equal(typeof source.sourceBrand, "string");
  assert.equal(typeof source.sourceMode, "string");
  const taskIndex = String((sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='market_download_tasks_unique_uq'").get() as { sql: string }).sql);
  assert.match(taskIndex, /category, scope, month, ranking_dimension/i);
  sqlite.close();
});

function entry(overrides: Partial<MarketEntryForImport> = {}): MarketEntryForImport {
  return {
    naturalKey: "2026-06-01|2026-06-30|净水|pop|SKU|SKU-1",
    sourceRowNumber: 1,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    category: "净水",
    scope: "pop",
    rankingDimension: "SKU",
    operationMode: "POP",
    subcategory: "台式",
    rank: 1,
    skuCode: "SKU-1",
    productName: "商品1",
    brand: "品牌1",
    priceCents: 199900,
    priceLowCents: 199900,
    priceHighCents: 199900,
    priceEstimated: false,
    gmvCents: 1000000,
    quantity: 5,
    pageViews: 1000,
    visitors: 100,
    conversionBps: 500,
    cartCustomers: 20,
    searchClicks: 30,
    imageUrl: "https://img10.360buyimg.com/imgzone/a.jpg",
    productUrl: "https://item.jd.com/1.html",
    raw: { dimension: "SKU" },
    ...overrides,
  };
}

test("monthly snapshot backfill selects one fact when a SKU has multiple date ranges in one month", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, price_cents, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES
      ('partial',1,'2026-06-01','2026-06-15','category-month','pop','SKU','POP','SKU-MONTH','Partial','Brand',100,1000,1,1,'{}','batch'),
      ('full',2,'2026-06-01','2026-06-30','category-month','pop','SKU','POP','SKU-MONTH','Full','Brand',200,2000,2,2,'{}','batch')`);
  sqlite.prepare("DELETE FROM market_master_audit_logs WHERE entity_type='runtime_schema'").run();
  await ensureMarketSchemaCore(db);
  const snapshots = sqlite.prepare("SELECT id, source_price_cents sourcePrice FROM market_price_snapshots WHERE category='category-month' AND sku_code='SKU-MONTH'").all() as Array<{ id: string; sourcePrice: number }>;
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.sourcePrice, 200);
  assert.match(snapshots[0]?.id ?? "", /^market-price-backfill-v2-/);
  sqlite.close();
});

test("snapshot ids cannot collide when business-key components contain separators", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const rows = [
    entry({ naturalKey: "key-a", category: "a-b", scope: "c", skuCode: "X" }),
    entry({ naturalKey: "key-b", category: "a", scope: "b-c", skuCode: "X", sourceRowNumber: 2 }),
  ];
  await saveMarketImportCore({ db, batchId: "separator-batch", sourceType: "jd", fileName: "separator.csv", fileSizeBytes: 10, fileHash: "separator-hash", sheetName: "CSV", rows, warnings: [] });
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_snapshots WHERE sku_code='X'").get() as { count: number }).count, 2);
  sqlite.close();
});

test("same market fact with different file hashes updates the canonical fact instead of duplicating sales", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.prepare("INSERT INTO market_image_cache (source_url,status,content_sha256) VALUES ('https://img10.360buyimg.com/imgzone/a.jpg','ready','hash-a')").run();

  const first = await saveMarketImportCore({ db, batchId: "batch-1", sourceType: "jd", fileName: "a.csv", fileSizeBytes: 10, fileHash: "hash-1", sheetName: "CSV", rows: [entry()], warnings: [] });
  const second = await saveMarketImportCore({ db, batchId: "batch-2", sourceType: "jd", fileName: "b.csv", fileSizeBytes: 11, fileHash: "hash-2", sheetName: "CSV", rows: [entry({ gmvCents: 1200000, naturalKey: "2026-06-01|2026-06-30|净水|pop|SKU|SKU-1" })], warnings: [] });

  assert.equal(first.insertedCount, 1);
  assert.equal(second.updatedCount, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count, SUM(gmv_cents) gmv FROM market_ranking_entries").get() as { count: number; gmv: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT SUM(gmv_cents) gmv FROM market_ranking_entries").get() as { gmv: number }).gmv, 1200000);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_import_batches").get() as { count: number }).count, 2);
  assert.equal((sqlite.prepare("SELECT image_content_sha256 hash FROM market_price_snapshots WHERE sku_code='SKU-1'").get() as { hash: string }).hash, "hash-a");
  sqlite.close();
});

test("official price band and market price statistics ignore unconfirmed source, transaction, deposit, and installment prices", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES
      ('a',1,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-A','A','A',1000000,10,10,'{}','b'),
      ('b',2,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-B','B','B',2000000,20,20,'{}','b'),
      ('c',3,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-C','C','C',3000000,30,30,'{}','b');
    INSERT INTO market_price_snapshots
      (id, category, sku_code, ranking_dimension, month, source_price_cents, ai_image_price_cents, ai_price_type, average_transaction_price_cents, confirmed_market_price_cents, confirmation_status)
    VALUES
      ('ps-a','净水','SKU-A','SKU','2026-06',199900,159900,'标准售价',100000,NULL,'source_table'),
      ('ps-b','净水','SKU-B','SKU','2026-06',NULL,9900,'定金',100000,NULL,'ai_pending'),
      ('ps-c','净水','SKU-C','SKU','2026-06',NULL,12000,'分期金额',100000,259900,'confirmed');
  `);
  const rows = sqlite.prepare(`
    SELECT m.sku_code sku, ${officialPriceBandSql("ps.confirmed_market_price_cents")} band
    FROM market_ranking_entries m
    JOIN market_price_snapshots ps ON ps.category=m.category AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    ORDER BY sku
  `).all() as Array<{ sku: string; band: string }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { sku: "SKU-A", band: "未确认价格" },
    { sku: "SKU-B", band: "未确认价格" },
    { sku: "SKU-C", band: "未确认价格" },
  ]);
  const official = sqlite.prepare("SELECT COUNT(*) count, AVG(confirmed_market_price_cents) avgPrice FROM market_price_snapshots WHERE confirmed_market_price_cents IS NOT NULL AND confirmation_status='confirmed' AND ai_price_type NOT IN (char(23450,37329), char(20998,26399,37329,39069), char(26080,27861,21028,26029))").get() as { count: number; avgPrice: number | null };
  assert.deepEqual({ ...official }, { count: 0, avgPrice: null });
  sqlite.close();
});

test("official price band SQL is alias-safe and D1-compatible inside the overview CTE", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`
    CREATE TABLE netshop_rows (sku_id TEXT, product_code TEXT, spu_id TEXT);
    CREATE TABLE sales_order_lines (product_code TEXT, allocated_amount_cents INTEGER, sales_time TEXT, ship_time TEXT);
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES
      ('overview-alias',1,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-ALIAS','别名测试商品','测试品牌',1000000,5,10,'{}','batch');
    INSERT INTO market_price_snapshots
      (id, category, scope, sku_code, ranking_dimension, month, ai_price_type, confirmed_market_price_cents, confirmation_status)
    VALUES
      ('ps-overview-alias','净水','pop','SKU-ALIAS','SKU','2026-06','标准售价',159900,'confirmed');
  `);
  const priceBandSql = officialPriceBandSql("snapshot.confirmed_market_price_cents", {
    confirmationStatusSql: "snapshot.confirmation_status",
    aiPriceTypeSql: "snapshot.ai_price_type",
    categorySql: "entry.category",
    periodEndSql: "entry.period_end",
  });
  assert.doesNotMatch(priceBandSql, /ORDER BY[^\n]*entry\.category/);
  const row = sqlite.prepare(`WITH enriched AS (
    SELECT entry.sku_code, ${priceBandSql} AS price_band
    FROM market_ranking_entries entry
    LEFT JOIN market_price_snapshots snapshot
      ON snapshot.category=entry.category AND snapshot.scope=entry.scope
      AND snapshot.sku_code=entry.sku_code AND snapshot.ranking_dimension=entry.ranking_dimension
      AND snapshot.month=substr(entry.period_end,1,7)
  ), filtered AS (SELECT * FROM enriched)
  SELECT sku_code sku, price_band band FROM filtered`).get() as { sku: string; band: string };
  assert.deepEqual({ ...row }, { sku: "SKU-ALIAS", band: "1000-1999" });
  const analytics = sqlite.prepare(buildMarketOverviewAnalyticsSql({ where: "WHERE m.ranking_dimension=?" })).get("SKU") as {
    summary_json: string; trend_json: string; price_bands_json: string; date_min: string; date_max: string;
  };
  assert.deepEqual(JSON.parse(analytics.summary_json), {
    product_count: 1, category_count: 1, brand_count: 1, gmv_cents: 1000000, quantity: 5,
    page_views: 0, visitors: 10, own_product_count: 0, self_operated_gmv_cents: 0, pending_ai_count: 0,
    median_market_price_cents: 159900, weighted_market_price_cents: 159900,
  });
  assert.deepEqual(JSON.parse(analytics.trend_json), [{
    period: "2026-06", gmv_cents: 1000000, quantity: 5, visitors: 10, product_count: 1, brand_count: 1,
    pop_gmv_cents: 1000000, self_gmv_cents: 0, average_transaction_price_cents: 200000,
    weighted_market_price_cents: 159900,
  }]);
  assert.deepEqual(JSON.parse(analytics.price_bands_json), [{ value: "1000-1999", count: 1 }]);
  assert.deepEqual({ start: analytics.date_min, end: analytics.date_max }, { start: "2026-06-01", end: "2026-06-30" });
  const filterOptions = sqlite.prepare(marketOverviewFilterOptionsSql).get() as { categories_json: string; dimensions_json: string };
  assert.deepEqual(JSON.parse(filterOptions.categories_json), [{ value: "净水", count: 1 }]);
  assert.deepEqual(JSON.parse(filterOptions.dimensions_json), [{ value: "SKU", count: 1 }]);
  sqlite.close();
});

test("brand share denominator uses all brands and display limiting happens after CR calculations", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const insert = sqlite.prepare(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, rank, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES (?, ?, '2026-06-01', '2026-06-30', '净水', 'pop', 'SKU', 'POP', ?, ?, ?, ?, ?, 1, 1, '{}', 'batch')`);
  for (let index = 1; index <= 31; index += 1) {
    const brand = `品牌${index.toString().padStart(2, "0")}`;
    const gmv = index === 31 ? 7000 : 1000;
    insert.run(`key-${index}`, index, index, `SKU-${index}`, `商品${index}`, brand, gmv);
  }
  const allBrands = sqlite.prepare("SELECT brand, SUM(gmv_cents) gmv FROM market_ranking_entries WHERE brand<>'' GROUP BY brand ORDER BY gmv DESC").all() as Array<{ brand: string; gmv: number }>;
  const brandTotal = allBrands.reduce((sum, row) => sum + row.gmv, 0);
  const displayed = allBrands.slice(0, 30);
  const cr3 = Math.round(allBrands.slice(0, 3).reduce((sum, row) => sum + row.gmv, 0) / brandTotal * 10000);
  assert.equal(brandTotal, 37000);
  assert.equal(displayed.length, 30);
  assert.equal(Math.round(displayed[0]!.gmv / brandTotal * 10000), 1892);
  assert.equal(cr3, 2432);
  sqlite.close();
});

test("market ranking limits candidates before previous-rank lookup and pins the selective index", async () => {
  const source = await readFile(new URL("../lib/market/database.ts", import.meta.url), "utf8");
  const topRanked = source.indexOf("top_ranked AS MATERIALIZED");
  const previousRank = source.indexOf("previous_rank", topRanked);
  assert.ok(topRanked >= 0 && previousRank > topRanked);
  assert.match(source, /market_ranking_entries p INDEXED BY market_entries_sku_idx/);
});
