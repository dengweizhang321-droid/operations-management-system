export const salesOverviewCacheSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS sales_overview_cache_state (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    sales_revision INTEGER NOT NULL DEFAULT 1,
    erp_product_revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT OR IGNORE INTO sales_overview_cache_state
    (id, sales_revision, erp_product_revision, updated_at)
    VALUES (1, 1, 1, CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sales_overview_response_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    revision_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS sales_overview_response_cache_updated_idx
    ON sales_overview_response_cache (updated_at)`,
] as const;

export const bumpSalesOverviewFactsRevisionSql = `UPDATE sales_overview_cache_state
  SET sales_revision = sales_revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND EXISTS (SELECT 1 FROM sales_import_batches WHERE id = ? AND status = 'processing')`;

export const bumpSalesOverviewErpProductRevisionSql = `UPDATE sales_overview_cache_state
  SET erp_product_revision = erp_product_revision + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND EXISTS (SELECT 1 FROM erp_reference_import_batches
      WHERE id = ? AND source_key = 'products' AND status = 'processing')`;
