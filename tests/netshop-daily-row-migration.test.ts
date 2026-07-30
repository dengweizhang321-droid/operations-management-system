import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { dailyRowKey } from "../lib/netshop/daily-contract";
import {
  DAILY_ROW_NATURAL_KEY_MIGRATION,
  ensureDailyRowNaturalKeys,
  type DailyRowMigrationDatabase,
} from "../lib/netshop/daily-row-migration";

function sqliteAdapter(sqlite: DatabaseSync): DailyRowMigrationDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return statement.run(...values); },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as DailyRowMigrationDatabase;
}

function createSchema(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE netshop_schema_migrations (
      migration_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE netshop_import_batches (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE netshop_rows (
      id INTEGER PRIMARY KEY,
      source_row_key TEXT NOT NULL UNIQUE,
      last_import_batch_id TEXT NOT NULL,
      source TEXT NOT NULL,
      dataset TEXT NOT NULL,
      platform TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      business_date TEXT,
      sku_id TEXT NOT NULL DEFAULT '',
      spu_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE row_update_audit (count INTEGER NOT NULL);
    INSERT INTO row_update_audit VALUES (0);
    CREATE TRIGGER audit_netshop_update AFTER UPDATE ON netshop_rows BEGIN
      UPDATE row_update_audit SET count=count+1;
    END;
  `);
}

test("daily natural-key migration marks an already-correct database without rewriting rows", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createSchema(sqlite);
  const key = dailyRowKey("sku_daily", "京东", "测试店", "2026-07-29", "SKU-1");
  sqlite.prepare("INSERT INTO netshop_import_batches VALUES ('batch-1','completed','2026-07-30 08:00:00','2026-07-30 07:00:00')").run();
  sqlite.prepare(`INSERT INTO netshop_rows
    (id,source_row_key,last_import_batch_id,source,dataset,platform,shop_name,business_date,sku_id,updated_at)
    VALUES (1,?,'batch-1','jd_sku_daily','sku_daily','京东','测试店','2026-07-29','SKU-1','2026-07-30 08:00:00')`).run(key);

  const db = sqliteAdapter(sqlite);
  await ensureDailyRowNaturalKeys(db);
  await ensureDailyRowNaturalKeys(db);

  assert.equal((sqlite.prepare("SELECT count FROM row_update_audit").get() as { count: number }).count, 0);
  assert.equal((sqlite.prepare("SELECT updated_at FROM netshop_rows").get() as { updated_at: string }).updated_at, "2026-07-30 08:00:00");
  assert.ok(sqlite.prepare("SELECT 1 FROM netshop_schema_migrations WHERE migration_key=?").get(DAILY_ROW_NATURAL_KEY_MIGRATION));
  sqlite.close();
});

test("daily natural-key migration deduplicates legacy rows and updates only the winner", async () => {
  const sqlite = new DatabaseSync(":memory:");
  createSchema(sqlite);
  sqlite.exec(`
    INSERT INTO netshop_import_batches VALUES
      ('old','completed','2026-07-29 08:00:00','2026-07-29 07:00:00'),
      ('new','completed','2026-07-30 08:00:00','2026-07-30 07:00:00');
    INSERT INTO netshop_rows
      (id,source_row_key,last_import_batch_id,source,dataset,platform,shop_name,business_date,sku_id,updated_at)
    VALUES
      (1,'legacy-old','old','jd_sku_daily','sku_daily','京东','测试店','2026-07-29','SKU-1','2026-07-29 08:00:00'),
      (2,'legacy-new','new','jd_sku_daily','sku_daily','京东','测试店','2026-07-29','SKU-1','2026-07-30 08:00:00');
  `);

  await ensureDailyRowNaturalKeys(sqliteAdapter(sqlite));

  const rows = sqlite.prepare("SELECT id,source_row_key FROM netshop_rows").all() as Array<{ id: number; source_row_key: string }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [{
    id: 2,
    source_row_key: dailyRowKey("sku_daily", "京东", "测试店", "2026-07-29", "SKU-1"),
  }]);
  assert.equal((sqlite.prepare("SELECT count FROM row_update_audit").get() as { count: number }).count, 1);
  sqlite.close();
});
