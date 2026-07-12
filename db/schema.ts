import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Server-side allowlist and authorization source for the operations console. */
export const appUsers = sqliteTable(
  "app_users",
  {
    email: text("email").primaryKey(),
    displayName: text("display_name").notNull().default(""),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    scopeJson: text("scope_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("app_users_role_status_idx").on(table.role, table.status),
  ],
);

/** Durable, metadata-only audit trail for future AI tool executions. */
export const aiToolAuditLogs = sqliteTable(
  "ai_tool_audit_logs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorRole: text("actor_role").notNull(),
    surface: text("surface").notNull(),
    toolName: text("tool_name").notNull(),
    argumentsJson: text("arguments_json").notNull().default("{}"),
    status: text("status").notNull(),
    rowCount: integer("row_count"),
    durationMs: integer("duration_ms"),
    responseDigest: text("response_digest"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("ai_tool_audit_logs_actor_created_idx").on(table.actorEmail, table.createdAt),
    index("ai_tool_audit_logs_tool_created_idx").on(table.toolName, table.createdAt),
  ],
);

/**
 * Import audit data. The file hash is also used as the stable batch id, which
 * makes concurrent retries of the same upload safe.
 */
export const salesImportBatches = sqliteTable(
  "sales_import_batches",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull(),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    warningsJson: text("warnings_json").notNull().default("[]"),
    totalsJson: text("totals_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("sales_import_batches_file_hash_uq").on(table.fileHash),
    index("sales_import_batches_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Analysis-safe sales facts. Customer names/accounts, recipients, addresses,
 * customer notes, and other free-form personal data are deliberately absent.
 * Monetary values are stored as integer cents and rates as integer basis
 * points, so aggregation never depends on floating-point currency math.
 */
export const salesOrderLines = sqliteTable(
  "sales_order_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceLineKey: text("source_line_key").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    firstImportBatchId: text("first_import_batch_id").notNull(),
    lastImportBatchId: text("last_import_batch_id").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    orderNo: text("order_no").notNull(),
    onlineOrderNo: text("online_order_no").notNull(),
    channel: text("channel").notNull(),
    platform: text("platform").notNull(),
    shopName: text("shop_name").notNull(),
    logisticsCompany: text("logistics_company").notNull(),
    warehouse: text("warehouse").notNull(),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    specification: text("specification").notNull(),
    barcode: text("barcode").notNull(),
    supplier: text("supplier").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull(),
    listUnitPriceCents: integer("list_unit_price_cents").notNull(),
    costAmountCents: integer("cost_amount_cents").notNull(),
    allocatedUnitPriceCents: integer("allocated_unit_price_cents").notNull(),
    allocatedAmountCents: integer("allocated_amount_cents").notNull(),
    feeAllocationCents: integer("fee_allocation_cents").notNull(),
    grossProfitCents: integer("gross_profit_cents").notNull(),
    grossMarginBps: integer("gross_margin_bps").notNull(),
    untaxedGrossProfitCents: integer("untaxed_gross_profit_cents").notNull(),
    untaxedGrossMarginBps: integer("untaxed_gross_margin_bps").notNull(),
    orderTime: text("order_time").notNull(),
    salesTime: text("sales_time").notNull(),
    shipTime: text("ship_time").notNull(),
    lineShipTime: text("line_ship_time").notNull(),
    businessType: text("business_type").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sales_order_lines_source_line_key_uq").on(table.sourceLineKey),
    index("sales_order_lines_sales_time_idx").on(table.salesTime),
    index("sales_order_lines_channel_idx").on(table.channel),
    index("sales_order_lines_platform_idx").on(table.platform),
    index("sales_order_lines_inventory_demand_idx").on(table.salesTime, table.productCode, table.warehouse),
    index("sales_order_lines_last_batch_idx").on(table.lastImportBatchId),
  ],
);

/** Temporary metadata for resumable chunked Excel uploads. File bytes live in R2. */
export const salesImportUploads = sqliteTable(
  "sales_import_uploads",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    chunkSizeBytes: integer("chunk_size_bytes").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    receivedChunkCount: integer("received_chunk_count").notNull().default(0),
    receivedBytes: integer("received_bytes").notNull().default(0),
    status: text("status").notNull().default("uploading"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("sales_import_uploads_fingerprint_uq").on(table.fingerprint),
    index("sales_import_uploads_expires_at_idx").on(table.expiresAt),
  ],
);

export const salesImportUploadChunks = sqliteTable(
  "sales_import_upload_chunks",
  {
    uploadId: text("upload_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sales_import_upload_chunks_upload_chunk_uq").on(table.uploadId, table.chunkIndex),
    index("sales_import_upload_chunks_upload_id_idx").on(table.uploadId),
  ],
);

/** Audit trail for immutable warehouse-stock snapshot imports. */
export const inventoryImportBatches = sqliteTable(
  "inventory_import_batches",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull(),
    snapshotDate: text("snapshot_date").notNull(),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    warningsJson: text("warnings_json").notNull().default("[]"),
    totalsJson: text("totals_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("inventory_import_batches_file_hash_uq").on(table.fileHash),
    index("inventory_import_batches_completed_at_idx").on(table.completedAt),
  ],
);

/** Analysis-safe stock facts for a single imported snapshot. */
export const inventoryStockLines = sqliteTable(
  "inventory_stock_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: text("batch_id").notNull(),
    rowKey: text("row_key").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    snapshotDate: text("snapshot_date").notNull(),
    warehouse: text("warehouse").notNull(),
    warehouseType: text("warehouse_type").notNull(),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    specification: text("specification").notNull(),
    barcode: text("barcode").notNull(),
    category: text("category").notNull(),
    onHandQuantity: integer("on_hand_quantity").notNull(),
    availableQuantity: integer("available_quantity").notNull(),
    lockedQuantity: integer("locked_quantity").notNull(),
    inTransitQuantity: integer("in_transit_quantity").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    inventoryAgeDays: integer("inventory_age_days"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("inventory_stock_lines_batch_row_uq").on(table.batchId, table.rowKey),
    index("inventory_stock_lines_batch_idx").on(table.batchId),
    index("inventory_stock_lines_product_idx").on(table.productCode),
    index("inventory_stock_lines_warehouse_idx").on(table.warehouse),
  ],
);

/** Temporary metadata for resumable inventory snapshot uploads. */
export const inventoryImportUploads = sqliteTable(
  "inventory_import_uploads",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    chunkSizeBytes: integer("chunk_size_bytes").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    receivedChunkCount: integer("received_chunk_count").notNull().default(0),
    receivedBytes: integer("received_bytes").notNull().default(0),
    status: text("status").notNull().default("uploading"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("inventory_import_uploads_fingerprint_uq").on(table.fingerprint),
    index("inventory_import_uploads_expires_at_idx").on(table.expiresAt),
  ],
);

export const inventoryImportUploadChunks = sqliteTable(
  "inventory_import_upload_chunks",
  {
    uploadId: text("upload_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("inventory_import_upload_chunks_upload_chunk_uq").on(table.uploadId, table.chunkIndex),
    index("inventory_import_upload_chunks_upload_id_idx").on(table.uploadId),
  ],
);

/** Stored completion payload makes chunked upload completion safe to retry. */
export const inventoryImportUploadResults = sqliteTable(
  "inventory_import_upload_results",
  {
    uploadId: text("upload_id").primaryKey(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

/** Durable replenishment workflow created from a specific inventory snapshot. */
export const replenishmentPlanItems = sqliteTable(
  "replenishment_plan_items",
  {
    id: text("id").primaryKey(),
    sourceBatchId: text("source_batch_id").notNull(),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    warehouse: text("warehouse").notNull(),
    suggestedQuantity: integer("suggested_quantity").notNull(),
    plannedQuantity: integer("planned_quantity").notNull(),
    coverageDaysTenths: integer("coverage_days_tenths"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("replenishment_plan_items_draft_key_uq")
      .on(table.sourceBatchId, table.productCode, table.warehouse)
      .where(sql`${table.status} = 'draft'`),
    index("replenishment_plan_items_status_idx").on(table.status),
    index("replenishment_plan_items_product_idx").on(table.productCode),
    index("replenishment_plan_items_source_batch_idx").on(table.sourceBatchId),
  ],
);
