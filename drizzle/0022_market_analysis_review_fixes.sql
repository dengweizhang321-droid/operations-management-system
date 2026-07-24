UPDATE market_ranking_entries
SET operation_mode = CASE
  WHEN lower(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '')) LIKE '%pop%'
    OR COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%店铺%'
    OR COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%旗舰店%' THEN 'POP'
  WHEN COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') LIKE '%自营%' THEN '自营'
  ELSE '未知'
END
WHERE operation_mode IS NULL OR operation_mode = '' OR operation_mode IN ('SKU','SPU','全部','未知');
--> statement-breakpoint
UPDATE market_ranking_entries
SET ranking_dimension = CASE
  WHEN upper(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') || ' ' || COALESCE((SELECT file_name FROM market_import_batches b WHERE b.id = last_import_batch_id), '')) LIKE '%SPU%' THEN 'SPU'
  WHEN upper(COALESCE(scope, '') || ' ' || COALESCE(raw_json, '') || ' ' || COALESCE((SELECT file_name FROM market_import_batches b WHERE b.id = last_import_batch_id), '')) LIKE '%SKU%' THEN 'SKU'
  ELSE 'SKU'
END;
--> statement-breakpoint
DELETE FROM market_ranking_entries
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY period_start, period_end, category, scope, ranking_dimension, sku_code
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
    FROM market_ranking_entries
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint
UPDATE market_ranking_entries
SET natural_key = period_start || '|' || period_end || '|' || category || '|' || scope || '|' || ranking_dimension || '|' || sku_code;
--> statement-breakpoint
INSERT INTO market_price_snapshots (
  id, category, sku_code, ranking_dimension, month, source_price_cents,
  average_transaction_price_cents, price_low_cents, price_high_cents,
  image_content_sha256, image_url, confirmation_status, source_import_batch_id, updated_at
)
SELECT
  'market-price-backfill-v1-' ||
    length(m.category) || ':' || m.category || '|' ||
    length(m.ranking_dimension) || ':' || m.ranking_dimension || '|' ||
    length(m.sku_code) || ':' || m.sku_code || '|' || substr(m.period_end, 1, 7),
  m.category,
  m.sku_code,
  m.ranking_dimension,
  substr(m.period_end, 1, 7),
  m.price_cents,
  CASE WHEN m.quantity > 0 THEN CAST(ROUND(m.gmv_cents * 1.0 / m.quantity) AS INTEGER) ELSE NULL END,
  m.price_low_cents,
  m.price_high_cents,
  COALESCE((SELECT content_sha256 FROM market_image_cache mic WHERE mic.source_url = m.image_url AND mic.status = 'ready' LIMIT 1), ''),
  m.image_url,
  CASE WHEN m.price_cents IS NULL THEN 'missing' ELSE 'source_table' END,
  m.last_import_batch_id,
  CURRENT_TIMESTAMP
FROM (
  SELECT ranked.*
  FROM (
    SELECT source.*,
      ROW_NUMBER() OVER (
        PARTITION BY source.category, source.sku_code, source.ranking_dimension, substr(source.period_end, 1, 7)
        ORDER BY datetime(source.updated_at) DESC, source.id DESC
      ) AS snapshot_rn
    FROM market_ranking_entries source
    WHERE substr(source.period_end, 1, 7) <> ''
  ) ranked
  WHERE ranked.snapshot_rn = 1
) m
WHERE 1 = 1
ON CONFLICT(category, sku_code, ranking_dimension, month) DO UPDATE SET
  source_price_cents = excluded.source_price_cents,
  average_transaction_price_cents = excluded.average_transaction_price_cents,
  price_low_cents = excluded.price_low_cents,
  price_high_cents = excluded.price_high_cents,
  image_content_sha256 = CASE WHEN excluded.image_content_sha256 <> '' THEN excluded.image_content_sha256 ELSE market_price_snapshots.image_content_sha256 END,
  image_url = CASE WHEN excluded.image_url <> '' THEN excluded.image_url ELSE market_price_snapshots.image_url END,
  confirmation_status = CASE
    WHEN market_price_snapshots.confirmed_market_price_cents IS NOT NULL THEN market_price_snapshots.confirmation_status
    WHEN excluded.source_price_cents IS NULL THEN 'missing'
    ELSE 'source_table'
  END,
  source_import_batch_id = excluded.source_import_batch_id,
  updated_at = CURRENT_TIMESTAMP;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_entries_canonical_uq ON market_ranking_entries (`period_start`,`period_end`,`category`,`scope`,`ranking_dimension`,`sku_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_price_band_versions (
  `id` text PRIMARY KEY NOT NULL,
  `category` text DEFAULT '*' NOT NULL,
  `version` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `effective_from` text DEFAULT '1970-01-01' NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `published_by` text DEFAULT '' NOT NULL,
  `published_at` text,
  `rolled_back_from_id` text DEFAULT '' NOT NULL,
  `note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_price_band_versions_category_version_uq ON market_price_band_versions (`category`,`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_price_band_versions_lookup_idx ON market_price_band_versions (`category`,`status`,`effective_from`,`version`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_price_band_items (
  `id` text PRIMARY KEY NOT NULL,
  `version_id` text NOT NULL,
  `label` text NOT NULL,
  `min_cents` integer,
  `max_cents` integer,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_price_band_items_version_idx ON market_price_band_items (`version_id`,`sort_order`);
--> statement-breakpoint
INSERT OR IGNORE INTO market_price_band_versions
  (id, category, version, status, effective_from, created_by, published_by, published_at, note)
VALUES ('market-price-band-default-v1', '*', 1, 'published', '1970-01-01', 'system', 'system', CURRENT_TIMESTAMP, 'default seeded config');
--> statement-breakpoint
INSERT OR IGNORE INTO market_price_band_items (id, version_id, label, min_cents, max_cents, sort_order) VALUES
  ('market-price-band-default-v1-10', 'market-price-band-default-v1', '0-499', 0, 50000, 10),
  ('market-price-band-default-v1-20', 'market-price-band-default-v1', '500-999', 50000, 100000, 20),
  ('market-price-band-default-v1-30', 'market-price-band-default-v1', '1000-1999', 100000, 200000, 30),
  ('market-price-band-default-v1-40', 'market-price-band-default-v1', '2000-2999', 200000, 300000, 40),
  ('market-price-band-default-v1-50', 'market-price-band-default-v1', '3000+', 300000, NULL, 50);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_master_mapping_rules (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `category` text DEFAULT '' NOT NULL,
  `source_value` text NOT NULL,
  `target_value` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `effective_from` text DEFAULT '1970-01-01' NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_master_mapping_rules_kind_idx ON market_master_mapping_rules (`kind`,`category`,`status`,`effective_from`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_download_tasks (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL,
  `month` text NOT NULL,
  `ranking_dimension` text NOT NULL,
  `status` text DEFAULT 'planned' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `source_file_name` text DEFAULT '' NOT NULL,
  `file_hash` text DEFAULT '' NOT NULL,
  `row_count` integer DEFAULT 0 NOT NULL,
  `error_code` text DEFAULT '' NOT NULL,
  `error_message` text DEFAULT '' NOT NULL,
  `next_retry_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_download_tasks_unique_uq ON market_download_tasks (`category`,`month`,`ranking_dimension`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_download_tasks_status_idx ON market_download_tasks (`status`,`next_retry_at`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_master_audit_logs (
  `id` text PRIMARY KEY NOT NULL,
  `actor_email` text NOT NULL,
  `actor_role` text NOT NULL,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `before_json` text DEFAULT '{}' NOT NULL,
  `after_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_master_audit_logs_entity_idx ON market_master_audit_logs (`entity_type`,`entity_id`,`created_at`);
