import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { applyMarketImageRepairs, listMarketImageRepairCandidates, normalizeJdMarketRepairImageUrl } from "../lib/market/image-repair";
import { ensureMarketSchemaCore, type MarketSchemaDatabase } from "../lib/market/schema-core";
import { parseJdMarketRepairImageResponse, summarizeJdMarketRepairImageResponse } from "../tools/jd-market-image-repair";

function sqliteAdapter(sqlite: DatabaseSync): MarketSchemaDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SQLInputValue[]; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() {
          const result = statement.run(...values);
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

test("market image repair lists exact pending identities and materializes a ready historical image", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,image_url,product_url,raw_json,last_import_batch_id)
    VALUES
      ('old',1,'2026-07-01','2026-07-31','净水','POP','SKU','POP','SKU-1','旧商品','https://img10.360buyimg.com/n5/ready.jpg','https://item.jd.com/SKU-1.html','{}','old'),
      ('current',2,'2026-08-12','2026-08-12','净水','POP','SKU','POP','SKU-1','新商品','','https://item.jd.com/SKU-1.html','{}','current'),
      ('foreign',3,'2026-08-12','2026-08-12','净水','自营','SKU','自营','SKU-1','其他范围','','https://item.jd.com/SKU-1.html','{}','foreign');
    INSERT INTO market_price_snapshots
      (id,category,scope,sku_code,ranking_dimension,month,image_url,image_content_sha256,confirmation_status)
    VALUES
      ('snapshot','净水','POP','SKU-1','SKU','2026-08','','','source_table'),
      ('foreign-snapshot','净水','自营','SKU-1','SKU','2026-08','','','source_table');
    INSERT INTO market_image_cache
      (source_url,status,object_key,content_sha256,mime_type,size_bytes,image_source,attempt_count)
    VALUES ('https://img10.360buyimg.com/n5/ready.jpg','ready','market-images/ready.jpg','ready-hash','image/jpeg',10,'n5',1);
  `);

  const candidates = await listMarketImageRepairCandidates(db as never, { pageSize: 20 });
  assert.equal(candidates.pagination.total, 2);
  const target = candidates.items.find((item) => item.scope === "POP");
  assert.equal(target?.reusableImageUrl, "https://img10.360buyimg.com/n5/ready.jpg");
  assert.equal(target?.productUrl, "https://item.jd.com/SKU-1.html");

  const result = await applyMarketImageRepairs(db as never, { repairs: [{
    category: "净水", scope: "POP", rankingDimension: "SKU", skuCode: "SKU-1",
    imageUrl: "https://img10.360buyimg.com/n7/ready.jpg?size=1",
  }] }, { email: "admin@example.com", role: "admin" });
  assert.equal(result.repairCount, 1);
  assert.equal(result.rankingRowsUpdated, 1);
  assert.equal(result.snapshotsUpdated, 1);
  assert.deepEqual({ ...(sqlite.prepare("SELECT image_url imageUrl,image_content_sha256 hash FROM market_price_snapshots WHERE id='snapshot'").get() as Record<string, unknown>) }, {
    imageUrl: "https://img10.360buyimg.com/n5/ready.jpg",
    hash: "ready-hash",
  });
  assert.equal(sqlite.prepare("SELECT image_url FROM market_ranking_entries WHERE natural_key='foreign'").get()?.image_url, "");
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action='repair_market_identity_images'").get()?.count, 1);
  sqlite.close();
});

test("market image repair resets a terminal cache only for a freshly verified JD image URL", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`
    INSERT INTO market_ranking_entries
      (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,image_url,raw_json,last_import_batch_id)
    VALUES ('failed',1,'2026-08-12','2026-08-12','净水','POP','SKU','POP','SKU-2','','{}','current');
    INSERT INTO market_price_snapshots
      (id,category,scope,sku_code,ranking_dimension,month,image_url,image_content_sha256,confirmation_status)
    VALUES ('failed-snapshot','净水','POP','SKU-2','SKU','2026-08','https://img11.360buyimg.com/n5/failed.jpg','','source_table');
    INSERT INTO market_image_cache (source_url,status,attempt_count,error_code,error_message)
    VALUES ('https://img11.360buyimg.com/n5/failed.jpg','failed',3,'http_error','old');
  `);
  await applyMarketImageRepairs(db as never, { repairs: [{
    category: "净水", scope: "POP", rankingDimension: "SKU", skuCode: "SKU-2",
    imageUrl: "https://img11.360buyimg.com/n5/failed.jpg",
  }] }, { email: "admin@example.com", role: "admin" });
  assert.deepEqual({ ...(sqlite.prepare("SELECT status,attempt_count attempts,error_code error FROM market_image_cache WHERE source_url='https://img11.360buyimg.com/n5/failed.jpg'").get() as Record<string, unknown>) }, {
    status: "pending", attempts: 0, error: "",
  });
  assert.equal(normalizeJdMarketRepairImageUrl("https://evil.example/n5/a.jpg"), "");
  sqlite.close();
});

test("JD image repair accepts keyed image responses and normalizes them to the cacheable n5 source", () => {
  assert.deepEqual([...parseJdMarketRepairImageResponse({ content: { data: {
    "1001": { imgSrc: "//img10.360buyimg.com/n7/jfs/a.jpg?x=1" },
    "1002": { imgSrc: "https://untrusted.example/n5/b.jpg" },
  } } })], [["1001", "https://img10.360buyimg.com/n5/jfs/a.jpg"]]);
  assert.deepEqual(summarizeJdMarketRepairImageResponse({ code: 601, content: { errorCode: "limited", secret: "hidden" } }), {
    rootKeys: ["code", "content"], contentKeys: ["errorCode", "secret"], code: "601", status: "", message: "", success: null,
  });
});

test("JD image repair verifies the signed-in header shop instead of ranking-row mall links", async () => {
  const runner = await readFile(new URL("../tools/jd-market-image-repair.ts", import.meta.url), "utf8");
  assert.match(runner, /\.user-info \.shop-name a\[href\*=\"mall\.jd\.com\/index-\"\]/);
  assert.match(runner, /return await fetchJdImages\(frame,/);
});
