CREATE TABLE IF NOT EXISTS market_brand_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  ranking_dimension TEXT NOT NULL DEFAULT 'SKU',
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  current_brand TEXT NOT NULL DEFAULT '',
  ai_brand TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ai_pending',
  model_id TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS market_brand_suggestions_identity_uq
  ON market_brand_suggestions (category, scope, ranking_dimension, sku_code);
CREATE INDEX IF NOT EXISTS market_brand_suggestions_status_idx
  ON market_brand_suggestions (status, category, updated_at);
