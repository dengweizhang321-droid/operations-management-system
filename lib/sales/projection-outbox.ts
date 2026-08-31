export const SALES_PROJECTION_CANONICAL_FORMAT_VERSION = "sales-projection-v2";

export const salesProjectionOutboxSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS sales_projection_source_state (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    source_epoch TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT OR IGNORE INTO sales_projection_source_state
    (id, source_epoch, created_at, updated_at)
    VALUES (1, lower(hex(randomblob(16))), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sales_projection_outbox (
    event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source_epoch TEXT NOT NULL,
    domain TEXT NOT NULL CHECK (domain IN ('sales', 'erp')),
    operation TEXT NOT NULL CHECK (operation IN ('replace_scope', 'replace_all')),
    scope_json TEXT NOT NULL,
    source_batch_id TEXT NOT NULL,
    sales_revision INTEGER NOT NULL CHECK (sales_revision >= 1),
    erp_revision INTEGER NOT NULL CHECK (erp_revision >= 1),
    row_count INTEGER NOT NULL CHECK (row_count >= 0),
    content_hash TEXT NOT NULL,
    canonical_format_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sales_projection_outbox_event_id_uq
    ON sales_projection_outbox (event_id)`,
  `CREATE INDEX IF NOT EXISTS sales_projection_outbox_domain_sequence_idx
    ON sales_projection_outbox (domain, event_sequence)`,
] as const;

export const insertSalesProjectionOutboxEventSql = `
  INSERT INTO sales_projection_outbox (
    event_id, source_epoch, domain, operation, scope_json, source_batch_id,
    sales_revision, erp_revision, row_count, content_hash,
    canonical_format_version, created_at
  )
  SELECT
    source.source_epoch || ':sales:' || ?, source.source_epoch, 'sales', 'replace_scope', ?, ?,
    revision.sales_revision, revision.erp_product_revision, ?, ?, ?, CURRENT_TIMESTAMP
  FROM sales_overview_cache_state AS revision
  JOIN sales_projection_source_state AS source ON source.id = 1
  WHERE revision.id = 1
    AND EXISTS (
      SELECT 1 FROM sales_import_batches
      WHERE id = ? AND status = 'processing'
    )
  ON CONFLICT(event_id) DO NOTHING
`;

export const insertErpProjectionOutboxEventSql = `
  INSERT INTO sales_projection_outbox (
    event_id, source_epoch, domain, operation, scope_json, source_batch_id,
    sales_revision, erp_revision, row_count, content_hash,
    canonical_format_version, created_at
  )
  SELECT
    source.source_epoch || ':erp:' || ?, source.source_epoch, 'erp', 'replace_all', ?, ?,
    revision.sales_revision, revision.erp_product_revision, ?, ?, ?, CURRENT_TIMESTAMP
  FROM sales_overview_cache_state AS revision
  JOIN sales_projection_source_state AS source ON source.id = 1
  WHERE revision.id = 1
    AND EXISTS (
      SELECT 1 FROM erp_reference_import_batches
      WHERE id = ? AND source_key = 'products' AND status = 'processing'
    )
  ON CONFLICT(event_id) DO NOTHING
`;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function assertProjectionContentHash(contentHash: string): string {
  if (!SHA256_HEX_PATTERN.test(contentHash)) {
    throw new Error("投影 outbox 的规范内容摘要必须是 64 位小写 SHA-256");
  }
  return contentHash;
}

export function buildSalesProjectionScopeJson(input: {
  startDate: string;
  endDate: string;
  channels: readonly string[] | null;
}): string {
  const channels = input.channels
    ? [...new Set(input.channels.map((channel) => channel.trim()))].sort()
    : null;
  return JSON.stringify({
    startDate: input.startDate,
    endDate: input.endDate,
    channels,
  });
}

export const ERP_PRODUCT_PROJECTION_SCOPE_JSON = JSON.stringify({ source: "products" });
