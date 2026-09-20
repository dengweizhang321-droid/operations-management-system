CREATE TABLE IF NOT EXISTS import_content_fingerprints (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  import_hash TEXT NOT NULL,
  raw_file_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  publication_sequence INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain, batch_id),
  UNIQUE (domain, scope_key, import_hash)
);

CREATE INDEX IF NOT EXISTS import_content_fingerprints_scope_idx
  ON import_content_fingerprints (domain, scope_key, publication_sequence DESC);

CREATE INDEX IF NOT EXISTS import_content_fingerprints_raw_idx
  ON import_content_fingerprints (domain, raw_file_hash);

CREATE TABLE IF NOT EXISTS import_content_attempts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  import_hash TEXT NOT NULL,
  raw_file_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT '',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  recovered_from_attempt_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS import_content_attempts_scope_idx
  ON import_content_attempts (domain, scope_key, sequence DESC);

CREATE INDEX IF NOT EXISTS import_content_attempts_raw_idx
  ON import_content_attempts (domain, raw_file_hash, sequence DESC);

CREATE TABLE IF NOT EXISTS import_scope_heads (
  domain TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  state_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  owner_token TEXT,
  current_batch_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, scope_key)
);

CREATE INDEX IF NOT EXISTS finance_months_status_batch_idx
  ON finance_months (status, batch_id);

CREATE INDEX IF NOT EXISTS customer_service_conversations_shop_last_batch_idx
  ON customer_service_conversations (shop_name, last_import_batch_id);

CREATE INDEX IF NOT EXISTS erp_product_master_last_batch_idx
  ON erp_product_master (last_import_batch_id);

CREATE INDEX IF NOT EXISTS erp_inventory_age_last_batch_idx
  ON erp_inventory_age_lines (last_import_batch_id);

CREATE INDEX IF NOT EXISTS erp_combo_items_last_batch_idx
  ON erp_combo_items (last_import_batch_id);

CREATE INDEX IF NOT EXISTS market_entries_last_batch_idx
  ON market_ranking_entries (last_import_batch_id);

CREATE INDEX IF NOT EXISTS netshop_rows_lock_ownership_idx
  ON netshop_rows (source, dataset, platform, shop_name, last_import_batch_id);
