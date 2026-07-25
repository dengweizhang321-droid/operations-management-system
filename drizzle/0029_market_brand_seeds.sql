CREATE TABLE IF NOT EXISTS market_brand_seeds (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_brand TEXT NOT NULL,
  seed_text TEXT NOT NULL,
  normalized_seed TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enabled',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_refreshed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS market_brand_seeds_normalized_uq
  ON market_brand_seeds (normalized_seed);
CREATE INDEX IF NOT EXISTS market_brand_seeds_lookup_idx
  ON market_brand_seeds (status, canonical_brand, source);
