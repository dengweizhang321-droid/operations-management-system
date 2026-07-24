ALTER TABLE market_price_snapshots ADD COLUMN scope TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_annotation_items ADD COLUMN scope TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE market_ranking_entries
SET operation_mode = CASE
  WHEN lower(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '')) LIKE '%pop%'
    OR COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%店铺%'
    OR COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%旗舰店%' THEN 'POP'
  WHEN COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%自营%' THEN '自营'
  ELSE '未知'
END;
--> statement-breakpoint
UPDATE market_ranking_entries
SET ranking_dimension = CASE
  WHEN upper(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') || ' ' || COALESCE((SELECT file_name FROM market_import_batches b WHERE b.id = last_import_batch_id), '')) LIKE '%SPU%' THEN 'SPU'
  WHEN upper(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') || ' ' || COALESCE((SELECT file_name FROM market_import_batches b WHERE b.id = last_import_batch_id), '')) LIKE '%SKU%' THEN 'SKU'
  ELSE 'SKU'
END;
--> statement-breakpoint
DROP INDEX IF EXISTS market_entries_canonical_uq;
--> statement-breakpoint
DELETE FROM market_ranking_entries
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY period_start, period_end, category, scope, ranking_dimension, sku_code
      ORDER BY datetime(updated_at) DESC, id DESC
    ) rn
    FROM market_ranking_entries
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint
UPDATE market_ranking_entries
SET natural_key = period_start || '|' || period_end || '|' || category || '|' || scope || '|' || ranking_dimension || '|' || sku_code;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_entries_canonical_uq ON market_ranking_entries (period_start, period_end, category, scope, ranking_dimension, sku_code);
--> statement-breakpoint
UPDATE market_price_snapshots
SET scope = COALESCE((
  SELECT m.scope FROM market_ranking_entries m
  WHERE m.category = market_price_snapshots.category
    AND m.sku_code = market_price_snapshots.sku_code
    AND m.ranking_dimension = market_price_snapshots.ranking_dimension
    AND substr(m.period_end, 1, 7) = market_price_snapshots.month
  ORDER BY m.id DESC LIMIT 1
), '');
--> statement-breakpoint
DROP INDEX IF EXISTS market_price_snapshots_sku_month_uq;
--> statement-breakpoint
INSERT INTO market_price_snapshots
  (id, category, scope, sku_code, ranking_dimension, month, source_price_cents,
   average_transaction_price_cents, price_low_cents, price_high_cents,
   image_url, confirmation_status, source_import_batch_id)
SELECT
  'market-price-' || m.category || '-' || m.scope || '-' || m.ranking_dimension || '-' || m.sku_code || '-' || substr(m.period_end, 1, 7),
  m.category, m.scope, m.sku_code, m.ranking_dimension, substr(m.period_end, 1, 7), m.price_cents,
  CASE WHEN m.quantity > 0 THEN CAST(ROUND(m.gmv_cents * 1.0 / m.quantity) AS INTEGER) ELSE NULL END,
  m.price_low_cents, m.price_high_cents, m.image_url,
  CASE WHEN m.price_cents IS NULL THEN 'missing' ELSE 'source_table' END, m.last_import_batch_id
FROM market_ranking_entries m
WHERE substr(m.period_end, 1, 7) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM market_price_snapshots ps
    WHERE ps.category=m.category AND ps.scope=m.scope AND ps.sku_code=m.sku_code
      AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end, 1, 7)
  );
--> statement-breakpoint
DROP INDEX IF EXISTS market_price_snapshots_sku_month_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_price_snapshots_sku_month_uq ON market_price_snapshots (category, scope, sku_code, ranking_dimension, month);
--> statement-breakpoint
DROP INDEX IF EXISTS market_annotation_items_job_snapshot_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_items_job_snapshot_uq ON market_annotation_items (job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_download_staging_rows (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  row_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_download_staging_rows_file_row_uq ON market_download_staging_rows (task_id, file_hash, row_number);
