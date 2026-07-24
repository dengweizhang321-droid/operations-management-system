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

/** Configured AI model endpoints; credentials are stored encrypted. */
export const aiModels = sqliteTable("ai_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  modelType: text("model_type").notNull(),
  modelName: text("model_name").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  apiKeyEncrypted: text("api_key_encrypted").notNull().default(""),
  apiKeySuffix: text("api_key_suffix").notNull().default(""),
  isDefaultTextModel: integer("is_default_text_model", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull(),
  lastTestResult: text("last_test_result"),
  lastTestedAt: text("last_tested_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("ai_models_default_text_uq").on(table.isDefaultTextModel).where(sql`${table.isDefaultTextModel} = 1 AND ${table.status} = 'enabled' AND ${table.modelType} = 'text'`),
  index("ai_models_status_idx").on(table.status, table.modelType, table.updatedAt),
]);

export const aiChannels = sqliteTable("ai_channels", {
  id: text("id").primaryKey(), name: text("name").notNull(), kind: text("kind").notNull(), status: text("status").notNull(),
  sendEnabled: integer("send_enabled", { mode: "boolean" }).notNull().default(false), callbackEnabled: integer("callback_enabled", { mode: "boolean" }).notNull().default(false),
  webhookUrl: text("webhook_url").notNull().default(""), callbackTokenEncrypted: text("callback_token_encrypted").notNull().default(""), callbackTokenSuffix: text("callback_token_suffix").notNull().default(""),
  aesKeyEncrypted: text("aes_key_encrypted").notNull().default(""), aesKeySuffix: text("aes_key_suffix").notNull().default(""), receiverId: text("receiver_id").notNull().default(""), lastTestResult: text("last_test_result"), lastTestedAt: text("last_tested_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ai_channels_status_idx").on(table.status, table.kind, table.updatedAt)]);

/** Idempotency receipts for signed chat-platform callbacks. Callback payloads are never retained. */
export const aiChannelCallbackEvents = sqliteTable("ai_channel_callback_events", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  eventKey: text("event_key").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("ai_channel_callback_events_channel_event_uq").on(table.channelId, table.eventKey),
  index("ai_channel_callback_events_received_idx").on(table.channelId, table.receivedAt),
]);

export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(), title: text("title").notNull(), modelId: text("model_id"), createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ai_conversations_creator_updated_idx").on(table.createdBy, table.updatedAt)]);

export const aiConversationMessages = sqliteTable("ai_conversation_messages", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull(), role: text("role").notNull(), content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ai_conversation_messages_conversation_idx").on(table.conversationId, table.createdAt)]);

/** Administrator-managed operating thresholds used by inventory analysis. */
export const systemSettings = sqliteTable(
  "system_settings",
  {
    key: text("key").primaryKey(),
    valueJson: text("value_json").notNull(),
    updatedBy: text("updated_by").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

/** Durable work-plan items shown by the operations collaboration workspace. */
export const workflowTasks = sqliteTable(
  "workflow_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    workContent: text("work_content").notNull().default(""),
    category: text("category").notNull().default("工作计划"),
    owner: text("owner").notNull().default(""),
    shopName: text("shop_name").notNull().default(""),
    startDate: text("start_date").notNull().default(""),
    dueDate: text("due_date").notNull().default(""),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    createdBy: text("created_by").notNull().default(""),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workflow_tasks_status_created_idx").on(table.status, table.createdAt),
  ],
);

/** Prevents deleted default tasks from being seeded again after a refresh. */
export const workflowTaskBootstrap = sqliteTable(
  "workflow_task_bootstrap",
  {
    key: text("key").primaryKey(),
    seededAt: text("seeded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
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
    onlineSpecCode: text("online_spec_code").notNull().default(""),
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
    index("sales_order_lines_ship_time_idx").on(table.shipTime),
    index("sales_order_lines_channel_idx").on(table.channel),
    index("sales_order_lines_platform_idx").on(table.platform),
    index("sales_order_lines_online_spec_code_idx").on(table.onlineSpecCode),
    index("sales_order_lines_inventory_demand_idx").on(table.salesTime, table.productCode, table.warehouse),
    index("sales_order_lines_ship_time_inventory_demand_idx").on(table.shipTime, table.productCode, table.warehouse),
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
    brand: text("brand").notNull().default(""),
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

/** Per-row rolling sales counters supplied by a warehouse-age analysis export. */
export const inventoryAgeMetrics = sqliteTable(
  "inventory_age_metrics",
  {
    batchId: text("batch_id").notNull(),
    rowKey: text("row_key").notNull(),
    sales7dQuantity: integer("sales_7d_quantity").notNull().default(0),
    sales30dQuantity: integer("sales_30d_quantity").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("inventory_age_metrics_batch_row_uq").on(table.batchId, table.rowKey),
    index("inventory_age_metrics_batch_idx").on(table.batchId),
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

/** Audit trail shared by product-master, inventory-age, and combo imports. */
export const erpReferenceImportBatches = sqliteTable(
  "erp_reference_import_batches",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    sourceLabel: text("source_label").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull(),
    snapshotDate: text("snapshot_date"),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    excludedCount: integer("excluded_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    warningsJson: text("warnings_json").notNull().default("[]"),
    totalsJson: text("totals_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("erp_reference_import_batches_source_hash_uq").on(table.sourceKey, table.fileHash),
    index("erp_reference_import_batches_source_created_idx").on(table.sourceKey, table.createdAt),
  ],
);

/** Current 吉客云 product master, updated idempotently by product code. */
export const erpProductMaster = sqliteTable(
  "erp_product_master",
  {
    productCode: text("product_code").primaryKey(),
    productName: text("product_name").notNull(),
    brand: text("brand").notNull().default(""),
    specification: text("specification").notNull().default(""),
    barcode: text("barcode").notNull().default(""),
    category: text("category").notNull().default(""),
    supplier: text("supplier").notNull().default(""),
    productStatus: text("product_status").notNull().default(""),
    sourceRowNumber: integer("source_row_number").notNull(),
    lastImportBatchId: text("last_import_batch_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("erp_product_master_name_idx").on(table.productName),
    index("erp_product_master_barcode_idx").on(table.barcode),
  ],
);

/** Daily inventory-age facts, replaced by snapshot date on re-import. */
export const erpInventoryAgeLines = sqliteTable(
  "erp_inventory_age_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    snapshotDate: text("snapshot_date").notNull(),
    warehouse: text("warehouse").notNull(),
    warehouseType: text("warehouse_type").notNull(),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull().default(""),
    specification: text("specification").notNull().default(""),
    category: text("category").notNull().default(""),
    availableQuantity: integer("available_quantity").notNull().default(0),
    inventoryAgeDays: integer("inventory_age_days"),
    sales7dQuantity: integer("sales_7d_quantity"),
    sales30dQuantity: integer("sales_30d_quantity"),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    stockValueCents: integer("stock_value_cents").notNull().default(0),
    sourceRowNumber: integer("source_row_number").notNull(),
    lastImportBatchId: text("last_import_batch_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("erp_inventory_age_snapshot_warehouse_product_uq").on(
      table.snapshotDate,
      table.warehouse,
      table.productCode,
    ),
    index("erp_inventory_age_snapshot_idx").on(table.snapshotDate),
    index("erp_inventory_age_product_idx").on(table.productCode),
  ],
);

/** Current combo bill-of-materials exported by 吉客云. */
export const erpComboItems = sqliteTable(
  "erp_combo_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentCode: text("parent_code").notNull(),
    parentName: text("parent_name").notNull().default(""),
    childCode: text("child_code").notNull(),
    childName: text("child_name").notNull().default(""),
    childQuantityMilli: integer("child_quantity_milli").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    lastImportBatchId: text("last_import_batch_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("erp_combo_items_parent_child_uq").on(table.parentCode, table.childCode),
    index("erp_combo_items_parent_idx").on(table.parentCode),
    index("erp_combo_items_child_idx").on(table.childCode),
  ],
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

/** One immutable audit batch per uploaded monthly financial-report file. */
export const financeImportBatches = sqliteTable(
  "finance_import_batches",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    fileHash: text("file_hash").notNull(),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    parsedMonthCount: integer("parsed_month_count").notNull().default(0),
    importedMonthCount: integer("imported_month_count").notNull().default(0),
    skippedMonthCount: integer("skipped_month_count").notNull().default(0),
    subjectCount: integer("subject_count").notNull().default(0),
    monthsJson: text("months_json").notNull().default("[]"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("finance_import_batches_file_hash_uq").on(table.fileHash),
    index("finance_import_batches_created_idx").on(table.createdAt),
  ],
);

/** Month is the idempotency anchor: a later file cannot duplicate a closed month. */
export const financeMonths = sqliteTable(
  "finance_months",
  {
    month: text("month").primaryKey(),
    batchId: text("batch_id").notNull(),
    sheetName: text("sheet_name").notNull(),
    businessName: text("business_name").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    status: text("status").notNull().default("processing"),
    shopCount: integer("shop_count").notNull().default(0),
    subjectCount: integer("subject_count").notNull().default(0),
    importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("finance_months_status_month_idx").on(table.status, table.month)],
);

/** Dynamic subject-name facts avoid a schema migration when Kingdee fields change. */
export const financeLines = sqliteTable(
  "finance_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    section: text("section").notNull(),
    metricKey: text("metric_key").notNull(),
    subjectName: text("subject_name").notNull(),
    scopeKey: text("scope_key").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeName: text("scope_name").notNull(),
    groupName: text("group_name").notNull().default(""),
    valueType: text("value_type").notNull(),
    amountCents: integer("amount_cents"),
    rateBps: integer("rate_bps"),
    rawValue: text("raw_value").notNull().default(""),
    sourceRowCount: integer("source_row_count").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    isTotal: integer("is_total", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("finance_lines_month_section_scope_subject_uq").on(
      table.month,
      table.section,
      table.scopeKey,
      table.subjectName,
    ),
    index("finance_lines_month_section_scope_idx").on(table.month, table.section, table.scopeType, table.scopeName),
    index("finance_lines_metric_month_idx").on(table.metricKey, table.month),
    index("finance_lines_subject_month_idx").on(table.subjectName, table.month),
  ],
);

/** Monthly, annual, and project targets used by financial progress analysis. */
export const financeTargets = sqliteTable(
  "finance_targets",
  {
    id: text("id").primaryKey(),
    periodType: text("period_type").notNull(),
    periodKey: text("period_key").notNull(),
    shopName: text("shop_name").notNull().default(""),
    category: text("category").notNull().default(""),
    manager: text("manager").notNull().default(""),
    salesTargetCents: integer("sales_target_cents").notNull().default(0),
    profitTargetCents: integer("profit_target_cents").notNull().default(0),
    smallMarginBps: integer("small_margin_bps").notNull().default(0),
    inventoryCleanupTargetCents: integer("inventory_cleanup_target_cents").notNull().default(0),
    promotionFeeRatioBps: integer("promotion_fee_ratio_bps").notNull().default(0),
    stagnantInventoryTargetCents: integer("stagnant_inventory_target_cents").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("finance_targets_period_scope_uq").on(table.periodType, table.periodKey, table.shopName, table.category),
    index("finance_targets_period_idx").on(table.periodType, table.periodKey),
  ],
);

/** Auditable uploads for competitor rankings and market SKU catalog files. */
export const marketImportBatches = sqliteTable(
  "market_import_batches",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull().default(""),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("market_import_batches_file_hash_uq").on(table.fileHash),
    index("market_import_batches_created_idx").on(table.createdAt),
  ],
);

/** Market ranking facts; own-product flags are resolved live against SKU/SPU and sales data. */
export const marketRankingEntries = sqliteTable(
  "market_ranking_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    naturalKey: text("natural_key").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    category: text("category").notNull().default(""),
    scope: text("scope").notNull().default("全部"),
    rankingDimension: text("ranking_dimension").notNull().default("SKU"),
    operationMode: text("operation_mode").notNull().default("未知"),
    subcategory: text("subcategory").notNull().default(""),
    rank: integer("rank"),
    skuCode: text("sku_code").notNull(),
    productName: text("product_name").notNull().default(""),
    brand: text("brand").notNull().default(""),
    priceCents: integer("price_cents"),
    priceLowCents: integer("price_low_cents"),
    priceHighCents: integer("price_high_cents"),
    priceEstimated: integer("price_estimated", { mode: "boolean" }).notNull().default(false),
    gmvCents: integer("gmv_cents").notNull().default(0),
    quantity: integer("quantity").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
    conversionBps: integer("conversion_bps"),
    cartCustomers: integer("cart_customers").notNull().default(0),
    searchClicks: integer("search_clicks").notNull().default(0),
    imageUrl: text("image_url").notNull().default(""),
    productUrl: text("product_url").notNull().default(""),
    rawJson: text("raw_json").notNull().default("{}"),
    lastImportBatchId: text("last_import_batch_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("market_ranking_entries_natural_key_uq").on(table.naturalKey),
    uniqueIndex("market_entries_canonical_uq").on(table.periodStart, table.periodEnd, table.category, table.scope, table.rankingDimension, table.skuCode),
    index("market_entries_period_idx").on(table.periodEnd, table.periodStart),
    index("market_entries_category_idx").on(table.category, table.periodEnd),
    index("market_entries_sku_idx").on(table.skuCode, table.periodEnd),
    index("market_entries_brand_idx").on(table.brand, table.periodEnd),
    index("market_entries_dimension_idx").on(table.rankingDimension, table.operationMode, table.periodEnd),
    index("market_entries_subcategory_idx").on(table.subcategory, table.periodEnd),
  ],
);

/** Monthly market-positioning price snapshots; manual confirmations survive re-imports. */
export const marketPriceSnapshots = sqliteTable(
  "market_price_snapshots",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    skuCode: text("sku_code").notNull(),
    rankingDimension: text("ranking_dimension").notNull().default("SKU"),
    month: text("month").notNull(),
    sourcePriceCents: integer("source_price_cents"),
    aiImagePriceCents: integer("ai_image_price_cents"),
    aiPriceType: text("ai_price_type").notNull().default(""),
    aiConfidenceBps: integer("ai_confidence_bps"),
    aiReason: text("ai_reason").notNull().default(""),
    confirmedMarketPriceCents: integer("confirmed_market_price_cents"),
    averageTransactionPriceCents: integer("average_transaction_price_cents"),
    priceLowCents: integer("price_low_cents"),
    priceHighCents: integer("price_high_cents"),
    imageContentSha256: text("image_content_sha256").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    confirmationStatus: text("confirmation_status").notNull().default("source_table"),
    confirmedBy: text("confirmed_by").notNull().default(""),
    confirmedAt: text("confirmed_at"),
    sourceJobItemId: text("source_job_item_id").notNull().default(""),
    promptVersionId: text("prompt_version_id").notNull().default(""),
    sourceImportBatchId: text("source_import_batch_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("market_price_snapshots_sku_month_uq").on(table.category, table.skuCode, table.rankingDimension, table.month),
    index("market_price_snapshots_status_idx").on(table.confirmationStatus, table.updatedAt),
    index("market_price_snapshots_hash_idx").on(table.skuCode, table.imageContentSha256, table.confirmedAt),
  ],
);

export const marketPriceBandVersions = sqliteTable("market_price_band_versions", {
  id: text("id").primaryKey(),
  category: text("category").notNull().default("*"),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  effectiveFrom: text("effective_from").notNull().default("1970-01-01"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedBy: text("published_by").notNull().default(""),
  publishedAt: text("published_at"),
  rolledBackFromId: text("rolled_back_from_id").notNull().default(""),
  note: text("note").notNull().default(""),
}, (table) => [
  uniqueIndex("market_price_band_versions_category_version_uq").on(table.category, table.version),
  index("market_price_band_versions_lookup_idx").on(table.category, table.status, table.effectiveFrom, table.version),
]);

export const marketPriceBandItems = sqliteTable("market_price_band_items", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull(),
  label: text("label").notNull(),
  minCents: integer("min_cents"),
  maxCents: integer("max_cents"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  index("market_price_band_items_version_idx").on(table.versionId, table.sortOrder),
]);

export const marketMasterMappingRules = sqliteTable("market_master_mapping_rules", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  category: text("category").notNull().default(""),
  sourceValue: text("source_value").notNull(),
  targetValue: text("target_value").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  effectiveFrom: text("effective_from").notNull().default("1970-01-01"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("market_master_mapping_rules_kind_idx").on(table.kind, table.category, table.status, table.effectiveFrom),
]);

export const marketDownloadTasks = sqliteTable("market_download_tasks", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  month: text("month").notNull(),
  rankingDimension: text("ranking_dimension").notNull(),
  status: text("status").notNull().default("planned"),
  attemptCount: integer("attempt_count").notNull().default(0),
  sourceFileName: text("source_file_name").notNull().default(""),
  fileHash: text("file_hash").notNull().default(""),
  rowCount: integer("row_count").notNull().default(0),
  errorCode: text("error_code").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  nextRetryAt: text("next_retry_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("market_download_tasks_unique_uq").on(table.category, table.month, table.rankingDimension),
  index("market_download_tasks_status_idx").on(table.status, table.nextRetryAt, table.updatedAt),
]);

export const marketMasterAuditLogs = sqliteTable("market_master_audit_logs", {
  id: text("id").primaryKey(),
  actorEmail: text("actor_email").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("market_master_audit_logs_entity_idx").on(table.entityType, table.entityId, table.createdAt),
]);

/** Validated JD product image cache metadata; image bytes live in R2. */
export const marketImageCache = sqliteTable(
  "market_image_cache",
  {
    sourceUrl: text("source_url").primaryKey(),
    status: text("status").notNull().default("pending"),
    objectKey: text("object_key").notNull().default(""),
    contentSha256: text("content_sha256").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: integer("size_bytes").notNull().default(0),
    imageSource: text("image_source").notNull().default(""),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("market_image_cache_object_key_idx").on(table.objectKey),
    index("market_image_cache_status_idx").on(table.status, table.updatedAt),
  ],
);

/** Immutable prompts and durable review jobs for market-SKU AI annotation. */
export const marketAnnotationPromptVersions = sqliteTable("market_annotation_prompt_versions", {
  id: text("id").primaryKey(), category: text("category").notNull(), version: integer("version").notNull(),
  parentId: text("parent_id"), source: text("source").notNull(), status: text("status").notNull().default("draft"),
  segmentsJson: text("segments_json").notNull(), promptBody: text("prompt_body").notNull(), changeNote: text("change_note").notNull().default(""),
  metricsJson: text("metrics_json").notNull().default("{}"), createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), activatedBy: text("activated_by"), activatedAt: text("activated_at"),
}, (table) => [
  uniqueIndex("market_annotation_prompts_category_version_uq").on(table.category, table.version),
  uniqueIndex("market_annotation_prompts_active_uq").on(table.category).where(sql`${table.status} = 'active'`),
]);

export const marketAnnotationJobs = sqliteTable("market_annotation_jobs", {
  id: text("id").primaryKey(), category: text("category").notNull(), promptVersionId: text("prompt_version_id").notNull(),
  executor: text("executor").notNull(), modelId: text("model_id"), localModelName: text("local_model_name").notNull().default(""),
  status: text("status").notNull().default("queued"), totalCount: integer("total_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0), failedCount: integer("failed_count").notNull().default(0),
  reviewedCount: integer("reviewed_count").notNull().default(0), committedCount: integer("committed_count").notNull().default(0),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  startedAt: text("started_at"), completedAt: text("completed_at"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  commitTokenHash: text("commit_token_hash").notNull().default(""), commitStartedAt: text("commit_started_at"),
}, (table) => [index("market_annotation_jobs_category_created_idx").on(table.category, table.createdAt)]);

export const marketAnnotationItems = sqliteTable("market_annotation_items", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull(), skuCode: text("sku_code").notNull(),
  category: text("category").notNull().default(""), rankingDimension: text("ranking_dimension").notNull().default("SKU"),
  month: text("month").notNull().default(""), imageContentSha256: text("image_content_sha256").notNull().default(""),
  productName: text("product_name").notNull().default(""), brand: text("brand").notNull().default(""),
  sourceImageUrl: text("source_image_url").notNull().default(""), resolvedImageUrl: text("resolved_image_url").notNull().default(""),
  imageSource: text("image_source").notNull().default("none"), status: text("status").notNull().default("queued"),
  aiSegment: text("ai_segment").notNull().default(""), aiImagePriceCents: integer("ai_image_price_cents"),
  aiPriceType: text("ai_price_type").notNull().default(""), aiPriceLowCents: integer("ai_price_low_cents"), aiPriceHighCents: integer("ai_price_high_cents"),
  aiConfidenceBps: integer("ai_confidence_bps"), aiReason: text("ai_reason").notNull().default(""), aiRawDigest: text("ai_raw_digest").notNull().default(""),
  reviewedSegment: text("reviewed_segment").notNull().default(""), reviewedImagePriceCents: integer("reviewed_image_price_cents"),
  reviewedPriceType: text("reviewed_price_type").notNull().default(""), reviewedPriceLowCents: integer("reviewed_price_low_cents"), reviewedPriceHighCents: integer("reviewed_price_high_cents"),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false), reviewedBy: text("reviewed_by").notNull().default(""), reviewedAt: text("reviewed_at"),
  leaseTokenHash: text("lease_token_hash").notNull().default(""), leaseAgentId: text("lease_agent_id").notNull().default(""), leaseExpiresAt: text("lease_expires_at"),
  attemptCount: integer("attempt_count").notNull().default(0), errorMessage: text("error_message").notNull().default(""),
  version: integer("version").notNull().default(0), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("market_annotation_items_job_snapshot_uq").on(table.jobId, table.category, table.skuCode, table.rankingDimension, table.month, table.imageContentSha256),
  index("market_annotation_items_job_status_idx").on(table.jobId, table.status, table.updatedAt),
  index("market_annotation_items_lease_idx").on(table.leaseExpiresAt, table.status),
]);

export const marketSkuAnnotations = sqliteTable("market_sku_annotations", {
  id: text("id").primaryKey(), category: text("category").notNull(), skuCode: text("sku_code").notNull(), segment: text("segment").notNull(),
  imagePriceCents: integer("image_price_cents"), imageUrl: text("image_url").notNull().default(""), imageSource: text("image_source").notNull().default("none"),
  confidenceBps: integer("confidence_bps"), sourceJobItemId: text("source_job_item_id").notNull(), promptVersionId: text("prompt_version_id").notNull(),
  reviewedBy: text("reviewed_by").notNull(), reviewedAt: text("reviewed_at").notNull(), version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("market_sku_annotations_category_sku_uq").on(table.category, table.skuCode),
  index("market_sku_annotations_segment_idx").on(table.category, table.segment, table.updatedAt),
]);

export const marketAnnotationCommitReceipts = sqliteTable("market_annotation_commit_receipts", {
  id: text("id").primaryKey(), jobItemId: text("job_item_id").notNull(), annotationId: text("annotation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), beforeJson: text("before_json").notNull().default("{}"), afterJson: text("after_json").notNull(),
  committedBy: text("committed_by").notNull(), committedAt: text("committed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  batchId: text("batch_id").notNull().default(""), requestDigest: text("request_digest").notNull().default(""),
}, (table) => [
  uniqueIndex("market_annotation_commits_item_uq").on(table.jobItemId), uniqueIndex("market_annotation_commits_idempotency_uq").on(table.idempotencyKey),
  index("market_annotation_commits_batch_idx").on(table.batchId),
]);

export const marketAnnotationValidationSamples = sqliteTable("market_annotation_validation_samples", {
  id: text("id").primaryKey(), category: text("category").notNull(), skuCode: text("sku_code").notNull(), productName: text("product_name").notNull().default(""),
  brand: text("brand").notNull().default(""), imageUrl: text("image_url").notNull().default(""), goldSegment: text("gold_segment").notNull(),
  goldImagePriceCents: integer("gold_image_price_cents"), sourceAnnotationId: text("source_annotation_id").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("market_annotation_samples_category_sku_uq").on(table.category, table.skuCode)]);

export const marketAnnotationValidationRuns = sqliteTable("market_annotation_validation_runs", {
  id: text("id").primaryKey(), category: text("category").notNull(), baselinePromptId: text("baseline_prompt_id"), candidatePromptId: text("candidate_prompt_id").notNull(),
  modelId: text("model_id").notNull(), status: text("status").notNull().default("queued"), seed: text("seed").notNull(),
  requestedSampleCount: integer("requested_sample_count").notNull().default(50), sampleCount: integer("sample_count").notNull().default(0),
  sampleHash: text("sample_hash").notNull().default(""), metricsJson: text("metrics_json").notNull().default("{}"), gateJson: text("gate_json").notNull().default("{}"),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text("completed_at"),
}, (table) => [index("market_annotation_validation_runs_prompt_idx").on(table.candidatePromptId, table.createdAt)]);

export const marketAnnotationValidationResults = sqliteTable("market_annotation_validation_results", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), sampleId: text("sample_id").notNull(), promptVersionId: text("prompt_version_id").notNull(),
  status: text("status").notNull().default("queued"),
  predictedSegment: text("predicted_segment").notNull().default(""), predictedImagePriceCents: integer("predicted_image_price_cents"), confidenceBps: integer("confidence_bps"),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull().default(false), errorMessage: text("error_message").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sampleSnapshotJson: text("sample_snapshot_json").notNull().default("{}"), claimTokenHash: text("claim_token_hash").notNull().default(""),
  leaseExpiresAt: text("lease_expires_at"), attemptCount: integer("attempt_count").notNull().default(0), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("market_annotation_validation_result_uq").on(table.runId, table.sampleId, table.promptVersionId),
  index("market_annotation_validation_result_lease_idx").on(table.runId, table.status, table.leaseExpiresAt),
]);

export const marketAnnotationPromptAudits = sqliteTable("market_annotation_prompt_audits", {
  id: text("id").primaryKey(), promptId: text("prompt_id").notNull(), category: text("category").notNull(), action: text("action").notNull(),
  reason: text("reason").notNull(), actor: text("actor").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("market_annotation_prompt_audits_prompt_idx").on(table.promptId, table.createdAt)]);

export const marketAnnotationLocalAgents = sqliteTable("market_annotation_local_agents", {
  id: text("id").primaryKey(), name: text("name").notNull(), tokenHash: text("token_hash").notNull(), status: text("status").notNull().default("enabled"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"), createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), lastSeenAt: text("last_seen_at"), revokedAt: text("revoked_at"),
}, (table) => [uniqueIndex("market_annotation_agents_token_uq").on(table.tokenHash)]);

/** Paired customer-service session/chat imports and durable AI/manual review fields. */
export const customerServiceImportBatches = sqliteTable("customer_service_import_batches", {
  id: text("id").primaryKey(), shopName: text("shop_name").notNull().default("志高商用设备"),
  sessionFileName: text("session_file_name").notNull(), chatFileName: text("chat_file_name").notNull(), fileHash: text("file_hash").notNull(), status: text("status").notNull(),
  conversationCount: integer("conversation_count").notNull().default(0), matchedCount: integer("matched_count").notNull().default(0), sessionOnlyCount: integer("session_only_count").notNull().default(0), chatOnlyCount: integer("chat_only_count").notNull().default(0), ambiguousCount: integer("ambiguous_count").notNull().default(0),
  warningsJson: text("warnings_json").notNull().default("[]"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text("completed_at"),
}, (table) => [uniqueIndex("customer_service_import_batches_file_hash_uq").on(table.fileHash)]);

export const customerServiceConversations = sqliteTable("customer_service_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }), conversationKey: text("conversation_key").notNull(), firstImportBatchId: text("first_import_batch_id").notNull(), lastImportBatchId: text("last_import_batch_id").notNull(),
  shopName: text("shop_name").notNull().default("志高商用设备"), consultedAt: text("consulted_at").notNull(), customerId: text("customer_id").notNull().default(""), customerAlias: text("customer_alias").notNull().default(""), consultationType: text("consultation_type").notNull().default(""), agent: text("agent").notNull().default(""), transferredAgent: text("transferred_agent").notNull().default(""), skillGroup: text("skill_group").notNull().default(""),
  productSku: text("product_sku").notNull().default(""), productName: text("product_name").notNull().default(""), firstResponseAt: text("first_response_at").notNull().default(""), responseSeconds: integer("response_seconds"), durationMinutes: integer("duration_minutes"), customerMessageCount: integer("customer_message_count"), agentMessageCount: integer("agent_message_count"), satisfaction: text("satisfaction").notNull().default(""), resolved: text("resolved").notNull().default(""), conversationId: text("conversation_id").notNull().default(""),
  matchStatus: text("match_status").notNull(), matchConfidence: text("match_confidence").notNull(), chatStartedAt: text("chat_started_at").notNull().default(""), chatEndedAt: text("chat_ended_at").notNull().default(""), chatCustomerAlias: text("chat_customer_alias").notNull().default(""), messagesJson: text("messages_json").notNull().default("[]"),
  robotScope: text("robot_scope").notNull().default(""), problemType: text("problem_type").notNull().default(""), conversionStatus: text("conversion_status").notNull().default(""), serviceIssues: text("service_issues").notNull().default(""), summaryText: text("summary_text").notNull().default(""), analysisSource: text("analysis_source").notNull().default(""), analyzedAt: text("analyzed_at"), annotatedAt: text("annotated_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("customer_service_conversations_key_uq").on(table.conversationKey),
  index("customer_service_conversations_consulted_idx").on(table.consultedAt),
  index("customer_service_conversations_filter_idx").on(table.agent, table.matchStatus, table.consultedAt),
]);
