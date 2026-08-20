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
const { resolveNetshopSalesOutletMatches } = await import("../lib/netshop/sales-shop-aliases");
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
      channel TEXT NOT NULL, shop_name TEXT NOT NULL, online_spec_code TEXT NOT NULL, allocated_amount_cents INTEGER NOT NULL,
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
  const sale = sqlite.prepare(`INSERT INTO sales_order_lines VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
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
    sale.run(index + 1, "2026-08-01 12:00:00", "主仓", sku, `商品-${index}`, "京东", "京东", "目录店铺", sku, 100, 20, 1, 80);
  }
  const extraBatches = [
    { id: "tm-same-batch", platform: "天猫", shopName: "目录店铺", source: "tmall_product_master" },
    { id: "jd-other-batch", platform: "京东", shopName: "另一店铺", source: "jd_product_master" },
    { id: "tm-other-batch", platform: "天猫", shopName: "另一店铺", source: "tmall_product_master" },
  ];
  const batchInsert = sqlite.prepare(`INSERT INTO netshop_import_batches VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const batch of extraBatches) {
    batchInsert.run(
      batch.id, batch.source, "product_master", batch.platform, batch.shopName, `${batch.id}.xlsx`, 1,
      `${batch.id}-hash`, "sheet", "completed", 1, 1, 0, 0, null, null, "2026-08-01", "[]", "{}", "",
      "2026-08-01 08:00:00", "2026-08-01 08:01:00",
    );
  }
  const extraRows = [
    { id: 101, batchId: "master-batch", source: "jd_product_master", platform: "京东", shopName: "目录店铺", code: "PAIR-JD-SAME" },
    { id: 102, batchId: "tm-same-batch", source: "tmall_product_master", platform: "天猫", shopName: "目录店铺", code: "PAIR-TM-SAME" },
    { id: 103, batchId: "jd-other-batch", source: "jd_product_master", platform: "京东", shopName: "另一店铺", code: "PAIR-JD-OTHER" },
    { id: 104, batchId: "tm-other-batch", source: "tmall_product_master", platform: "天猫", shopName: "另一店铺", code: "PAIR-TM-OTHER" },
    { id: 105, batchId: "master-batch", source: "jd_product_master", platform: "京东", shopName: "目录店铺", code: "CROSS-SHOP-A", salesCode: "SHARED-SALES-SKU" },
    { id: 106, batchId: "jd-other-batch", source: "jd_product_master", platform: "京东", shopName: "另一店铺", code: "CROSS-SHOP-B", salesCode: "SHARED-SALES-SKU" },
  ];
  for (const row of extraRows) {
    product.run(
      row.id, `row-${row.id}`, `hash-${row.id}`, row.batchId, row.batchId, row.id,
      row.source, "product_master", row.platform, row.shopName, null, "2026-08-01",
      row.code, row.code, row.code, `SPU-${row.code}`, "", "{}",
      JSON.stringify({ "商家SKU": "salesCode" in row ? row.salesCode : row.code, "商品状态": "上架" }),
      "2026-08-01 08:00:00", "2026-08-01 08:00:00",
    );
  }
  sale.run(101, "2026-08-01 12:00:00", "主仓", "P-A", "跨店商品A", "京东", "京东", "目录店铺", "SHARED-SALES-SKU", 100, 20, 1, 80);
  sale.run(102, "2026-08-02 12:00:00", "主仓", "P-B", "跨店商品B", "京东", "京东", "另一店铺", "SHARED-SALES-SKU", 900, 180, 1, 720);
  sale.run(103, "2026-08-03 12:00:00", "主仓", "P-C", "错误渠道商品", "京东", "天猫", "目录店铺", "SHARED-SALES-SKU", 700, 140, 1, 560);
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

test("platform-qualified outlet filters isolate same-name shops and never expand cross-platform pairs", async () => {
  const sqlite = createDatabase();
  const insert = sqlite.prepare(`INSERT INTO netshop_rows
    (id,source,dataset,platform,shop_name,business_date,product_code,product_name,sku_id,spu_id,metrics_json,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const identities = [
    { platform: "京东", shopName: "同名店", id: "JD-SAME" },
    { platform: "天猫", shopName: "同名店", id: "TM-SAME" },
    { platform: "京东", shopName: "另一店", id: "JD-OTHER" },
    { platform: "天猫", shopName: "另一店", id: "TM-OTHER" },
  ];
  let rowId = 1;
  for (const identity of identities) {
    insert.run(
      rowId++,
      identity.platform === "京东" ? "jd_sku_daily" : "tmall_product_daily",
      "spu_daily",
      identity.platform,
      identity.shopName,
      "2026-08-01",
      identity.id,
      identity.id,
      `${identity.id}-SKU`,
      identity.id,
      JSON.stringify({ visitors: 1, transactionAmountCents: 100, transactionCustomers: 1 }),
      "{}",
    );
    insert.run(
      rowId++,
      identity.platform === "京东" ? "jd_promotion" : "tmall_promotion",
      identity.platform === "京东" ? "ad" : "promotion_daily",
      identity.platform,
      identity.shopName,
      "2026-08-01",
      identity.id,
      identity.id,
      identity.platform === "京东" ? identity.id : "",
      identity.platform === "天猫" ? identity.id : "",
      JSON.stringify({ spendCents: 10, netTransactionAmountCents: 100, impressions: 10, clicks: 1, netOrders: 1 }),
      "{}",
    );
  }

  const sameNameOnly = await getNetshopProductPerformance(adapter(sqlite, []) as never, {
    dimension: "spu",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    pageSize: 100,
    outlets: [{ platform: "京东", shopName: "同名店" }],
  });
  assert.equal(sameNameOnly.summary.productCount, 1);
  assert.deepEqual(sameNameOnly.items.map((item) => `${item.platform}/${item.id}`), ["京东/JD-SAME"]);
  const invalidSelectionReads: string[] = [];
  await assert.rejects(
    getNetshopProductPerformance(adapter(sqlite, invalidSelectionReads) as never, {
      dimension: "spu",
      platformNames: ["京东"],
      outlets: [{ platform: "天猫", shopName: "同名店" }],
    }),
    /outlet 平台必须属于当前 platform 筛选/,
  );
  assert.equal(invalidSelectionReads.length, 0);

  const exactPairs = [
    { platform: "京东", shopName: "同名店" },
    { platform: "天猫", shopName: "另一店" },
  ];
  const product = await getNetshopProductPerformance(adapter(sqlite, []) as never, {
    dimension: "spu",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    pageSize: 100,
    outlets: exactPairs,
  });
  assert.equal(product.summary.productCount, 2);
  assert.deepEqual(new Set(product.items.map((item) => `${item.platform}/${item.id}`)), new Set(["京东/JD-SAME", "天猫/TM-OTHER"]));

  const promotion = await getNetshopPromotionPerformance(adapter(sqlite, []) as never, {
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    pageSize: 100,
    outlets: exactPairs,
  });
  assert.equal(promotion.summary.productCount, 2);
  assert.deepEqual(new Set(promotion.items.map((item) => `${item.platform}/${item.id}`)), new Set(["京东/JD-SAME", "天猫/TM-OTHER"]));
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
    outlets: [{ platform: "京东", shopName: "长期店铺" }],
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
    outlets: [{ platform: "京东", shopName: "长期店铺" }],
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
    outlets: Array.from({ length: 50 }, (_, index) => ({ platform: `platform-${index % 20}`, shopName: `shop-${index}` })),
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
    query: "SKU-PAGE-",
    page: 1,
    pageSize: 100,
    platformNames: ["京东"],
    outlets: [{ platform: "京东", shopName: "目录店铺" }],
    salesChannels: ["京东", ...Array.from({ length: 49 }, (_, index) => `无关渠道-${index}`)],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-01",
  });
  assert.equal(result.items.length, 100);
  assert.equal(result.items.every((item) => item.salesMatched), true);
  assert.ok(Math.max(...bindCounts) <= 100, `maximum bind count was ${Math.max(...bindCounts)}`);
  assert.ok(reads.some((sql) => /online_spec_code[\s\S]*json_each\(\?\)/i.test(sql)));
  sqlite.close();
});

test("product catalog applies selected outlets as exact platform and shop pairs", async () => {
  const sqlite = createProductCatalogDatabase();
  const sameNameOnly = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "PAIR-",
    pageSize: 100,
    outlets: [{ platform: "京东", shopName: "目录店铺" }],
  });
  assert.deepEqual(sameNameOnly.items.map((item) => `${item.platform}/${item.productCode}`), ["京东/PAIR-JD-SAME"]);

  const exactPairs = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "PAIR-",
    pageSize: 100,
    outlets: [
      { platform: "京东", shopName: "目录店铺" },
      { platform: "天猫", shopName: "另一店铺" },
    ],
  });
  assert.equal(exactPairs.pagination.total, 2);
  assert.deepEqual(
    new Set(exactPairs.items.map((item) => `${item.platform}/${item.productCode}`)),
    new Set(["京东/PAIR-JD-SAME", "天猫/PAIR-TM-OTHER"]),
  );
  sqlite.close();
});

test("product catalog image enrichment keeps platform and resolved shop in the image identity", async () => {
  const sqlite = createProductCatalogDatabase();
  const batch = sqlite.prepare(`INSERT INTO netshop_import_batches VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const input of [
    { id: "image-cross-platform", platform: "京东", shopName: "目录店铺", completedAt: "2026-08-04 08:00:00" },
    { id: "image-correct", platform: "京东", shopName: "目录店铺", completedAt: "2026-08-02 08:00:00" },
    { id: "image-other-shop", platform: "京东", shopName: "另一店铺", completedAt: "2026-08-05 08:00:00" },
  ]) {
    batch.run(
      input.id, "jd_yimei_sku", "yimei_sku", input.platform, input.shopName, `${input.id}.xlsx`, 1,
      `${input.id}-hash`, "sheet", "completed", 1, 1, 0, 0, null, null, "2026-08-01", "[]", "{}", "",
      input.completedAt, input.completedAt,
    );
  }
  const image = sqlite.prepare(`INSERT INTO netshop_rows VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  image.run(
    107, "image-cross-platform", "hash-107", "image-cross-platform", "image-cross-platform", 1,
    "jd_yimei_sku", "yimei_sku", "京东", "目录店铺", null, "2026-08-01",
    "PAIR-TM-SAME", "京东同编码商品", "PAIR-TM-SAME", "", "", "{}",
    JSON.stringify({ 主图链接: "https://example.test/cross-platform.jpg" }),
    "2026-08-04 08:00:00", "2026-08-04 08:00:00",
  );
  image.run(
    108, "image-correct", "hash-108", "image-correct", "image-correct", 1,
    "jd_yimei_sku", "yimei_sku", "京东", "目录店铺", null, "2026-08-01",
    "PAIR-JD-SAME", "京东正确商品", "PAIR-JD-SAME", "", "", "{}",
    JSON.stringify({ 主图链接: "https://example.test/correct.jpg" }),
    "2026-08-02 08:00:00", "2026-08-02 08:00:00",
  );
  image.run(
    109, "image-other-shop", "hash-109", "image-other-shop", "image-other-shop", 1,
    "jd_yimei_sku", "yimei_sku", "京东", "", null, "2026-08-01",
    "PAIR-JD-SAME", "另一店同编码商品", "PAIR-JD-SAME", "", "", "{}",
    JSON.stringify({ 主图链接: "https://example.test/other-shop.jpg" }),
    "2026-08-05 08:00:00", "2026-08-05 08:00:00",
  );

  const tmall = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "PAIR-TM-SAME",
    pageSize: 10,
    outlets: [{ platform: "天猫", shopName: "目录店铺" }],
  });
  assert.equal(tmall.items[0]?.imageUrl, "");

  const jd = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "PAIR-JD-SAME",
    pageSize: 10,
    outlets: [{ platform: "京东", shopName: "目录店铺" }],
  });
  assert.equal(jd.items[0]?.imageUrl, "https://example.test/correct.jpg");
  sqlite.close();
});

test("product catalog sales metrics use platform, shop, and SKU as one identity", async () => {
  const sqlite = createProductCatalogDatabase();
  const selected = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "CROSS-SHOP-",
    pageSize: 100,
    platformNames: ["京东"],
    outlets: [{ platform: "京东", shopName: "目录店铺" }],
    salesChannels: ["京东"],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-03",
  });
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0]?.netSalesCents, 100);
  assert.equal(selected.items[0]?.costPriceCents, 80);
  assert.equal(selected.sales.dataCutoffDate, "2026-08-01");

  const allShops = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
    query: "CROSS-SHOP-",
    pageSize: 100,
    platformNames: ["京东"],
    salesChannels: ["京东"],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-03",
  });
  assert.deepEqual(
    new Map(allShops.items.map((item) => [item.shopName, item.netSalesCents])),
    new Map([["目录店铺", 100], ["另一店铺", 900]]),
  );
  assert.equal(allShops.sales.dataCutoffDate, "2026-08-02");

  for (const salesChannels of [[], ["天猫"]]) {
    const restricted = await getNetshopProductCatalog(adapter(sqlite, []) as never, {
      query: "CROSS-SHOP-A",
      pageSize: 100,
      outlets: [{ platform: "京东", shopName: "目录店铺" }],
      salesChannels,
      salesStartDate: "2026-08-01",
      salesEndDate: "2026-08-03",
    });
    assert.equal(restricted.items[0]?.salesMatched, false);
    assert.equal(restricted.items[0]?.netSalesCents, null);
    assert.equal(restricted.sales.dataCutoffDate, null);
  }
  sqlite.close();
});

test("product catalog bridges only controlled JD canonical shops to exact approved ERP shop/channel pairs", async () => {
  assert.deepEqual(
    [
      "志高商用设备旗舰店",
      "志高切肉机旗舰店",
      "志高商用洗碗机旗舰店",
    ].map((shopName) => resolveNetshopSalesOutletMatches("京东", shopName)[0]),
    [
      {
        platform: "京东",
        canonicalShopName: "志高商用设备旗舰店",
        rawShopName: "志高商用设备旗舰店（亿用）",
        rawChannel: "京东-志高商用设备旗舰店（亿用）",
      },
      {
        platform: "京东",
        canonicalShopName: "志高切肉机旗舰店",
        rawShopName: "志高切肉机旗舰店（志高迈德豪）",
        rawChannel: "京东-志高切肉机旗舰店（志高迈德豪）",
      },
      {
        platform: "京东",
        canonicalShopName: "志高商用洗碗机旗舰店",
        rawShopName: "志高商用洗碗机旗舰店（志高炊之王）",
        rawChannel: "京东-志高商用洗碗机旗舰店（志高炊之王）",
      },
    ],
  );

  const sqlite = createProductCatalogDatabase();
  const batch = sqlite.prepare(`INSERT INTO netshop_import_batches VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const product = sqlite.prepare(`INSERT INTO netshop_rows VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const sale = sqlite.prepare(`INSERT INTO sales_order_lines VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const controlledStores = [
    {
      key: "device",
      canonicalShopName: "志高商用设备旗舰店",
      rawShopName: "志高商用设备旗舰店（亿用）",
      rawChannel: "京东-志高商用设备旗舰店（亿用）",
      amount: 110,
      date: "2026-08-01",
    },
    {
      key: "meat",
      canonicalShopName: "志高切肉机旗舰店",
      rawShopName: "志高切肉机旗舰店（志高迈德豪）",
      rawChannel: "京东-志高切肉机旗舰店（志高迈德豪）",
      amount: 220,
      date: "2026-08-02",
    },
    {
      key: "dishwasher",
      canonicalShopName: "志高商用洗碗机旗舰店",
      rawShopName: "志高商用洗碗机旗舰店（志高炊之王）",
      rawChannel: "京东-志高商用洗碗机旗舰店（志高炊之王）",
      amount: 330,
      date: "2026-08-03",
    },
  ] as const;
  for (const [index, store] of controlledStores.entries()) {
    const batchId = `controlled-${store.key}-batch`;
    batch.run(
      batchId, "jd_product_master", "product_master", "京东", store.canonicalShopName,
      `${batchId}.xlsx`, 1, `${batchId}-hash`, "sheet", "completed", 1, 1, 0, 0,
      null, null, "2026-08-01", "[]", "{}", "", "2026-08-04 08:00:00", "2026-08-04 08:01:00",
    );
    product.run(
      200 + index, `controlled-row-${index}`, `controlled-hash-${index}`, batchId, batchId, index + 1,
      "jd_product_master", "product_master", "京东", store.canonicalShopName, null, "2026-08-01",
      `ALIAS-PRODUCT-${store.key}`, `受控别名商品-${store.key}`, `ALIAS-SKU-${store.key}`,
      `ALIAS-SPU-${store.key}`, "", "{}", JSON.stringify({ "商家SKU": "SHARED-ERP-SKU", "商品状态": "上架" }),
      "2026-08-04 08:00:00", "2026-08-04 08:00:00",
    );
    sale.run(
      200 + index, `${store.date} 12:00:00`, "主仓", `ERP-${store.key}`,
      `受控销售-${store.key}`, "京东", store.rawChannel, store.rawShopName, "SHARED-ERP-SKU",
      store.amount, Math.round(store.amount / 5), 1, Math.round(store.amount * 4 / 5),
    );
  }

  // Same SKU and a later date must not cross from an unknown suffix or a
  // mismatched shop/channel pair into the device store's KPI or cutoff.
  sale.run(
    210, "2026-08-20 12:00:00", "主仓", "ERP-UNKNOWN", "未知主体", "京东",
    "京东-志高商用设备旗舰店（未知主体）", "志高商用设备旗舰店（未知主体）",
    "SHARED-ERP-SKU", 9_000, 1_800, 1, 7_200,
  );
  sale.run(
    211, "2026-08-19 12:00:00", "主仓", "ERP-CROSS", "错配渠道", "京东",
    "京东-志高切肉机旗舰店（志高迈德豪）", "志高商用设备旗舰店（亿用）",
    "SHARED-ERP-SKU", 8_000, 1_600, 1, 6_400,
  );

  const allChannels = [
    ...controlledStores.map((store) => store.rawChannel),
    "京东-志高商用设备旗舰店（未知主体）",
  ];
  const reads: string[] = [];
  const bindCounts: number[] = [];
  const allStores = await getNetshopProductCatalog(adapter(sqlite, reads, bindCounts) as never, {
    query: "ALIAS-PRODUCT-",
    pageSize: 100,
    platformNames: ["京东"],
    outlets: controlledStores.map((store) => ({ platform: "京东", shopName: store.canonicalShopName })),
    salesChannels: allChannels,
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-20",
  });
  assert.deepEqual(
    new Map(allStores.items.map((item) => [item.shopName, item.netSalesCents])),
    new Map(controlledStores.map((store) => [store.canonicalShopName, store.amount])),
  );
  assert.equal(allStores.sales.dataCutoffDate, "2026-08-03");

  const deviceOnly = await getNetshopProductCatalog(adapter(sqlite, reads, bindCounts) as never, {
    query: "ALIAS-PRODUCT-device",
    pageSize: 100,
    outlets: [{ platform: "京东", shopName: "志高商用设备旗舰店" }],
    salesChannels: allChannels,
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-20",
  });
  assert.equal(deviceOnly.items[0]?.netSalesCents, 110);
  assert.equal(deviceOnly.sales.dataCutoffDate, "2026-08-01");

  const wrongChannelScope = await getNetshopProductCatalog(adapter(sqlite, reads, bindCounts) as never, {
    query: "ALIAS-PRODUCT-device",
    pageSize: 100,
    outlets: [{ platform: "京东", shopName: "志高商用设备旗舰店" }],
    salesChannels: ["京东-志高切肉机旗舰店（志高迈德豪）"],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-20",
  });
  assert.equal(wrongChannelScope.items[0]?.salesMatched, false);
  assert.equal(wrongChannelScope.items[0]?.netSalesCents, null);
  assert.equal(wrongChannelScope.sales.dataCutoffDate, null);
  assert.ok(Math.max(...bindCounts) <= 100, `maximum bind count was ${Math.max(...bindCounts)}`);
  assert.ok(reads.some((sql) => /canonicalShopName[\s\S]*rawShopName[\s\S]*rawChannel/i.test(sql)));
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
