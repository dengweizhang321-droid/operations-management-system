import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  createMarketPriceBandVersion,
  publishMarketPriceBandVersion,
  rollbackMarketPriceBandVersion,
} from "../lib/market/admin-service";
import { ensureMarketSchemaCore, officialPriceBandSql, type MarketSchemaDatabase } from "../lib/market/schema-core";

function sqliteAdapter(sqlite: DatabaseSync): MarketSchemaDatabase {
  let batchQueue: Promise<void> = Promise.resolve();
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const previous = batchQueue;
      let release = () => {};
      batchQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      sqlite.exec("BEGIN");
      try {
        const output = [];
        for (const statement of statements) output.push(await statement.run());
        sqlite.exec("COMMIT");
        return output;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  };
}

const admin = { email: "admin@example.com", role: "admin" } as const;

async function createVersion(db: MarketSchemaDatabase, category: string, label: string) {
  return createMarketPriceBandVersion(db, {
    category,
    items: [
      { label: `${label}-low`, minCents: 0, maxCents: 20_000 },
      { label: `${label}-high`, minCents: 20_000, maxCents: null },
    ],
  }, admin);
}

function createLegacyPriceBandTable(sqlite: DatabaseSync) {
  sqlite.exec(`CREATE TABLE market_price_band_versions (
    id TEXT PRIMARY KEY NOT NULL,
    category TEXT NOT NULL DEFAULT '*',
    version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    effective_from TEXT NOT NULL DEFAULT '1970-01-01',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_by TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    rolled_back_from_id TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  )`);
}

function createLegacyPriceBandItemTable(sqlite: DatabaseSync) {
  sqlite.exec(`CREATE TABLE market_price_band_items (
    id TEXT PRIMARY KEY NOT NULL,
    version_id TEXT NOT NULL,
    label TEXT NOT NULL,
    min_cents INTEGER,
    max_cents INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
}

function pausingReceiptAdapter(
  base: MarketSchemaDatabase,
  action: "publish_price_band_version" | "rollback_price_band_version",
) {
  let release = () => {};
  let reached = () => {};
  let paused = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const receiptReached = new Promise<void>((resolve) => { reached = resolve; });
  const db: MarketSchemaDatabase = {
    prepare(sql: string) {
      const prepared = base.prepare(sql);
      return {
        bind(...values: unknown[]) {
          const bound = prepared.bind(...values);
          return {
            async first<T>() {
              if (!paused && sql.includes("SELECT after_json FROM market_master_audit_logs") && values[1] === action) {
                paused = true;
                reached();
                await gate;
              }
              return bound.first<T>();
            },
            all<T>() { return bound.all<T>(); },
            run() { return bound.run(); },
          };
        },
        first<T>() { return prepared.first<T>(); },
        all<T>() { return prepared.all<T>(); },
        run() { return prepared.run(); },
      };
    },
    batch(statements) { return base.batch(statements); },
  };
  return { db, receiptReached, release: () => release() };
}

test("0045 deterministically archives legacy duplicate published price bands before adding the unique index", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from,published_at) VALUES
    ('legacy-effective', 'legacy-category', 1, 'published', '2026-06-01', '2026-06-01 00:00:00'),
    ('legacy-version', 'legacy-category', 2, 'published', '2026-05-01', '2026-07-01 00:00:00')`);

  const migration = await readFile(new URL("../drizzle/0045_market_price_band_publish_safety.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);

  const rows = sqlite.prepare("SELECT id,status FROM market_price_band_versions ORDER BY id").all() as Array<{ id: string; status: string }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "legacy-effective", status: "published" },
    { id: "legacy-version", status: "archived" },
  ]);
  assert.throws(() => sqlite.prepare("INSERT INTO market_price_band_versions (id,category,version,status) VALUES ('duplicate','legacy-category',3,'published')").run(), /UNIQUE constraint failed/);
  sqlite.close();
});

test("runtime schema upgrade also converges duplicate published price bands and installs the final constraint", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
    ('runtime-v1', 'runtime-category', 1, 'published', '1970-01-01'),
    ('runtime-v2', 'runtime-category', 2, 'published', '1970-01-01')`);

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));

  const published = sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category='runtime-category' AND status='published'").all() as Array<{ id: string }>;
  assert.deepEqual(published.map((row) => row.id), ["runtime-v2"]);
  assert.throws(() => sqlite.prepare("INSERT INTO market_price_band_versions (id,category,version,status) VALUES ('runtime-v3','runtime-category',3,'published')").run(), /UNIQUE constraint failed/);
  sqlite.close();
});

test("runtime schema restores an archived fixed global default with complete items and stays idempotent", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
    ('market-price-band-default-v1', '*', 1, 'archived', '1970-01-01'),
    ('legacy-global-v2', '*', 2, 'archived', '2026-01-01'),
    ('other-category-v1', 'other-category', 1, 'published', '1970-01-01')`);

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id='market-price-band-default-v1'").get() as { status: string }).status, "published");
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id='legacy-global-v2'").get() as { status: string }).status, "archived");
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id='other-category-v1'").get() as { status: string }).status, "published");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_band_items WHERE version_id='market-price-band-default-v1'").get() as { count: number }).count, 5);
  const beforeCounts = sqlite.prepare(`SELECT
    (SELECT COUNT(*) FROM market_price_band_versions) versions,
    (SELECT COUNT(*) FROM market_price_band_items) items`).get() as { versions: number; items: number };

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));
  const afterCounts = sqlite.prepare(`SELECT
    (SELECT COUNT(*) FROM market_price_band_versions) versions,
    (SELECT COUNT(*) FROM market_price_band_items) items`).get() as { versions: number; items: number };
  assert.deepEqual({ ...afterCounts }, { ...beforeCounts });
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_band_versions WHERE category='*' AND status='published'").get() as { count: number }).count, 1);
  sqlite.close();
});

test("runtime schema completes every exact item of an already-published fixed default", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  createLegacyPriceBandItemTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
      ('market-price-band-default-v1', '*', 1, 'published', '1970-01-01');
    INSERT INTO market_price_band_items (id,version_id,label,min_cents,max_cents,sort_order) VALUES
      ('market-price-band-default-v1-10', 'market-price-band-default-v1', '0-499', 0, 50000, 10)`);

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));

  const items = sqlite.prepare(`SELECT label, min_cents minCents, max_cents maxCents, sort_order sortOrder
    FROM market_price_band_items WHERE version_id='market-price-band-default-v1' ORDER BY sort_order`).all();
  assert.deepEqual(items.map((row) => ({ ...row })), [
    { label: "0-499", minCents: 0, maxCents: 50_000, sortOrder: 10 },
    { label: "500-999", minCents: 50_000, maxCents: 100_000, sortOrder: 20 },
    { label: "1000-1999", minCents: 100_000, maxCents: 200_000, sortOrder: 30 },
    { label: "2000-2999", minCents: 200_000, maxCents: 300_000, sortOrder: 40 },
    { label: "3000+", minCents: 300_000, maxCents: null, sortOrder: 50 },
  ]);
  sqlite.close();
});

test("runtime schema preserves a usable custom published global band instead of replacing its contract", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  createLegacyPriceBandItemTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
      ('custom-global-v1', '*', 1, 'published', '2026-01-01');
    INSERT INTO market_price_band_items (id,version_id,label,min_cents,max_cents,sort_order) VALUES
      ('custom-global-v1-only', 'custom-global-v1', 'custom-all', 0, NULL, 10)`);

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));

  const items = sqlite.prepare("SELECT label FROM market_price_band_items WHERE version_id='custom-global-v1'").all() as Array<{ label: string }>;
  assert.deepEqual(items.map((row) => row.label), ["custom-all"]);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id='custom-global-v1'").get() as { status: string }).status, "published");
  sqlite.close();
});

test("runtime schema recovers from a fixed default primary-key collision before recording the v12 marker", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
    ('market-price-band-default-v1', 'collision-category', 1, 'archived', '1970-01-01')`);

  await ensureMarketSchemaCore(sqliteAdapter(sqlite));
  const global = sqlite.prepare(`SELECT id FROM market_price_band_versions
    WHERE category='*' AND status='published' LIMIT 1`).get() as { id: string };
  assert.ok(global.id);
  assert.notEqual(global.id, "market-price-band-default-v1");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_band_items WHERE version_id=?").get(global.id) as { count: number }).count, 5);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) count FROM market_master_audit_logs
    WHERE entity_type='runtime_schema' AND entity_id='market-runtime-schema-v12'`).get() as { count: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT category FROM market_price_band_versions WHERE id='market-price-band-default-v1'").get() as { category: string }).category, "collision-category");
  sqlite.close();
});

test("runtime schema does not record the v12 marker when a default-item primary key blocks recovery", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  sqlite.exec(`CREATE TABLE market_price_band_items (
      id TEXT PRIMARY KEY NOT NULL,
      version_id TEXT NOT NULL,
      label TEXT NOT NULL,
      min_cents INTEGER,
      max_cents INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO market_price_band_versions (id,category,version,status,effective_from)
      VALUES ('market-price-band-default-v1', '*', 1, 'archived', '1970-01-01');
    INSERT INTO market_price_band_items (id,version_id,label,min_cents,max_cents,sort_order)
      VALUES ('market-price-band-default-v1-10', 'unrelated-version', 'collision', 0, 1, 10)`);

  await assert.rejects(() => ensureMarketSchemaCore(sqliteAdapter(sqlite)), /默认价格带项恢复失败/);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) count FROM market_master_audit_logs
    WHERE entity_type='runtime_schema' AND entity_id='market-runtime-schema-v12'`).get() as { count: number }).count, 0);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id='market-price-band-default-v1'").get() as { status: string }).status, "archived");
  sqlite.close();
});

test("published fixed default primary-key collisions fail before recording the v12 marker", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createLegacyPriceBandTable(sqlite);
  createLegacyPriceBandItemTable(sqlite);
  sqlite.exec(`INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
      ('market-price-band-default-v1', '*', 1, 'published', '1970-01-01');
    INSERT INTO market_price_band_items (id,version_id,label,min_cents,max_cents,sort_order) VALUES
      ('market-price-band-default-v1-10', 'market-price-band-default-v1', '0-499', 0, 50000, 10),
      ('market-price-band-default-v1-20', 'unrelated-version', 'collision', 0, 1, 20)`);

  await assert.rejects(() => ensureMarketSchemaCore(sqliteAdapter(sqlite)), /默认价格带项恢复失败/);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) count FROM market_master_audit_logs
    WHERE entity_type='runtime_schema' AND entity_id='market-runtime-schema-v12'`).get() as { count: number }).count, 0);
  sqlite.close();
});

test("v12 fast-marker path reconverges duplicate published versions and restores the partial unique index", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  sqlite.exec(`DROP INDEX market_price_band_versions_published_category_uq;
    INSERT INTO market_price_band_versions (id,category,version,status,effective_from) VALUES
      ('fast-duplicate-v1', 'fast-duplicate', 1, 'published', '2026-01-01'),
      ('fast-duplicate-v2', 'fast-duplicate', 2, 'published', '2026-02-01')`);

  await ensureMarketSchemaCore(db);

  const rows = sqlite.prepare("SELECT id,status FROM market_price_band_versions WHERE category='fast-duplicate' ORDER BY version").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "fast-duplicate-v1", status: "archived" },
    { id: "fast-duplicate-v2", status: "published" },
  ]);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='market_price_band_versions_published_category_uq'").get());
  assert.throws(() => sqlite.prepare(`INSERT INTO market_price_band_versions
    (id,category,version,status,effective_from) VALUES ('fast-duplicate-v3','fast-duplicate',3,'published','2026-03-01')`).run(), /UNIQUE constraint failed/);
  sqlite.close();
});

test("concurrent publish and rollback batches serialize to one published version and calculations use the last successful target", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const category = "并发价格带";
  const first = await createVersion(db, category, "first");
  const second = await createVersion(db, category, "second");
  await Promise.all([
    publishMarketPriceBandVersion(db, first.id, admin),
    publishMarketPriceBandVersion(db, second.id, admin),
  ]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { count: number }).count, 1);

  const archived = sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='archived' ORDER BY version LIMIT 1").get(category) as { id: string };
  const next = await createVersion(db, category, "next");
  await Promise.all([
    publishMarketPriceBandVersion(db, next.id, admin),
    rollbackMarketPriceBandVersion(db, { targetVersionId: archived.id }, admin),
  ]);

  const current = sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string };
  const lastAudit = sqlite.prepare(`SELECT entity_id entityId FROM market_master_audit_logs
    WHERE action IN ('publish_price_band_version','rollback_price_band_version')
    ORDER BY rowid DESC LIMIT 1`).get() as { entityId: string };
  assert.equal(current.id, lastAudit.entityId);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { count: number }).count, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action LIKE 'market_price_band_%_guard'").get() as { count: number }).count, 0);
  const rollbackSource = sqlite.prepare("SELECT rolled_back_from_id sourceId FROM market_price_band_versions WHERE id=?").get(archived.id) as { sourceId: string };
  assert.ok(rollbackSource.sourceId);
  assert.notEqual(rollbackSource.sourceId, archived.id);

  sqlite.exec(`INSERT INTO market_ranking_entries
    (natural_key,source_row_number,period_start,period_end,category,scope,ranking_dimension,operation_mode,sku_code,product_name,raw_json,last_import_batch_id)
    VALUES ('price-band-race-fact',1,'2026-07-01','2026-07-31','并发价格带','POP','SKU','POP','RACE-SKU','Race','{}','batch');
    INSERT INTO market_price_snapshots
    (id,category,scope,sku_code,ranking_dimension,month,confirmed_market_price_cents,ai_price_type,confirmation_status)
    VALUES ('price-band-race-snapshot','并发价格带','POP','RACE-SKU','SKU','2026-07',15000,'标准售价','confirmed')`);
  const calculated = sqlite.prepare(`SELECT ${officialPriceBandSql("ps.confirmed_market_price_cents")} band
    FROM market_ranking_entries m JOIN market_price_snapshots ps
      ON ps.category=m.category AND ps.scope=m.scope AND ps.sku_code=m.sku_code
      AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    WHERE m.sku_code='RACE-SKU'`).get() as { band: string };
  const expected = sqlite.prepare("SELECT label FROM market_price_band_items WHERE version_id=? AND min_cents=0").get(current.id) as { label: string };
  assert.equal(calculated.band, expected.label);
  sqlite.close();
});

test("publish and rollback return their committed audit snapshots after a later mutation archives the target", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const category = "receipt-linearization";
  const first = await createVersion(db, category, "first");
  const second = await createVersion(db, category, "second");

  const pausedPublish = pausingReceiptAdapter(db, "publish_price_band_version");
  const firstPublishPromise = publishMarketPriceBandVersion(pausedPublish.db, first.id, admin);
  await pausedPublish.receiptReached;
  const secondPublish = await publishMarketPriceBandVersion(db, second.id, admin);
  pausedPublish.release();
  const firstPublish = await firstPublishPromise;

  assert.equal(firstPublish.id, first.id);
  assert.equal(firstPublish.status, "published");
  assert.equal(secondPublish.id, second.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(first.id) as { status: string }).status, "archived");
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(second.id) as { status: string }).status, "published");

  const pausedRollback = pausingReceiptAdapter(db, "rollback_price_band_version");
  const firstRollbackPromise = rollbackMarketPriceBandVersion(pausedRollback.db, { targetVersionId: first.id }, admin);
  await pausedRollback.receiptReached;
  const republishedSecond = await publishMarketPriceBandVersion(db, second.id, admin);
  pausedRollback.release();
  const firstRollback = await firstRollbackPromise;

  assert.equal(firstRollback.id, first.id);
  assert.equal(firstRollback.status, "published");
  assert.equal(firstRollback.rolled_back_from_id, second.id);
  assert.equal(republishedSecond.id, second.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(first.id) as { status: string }).status, "archived");
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(second.id) as { status: string }).status, "published");
  sqlite.close();
});

test("publish and rollback audit failures roll back every price-band status change", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const category = "审计原子性";
  const first = await createVersion(db, category, "first");
  const second = await createVersion(db, category, "second");
  await publishMarketPriceBandVersion(db, first.id, admin);

  sqlite.exec(`CREATE TRIGGER reject_price_band_publish_audit BEFORE INSERT ON market_master_audit_logs
    WHEN NEW.action='publish_price_band_version'
    BEGIN SELECT RAISE(ABORT, 'forced publish audit failure'); END`);
  await assert.rejects(() => publishMarketPriceBandVersion(db, second.id, admin), /forced publish audit failure/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, first.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(second.id) as { status: string }).status, "draft");
  sqlite.exec("DROP TRIGGER reject_price_band_publish_audit");

  await publishMarketPriceBandVersion(db, second.id, admin);
  sqlite.exec(`CREATE TRIGGER reject_price_band_rollback_audit BEFORE INSERT ON market_master_audit_logs
    WHEN NEW.action='rollback_price_band_version'
    BEGIN SELECT RAISE(ABORT, 'forced rollback audit failure'); END`);
  await assert.rejects(() => rollbackMarketPriceBandVersion(db, { targetVersionId: first.id }, admin), /forced rollback audit failure/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, second.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(first.id) as { status: string }).status, "archived");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action LIKE 'market_price_band_%_guard'").get() as { count: number }).count, 0);
  sqlite.close();
});

test("ignored target updates and ignored formal audits roll back publish and rollback batches", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureMarketSchemaCore(db);
  const category = "ignore-atomicity";
  const first = await createVersion(db, category, "first");
  const second = await createVersion(db, category, "second");
  await publishMarketPriceBandVersion(db, first.id, admin);

  sqlite.exec(`CREATE TRIGGER ignore_price_band_publish_target BEFORE UPDATE ON market_price_band_versions
    WHEN OLD.id='${second.id}' AND OLD.status='draft' AND NEW.status='published'
    BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(() => publishMarketPriceBandVersion(db, second.id, admin), /NOT NULL/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, first.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(second.id) as { status: string }).status, "draft");
  sqlite.exec("DROP TRIGGER ignore_price_band_publish_target");

  sqlite.exec(`CREATE TRIGGER ignore_price_band_publish_audit BEFORE INSERT ON market_master_audit_logs
    WHEN NEW.action='publish_price_band_version'
    BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(() => publishMarketPriceBandVersion(db, second.id, admin), /NOT NULL/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, first.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(second.id) as { status: string }).status, "draft");
  sqlite.exec("DROP TRIGGER ignore_price_band_publish_audit");

  await publishMarketPriceBandVersion(db, second.id, admin);
  sqlite.exec(`CREATE TRIGGER ignore_price_band_rollback_target BEFORE UPDATE ON market_price_band_versions
    WHEN OLD.id='${first.id}' AND OLD.status='archived' AND NEW.status='published'
    BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(() => rollbackMarketPriceBandVersion(db, { targetVersionId: first.id }, admin), /NOT NULL/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, second.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(first.id) as { status: string }).status, "archived");
  sqlite.exec("DROP TRIGGER ignore_price_band_rollback_target");

  sqlite.exec(`CREATE TRIGGER ignore_price_band_rollback_audit BEFORE INSERT ON market_master_audit_logs
    WHEN NEW.action='rollback_price_band_version'
    BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(() => rollbackMarketPriceBandVersion(db, { targetVersionId: first.id }, admin), /NOT NULL/);
  assert.equal((sqlite.prepare("SELECT id FROM market_price_band_versions WHERE category=? AND status='published'").get(category) as { id: string }).id, second.id);
  assert.equal((sqlite.prepare("SELECT status FROM market_price_band_versions WHERE id=?").get(first.id) as { status: string }).status, "archived");
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM market_master_audit_logs WHERE action LIKE 'market_price_band_%_guard'").get() as { count: number }).count, 0);
  sqlite.close();
});
