CREATE TABLE IF NOT EXISTS market_brand_recognition_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  model_id TEXT NOT NULL,
  query_text TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  recognized_count INTEGER NOT NULL DEFAULT 0,
  empty_count INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 40,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT
);

CREATE INDEX IF NOT EXISTS market_brand_recognition_jobs_filter_idx
  ON market_brand_recognition_jobs (category, query_text, created_at);
CREATE INDEX IF NOT EXISTS market_brand_recognition_jobs_status_idx
  ON market_brand_recognition_jobs (status, updated_at);
