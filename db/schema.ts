import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    index("sales_order_lines_last_batch_idx").on(table.lastImportBatchId),
  ],
);
