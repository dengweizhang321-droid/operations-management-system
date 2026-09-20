ALTER TABLE market_download_tasks ADD COLUMN execution_token TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_import_batches ADD COLUMN owner_token TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_import_range_claims (
  range_key TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_import_range_claims_batch_idx
  ON market_import_range_claims (batch_id, claim_token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_import_range_claims_expiry_idx
  ON market_import_range_claims (lease_expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_import_staging_rows (
  batch_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  range_key TEXT NOT NULL,
  row_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, row_number)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_import_staging_rows_range_idx
  ON market_import_staging_rows (batch_id, range_key);
