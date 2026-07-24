import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { saveMarketImportCore, type MarketEntryForImport } from "../lib/market/import-core";
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
  return sqlite;
}

test("0020 old market database upgrades columns, indexes, snapshots, and backfill deterministically", async () => {
  const sqlite = await oldMarketDatabase();
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureMarketSchemaCore(db);

  const columnNames = (table: string) => new Set((sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name));
  for (const column of ["ranking_dimension", "operation_mode", "subcategory", "price_low_cents", "price_high_cents", "price_estimated"]) {
    assert.ok(columnNames("market_ranking_entries").has(column), column);
  }
  for (const column of ["image_content_sha256", "source_import_batch_id", "average_transaction_price_cents"]) {
    assert.ok(columnNames("market_price_snapshots").has(column), column);
  }

  const rows = sqlite.prepare("SELECT sku_code sku, operation_mode mode, ranking_dimension dimension, natural_key naturalKey FROM market_ranking_entries ORDER BY sku_code").all() as Array<{ sku: string; mode: string; dimension: string; naturalKey: string }>;
  assert.deepEqual(rows.map((row) => [row.sku, row.mode, row.dimension]), [["SKU-1", "POP", "SKU"], ["SPU-1", "自营", "SPU"]]);
  assert.ok(rows.every((row) => row.naturalKey.split("|").length === 6));

  const snapshot = sqlite.prepare("SELECT source_price_cents sourcePrice, average_transaction_price_cents avgPrice, image_content_sha256 hash, image_url imageUrl, source_import_batch_id batchId FROM market_price_snapshots WHERE sku_code='SKU-1'").get() as { sourcePrice: number; avgPrice: number; hash: string; imageUrl: string; batchId: string };
  assert.deepEqual({ ...snapshot }, {
    sourcePrice: 199900,
    avgPrice: 200000,
    hash: "hash-a",
    imageUrl: "https://img10.360buyimg.com/imgzone/a.jpg",
    batchId: "batch-sku",
  });

  const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const index of ["market_entries_dimension_idx", "market_entries_subcategory_idx", "market_entries_canonical_uq", "market_price_snapshots_sku_month_uq"]) {
    assert.ok(indexes.has(index), index);
  }
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
    { sku: "SKU-C", band: "2000-2999" },
  ]);
  const official = sqlite.prepare("SELECT COUNT(*) count, AVG(confirmed_market_price_cents) avgPrice FROM market_price_snapshots WHERE confirmed_market_price_cents IS NOT NULL").get() as { count: number; avgPrice: number };
  assert.deepEqual({ ...official }, { count: 1, avgPrice: 259900 });
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
