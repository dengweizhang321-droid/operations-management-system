import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env={};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  ensureNetshopSchema,
  getNetshopProductCatalog,
  getNetshopProductPerformance,
  getNetshopPromotionPerformance,
  NETSHOP_DAILY_SERIES_LIMIT,
  saveNetshopImport,
} = await import("../lib/netshop/database");
const { PublicApiError } = await import("../lib/http/api-error");
const { netshopBatchId } = await import("../lib/netshop/batch-identity");
const {
  buildImportAttemptHash,
  buildImportContentFingerprint,
  ensureImportFingerprintSchema,
  reserveImportFingerprint,
} = await import("../lib/imports/content-fingerprint");

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE netshop_rows (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      dataset TEXT NOT NULL,
      platform TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      business_date TEXT,
      product_code TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      sku_id TEXT NOT NULL DEFAULT '',
      spu_id TEXT NOT NULL DEFAULT '',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      raw_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX netshop_rows_source_dataset_scope_date_idx
      ON netshop_rows (source,dataset,platform,shop_name,business_date);
  `);
  return sqlite;
}

function createProductCatalogDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE netshop_import_batches (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, dataset TEXT NOT NULL, platform TEXT NOT NULL,
      shop_name TEXT NOT NULL, file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      file_hash TEXT NOT NULL, sheet_name TEXT NOT NULL, status TEXT NOT NULL,
      row_count INTEGER NOT NULL, inserted_count INTEGER NOT NULL, duplicate_count INTEGER NOT NULL,
      warning_count INTEGER NOT NULL, date_min TEXT, date_max TEXT, snapshot_date TEXT,
      warnings_json TEXT NOT NULL, totals_json TEXT NOT NULL, note TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE netshop_rows (
      id INTEGER PRIMARY KEY, source_row_key TEXT NOT NULL, source_row_hash TEXT NOT NULL,
      first_import_batch_id TEXT NOT NULL, last_import_batch_id TEXT NOT NULL,
      source_row_number INTEGER NOT NULL, source TEXT NOT NULL, dataset TEXT NOT NULL,
      platform TEXT NOT NULL, shop_name TEXT NOT NULL, business_date TEXT, snapshot_date TEXT,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, sku_id TEXT NOT NULL, spu_id TEXT NOT NULL,
      warehouse_type TEXT NOT NULL, metrics_json TEXT NOT NULL, raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE sales_order_lines (
      id INTEGER PRIMARY KEY, ship_time TEXT NOT NULL, warehouse TEXT NOT NULL,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, platform TEXT NOT NULL,
      channel TEXT NOT NULL, online_spec_code TEXT NOT NULL, allocated_amount_cents INTEGER NOT NULL,
      gross_profit_cents INTEGER NOT NULL, quantity REAL NOT NULL, cost_amount_cents INTEGER NOT NULL
    );
    INSERT INTO netshop_import_batches VALUES (
      'master-batch','jd_product_master','product_master','京东','目录店铺','master.xlsx',1,
      'hash','sheet','completed',100,100,0,0,NULL,NULL,'2026-08-01','[]','{}','',
      '2026-08-01 08:00:00','2026-08-01 08:01:00'
    );
  `);
  const product = sqlite.prepare(`INSERT INTO netshop_rows VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const sale = sqlite.prepare(`INSERT INTO sales_order_lines VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  sqlite.exec("BEGIN");
  for (let index = 0; index < 100; index += 1) {
    const sku = `SKU-PAGE-${String(index).padStart(3, "0")}`;
    product.run(
      index + 1, `row-${index}`, `hash-${index}`, "master-batch", "master-batch", index + 1,
      "jd_product_master", "product_master", "京东", "目录店铺", null, "2026-08-01",
      sku, `商品-${index}`, sku, `SPU-${index}`, "", "{}",
      JSON.stringify({ "商家SKU": sku, "商品状态": "上架" }),
      "2026-08-01 08:00:00", "2026-08-01 08:00:00",
    );
    sale.run(index + 1, "2026-08-01 12:00:00", "主仓", sku, `商品-${index}`, "京东", "京东", sku, 100, 20, 1, 80);
  }
  sqlite.exec("COMMIT");
  return sqlite;
}

function adapter(sqlite: DatabaseSync, reads: string[], bindCounts: number[] = []) {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SQLInputValue[]; return this; },
        async first<T>() { reads.push(sql); bindCounts.push(values.length); return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { reads.push(sql); bindCounts.push(values.length); return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    },
  };
}

function transactionalAdapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SQLInputValue[]; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
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

test("netshop publish maps a proven commit-fence takeover to a safe 409 and rolls back facts", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const base = transactionalAdapter(sqlite);
  let takeOverBeforeNextBatch = false;
  const db = {
    prepare: base.prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      if (takeOverBeforeNextBatch) {
        takeOverBeforeNextBatch = false;
        sqlite.prepare("UPDATE import_scope_heads SET owner_token='new-owner' WHERE domain='netshop'").run();
      }
      return base.batch(statements);
    },
  };
  await ensureNetshopSchema(db as never);
  await ensureImportFingerprintSchema(db as never);
  const row = {
    sourceRowNumber: 1,
    sourceRowKey: JSON.stringify(["sku_daily", "京东", "测试店", "2026-08-01", "SKU-1"]),
    sourceRowHash: "a".repeat(64),
    source: "jd_sku_daily" as const,
    dataset: "sku_daily",
    platform: "京东",
    shopName: "测试店",
    businessDate: "2026-08-01",
    snapshotDate: "",
    productCode: "SKU-1",
    productName: "测试商品",
    skuId: "SKU-1",
    spuId: "",
    warehouseType: "",
    metrics: { visitors: 1 },
    raw: {},
  };
  const fingerprint = await buildImportContentFingerprint({
    domain: "netshop",
    scope: { source: row.source, dataset: row.dataset, platform: row.platform, shopName: row.shopName, startDate: row.businessDate, endDate: row.businessDate },
    lockScope: { source: row.source, dataset: row.dataset, platform: row.platform, shopName: row.shopName },
    rows: [row],
  });
  const fileHash = await buildImportAttemptHash({ fingerprint, currentStateToken: "initial" });
  const batchId = netshopBatchId({ source: row.source, platform: row.platform, shopName: row.shopName, fileHash });
  const owner = await reserveImportFingerprint(db as never, {
    ...fingerprint,
    batchId,
    importHash: fileHash,
    rawFileHash: "b".repeat(64),
    currentStateToken: "initial",
  });
  takeOverBeforeNextBatch = true;
  await assert.rejects(saveNetshopImport(db as never, {
    source: row.source,
    dataset: row.dataset,
    platform: row.platform,
    shopName: row.shopName,
    fileHash,
    fileName: "daily.xlsx",
    fileSizeBytes: 1,
    sheetName: "SKU",
    rows: [row],
    warnings: [],
    totals: {},
    note: "",
    replaceScope: { startDate: row.businessDate, endDate: row.businessDate },
    reservationFence: { domain: fingerprint.domain, scopeKey: fingerprint.scopeKey, batchId, attemptId: owner.attemptId },
  }), (error: unknown) => error instanceof PublicApiError && error.status === 409 && error.code === "conflict");
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM netshop_rows").get()?.count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM netshop_import_batches WHERE id=?").get(batchId)?.count, 0);
  assert.equal(sqlite.prepare("SELECT owner_token ownerToken FROM import_scope_heads WHERE domain='netshop'").get()?.ownerToken, "new-owner");
  sqlite.close();
});

test("100k product-day query stays equivalent, bounded, and avoids the duplicate total scan", async () => {
  const sqlite = createDatabase();
  const insert = sqlite.prepare(`INSERT INTO netshop_rows
    (id,source,dataset,platform,shop_name,business_date,product_code,product_name,sku_id,metrics_json,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const metrics = JSON.stringify({
    pageViews: 10,
    visitors: 5,
    transactionAmountCents: 10_000,
    transactionQuantity: 1,
    transactionCustomers: 1,
  });
  sqlite.exec("BEGIN");
  for (let index = 0; index < 100_000; index += 1) {
    const sku = `SKU-${String(index % 5_000).padStart(5, "0")}`;
    const day = String(index % 20 + 1).padStart(2, "0");
    insert.run(index + 1, "jd_sku_daily", "sku_daily", "京东", `店铺-${index % 4}`,
      `2026-07-${day}`, sku, `商品-${sku}`, sku, metrics, "{}");
  }
  sqlite.exec("COMMIT");
  insert.run(100_001, "jd_sku_daily", "sku_daily", "京东", "店铺-边界",
    "2026-07-21", "SKU-BOUNDARY", "区间外商品", "SKU-BOUNDARY", JSON.stringify({
      pageViews: 1,
      visitors: 1,
      transactionAmountCents: 999_999_999,
      transactionQuantity: 1,
      transactionCustomers: 1,
    }), "{}");

  const reads: string[] = [];
  const startedAt = performance.now();
  const result = await getNetshopProductPerformance(adapter(sqlite, reads) as never, {
    dimension: "sku",
    startDate: "2026-07-01",
    endDate: "2026-07-20",
    page: 1,
    pageSize: 20,
  });
  const elapsedMs = performance.now() - startedAt;
  const reference = sqlite.prepare(`SELECT
      COUNT(DISTINCT platform || char(31) || shop_name || char(31) || sku_id) AS products,
      SUM(CAST(json_extract(metrics_json,'$.transactionAmountCents') AS INTEGER)) AS amount
    FROM netshop_rows
    WHERE source='jd_sku_daily' AND dataset='sku_daily'
      AND business_date>='2026-07-01' AND business_date<'2026-07-21'`).get() as { products: number; amount: number };

  assert.equal(result.pagination.total, reference.products);
  assert.equal(result.summary.productCount, reference.products);
  assert.equal(result.summary.transactionAmountCents, reference.amount);
  assert.equal(result.pagination.returned, 20);
  assert.equal(result.coverage.actualDates.length, 20);
  assert.equal(reads.length, 5);
  assert.equal(reads.some((sql) => /AS total FROM netshop_rows/.test(sql)), false);
  assert.ok(elapsedMs < 5_000, `100k product-day query took ${Math.round(elapsedMs)}ms`);
  const readsBeforeInvalidInput = reads.length;
  await assert.rejects(
    getNetshopProductPerformance(adapter(sqlite, reads) as never, {
      dimension: "sku",
      startDate: "2026-07-31",
      endDate: "2026-07-01",
    }),
    { name: "NetshopQueryError" },
  );
  assert.equal(reads.length, readsBeforeInvalidInput, "invalid ranges must fail before any database read");
  sqlite.close();
});

test("omitted product and promotion periods return only the latest bounded daily series with explicit truncation", async () => {
  const sqlite = createDatabase();
  const insert = sqlite.prepare(`INSERT INTO netshop_rows
    (id,source,dataset,platform,shop_name,business_date,product_code,product_name,sku_id,spu_id,metrics_json,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const start = Date.UTC(2023, 0, 1);
  sqlite.exec("BEGIN");
  for (let index = 0; index < NETSHOP_DAILY_SERIES_LIMIT + 70; index += 1) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    insert.run(
      index * 2 + 1,
      "jd_sku_daily",
      "sku_daily",
      "京东",
      "长期店铺",
      date,
      "SKU-LONG",
      "长期商品",
      "SKU-LONG",
      "SPU-LONG",
      JSON.stringify({ visitors: 1, transactionAmountCents: 100, transactionCustomers: 1 }),
      "{}",
    );
    insert.run(
      index * 2 + 2,
      "jd_promotion",
      "ad",
      "京东",
      "长期店铺",
      date,
      "SKU-LONG",
      "长期商品",
      "SKU-LONG",
      "SPU-LONG",
      JSON.stringify({ spendCents: 10, netTransactionAmountCents: 100, impressions: 10, clicks: 1, netOrders: 1 }),
      "{}",
    );
  }
  sqlite.exec("COMMIT");

  const productReads: string[] = [];
  const product = await getNetshopProductPerformance(adapter(sqlite, productReads) as never, {
    dimension: "sku",
    page: 1,
    pageSize: 1,
    platformNames: ["京东"],
    shopNames: ["长期店铺"],
  });
  assert.deepEqual(product.dailyPagination, {
    total: NETSHOP_DAILY_SERIES_LIMIT + 70,
    returned: NETSHOP_DAILY_SERIES_LIMIT,
    truncated: true,
  });
  assert.equal(product.coverage.actualDates.length, NETSHOP_DAILY_SERIES_LIMIT);
  assert.equal(product.coverage.truncated, true);

  const promotionReads: string[] = [];
  const promotion = await getNetshopPromotionPerformance(adapter(sqlite, promotionReads) as never, {
    page: 1,
    pageSize: 1,
    platformNames: ["京东"],
    shopNames: ["长期店铺"],
  });
  assert.deepEqual(promotion.dailyPagination, {
    total: NETSHOP_DAILY_SERIES_LIMIT + 70,
    returned: NETSHOP_DAILY_SERIES_LIMIT,
    truncated: true,
  });
  assert.equal(promotion.coverage.promotionDatesPagination.truncated, true);
  assert.equal(promotion.coverage.productDailyDatesPagination.truncated, true);
  assert.equal(promotion.coverage.intersectionTruncated, true);
  assert.equal(promotion.items[0]?.dates.length, 0);
  assert.equal(promotion.items[0]?.datesTruncated, true);
  assert.ok([...productReads, ...promotionReads].filter((sql) => /daily_series/i.test(sql)).every((sql) => /LIMIT \?/i.test(sql)));
  sqlite.close();
});

test("maximum legal netshop filters stay below D1's 100-bind ceiling", async () => {
  const sqlite = createDatabase();
  const reads: string[] = [];
  const bindCounts: number[] = [];
  await getNetshopProductPerformance(adapter(sqlite, reads, bindCounts) as never, {
    dimension: "sku",
    query: "missing-product",
    page: 10_000,
    pageSize: 100,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    platformNames: Array.from({ length: 20 }, (_, index) => `platform-${index}`),
    shopNames: Array.from({ length: 50 }, (_, index) => `shop-${index}`),
  });
  assert.ok(bindCounts.length > 0);
  assert.ok(Math.max(...bindCounts) <= 100, `maximum bind count was ${Math.max(...bindCounts)}`);
  sqlite.close();
});

test("a 100-item product page aggregates sales through one JSON bind instead of 103 scalar binds", async () => {
  const sqlite = createProductCatalogDatabase();
  const reads: string[] = [];
  const bindCounts: number[] = [];
  const result = await getNetshopProductCatalog(adapter(sqlite, reads, bindCounts) as never, {
    page: 1,
    pageSize: 100,
    platformNames: ["京东"],
    shopNames: ["目录店铺"],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-01",
  });
  assert.equal(result.items.length, 100);
  assert.equal(result.items.every((item) => item.salesMatched), true);
  assert.ok(Math.max(...bindCounts) <= 100, `maximum bind count was ${Math.max(...bindCounts)}`);
  assert.ok(reads.some((sql) => /online_spec_code[\s\S]*json_each\(\?\)/i.test(sql)));
  sqlite.close();
});

test("a failed legacy-index PRAGMA probe is never treated or cached as schema-ready", async () => {
  let probes = 0;
  const failure = new Error("injected pragma failure");
  const db = {
    prepare(sql: string) {
      if (/PRAGMA index_list/i.test(sql)) {
        return { async all() { probes += 1; throw failure; } };
      }
      throw new Error(`unexpected SQL after failed probe: ${sql}`);
    },
  };
  await assert.rejects(ensureNetshopSchema(db as never), failure);
  await assert.rejects(ensureNetshopSchema(db as never), failure);
  assert.equal(probes, 2, "failed readiness promises must be evicted so the next request retries the probe");
});
