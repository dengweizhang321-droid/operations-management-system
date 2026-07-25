import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { AppPrincipal } from "../lib/auth/authorization";
import { executeToolCallWithRegistry, getOpenAiTools, type AiToolEntry } from "../lib/ai/tool-registry-contract";
import {
  applyPublishedMarketMappings,
  confirmMarketBrand,
  confirmMarketPrice,
  createMarketBrandRecognitionJob,
  createMarketPriceBandVersion,
  getMarketSkuComparison,
  getMarketBrandRecognitionJob,
  planMissingMarketDownloads,
  publishMarketPriceBandVersion,
  recordMarketDownloadAttempt,
  rollbackMarketPriceBandVersion,
  setMarketBrandRecognitionJobStatus,
  upsertMarketDownloadConfig,
  upsertMarketMapping,
} from "../lib/market/admin-service";
import { executeMarketDownloadTask } from "../lib/market/download-executor";
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
        const output = [];
        for (const statement of statements) output.push(await statement.run());
        sqlite.exec("COMMIT");
        return output;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const admin = { email: "admin@example.com", role: "admin" } as const;

test("brand recognition jobs count unique pending identities and persist pause/resume progress", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES
    ('brand-a-may',1,'2026-05-01','2026-05-31','净水','pop','SKU','POP','SKU-A','商品A旧标题','',100,1,1,'{}','batch'),
    ('brand-a-jun',2,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-A','商品A新标题','',200,2,2,'{}','batch'),
    ('brand-b-jun',3,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-B','商品B','',300,3,3,'{}','batch');
    INSERT INTO market_brand_suggestions
      (id, category, scope, ranking_dimension, sku_code, product_name, ai_brand, status, model_id)
    VALUES ('suggestion-a','净水','pop','SKU','SKU-A','商品A新标题','品牌A','ai_pending','model-1');`);
  const created = await createMarketBrandRecognitionJob(db as never, { modelId: "model-1", category: "净水" }, admin);
  assert.equal(created.totalCount, 1);
  assert.equal(created.remainingCount, 1);
  const paused = await setMarketBrandRecognitionJobStatus(db as never, { id: created.id, status: "paused" }, admin);
  assert.equal(paused?.status, "paused");
  const resumed = await setMarketBrandRecognitionJobStatus(db as never, { id: created.id, status: "queued" }, admin);
  assert.equal(resumed?.status, "queued");
  const fetched = await getMarketBrandRecognitionJob(db as never, { category: "净水" });
  assert.equal(fetched?.id, created.id);
  assert.equal(fetched?.progressBps, 0);
});

test("installment price confirmation is rejected and scoped confirmation cannot alter another scope", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  const installment = "\u5206\u671f\u91d1\u989d";
  const standard = "\u6807\u51c6\u552e\u4ef7";
  const selfOperated = "\u81ea\u8425";
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_price_snapshots (id, category, scope, sku_code, ranking_dimension, month, ai_price_type)
    VALUES ('pop-price','category-1','pop','SKU-1','SKU','2026-06','分期金额'), ('self-price','category-1','自营','SKU-1','SKU','2026-06','标准售价');`);
  await assert.rejects(() => confirmMarketPrice(db as never, {
    category: "category-1", scope: "pop", skuCode: "SKU-1", rankingDimension: "SKU", month: "2026-06",
    priceCents: 199900, priceType: installment,
  }, admin));
  await assert.rejects(() => confirmMarketPrice(db as never, {
    category: "category-1", scope: "pop", skuCode: "SKU-1", rankingDimension: "SKU", month: "2026-06",
    priceCents: 199900,
  }, admin));
  sqlite.prepare("UPDATE market_price_snapshots SET image_content_sha256='expected-hash' WHERE id='pop-price'").run();
  await assert.rejects(() => confirmMarketPrice(db as never, {
    category: "category-1", scope: "pop", skuCode: "SKU-1", rankingDimension: "SKU", month: "2026-06",
    priceCents: 199900, priceType: standard,
  }, admin));
  await confirmMarketPrice(db as never, {
    category: "category-1", scope: "pop", skuCode: "SKU-1", rankingDimension: "SKU", month: "2026-06",
    imageContentSha256: "expected-hash", priceCents: 199900, priceType: standard,
  }, admin);
  const prices = sqlite.prepare("SELECT scope, confirmed_market_price_cents price FROM market_price_snapshots ORDER BY scope").all() as Array<{ scope: string; price: number | null }>;
  assert.deepEqual(prices.map((row) => ({ ...row })), [{ scope: "pop", price: 199900 }, { scope: selfOperated, price: null }]);
  sqlite.close();
});

test("published master mappings apply to ranking facts and are audited", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, subcategory, sku_code, product_name, brand, raw_json, last_import_batch_id)
    VALUES ('mapping-1',1,'2026-06-01','2026-06-30','category-map','raw-store','SKU','未知','old-segment','SKU-MAP','Fresh segment product','old-brand','{}','batch');`);
  const brandRule = await upsertMarketMapping(db as never, { kind: "brand_alias", category: "category-map", sourceValue: "old-brand", targetValue: "new-brand", status: "published" }, admin);
  await upsertMarketMapping(db as never, { kind: "operation_mode", category: "category-map", sourceValue: "raw-store", targetValue: "POP", status: "published" }, admin);
  await upsertMarketMapping(db as never, { kind: "subcategory", category: "category-map", sourceValue: "Fresh", targetValue: "fresh-segment", status: "published" }, admin);
  const result = await applyPublishedMarketMappings(db as never, { category: "category-map" }, admin);
  assert.equal(result.changed, 3);
  const row = sqlite.prepare("SELECT brand, operation_mode mode, subcategory FROM market_ranking_entries WHERE sku_code='SKU-MAP'").get() as { brand: string; mode: string; subcategory: string };
  assert.deepEqual({ ...row }, { brand: "new-brand", mode: "POP", subcategory: "fresh-segment" });
  await upsertMarketMapping(db as never, { id: brandRule.id, kind: "brand_alias", category: "category-map", sourceValue: "old-brand", targetValue: "newest-brand", status: "published" }, admin);
  await applyPublishedMarketMappings(db as never, { category: "category-map" }, admin);
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='SKU-MAP'").get() as { brand: string }).brand, "newest-brand");
  assert.equal((sqlite.prepare("SELECT source_brand sourceBrand FROM market_ranking_entries WHERE sku_code='SKU-MAP'").get() as { sourceBrand: string }).sourceBrand, "old-brand");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action='apply_published_mappings'").get() as { count: number }).count, 2);
  sqlite.close();
});

test("download executor validates, stages, imports, caches, creates price tasks, recovers, and remains idempotent", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await upsertMarketDownloadConfig(db as never, { category: "category-download", scope: "pop", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-06" }, admin);
  await planMissingMarketDownloads(db as never, {}, admin);
  const task = sqlite.prepare("SELECT id FROM market_download_tasks LIMIT 1").get() as { id: string };
  let attempts = 0;
  let cached = 0;
  let priceTasks = 0;
  const csv = [
    "period_start,period_end,category,scope,dimension,rank,sku_code,product_name,brand,price,gmv,quantity,visitors,image_url",
    "2026-06-01,2026-06-30,category-download,pop,SKU,1,SKU-DL,Download product,Brand,1999,10000,5,20,https://img.example/dl.jpg",
  ].join("\n");
  const deps = {
    download: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary JD download failure");
      return { bytes: new TextEncoder().encode(csv), fileName: "market_SKU_2026-06.csv", jdTaskId: "jd-task-1" };
    },
    cacheImages: async () => { cached += 1; return { queued: 1 }; },
    createPriceTasks: async () => { priceTasks += 1; return { created: 1 }; },
  };
  const failed = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin, deps);
  assert.equal(failed.status, "failed");
  sqlite.prepare("UPDATE market_download_tasks SET next_retry_at=NULL WHERE id=?").run(task.id);
  const imported = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin, deps);
  assert.equal(imported.status, "imported");
  const duplicate = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin, deps);
  assert.equal(duplicate.duplicate, true);
  assert.equal(cached, 1);
  assert.equal(priceTasks, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_ranking_entries WHERE sku_code='SKU-DL'").get() as { count: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_download_staging_rows").get() as { count: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT status, header_valid headerValid, period_valid periodValid, category_valid categoryValid, dimension_valid dimensionValid FROM market_download_tasks WHERE id=?").get(task.id) as { status: string; headerValid: number; periodValid: number; categoryValid: number; dimensionValid: number }).status, "imported");
  const validation = JSON.parse((sqlite.prepare("SELECT validation_json validation FROM market_download_tasks WHERE id=?").get(task.id) as { validation: string }).validation) as { importIdentityHash: string };
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_import_batches WHERE file_hash=?").get(validation.importIdentityHash) as { count: number }).count, 1);
  sqlite.close();
});

test("same downloaded bytes remain idempotent per category scope dimension and month", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await upsertMarketDownloadConfig(db as never, { category: "category-identity", scope: "pop", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-07" }, admin);
  await planMissingMarketDownloads(db as never, {}, admin);
  const tasks = sqlite.prepare("SELECT id, month FROM market_download_tasks ORDER BY month").all() as Array<{ id: string; month: string }>;
  const csv = [
    "category,scope,dimension,rank,sku_code,product_name,brand,price,gmv,quantity,visitors",
    "category-identity,pop,SKU,1,SKU-SAME,Same bytes,Brand,1999,10000,5,20",
  ].join("\n");
  for (const task of tasks) {
    const result = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin, {
      download: async () => ({ bytes: new TextEncoder().encode(csv), fileName: "same.csv" }),
    });
    assert.equal(result.status, "imported");
  }
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_import_batches").get() as { count: number }).count, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_ranking_entries WHERE sku_code='SKU-SAME'").get() as { count: number }).count, 2);
  assert.deepEqual((sqlite.prepare("SELECT DISTINCT substr(period_end,1,7) month FROM market_ranking_entries ORDER BY month").all() as Array<{ month: string }>).map((row) => row.month), ["2026-06", "2026-07"]);
  sqlite.close();
});

test("download execution claim prevents concurrent imports and waiting login does not consume retries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await upsertMarketDownloadConfig(db as never, { category: "category-claim", scope: "pop", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-06" }, admin);
  await planMissingMarketDownloads(db as never, {}, admin);
  const task = sqlite.prepare("SELECT id FROM market_download_tasks LIMIT 1").get() as { id: string };
  const waiting = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin);
  assert.equal(waiting.status, "waiting_login");
  assert.equal((sqlite.prepare("SELECT attempt_count count FROM market_download_tasks WHERE id=?").get(task.id) as { count: number }).count, 0);
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const csv = [
    "period_start,period_end,category,scope,dimension,rank,sku_code,product_name,brand,gmv,quantity",
    "2026-06-01,2026-06-30,category-claim,pop,SKU,1,SKU-CLAIM,Claim,Brand,100,1",
  ].join("\n");
  const first = executeMarketDownloadTask(db as never, { taskId: task.id }, admin, { download: async () => { started(); await gate; return { bytes: new TextEncoder().encode(csv), fileName: "claim.csv" }; } });
  await startedPromise;
  const concurrent = await executeMarketDownloadTask(db as never, { taskId: task.id }, admin, { download: async () => ({ bytes: new TextEncoder().encode(csv), fileName: "claim.csv" }) });
  assert.equal(concurrent.busy, true);
  await assert.rejects(() => recordMarketDownloadAttempt(db as never, { taskId: task.id, status: "waiting_login" }, admin), /不能从客户端改写/);
  release();
  assert.equal((await first).status, "imported");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_import_batches").get() as { count: number }).count, 1);
  await assert.rejects(() => recordMarketDownloadAttempt(db as never, { taskId: task.id, status: "imported" as never }, admin), /客户端/);
  sqlite.close();
});

test("market price band configuration versions publish and rollback reproducibly", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES ('key-1',1,'2026-06-01','2026-06-30','净水','pop','SKU','POP','SKU-1','商品1','品牌1',1000,1,1,'{}','batch');
    INSERT INTO market_price_snapshots (id, category, sku_code, ranking_dimension, month, confirmed_market_price_cents, confirmation_status)
    VALUES ('ps-1','净水','SKU-1','SKU','2026-06',150000,'confirmed');`);
  const firstDraft = await createMarketPriceBandVersion(db as never, {
    category: "净水",
    items: [{ label: "stable-low", minCents: 0, maxCents: 160000 }, { label: "stable-high", minCents: 160000, maxCents: null }],
  }, admin);
  await publishMarketPriceBandVersion(db as never, firstDraft.id, admin);
  const draft = await createMarketPriceBandVersion(db as never, {
    category: "净水",
    items: [{ label: "custom-low", minCents: 0, maxCents: 200000 }, { label: "custom-high", minCents: 200000, maxCents: null }],
  }, admin);
  await publishMarketPriceBandVersion(db as never, draft.id, admin);
  let row = sqlite.prepare(`SELECT ${officialPriceBandSql("ps.confirmed_market_price_cents")} band
    FROM market_ranking_entries m JOIN market_price_snapshots ps ON ps.category=m.category AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)`).get() as { band: string };
  assert.equal(row.band, "custom-low");
  await rollbackMarketPriceBandVersion(db as never, { targetVersionId: firstDraft.id }, admin);
  row = sqlite.prepare(`SELECT ${officialPriceBandSql("ps.confirmed_market_price_cents")} band
    FROM market_ranking_entries m JOIN market_price_snapshots ps ON ps.category=m.category AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)`).get() as { band: string };
  assert.equal(row.band, "stable-low");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action IN ('create_price_band_version','publish_price_band_version','rollback_price_band_version')").get() as { count: number }).count, 5);
  sqlite.close();
});

test("market download tasks are idempotent and failed tasks recover until the third failure", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await upsertMarketDownloadConfig(db as never, { category: "净水", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-07" }, admin);
  assert.deepEqual(await planMissingMarketDownloads(db as never, {}, admin), { created: 2, reused: 0 });
  await planMissingMarketDownloads(db as never, {}, admin);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_download_tasks").get() as { count: number }).count, 2);
  const task = sqlite.prepare("SELECT id FROM market_download_tasks WHERE month='2026-06'").get() as { id: string };
  await recordMarketDownloadAttempt(db as never, { taskId: task.id, status: "failed", errorCode: "network", errorMessage: "timeout" }, admin);
  await planMissingMarketDownloads(db as never, {}, admin);
  let row = sqlite.prepare("SELECT status, attempt_count attemptCount FROM market_download_tasks WHERE id=?").get(task.id) as { status: string; attemptCount: number };
  assert.deepEqual({ ...row }, { status: "planned", attemptCount: 1 });
  await recordMarketDownloadAttempt(db as never, { taskId: task.id, status: "failed", errorCode: "network", errorMessage: "timeout" }, admin);
  await recordMarketDownloadAttempt(db as never, { taskId: task.id, status: "failed", errorCode: "network", errorMessage: "timeout" }, admin);
  await planMissingMarketDownloads(db as never, {}, admin);
  row = sqlite.prepare("SELECT status, attempt_count attemptCount FROM market_download_tasks WHERE id=?").get(task.id) as { status: string; attemptCount: number };
  assert.deepEqual({ ...row }, { status: "failed", attemptCount: 3 });
  await upsertMarketDownloadConfig(db as never, { category: "scope-category", scope: "pop", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-06" }, admin);
  await upsertMarketDownloadConfig(db as never, { category: "scope-category", scope: "self", rankingDimension: "SKU", monthStart: "2026-06", monthEnd: "2026-06" }, admin);
  assert.deepEqual(await planMissingMarketDownloads(db as never, { category: "scope-category" }, admin), { created: 2, reused: 0 });
  assert.equal((sqlite.prepare("SELECT COUNT(DISTINCT scope) count FROM market_download_tasks WHERE category='scope-category'").get() as { count: number }).count, 2);
  sqlite.close();
});

test("market SKU comparison returns real metrics and monthly trends for 2 to 5 SKUs", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const insert = sqlite.prepare(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, rank, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES (?, ?, ?, ?, '净水', 'pop', 'SKU', 'POP', ?, ?, ?, ?, ?, ?, ?, '{}', 'batch')`);
  insert.run("a1", 1, "2026-05-01", "2026-05-31", 2, "SKU-A", "商品A", "品牌A", 1000, 2, 10);
  insert.run("a2", 2, "2026-06-01", "2026-06-30", 1, "SKU-A", "商品A新标题", "品牌A", 3000, 3, 10);
  insert.run("b1", 3, "2026-06-01", "2026-06-30", 3, "SKU-B", "商品B", "品牌B", 2000, 4, 20);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, rank, sku_code, product_name, brand, gmv_cents, quantity, visitors, raw_json, last_import_batch_id)
    VALUES ('a-self',4,'2026-06-01','2026-06-30','净水','self','SKU','自营',5,'SKU-A','商品A','品牌A',9000,9,9,'{}','batch')`);
  sqlite.exec(`INSERT INTO market_price_snapshots (id, category, sku_code, ranking_dimension, month, confirmed_market_price_cents, average_transaction_price_cents, confirmation_status)
    VALUES ('pa','净水','SKU-A','SKU','2026-06',120000,1000,'confirmed'), ('pb','净水','SKU-B','SKU','2026-06',90000,500,'confirmed');`);
  const compared = await getMarketSkuComparison(db as never, { skuCodes: ["SKU-A", "SKU-B"], categories: ["净水"], rankingDimensions: ["SKU"], operationModes: ["POP"] });
  assert.equal(compared.items.length, 2);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-A")?.gmvCents, 4000);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-A")?.productName, "商品A新标题");
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-A")?.trend.length, 2);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-B")?.bestRank, 3);
  sqlite.close();
});

test("manual brand confirmation persists a replayable per-product override", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, rank, sku_code, product_name, brand, raw_json, last_import_batch_id)
    VALUES ('brand-empty',1,'2026-06-01','2026-06-30','净水','pop','SKU','POP',1,'SKU-BRAND','美的（Midea）商用净水机','', '{}','batch')`);
  await confirmMarketBrand(db as never, {
    category: "净水", scope: "pop", rankingDimension: "SKU", skuCode: "SKU-BRAND", brand: "美的",
  }, admin);
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='SKU-BRAND'").get() as { brand: string }).brand, "美的");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_mapping_rules WHERE kind='brand_override'").get() as { count: number }).count, 1);
  sqlite.exec("UPDATE market_ranking_entries SET brand='' WHERE sku_code='SKU-BRAND'");
  await applyPublishedMarketMappings(db as never, {}, admin);
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='SKU-BRAND'").get() as { brand: string }).brand, "美的");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action='confirm_market_brand'").get() as { count: number }).count, 1);
  sqlite.close();
});

test("central market AI tools enforce roles, bounded schemas, and audit execution", async () => {
  const registrySource = await readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8");
  const marketNames = ["get_market_overview", "get_market_sku_trend", "get_market_brand_analysis", "get_market_price_band_analysis", "get_market_pending_review_summary"];
  for (const name of marketNames) assert.match(registrySource, new RegExp(`name: "${name}"`));
  assert.match(registrySource, /additionalProperties: false/g);
  assert.match(registrySource, /risk: "read_only"/);
  assert.match(registrySource, /callMarketTool\("get_market_overview"/);
  const viewer: AppPrincipal = { email: "viewer@example.com", displayName: "Viewer", role: "viewer", scope: null };
  const analyst: AppPrincipal = { ...viewer, email: "analyst@example.com", role: "analyst" };
  const overviewEntry: AiToolEntry = {
    name: "get_market_overview",
    title: "Market overview",
    description: "Bounded market overview",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", maxLength: 120 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: "read_only",
    allowedRoles: ["analyst", "operator", "admin"],
    supportsScopedPrincipal: false,
    handler: async () => ({ returned: 1, truncated: false }),
  };
  assert.equal(getOpenAiTools(viewer, [overviewEntry]).some((item) => item.function.name === "get_market_overview"), false);
  assert.equal(getOpenAiTools(analyst, [overviewEntry]).some((item) => item.function.name === "get_market_overview"), true);
  let called = false;
  const stubEntry: AiToolEntry = { ...overviewEntry, handler: async () => { called = true; return { returned: 1, truncated: false }; } };
  const audits: Array<Record<string, unknown>> = [];
  const invalid = await executeToolCallWithRegistry("get_market_overview", { arbitrarySql: "select *" }, { principal: analyst, surface: "test", requestId: "market-ai-invalid" }, {
    entries: [stubEntry],
    audit: async (input) => { audits.push(input); },
  });
  assert.equal(invalid.ok, false);
  assert.equal(called, false);
  const ok = await executeToolCallWithRegistry("get_market_overview", { category: "净水" }, { principal: analyst, surface: "test", requestId: "market-ai-ok" }, {
    entries: [stubEntry],
    audit: async (input) => { audits.push(input); },
  });
  assert.equal(ok.ok, true);
  assert.equal(called, true);
  assert.equal(audits.filter((item) => item.requestId === "market-ai-ok").length, 2);
});
