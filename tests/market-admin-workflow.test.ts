import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { AppPrincipal } from "../lib/auth/authorization";
import { executeToolCallWithRegistry, getOpenAiTools, type AiToolEntry } from "../lib/ai/tool-registry-contract";
import {
  createMarketPriceBandVersion,
  getMarketSkuComparison,
  planMissingMarketDownloads,
  publishMarketPriceBandVersion,
  recordMarketDownloadAttempt,
  rollbackMarketPriceBandVersion,
  upsertMarketDownloadConfig,
} from "../lib/market/admin-service";
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
  insert.run("a2", 2, "2026-06-01", "2026-06-30", 1, "SKU-A", "商品A", "品牌A", 3000, 3, 10);
  insert.run("b1", 3, "2026-06-01", "2026-06-30", 3, "SKU-B", "商品B", "品牌B", 2000, 4, 20);
  sqlite.exec(`INSERT INTO market_price_snapshots (id, category, sku_code, ranking_dimension, month, confirmed_market_price_cents, average_transaction_price_cents, confirmation_status)
    VALUES ('pa','净水','SKU-A','SKU','2026-06',120000,1000,'confirmed'), ('pb','净水','SKU-B','SKU','2026-06',90000,500,'confirmed');`);
  const compared = await getMarketSkuComparison(db as never, { skuCodes: ["SKU-A", "SKU-B"], category: "净水", rankingDimension: "SKU" });
  assert.equal(compared.items.length, 2);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-A")?.gmvCents, 4000);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-A")?.trend.length, 2);
  assert.equal(compared.items.find((item) => item.skuCode === "SKU-B")?.bestRank, 3);
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
