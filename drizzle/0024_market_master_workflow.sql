CREATE TABLE IF NOT EXISTS market_download_configs (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  ranking_dimension TEXT NOT NULL,
  month_start TEXT NOT NULL,
  month_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE market_download_tasks ADD COLUMN jd_task_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN header_valid INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN period_valid INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN category_valid INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN dimension_valid INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN staging_batch_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN import_batch_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN validation_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN last_attempt_at TEXT;
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN completed_at TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_download_configs_unique_uq ON market_download_configs (category, ranking_dimension, month_start, month_end);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_download_configs_status_idx ON market_download_configs (status, category, ranking_dimension);
