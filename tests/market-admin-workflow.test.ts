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
  getMarketBrandSeedWorkspace,
  getMarketSubcategoryWorkspace,
  getMarketSystemKpis,
  listMarketMasterData,
  listPendingMarketPrices,
  matchMarketBrandSeeds,
  planMissingMarketDownloads,
  publishMarketPriceBandVersion,
  recordMarketDownloadAttempt,
  refreshMarketBrandSeeds,
  rollbackMarketPriceBandVersion,
  setMarketBrandRecognitionJobStatus,
  saveMarketSubcategorySettings,
  updateMarketSkuMasterData,
  upsertMarketDownloadConfig,
  upsertMarketBrandSeed,
  upsertMarketMapping,
} from "../lib/market/admin-service";
import { ensureAnnotationSchema } from "../lib/market/annotation-schema";
import { ensureMarketMasterIdentities, refreshMarketMasterIdentities } from "../lib/market/master-identity";
import { executeMarketDownloadTask } from "../lib/market/download-executor";
import { matchMarketBrandTitle, type MarketBrandSeed } from "../lib/market/brand-seeds";
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

test("market master GMV totals prefer full-month coverage, ignore rolling windows, and use child bands only as monthly fallback", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,price_band_filter,ranking_dimension,operation_mode,sku_code,product_name,gmv_cents,raw_json,last_import_batch_id)
    VALUES
    ('a-month',1,'2026-06-01','2026-06-30','净水','POP','全部','SKU','POP','SKU-A','A',1000,'{}','batch'),
    ('a-day-1',2,'2026-06-01','2026-06-01','净水','POP','全部','SKU','POP','SKU-A','A',100,'{}','batch'),
    ('a-day-2',3,'2026-06-02','2026-06-02','净水','POP','全部','SKU','POP','SKU-A','A',100,'{}','batch'),
    ('a-rolling',4,'2026-07-02','2026-07-31','净水','POP','全部','SKU','POP','SKU-A','A',999999,'{}','batch'),
    ('b-basis',5,'2026-07-01','2026-07-01','净水','POP','全部','SKU','POP','SKU-B','B',100,'{}','batch'),
    ('b-child-1',6,'2026-07-01','2026-07-01','净水','POP','0-500','SKU','POP','SKU-B','B',1000,'{}','batch'),
    ('b-child-2',7,'2026-07-02','2026-07-02','净水','POP','0-500','SKU','POP','SKU-B','B',1000,'{}','batch'),
    ('c-child-1',8,'2026-07-01','2026-07-01','净水','POP','0-500','SKU','POP','SKU-C','C',1000,'{}','batch'),
    ('c-child-2',9,'2026-07-02','2026-07-02','净水','POP','0-500','SKU','POP','SKU-C','C',1000,'{}','batch');`);
  const result = await listMarketMasterData(db as never, { pageSize: 20 });
  const totals = Object.fromEntries(result.items.map((row) => [row.skuCode, row.gmvTotalCents]));
  assert.deepEqual(totals, { "SKU-C": 2000, "SKU-A": 1000, "SKU-B": 100 });
  sqlite.close();
});

test("system settings KPIs use independent whole-database product identities", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db as never);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES
    ('a-june',1,'2026-06-01','2026-06-30','category-a','POP','SKU','POP','SKU-A','A June','{}','batch'),
    ('a-july',2,'2026-07-01','2026-07-31','category-a','POP','SKU','POP','SKU-A','A July','{}','batch'),
    ('b-june',3,'2026-06-01','2026-06-30','category-b','POP','SKU','POP','SKU-A','B','{}','batch'),
    ('c-june',4,'2026-06-01','2026-06-30','category-c','self','SPU','自营','SPU-C','C','{}','batch');
    INSERT INTO market_price_snapshots
    (id,category,scope,sku_code,ranking_dimension,month,confirmed_market_price_cents,confirmation_status)
    VALUES
    ('price-a-june','category-a','POP','SKU-A','SKU','2026-06',10000,'confirmed'),
    ('price-a-july','category-a','POP','SKU-A','SKU','2026-07',NULL,'review_pending'),
    ('price-c-june','category-c','self','SPU-C','SPU','2026-06',20000,'confirmed');
    INSERT INTO market_annotation_items
    (id,job_id,category,scope,sku_code,ranking_dimension,month,status,ai_segment)
    VALUES
    ('annotation-a','job-a','category-a','POP','SKU-A','SKU','2026-06','completed','segment-a'),
    ('annotation-b','job-b','category-b','POP','SKU-A','SKU','2026-06','failed','');`);

  assert.deepEqual(await getMarketSystemKpis(db as never), {
    marketIdentityTotal: 3,
    pendingPriceCount: 2,
    pendingAiCount: 2,
    completedAiCount: 1,
  });
  sqlite.close();
});

test("market master identity cache selects the latest row and refreshes after imports", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES
    ('identity-old',1,'2026-05-01','2026-05-31','category-cache','POP','SKU','POP','SKU-CACHE','Old','{}','batch'),
    ('identity-new',2,'2026-06-01','2026-06-30','category-cache','POP','SKU','POP','SKU-CACHE','New','{}','batch');`);
  await ensureMarketMasterIdentities(db);
  assert.equal((sqlite.prepare(`SELECT m.product_name productName FROM market_master_identities identity
    JOIN market_ranking_entries m ON m.id=identity.latest_entry_id`).get() as { productName: string }).productName, "New");

  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES ('identity-latest',3,'2026-07-01','2026-07-31','category-cache','POP','SKU','POP','SKU-CACHE','Latest','{}','batch');`);
  await refreshMarketMasterIdentities(db);
  assert.equal((sqlite.prepare(`SELECT m.product_name productName FROM market_master_identities identity
    JOIN market_ranking_entries m ON m.id=identity.latest_entry_id`).get() as { productName: string }).productName, "Latest");
  sqlite.close();
});

test("pending market prices filter displayed AI sources and paginate non-AI sources", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec("CREATE TABLE netshop_rows (source TEXT, dataset TEXT, business_date TEXT, sku_id TEXT, spu_id TEXT, product_code TEXT, metrics_json TEXT)");
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, raw_json, last_import_batch_id)
    VALUES
    ('price-ai',1,'2026-06-01','2026-06-30','category-price','pop','SKU','POP','SKU-AI','AI price product','','{}','batch'),
    ('price-source',2,'2026-06-01','2026-06-30','category-price','pop','SKU','POP','SKU-SOURCE','Source price product','','{}','batch'),
    ('price-average',3,'2026-06-01','2026-06-30','category-price','pop','SKU','POP','SKU-AVERAGE','Average price product','','{}','batch');
    INSERT INTO market_price_snapshots
    (id, category, scope, sku_code, ranking_dimension, month, source_price_cents, average_transaction_price_cents, ai_image_price_cents, confirmation_status)
    VALUES
    ('snapshot-ai','category-price','pop','SKU-AI','SKU','2026-06',NULL,500000,1150000,'ai_pending'),
    ('snapshot-source','category-price','pop','SKU-SOURCE','SKU','2026-06',769900,NULL,NULL,'source_table'),
    ('snapshot-average','category-price','pop','SKU-AVERAGE','SKU','2026-06',NULL,233300,NULL,'review_pending');`);

  const ai = await listPendingMarketPrices(db as never, { category: "category-price", candidatePriceSource: "ai", page: 1, pageSize: 20 });
  assert.equal(ai.pagination.total, 1);
  assert.equal(ai.items[0]?.skuCode, "SKU-AI");
  assert.equal(ai.items[0]?.candidatePriceSource, "ai_suggestion");

  const nonAiFirst = await listPendingMarketPrices(db as never, { category: "category-price", candidatePriceSource: "non_ai", page: 1, pageSize: 1 });
  const nonAiSecond = await listPendingMarketPrices(db as never, { category: "category-price", candidatePriceSource: "non_ai", page: 2, pageSize: 1 });
  assert.equal(nonAiFirst.pagination.total, 2);
  assert.equal(nonAiFirst.pagination.pageCount, 2);
  assert.equal(nonAiFirst.items.length, 1);
  assert.equal(nonAiSecond.items.length, 1);
  assert.notEqual(nonAiFirst.items[0]?.skuCode, nonAiSecond.items[0]?.skuCode);
  assert.ok(nonAiFirst.items.every((item) => item.candidatePriceSource !== "ai_suggestion"));
  assert.ok(nonAiSecond.items.every((item) => item.candidatePriceSource !== "ai_suggestion"));
  sqlite.close();
});

test("unified SKU database filters annotation storage status and updates all editable master fields", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db as never);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,subcategory,sku_code,product_name,brand,raw_json,last_import_batch_id)
    VALUES ('edit-key',1,'2026-06-01','2026-06-30','三级类目A','POP','SKU','POP','旧细分','SKU-EDIT','旧标题','旧品牌','{}','batch');
    INSERT INTO market_price_snapshots (id,category,scope,sku_code,ranking_dimension,month,confirmation_status)
    VALUES ('edit-price','三级类目A','POP','SKU-EDIT','SKU','2026-06','missing');
    INSERT INTO market_sku_annotations (id,category,sku_code,segment,image_price_cents,source_job_item_id,prompt_version_id,reviewed_by,reviewed_at)
    VALUES ('edit-annotation','三级类目A','SKU-EDIT','旧细分',10000,'source-item','source-prompt','admin@example.com',CURRENT_TIMESTAMP);
    INSERT INTO market_subcategory_taxonomy (id,category,subcategory,status,created_by,updated_by)
    VALUES ('edit-target-taxonomy','三级类目B','新细分','active','test','test');`);

  const committed = await listMarketMasterData(db as never, { annotationStatus: "committed" });
  const pending = await listMarketMasterData(db as never, { annotationStatus: "pending" });
  assert.equal(committed.pagination.total, 1);
  assert.equal(pending.pagination.total, 0);
  assert.equal(committed.items[0]?.annotationStatus, "committed");

  await updateMarketSkuMasterData(db as never, {
    originalCategory: "三级类目A", category: "三级类目B", scope: "POP", rankingDimension: "SKU", skuCode: "SKU-EDIT", month: "2026-06",
    productName: "新标题", brand: "新品牌", operationMode: "自营", subcategory: "新细分", priceCents: 259900, priceType: "标准售价",
  }, admin);
  const master = sqlite.prepare("SELECT category,product_name productName,brand,operation_mode operationMode,subcategory,natural_key naturalKey FROM market_ranking_entries WHERE sku_code='SKU-EDIT'").get() as Record<string, string>;
  assert.deepEqual({ category: master.category, productName: master.productName, brand: master.brand, operationMode: master.operationMode, subcategory: master.subcategory },
    { category: "三级类目B", productName: "新标题", brand: "新品牌", operationMode: "自营", subcategory: "新细分" });
  assert.match(master.naturalKey, /\|三级类目B\|/);
  const price = sqlite.prepare("SELECT category,confirmed_market_price_cents price FROM market_price_snapshots WHERE id='edit-price'").get() as { category: string; price: number };
  assert.deepEqual({ ...price }, { category: "三级类目B", price: 259900 });
  assert.deepEqual({ ...(sqlite.prepare("SELECT category,segment FROM market_sku_annotations WHERE id='edit-annotation'").get() as Record<string, unknown>) }, { category: "三级类目B", segment: "新细分" });
  sqlite.close();
});

test("runtime taxonomy backfills existing subcategories and the settings workspace reads the dictionary table", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,subcategory,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES ('legacy-taxonomy-key',1,'2026-06-01','2026-06-30','历史三级类目','POP','SKU','POP','历史细分','SKU-LEGACY-TAX','商品','{}','batch');
    DELETE FROM market_subcategory_taxonomy;
    DELETE FROM market_master_audit_logs WHERE entity_type='runtime_schema' AND entity_id='market-subcategory-taxonomy-v1';`);
  await ensureMarketSchemaCore(db);
  const workspace = await getMarketSubcategoryWorkspace(db as never, "历史三级类目");
  assert.deepEqual(workspace.items.map((item) => item.subcategory), ["历史细分"]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_subcategory_taxonomy WHERE status='active'").get() as { count: number }).count > 1, true);
  sqlite.close();
});

test("0036 migration moves ranking, annotation, and prompt taxonomies into the dictionary table", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db as never);
  sqlite.exec(`DELETE FROM market_subcategory_taxonomy;
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,subcategory,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES ('migration-taxonomy',1,'2026-06-01','2026-06-30','迁移类目','POP','SKU','POP','榜单细分','SKU-MIGRATION','商品','{}','batch');
    INSERT INTO market_sku_annotations (id,category,sku_code,segment,source_job_item_id,prompt_version_id,reviewed_by,reviewed_at)
    VALUES ('migration-annotation','迁移类目','SKU-MIGRATION','标注细分','item','prompt','admin@example.com',CURRENT_TIMESTAMP);
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
    VALUES ('migration-prompt','迁移类目',1,'manual','active','["Prompt细分","其他"]','这是一个用于迁移测试且长度足够的 Prompt 正文内容。','admin@example.com');`);
  sqlite.exec(await readFile(new URL("../drizzle/0036_backfill_market_subcategory_taxonomy.sql", import.meta.url), "utf8"));
  const values = (sqlite.prepare("SELECT subcategory FROM market_subcategory_taxonomy WHERE category='迁移类目' ORDER BY subcategory").all() as Array<{ subcategory: string }>).map((row) => row.subcategory);
  assert.deepEqual(values, ["Prompt细分", "其他", "标注细分", "榜单细分"]);
  sqlite.close();
});

test("subcategory settings rename and refresh ranking, committed annotations, pending candidates, and future mappings", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  await ensureAnnotationSchema(db as never);
  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,subcategory,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES ('taxonomy-key',1,'2026-06-01','2026-06-30','三级类目','POP','SKU','POP','旧品类','SKU-TAX','商品','{}','batch');
    INSERT INTO market_sku_annotations (id,category,sku_code,segment,source_job_item_id,prompt_version_id,reviewed_by,reviewed_at)
    VALUES ('taxonomy-annotation','三级类目','SKU-TAX','旧品类','source-item','source-prompt','admin@example.com',CURRENT_TIMESTAMP);
    INSERT INTO market_annotation_prompt_versions (id,category,version,source,status,segments_json,prompt_body,created_by)
    VALUES ('taxonomy-prompt','三级类目',1,'manual','active','["旧品类"]','这是一个用于测试细分品类同步刷新的足够长 Prompt 正文。','admin@example.com');
    INSERT INTO market_annotation_jobs (id,category,prompt_version_id,executor,status,total_count,created_by)
    VALUES ('taxonomy-job','三级类目','taxonomy-prompt','cloud','running',1,'admin@example.com');
    INSERT INTO market_annotation_items (id,job_id,category,scope,sku_code,ranking_dimension,month,product_name,status,ai_segment,reviewed_segment)
    VALUES ('taxonomy-item','taxonomy-job','三级类目','POP','SKU-TAX','SKU','2026-06','商品','review_pending','旧品类','旧品类');`);

  const result = await saveMarketSubcategorySettings(db as never, { category: "三级类目", renames: [{ source: "旧品类", target: "新品类" }], additions: ["新增品类"] }, admin);
  assert.equal(result.changedRows, 3);
  assert.equal((sqlite.prepare("SELECT subcategory FROM market_ranking_entries WHERE sku_code='SKU-TAX'").get() as { subcategory: string }).subcategory, "新品类");
  assert.equal((sqlite.prepare("SELECT segment FROM market_sku_annotations WHERE id='taxonomy-annotation'").get() as { segment: string }).segment, "新品类");
  assert.deepEqual({ ...(sqlite.prepare("SELECT ai_segment aiSegment,reviewed_segment reviewedSegment FROM market_annotation_items WHERE id='taxonomy-item'").get() as Record<string, unknown>) }, { aiSegment: "新品类", reviewedSegment: "新品类" });
  assert.equal((sqlite.prepare("SELECT target_value targetValue FROM market_master_mapping_rules WHERE kind='subcategory' AND source_value='旧品类'").get() as { targetValue: string }).targetValue, "新品类");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_subcategory_taxonomy WHERE category='三级类目' AND status='active'").get() as { count: number }).count, 2);
  sqlite.close();
});

test("brand seed matching prefers the earliest title brand and protects short ASCII seeds", () => {
  const seed = (canonicalBrand: string, seedText: string): MarketBrandSeed => ({
    id: seedText, canonicalBrand, seedText, normalizedSeed: seedText.toLowerCase(), source: "system", sourceRef: "test", status: "enabled",
  });
  const seeds = [seed("DEMASHI", "DEMASHI"), seed("德玛仕", "德玛仕"), seed("CK", "CK")];
  assert.equal(matchMarketBrandTitle("德玛仕（DEMASHI）商用净水器", seeds, "title_anywhere")?.brand, "德玛仕");
  assert.equal(matchMarketBrandTitle("BLACK 商用设备", seeds, "title_anywhere"), null);
});

test("system brand seeds refresh and apply B-store prefix versus C-store anywhere rules", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`CREATE TABLE erp_product_master (brand TEXT NOT NULL DEFAULT '');
    INSERT INTO erp_product_master (brand) VALUES ('品牌甲'), ('配件');
    INSERT INTO market_ranking_entries
      (natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension, operation_mode, sku_code, product_name, brand, raw_json, last_import_batch_id)
    VALUES
      ('seed-b-prefix',1,'2026-06-01','2026-06-30','净水','B店','SKU','自营','B-PREFIX','品牌甲商用净水机','', '{"店铺类型":"B店"}','batch'),
      ('seed-b-late',2,'2026-06-01','2026-06-30','净水','B店','SKU','自营','B-LATE','商用净水机品牌甲','', '{"店铺类型":"B店"}','batch'),
      ('seed-c-late',3,'2026-06-01','2026-06-30','净水','C店','SKU','POP','C-LATE','商用净水机品牌甲','', '{"店铺类型":"C店"}','batch');`);

  const refreshed = await refreshMarketBrandSeeds(db as never, admin);
  assert.equal(refreshed.discovered, 1);
  assert.equal(refreshed.inserted, 1);
  const matched = await matchMarketBrandSeeds(db as never, { category: "净水" }, admin);
  assert.deepEqual({
    scanned: matched.scanned,
    matchedSkuCount: matched.matchedSkuCount,
    prefixMatched: matched.prefixMatched,
    anywhereMatched: matched.anywhereMatched,
    remainingSkuCount: matched.remainingSkuCount,
  }, { scanned: 3, matchedSkuCount: 2, prefixMatched: 1, anywhereMatched: 1, remainingSkuCount: 1 });
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='B-PREFIX'").get() as { brand: string }).brand, "品牌甲");
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='B-LATE'").get() as { brand: string }).brand, "");
  assert.equal((sqlite.prepare("SELECT brand FROM market_ranking_entries WHERE sku_code='C-LATE'").get() as { brand: string }).brand, "品牌甲");

  let workspace = await getMarketBrandSeedWorkspace(db as never, { category: "净水" });
  assert.equal(workspace.dictionary.counts.system, 1);
  assert.equal(workspace.unknown.pagination.total, 1);
  await upsertMarketBrandSeed(db as never, {
    canonicalBrand: "品牌乙", seedText: "品牌乙", category: "净水", scope: "B店",
    rankingDimension: "SKU", skuCode: "B-LATE",
  }, admin);
  workspace = await getMarketBrandSeedWorkspace(db as never, { category: "净水" });
  assert.equal(workspace.dictionary.counts.manual, 1);
  assert.equal(workspace.unknown.pagination.total, 0);
});

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
  sqlite.exec("CREATE TABLE netshop_rows (source TEXT, dataset TEXT, business_date TEXT, sku_id TEXT, spu_id TEXT, product_code TEXT, metrics_json TEXT)");
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
    scopePolicy: "unscoped_only",
    execution: {
      environment: "worker_inline",
      mode: "direct",
      allowedSurfaces: ["ai_chat", "test"],
      timeoutMs: 1_000,
      maxResultCharacters: 4_000,
      maxCallsPerRequest: 4,
    },
    handler: async () => ({ returned: 1, truncated: false }),
  };
  assert.equal(getOpenAiTools(viewer, "ai_chat", [overviewEntry]).some((item) => item.function.name === "get_market_overview"), false);
  assert.equal(getOpenAiTools(analyst, "ai_chat", [overviewEntry]).some((item) => item.function.name === "get_market_overview"), true);
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
