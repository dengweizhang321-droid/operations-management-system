import {
  findLatestInventoryImportBatch,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import { findLatestSalesImportBatch } from "@/lib/sales/database";

export type ProductSummaryItem = {
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  netQuantity: number;
  grossSalesCents: number;
  netSalesCents: number;
  costCents: number;
  feeCents: number;
  grossProfitCents: number;
  grossMarginRate: number | null;
  averageSalePriceCents: number | null;
  averageCostCents: number | null;
  observedFeeRate: number | null;
  availableQuantity: number | null;
  stockValueCents: number | null;
};

type SalesRow = {
  product_code: string;
  product_name: string | null;
  specification: string | null;
  category: string | null;
  net_quantity: number | null;
  gross_sales_cents: number | null;
  net_sales_cents: number | null;
  cost_cents: number | null;
  fee_cents: number | null;
  gross_profit_cents: number | null;
  absolute_quantity: number | null;
  absolute_cost_cents: number | null;
};

type StockRow = {
  product_code: string;
  available_quantity: number | null;
  stock_value_cents: number | null;
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function summaryMetrics(items: ProductSummaryItem[]) {
  const grossSalesCents = items.reduce((sum, item) => sum + item.grossSalesCents, 0);
  const netSalesCents = items.reduce((sum, item) => sum + item.netSalesCents, 0);
  const grossProfitCents = items.reduce((sum, item) => sum + item.grossProfitCents, 0);
  return {
    skuCount: items.length,
    grossSalesCents,
    netSalesCents,
    grossProfitCents,
    grossMarginRate: rate(grossProfitCents, netSalesCents),
    lossSkuCount: items.filter((item) => item.netSalesCents > 0 && item.grossProfitCents < 0).length,
    stockedSkuCount: items.filter((item) => (item.availableQuantity ?? 0) > 0).length,
  };
}

export async function getProductSummary(db: InventoryDatabase, days = 30) {
  const windowDays = Math.max(7, Math.min(365, Math.trunc(days)));
  const [salesBounds, latestSalesBatch, latestInventoryBatch] = await Promise.all([
    db.prepare("SELECT MAX(substr(sales_time, 1, 10)) AS end_date FROM sales_order_lines")
      .first<{ end_date: string | null }>(),
    findLatestSalesImportBatch(db),
    findLatestInventoryImportBatch(db),
  ]);
  const salesThrough = salesBounds?.end_date ?? null;
  const salesWindowStart = salesThrough ? addDays(salesThrough, -(windowDays - 1)) : null;

  if (!salesThrough || !salesWindowStart) {
    return {
      hasSales: false,
      sync: {
        salesThrough: null,
        salesWindowStart: null,
        inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
        latestSalesFile: latestSalesBatch?.fileName ?? null,
      },
      metrics: summaryMetrics([]),
      items: [] as ProductSummaryItem[],
    };
  }

  const salesPromise = db.prepare(
    `SELECT
      product_code,
      MAX(NULLIF(product_name, '')) AS product_name,
      MAX(NULLIF(specification, '')) AS specification,
      MAX(NULLIF(category, '')) AS category,
      COALESCE(SUM(quantity), 0) AS net_quantity,
      COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
      COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
      COALESCE(SUM(cost_amount_cents), 0) AS cost_cents,
      COALESCE(SUM(fee_allocation_cents), 0) AS fee_cents,
      COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(ABS(quantity)), 0) AS absolute_quantity,
      COALESCE(SUM(ABS(cost_amount_cents)), 0) AS absolute_cost_cents
    FROM sales_order_lines
    WHERE sales_time >= ? AND sales_time < ?
      AND product_code <> 'ERP_PRICE_ADJUSTMENT'
      AND TRIM(product_name) <> '补差价专用'
    GROUP BY product_code
    ORDER BY net_sales_cents DESC, product_code ASC`,
  ).bind(`${salesWindowStart} 00:00:00`, `${addDays(salesThrough, 1)} 00:00:00`).all<SalesRow>();

  const stockPromise = latestInventoryBatch
    ? db.prepare(
      `SELECT
        product_code,
        COALESCE(SUM(MAX(available_quantity, 0)), 0) AS available_quantity,
        COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END), 0) AS stock_value_cents
      FROM inventory_stock_lines
      WHERE batch_id = ?
      GROUP BY product_code`,
    ).bind(latestInventoryBatch.id).all<StockRow>()
    : Promise.resolve({ results: [] as StockRow[] });

  const [salesResult, stockResult] = await Promise.all([salesPromise, stockPromise]);
  const stockByProduct = new Map(stockResult.results.map((row) => [row.product_code, row]));
  const items = salesResult.results.map((row): ProductSummaryItem => {
    const netQuantity = Number(row.net_quantity ?? 0);
    const grossSalesCents = Number(row.gross_sales_cents ?? 0);
    const netSalesCents = Number(row.net_sales_cents ?? 0);
    const costCents = Number(row.cost_cents ?? 0);
    const feeCents = Number(row.fee_cents ?? 0);
    const grossProfitCents = Number(row.gross_profit_cents ?? 0);
    const absoluteQuantity = Number(row.absolute_quantity ?? 0);
    const absoluteCostCents = Number(row.absolute_cost_cents ?? 0);
    const stock = stockByProduct.get(row.product_code);
    return {
      productCode: row.product_code,
      productName: row.product_name || row.product_code,
      specification: row.specification || "",
      category: row.category || "未分类",
      netQuantity,
      grossSalesCents,
      netSalesCents,
      costCents,
      feeCents,
      grossProfitCents,
      grossMarginRate: rate(grossProfitCents, netSalesCents),
      averageSalePriceCents: rate(netSalesCents, netQuantity),
      averageCostCents: rate(absoluteCostCents, absoluteQuantity),
      observedFeeRate: rate(Math.abs(feeCents), grossSalesCents),
      availableQuantity: stock ? Number(stock.available_quantity ?? 0) : null,
      stockValueCents: stock ? Number(stock.stock_value_cents ?? 0) : null,
    };
  });

  return {
    hasSales: true,
    sync: {
      salesThrough,
      salesWindowStart,
      inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
      latestSalesFile: latestSalesBatch?.fileName ?? null,
    },
    metrics: summaryMetrics(items),
    items,
  };
}
