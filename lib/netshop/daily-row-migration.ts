import { dailyRowKey } from "@/lib/netshop/daily-contract";

type MigrationStatement = {
  bind(...values: unknown[]): MigrationStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

export type DailyRowMigrationDatabase = {
  prepare(sql: string): MigrationStatement;
  batch(statements: MigrationStatement[]): Promise<unknown>;
};

type DailyMigrationRow = {
  id: number;
  source_row_key: string;
  dataset: string;
  platform: string;
  shop_name: string;
  business_date: string | null;
  sku_id: string;
  spu_id: string;
  completed_at: string | null;
  created_at: string;
};

export const DAILY_ROW_NATURAL_KEY_MIGRATION = "jd-daily-natural-key-v1";

function dailyNaturalKey(row: DailyMigrationRow) {
  const dimensionId = row.dataset === "sku_daily" ? row.sku_id : row.spu_id;
  return dailyRowKey(row.dataset, row.platform, row.shop_name, row.business_date ?? "", dimensionId);
}

function eligibleDailyRowsSql(selectSql: string) {
  return `${selectSql}
    FROM netshop_rows r
    JOIN netshop_import_batches b ON b.id = r.last_import_batch_id
    WHERE r.source = 'jd_sku_daily'
      AND r.dataset IN ('sku_daily', 'spu_daily')
      AND b.status = 'completed'
      AND r.business_date IS NOT NULL
      AND r.business_date <> ''
      AND ((r.dataset = 'sku_daily' AND r.sku_id <> '') OR (r.dataset = 'spu_daily' AND r.spu_id <> ''))`;
}

async function markMigrationComplete(db: DailyRowMigrationDatabase) {
  await db.prepare(`INSERT OR IGNORE INTO netshop_schema_migrations (migration_key)
    VALUES (?)`).bind(DAILY_ROW_NATURAL_KEY_MIGRATION).run();
}

/**
 * Historical daily imports used file hash + row number as their identity.
 * This migration is durable and restart-safe: already-migrated databases take
 * a marker fast path, while an unmarked but already-correct database performs
 * only one read-side verification and never rewrites unchanged rows.
 */
export async function ensureDailyRowNaturalKeys(db: DailyRowMigrationDatabase) {
  const marker = await db.prepare("SELECT 1 FROM netshop_schema_migrations WHERE migration_key = ? LIMIT 1")
    .bind(DAILY_ROW_NATURAL_KEY_MIGRATION)
    .first();
  if (marker) return;

  const mismatch = await db.prepare(eligibleDailyRowsSql(`SELECT 1
    `) + ` AND r.source_row_key IS NOT json_array(
      r.dataset,
      r.platform,
      r.shop_name,
      r.business_date,
      CASE WHEN r.dataset = 'sku_daily' THEN r.sku_id ELSE r.spu_id END
    ) LIMIT 1`).first();
  if (!mismatch) {
    await markMigrationComplete(db);
    return;
  }

  const result = await db.prepare(eligibleDailyRowsSql(`SELECT
      r.id, r.source_row_key, r.dataset, r.platform, r.shop_name, r.business_date,
      r.sku_id, r.spu_id, b.completed_at, b.created_at
  `)).all<DailyMigrationRow>();
  const winners = new Map<string, DailyMigrationRow>();
  const losers: number[] = [];
  for (const row of result.results ?? []) {
    const key = dailyNaturalKey(row);
    const current = winners.get(key);
    const rowTime = `${row.completed_at ?? ""}\u0000${row.created_at}\u0000${String(row.id).padStart(12, "0")}`;
    const currentTime = current ? `${current.completed_at ?? ""}\u0000${current.created_at}\u0000${String(current.id).padStart(12, "0")}` : "";
    if (!current || rowTime > currentTime) {
      if (current) losers.push(current.id);
      winners.set(key, row);
    } else {
      losers.push(row.id);
    }
  }

  const statements = losers.map((id) => db.prepare("DELETE FROM netshop_rows WHERE id = ?").bind(id));
  for (const row of winners.values()) {
    const naturalKey = dailyNaturalKey(row);
    if (row.source_row_key !== naturalKey) {
      statements.push(db.prepare("UPDATE netshop_rows SET source_row_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(naturalKey, row.id));
    }
  }

  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
  await markMigrationComplete(db);
}
