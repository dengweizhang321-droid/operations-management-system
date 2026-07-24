import type { MarketSchemaDatabase } from "@/lib/market/schema-core";

export type MarketEntryForImport = {
  naturalKey: string;
  sourceRowNumber: number;
  periodStart: string;
  periodEnd: string;
  category: string;
  scope: string;
  rankingDimension: "SKU" | "SPU";
  operationMode: "POP" | "自营" | "未知";
  subcategory: string;
  rank: number | null;
  skuCode: string;
  productName: string;
  brand: string;
  priceCents: number | null;
  priceLowCents: number | null;
  priceHighCents: number | null;
  priceEstimated: boolean;
  gmvCents: number;
  quantity: number;
  pageViews: number;
  visitors: number;
  conversionBps: number | null;
  cartCustomers: number;
  searchClicks: number;
  imageUrl: string;
  productUrl: string;
  raw: Record<string, string | number | boolean | null>;
};

export type MarketImportIssueForCore = {
  row?: number;
  field?: string;
  message: string;
};

export type MarketImportBatchForCore = {
  id: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  status: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  warningCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: MarketImportIssueForCore[];
  createdAt: string;
  completedAt: string | null;
};

type BatchRow = {
  id: string; source_type: string; file_name: string; file_size_bytes: number; file_hash: string;
  sheet_name: string; status: string; row_count: number; inserted_count: number; updated_count: number;
  warning_count: number; period_start: string | null; period_end: string | null; warnings_json: string;
  created_at: string; completed_at: string | null;
};

export const marketBatchColumns = `id, source_type, file_name, file_size_bytes, file_hash, sheet_name, status,
  row_count, inserted_count, updated_count, warning_count, period_start, period_end,
  warnings_json, created_at, completed_at`;

function monthKey(date: string) {
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function mapMarketBatch(row: BatchRow): MarketImportBatchForCore {
  return {
    id: row.id,
    sourceType: row.source_type,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileHash: row.file_hash,
    sheetName: row.sheet_name,
    status: row.status,
    rowCount: row.row_count,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    warningCount: row.warning_count,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    warnings: parseJson(row.warnings_json, []),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function saveMarketImportCore(input: {
  db: MarketSchemaDatabase;
  batchId: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  rows: MarketEntryForImport[];
  warnings: MarketImportIssueForCore[];
}): Promise<MarketImportBatchForCore> {
  const { db } = input;
  const dates = input.rows.flatMap((row) => [row.periodStart, row.periodEnd]).filter(Boolean).sort();
  await db.prepare(
    `INSERT INTO market_import_batches (
      id, source_type, file_name, file_size_bytes, file_hash, sheet_name, status,
      row_count, warning_count, period_start, period_end, warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
  ).bind(
    input.batchId, input.sourceType, input.fileName, input.fileSizeBytes, input.fileHash,
    input.sheetName, input.rows.length, input.warnings.length, dates[0] ?? null,
    dates.at(-1) ?? null, JSON.stringify(input.warnings.slice(0, 100)),
  ).run();

  try {
    let inserted = 0;
    let updated = 0;
    for (let offset = 0; offset < input.rows.length; offset += 80) {
      const chunk = input.rows.slice(offset, offset + 80);
      for (const row of chunk) {
        const existing = await db.prepare(
          `SELECT id FROM market_ranking_entries
          WHERE period_start=? AND period_end=? AND category=? AND scope=? AND ranking_dimension=? AND sku_code=?
          LIMIT 1`,
        ).bind(row.periodStart, row.periodEnd, row.category, row.scope, row.rankingDimension, row.skuCode).first<{ id: number }>();
        if (existing) updated += 1;
        else inserted += 1;
      }
      await db.batch(chunk.map((row) => db.prepare(
        `INSERT INTO market_ranking_entries (
          natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension,
          operation_mode, subcategory, rank, sku_code, product_name, brand, price_cents,
          source_brand, source_operation_mode, source_subcategory,
          price_low_cents, price_high_cents, price_estimated, gmv_cents, quantity, page_views,
          visitors, conversion_bps, cart_customers, search_clicks, image_url, product_url,
          raw_json, last_import_batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(period_start, period_end, category, scope, ranking_dimension, sku_code) DO UPDATE SET
          natural_key = excluded.natural_key,
          source_row_number = excluded.source_row_number,
          category = excluded.category,
          scope = excluded.scope,
          ranking_dimension = excluded.ranking_dimension,
          operation_mode = excluded.operation_mode,
          subcategory = excluded.subcategory,
          rank = excluded.rank,
          product_name = excluded.product_name,
          brand = excluded.brand,
          source_brand = excluded.source_brand,
          source_operation_mode = excluded.source_operation_mode,
          source_subcategory = excluded.source_subcategory,
          price_cents = excluded.price_cents,
          price_low_cents = excluded.price_low_cents,
          price_high_cents = excluded.price_high_cents,
          price_estimated = excluded.price_estimated,
          gmv_cents = excluded.gmv_cents,
          quantity = excluded.quantity,
          page_views = excluded.page_views,
          visitors = excluded.visitors,
          conversion_bps = excluded.conversion_bps,
          cart_customers = excluded.cart_customers,
          search_clicks = excluded.search_clicks,
          image_url = excluded.image_url,
          product_url = excluded.product_url,
          raw_json = excluded.raw_json,
          last_import_batch_id = excluded.last_import_batch_id,
          updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        row.naturalKey, row.sourceRowNumber, row.periodStart, row.periodEnd, row.category,
        row.scope, row.rankingDimension, row.operationMode, row.subcategory, row.rank,
        row.skuCode, row.productName, row.brand, row.priceCents,
        row.brand, row.operationMode, row.subcategory, row.priceLowCents,
        row.priceHighCents, row.priceEstimated ? 1 : 0, row.gmvCents, row.quantity, row.pageViews, row.visitors, row.conversionBps,
        row.cartCustomers, row.searchClicks, row.imageUrl, row.productUrl,
        JSON.stringify(row.raw), input.batchId,
      )));
      await db.batch(chunk.map((row) => db.prepare(
        `INSERT INTO market_price_snapshots (
          id, category, scope, sku_code, ranking_dimension, month, source_price_cents,
          average_transaction_price_cents, price_low_cents, price_high_cents,
          image_content_sha256, image_url, confirmation_status, source_import_batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT content_sha256 FROM market_image_cache WHERE source_url=? AND status='ready' LIMIT 1), ''), ?, ?, ?)
        ON CONFLICT(category, scope, sku_code, ranking_dimension, month) DO UPDATE SET
          source_price_cents = excluded.source_price_cents,
          average_transaction_price_cents = excluded.average_transaction_price_cents,
          price_low_cents = excluded.price_low_cents,
          price_high_cents = excluded.price_high_cents,
          image_content_sha256 = CASE WHEN excluded.image_content_sha256 <> '' THEN excluded.image_content_sha256 ELSE market_price_snapshots.image_content_sha256 END,
          image_url = CASE WHEN excluded.image_url <> '' THEN excluded.image_url ELSE market_price_snapshots.image_url END,
          confirmation_status = CASE
            WHEN market_price_snapshots.confirmed_market_price_cents IS NOT NULL THEN market_price_snapshots.confirmation_status
            WHEN excluded.source_price_cents IS NOT NULL THEN 'source_table'
            ELSE 'missing'
          END,
          source_import_batch_id = excluded.source_import_batch_id,
          updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        `market-price-import-${crypto.randomUUID()}`,
        row.category,
        row.scope,
        row.skuCode,
        row.rankingDimension,
        monthKey(row.periodEnd),
        row.priceCents,
        row.quantity > 0 ? Math.round(row.gmvCents / row.quantity) : null,
        row.priceLowCents,
        row.priceHighCents,
        row.imageUrl,
        row.imageUrl,
        row.priceCents === null ? "missing" : "source_table",
        input.batchId,
      )));
    }

    await db.prepare(
      `UPDATE market_import_batches SET status = 'completed', inserted_count = ?, updated_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(inserted, updated, input.batchId).run();
    const row = await db.prepare(`SELECT ${marketBatchColumns} FROM market_import_batches WHERE id = ? LIMIT 1`)
      .bind(input.batchId).first<BatchRow>();
    if (!row) throw new Error("market import batch was not persisted");
    return mapMarketBatch(row);
  } catch (error) {
    await db.prepare(
      "UPDATE market_import_batches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(input.batchId).run().catch(() => undefined);
    throw error;
  }
}
