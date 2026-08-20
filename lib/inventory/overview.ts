import {
  findLatestInventoryImportBatch,
  getReplenishmentPlanSummary,
  queryReplenishmentPlans,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import {
  calculateInventoryCostValuation,
  normalizeInventoryPagination,
} from "@/lib/inventory/query-contract";
import { resolveInventorySalesPeriod } from "@/lib/inventory/sales-period";
import { readOperatingSettings } from "@/lib/settings/service";

export type InventoryHealthStatus = "urgent" | "replenish" | "healthy" | "slow" | "stagnant" | "no_sales";

export type InventoryOverviewItem = {
  key: string;
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  warehouse: string;
  warehouseType: "owned" | "jd_rdc" | "other";
  onHandQuantity: number;
  availableQuantity: number;
  lockedQuantity: number;
  sourceInTransitQuantity: number;
  plannedInTransitQuantity: number;
  totalInTransitQuantity: number;
  unitCostCents: number;
  inventoryAgeDays: number | null;
  stockValueCents: number | null;
  knownStockValueCents: number;
  costCoverageRate: number;
  sales30d: number | null;
  averageDailySales: number | null;
  coverageDays: number | null;
  suggestedQuantity: number | null;
  status: InventoryHealthStatus;
  statusLabel: string;
  reason: string;
  inDraftPlan: boolean;
};

export type InventoryOverviewOptions = {
  query?: string;
  startDate?: string;
  endDate?: string;
  warehouses?: string[];
  categories?: string[];
  warehouseTypes?: InventoryOverviewItem["warehouseType"][];
  statuses?: InventoryHealthStatus[];
  page?: number;
  pageSize?: number;
  exactKey?: string;
  planPage?: number;
  planPageSize?: number;
  planStatus?: "draft" | "confirmed" | "completed" | "cancelled";
  includeCancelledPlans?: boolean;
};

type InventoryThresholdSettings = {
  targetDays: number;
  criticalDays: number;
  replenishDays: number;
  slowDays: number;
  stagnantDays: number;
  salesWindowDays: number;
};

type OverviewRow = {
  product_code: string;
  product_name: string;
  resolved_product_name: string;
  specification: string;
  category: string;
  warehouse: string;
  warehouse_type: string;
  on_hand_quantity: number;
  available_quantity: number;
  locked_quantity: number;
  in_transit_quantity: number;
  imported_stock_value_cents: number;
  priced_available_quantity: number;
  inventory_age_days: number | null;
  sales_quantity: number | null;
  absolute_quantity: number;
  absolute_cost_cents: number;
  fallback_unit_cost_cents: number;
  planned_in_transit_quantity: number;
  in_draft_plan: number;
  status: InventoryHealthStatus;
  suggested_quantity: number | null;
};

type OverviewMetricsRow = {
  total: number;
  total_available_quantity: number;
  known_stock_value_cents: number;
  positive_available_quantity: number;
  covered_quantity: number;
  matched_count: number;
  total_daily_sales: number;
  demand_available_quantity: number;
  urgent_count: number;
  replenish_count: number;
  healthy_count: number;
  slow_count: number;
  stagnant_count: number;
  no_sales_count: number;
  slow_moving_value_cents: number;
  recommendation_count: number;
  has_jd_rdc: number;
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDifference(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function normalizeWarehouseType(value: string): InventoryOverviewItem["warehouseType"] {
  return value === "owned" || value === "jd_rdc" ? value : "other";
}

function statusFor(input: {
  available: number;
  dailySales: number | null;
  coverageDays: number | null;
  inventoryAgeDays: number | null;
}, settings: Readonly<InventoryThresholdSettings>) {
  if (input.dailySales === null) {
    return { status: "no_sales" as const, label: "未匹配销量", reason: `所选 ${settings.salesWindowDays} 日周期未匹配到同货品、同仓库的销售明细，暂不生成补货量` };
  }
  if (input.dailySales <= 0) {
    if (input.available > 0 && (input.inventoryAgeDays ?? 0) >= settings.stagnantDays) {
      return { status: "stagnant" as const, label: "呆滞风险", reason: `库龄已达到 ${input.inventoryAgeDays} 天且所选 ${settings.salesWindowDays} 日周期无有效销量` };
    }
    return { status: "no_sales" as const, label: "无销量数据", reason: input.available > 0 ? `所选 ${settings.salesWindowDays} 日周期无有效销量，暂不生成补货量` : `暂无库存且所选 ${settings.salesWindowDays} 日周期无有效销量` };
  }
  if (input.available <= 0 || (input.coverageDays ?? Infinity) <= settings.criticalDays) {
    return { status: "urgent" as const, label: input.available <= 0 ? "库存告急" : "紧急补货", reason: `预计可售不超过 ${settings.criticalDays} 天` };
  }
  if ((input.coverageDays ?? Infinity) < settings.replenishDays) {
    return { status: "replenish" as const, label: "建议补货", reason: `预计可售低于 ${settings.replenishDays} 天` };
  }
  if ((input.coverageDays ?? 0) >= settings.stagnantDays) {
    return { status: "stagnant" as const, label: "呆滞风险", reason: `预计可售达到 ${settings.stagnantDays} 天以上` };
  }
  if ((input.coverageDays ?? 0) >= settings.slowDays) {
    return { status: "slow" as const, label: "低周转", reason: `预计可售达到 ${settings.slowDays} 天以上` };
  }
  return { status: "healthy" as const, label: "库存健康", reason: "库存覆盖处于目标区间" };
}

function normalizedWarehouseSql(column: string) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(${column})), '配送中心', ''), '仓库', ''), '库房', ''), '仓', ''), ' ', ''), '（', ''), '）', ''), '(', ''), ')', ''), '-', '')`;
}

function uniqueStrings(values: readonly string[] | undefined, max = 20) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, max);
}

function buildInventoryCte(input: {
  batchId: string;
  salesStartDate: string | null;
  salesEndDate: string | null;
  salesWindowDays: number;
  settings: InventoryThresholdSettings;
}) {
  const hasSalesRange = Boolean(input.salesStartDate && input.salesEndDate);
  const rangeStart = hasSalesRange ? `${input.salesStartDate} 00:00:00` : "";
  const rangeEnd = hasSalesRange ? `${addDays(input.salesEndDate!, 1)} 00:00:00` : "";
  const warehouseExpression = normalizedWarehouseSql("warehouse");
  const sql = `WITH stock AS (
    SELECT
      product_code,
      MAX(NULLIF(product_name, '')) AS product_name,
      MAX(NULLIF(specification, '')) AS specification,
      MAX(NULLIF(category, '')) AS category,
      warehouse,
      CASE
        WHEN MAX(CASE WHEN warehouse_type = 'jd_rdc' THEN 1 ELSE 0 END) = 1 THEN 'jd_rdc'
        WHEN MAX(CASE WHEN warehouse_type = 'owned' THEN 1 ELSE 0 END) = 1 THEN 'owned'
        ELSE 'other'
      END AS warehouse_type,
      SUM(on_hand_quantity) AS on_hand_quantity,
      SUM(available_quantity) AS available_quantity,
      SUM(locked_quantity) AS locked_quantity,
      SUM(in_transit_quantity) AS in_transit_quantity,
      SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END) AS imported_stock_value_cents,
      SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) ELSE 0 END) AS priced_available_quantity,
      MAX(inventory_age_days) AS inventory_age_days,
      ${normalizedWarehouseSql("warehouse")} AS warehouse_key
    FROM inventory_stock_lines
    WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
    GROUP BY product_code, warehouse
  ), sales AS (
    SELECT
      product_code,
      ${warehouseExpression} AS warehouse_key,
      MAX(NULLIF(product_name, '')) AS product_name,
      SUM(CASE WHEN product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END) AS sales_quantity,
      SUM(CASE WHEN product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN ABS(quantity) ELSE 0 END) AS absolute_quantity,
      SUM(CASE WHEN product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN ABS(cost_amount_cents) ELSE 0 END) AS absolute_cost_cents
    FROM sales_order_lines
    WHERE ? = 1 AND ship_time >= ? AND ship_time < ? AND TRIM(warehouse) <> '刷刷仓'
    GROUP BY product_code, ${warehouseExpression}
  ), active_plans AS (
    SELECT
      product_code,
      warehouse,
      COALESCE(SUM(planned_quantity), 0) AS planned_in_transit_quantity,
      MAX(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS in_draft_plan
    FROM replenishment_plan_items
    WHERE status IN ('draft', 'confirmed') OR (status = 'completed' AND source_batch_id = ?)
    GROUP BY product_code, warehouse
  ), base AS (
    SELECT
      st.*,
      COALESCE(NULLIF(st.product_name, ''), sa.product_name, st.product_code) AS resolved_product_name,
      sa.sales_quantity,
      COALESCE(sa.absolute_quantity, 0) AS absolute_quantity,
      COALESCE(sa.absolute_cost_cents, 0) AS absolute_cost_cents,
      CASE WHEN COALESCE(sa.absolute_quantity, 0) > 0 THEN sa.absolute_cost_cents * 1.0 / sa.absolute_quantity ELSE 0 END AS fallback_unit_cost_cents,
      COALESCE(ap.planned_in_transit_quantity, 0) AS planned_in_transit_quantity,
      COALESCE(ap.in_draft_plan, 0) AS in_draft_plan
    FROM stock st
    LEFT JOIN sales sa ON sa.product_code = st.product_code AND sa.warehouse_key = st.warehouse_key
    LEFT JOIN active_plans ap ON ap.product_code = st.product_code AND ap.warehouse = st.warehouse
  ), valued AS (
    SELECT
      *,
      imported_stock_value_cents
        + CASE WHEN fallback_unit_cost_cents > 0
          THEN MAX(0, MAX(available_quantity, 0) - MAX(priced_available_quantity, 0)) * fallback_unit_cost_cents
          ELSE 0 END AS known_stock_value_cents,
      MIN(MAX(available_quantity, 0), MAX(priced_available_quantity, 0)
        + CASE WHEN fallback_unit_cost_cents > 0 THEN MAX(0, MAX(available_quantity, 0) - MAX(priced_available_quantity, 0)) ELSE 0 END
      ) AS cost_covered_quantity,
      CASE WHEN sales_quantity IS NOT NULL AND sales_quantity > 0
        THEN MAX(available_quantity, 0) * ? * 1.0 / sales_quantity ELSE NULL END AS coverage_days
    FROM base
  ), classified AS (
    SELECT
      *,
      CASE
        WHEN sales_quantity IS NULL THEN 'no_sales'
        WHEN sales_quantity <= 0 AND available_quantity > 0 AND COALESCE(inventory_age_days, 0) >= ? THEN 'stagnant'
        WHEN sales_quantity <= 0 THEN 'no_sales'
        WHEN available_quantity <= 0 OR coverage_days <= ? THEN 'urgent'
        WHEN coverage_days < ? THEN 'replenish'
        WHEN coverage_days >= ? THEN 'stagnant'
        WHEN coverage_days >= ? THEN 'slow'
        ELSE 'healthy'
      END AS status,
      CASE WHEN sales_quantity IS NULL OR sales_quantity <= 0 THEN NULL ELSE
        MAX(0, CAST((sales_quantity * ? * 1.0 / ? - available_quantity - in_transit_quantity - planned_in_transit_quantity) + 0.999999 AS INTEGER))
      END AS suggested_quantity
    FROM valued
  )`;
  return {
    sql,
    values: [
      input.batchId,
      hasSalesRange ? 1 : 0,
      rangeStart,
      rangeEnd,
      input.batchId,
      input.salesWindowDays,
      input.settings.stagnantDays,
      input.settings.criticalDays,
      input.settings.replenishDays,
      input.settings.stagnantDays,
      input.settings.slowDays,
      input.settings.targetDays,
      input.salesWindowDays,
    ],
  };
}

function buildFilter(options: InventoryOverviewOptions) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const query = options.query?.trim().slice(0, 100);
  if (query) {
    const keywords = uniqueStrings(query.split(/[\s,，;；]+/), 8).map((value) => `%${value.toLowerCase()}%`);
    clauses.push(`(${keywords.map(() => "(LOWER(product_code) LIKE ? OR LOWER(resolved_product_name) LIKE ? OR LOWER(specification) LIKE ? OR LOWER(category) LIKE ? OR LOWER(warehouse) LIKE ?)").join(" OR ")})`);
    for (const keyword of keywords) values.push(keyword, keyword, keyword, keyword, keyword);
  }
  const warehouses = uniqueStrings(options.warehouses, 10);
  if (warehouses.length > 0) {
    clauses.push(`warehouse IN (${warehouses.map(() => "?").join(", ")})`);
    values.push(...warehouses);
  }
  const warehouseTypes = uniqueStrings(options.warehouseTypes)
    .filter((value) => ["owned", "jd_rdc", "other"].includes(value));
  if (warehouseTypes.length > 0) {
    clauses.push(`warehouse_type IN (${warehouseTypes.map(() => "?").join(", ")})`);
    values.push(...warehouseTypes);
  }
  const categories = uniqueStrings(options.categories, 10);
  if (categories.length > 0) {
    clauses.push(`category IN (${categories.map(() => "?").join(", ")})`);
    values.push(...categories);
  }
  const statuses = uniqueStrings(options.statuses)
    .filter((value) => ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"].includes(value));
  if (statuses.length > 0) {
    clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    values.push(...statuses);
  }
  if (options.exactKey) {
    clauses.push("warehouse || char(31) || product_code = ?");
    values.push(options.exactKey);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

function mapItem(row: OverviewRow, settings: InventoryThresholdSettings): InventoryOverviewItem {
  const available = Number(row.available_quantity ?? 0);
  const salesQuantity = row.sales_quantity === null ? null : Math.max(0, Number(row.sales_quantity));
  const dailySales = salesQuantity === null ? null : salesQuantity / settings.salesWindowDays;
  const coverageDays = dailySales && dailySales > 0 ? Math.max(0, available) / dailySales : null;
  const inventoryAgeDays = row.inventory_age_days === null ? null : Number(row.inventory_age_days);
  const health = statusFor({ available, dailySales, coverageDays, inventoryAgeDays }, settings);
  const valuation = calculateInventoryCostValuation({
    availableQuantity: available,
    importedValueCents: Number(row.imported_stock_value_cents ?? 0),
    importedPricedQuantity: Number(row.priced_available_quantity ?? 0),
    fallbackUnitCostCents: Number(row.fallback_unit_cost_cents ?? 0),
  });
  const sourceInTransit = Number(row.in_transit_quantity ?? 0);
  const plannedInTransit = Number(row.planned_in_transit_quantity ?? 0);
  return {
    key: `${row.warehouse}\u001f${row.product_code}`,
    productCode: row.product_code,
    productName: row.resolved_product_name || row.product_name || row.product_code,
    specification: row.specification || "",
    category: row.category || "",
    warehouse: row.warehouse,
    warehouseType: normalizeWarehouseType(row.warehouse_type),
    onHandQuantity: Number(row.on_hand_quantity ?? 0),
    availableQuantity: available,
    lockedQuantity: Number(row.locked_quantity ?? 0),
    sourceInTransitQuantity: sourceInTransit,
    plannedInTransitQuantity: plannedInTransit,
    totalInTransitQuantity: sourceInTransit + plannedInTransit,
    unitCostCents: valuation.unitCostCents,
    inventoryAgeDays,
    stockValueCents: valuation.completeStockValueCents,
    knownStockValueCents: valuation.knownStockValueCents,
    costCoverageRate: valuation.coverageRate,
    sales30d: salesQuantity,
    averageDailySales: dailySales,
    coverageDays,
    suggestedQuantity: row.suggested_quantity === null ? null : Number(row.suggested_quantity),
    status: health.status,
    statusLabel: health.label,
    reason: health.reason,
    inDraftPlan: Number(row.in_draft_plan ?? 0) > 0,
  };
}

export async function getInventoryOverview(db: InventoryDatabase, options: InventoryOverviewOptions = {}) {
  const pagination = normalizeInventoryPagination(options);
  const [latestBatch, salesBounds, persistedSettings] = await Promise.all([
    findLatestInventoryImportBatch(db),
    db.prepare(
      `SELECT MIN(substr(ship_time, 1, 10)) AS start_date, MAX(substr(ship_time, 1, 10)) AS end_date
       FROM sales_order_lines
       WHERE TRIM(warehouse) <> '刷刷仓'
         AND product_code <> 'ERP_PRICE_ADJUSTMENT'
         AND TRIM(product_name) <> '补差价专用'`,
    ).first<{ start_date: string | null; end_date: string | null }>(),
    readOperatingSettings(db),
  ]);
  const { salesStartDate, salesEndDate, salesWindowDays } = resolveInventorySalesPeriod(options, {
    startDate: salesBounds?.start_date ?? null,
    endDate: salesBounds?.end_date ?? null,
  });
  const settings: InventoryThresholdSettings = {
    targetDays: persistedSettings.targetDays,
    criticalDays: persistedSettings.criticalDays,
    replenishDays: persistedSettings.targetDays,
    slowDays: persistedSettings.slowDays,
    stagnantDays: persistedSettings.stagnantDays,
    salesWindowDays,
  };
  const [planPage, planSummary] = await Promise.all([
    queryReplenishmentPlans(db, {
      page: options.planPage,
      pageSize: options.planPageSize ?? 50,
      status: options.planStatus,
      includeCancelled: options.includeCancelledPlans,
    }),
    getReplenishmentPlanSummary(db, latestBatch?.id ?? null),
  ]);

  if (!latestBatch) {
    return {
      hasInventory: false,
      sync: { latestInventoryBatchId: null, inventoryAsOf: null, inventorySyncedAt: null, salesThrough: salesEndDate, salesWindowStart: salesStartDate, latestInventoryFile: null, inventoryStale: false },
      settings,
      metrics: { skuWarehouseCount: 0, totalAvailableQuantity: 0, totalStockValueCents: 0, knownStockValueCents: 0, stockValueComplete: true, costCoverageRate: 0, salesDemandMatchRate: 0, averageCoverageDays: null, urgentCount: 0, replenishCount: 0, slowMovingValueCents: 0, noSalesCount: 0, recommendationCount: 0 },
      health: { urgent: 0, replenish: 0, healthy: 0, slow: 0, stagnant: 0, noSales: 0 },
      sources: [
        { key: "warehouse_stock", label: "吉客云分仓库存", status: "missing", asOfDate: null },
        { key: "sales_demand", label: `所选 ${settings.salesWindowDays} 日销售需求`, status: salesEndDate ? "ready" : "missing", asOfDate: salesEndDate },
        { key: "jd_rdc", label: "京东 RDC / DC", status: "missing", asOfDate: null },
      ],
      filters: { warehouses: [], statuses: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"] },
      pagination: { page: pagination.page, pageSize: pagination.pageSize, limit: pagination.pageSize, total: 0, returned: 0, totalPages: 0, truncated: false },
      recommendations: [] as InventoryOverviewItem[],
      items: [] as InventoryOverviewItem[],
      plans: planPage.items,
      plansPagination: planPage.pagination,
      planSummary,
    };
  }

  const cte = buildInventoryCte({ batchId: latestBatch.id, salesStartDate, salesEndDate, salesWindowDays, settings });
  const filter = buildFilter(options);
  const [metricsRow, pageResult, recommendationsResult, warehouseResult] = await Promise.all([
    db.prepare(`${cte.sql}, filtered AS (SELECT * FROM classified ${filter.sql})
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(available_quantity), 0) AS total_available_quantity,
        COALESCE(SUM(known_stock_value_cents), 0) AS known_stock_value_cents,
        COALESCE(SUM(MAX(available_quantity, 0)), 0) AS positive_available_quantity,
        COALESCE(SUM(cost_covered_quantity), 0) AS covered_quantity,
        COALESCE(SUM(CASE WHEN sales_quantity IS NOT NULL THEN 1 ELSE 0 END), 0) AS matched_count,
        COALESCE(SUM(CASE WHEN sales_quantity > 0 THEN sales_quantity * 1.0 / ? ELSE 0 END), 0) AS total_daily_sales,
        COALESCE(SUM(CASE WHEN sales_quantity > 0 THEN MAX(available_quantity, 0) ELSE 0 END), 0) AS demand_available_quantity,
        COALESCE(SUM(CASE WHEN status = 'urgent' THEN 1 ELSE 0 END), 0) AS urgent_count,
        COALESCE(SUM(CASE WHEN status = 'replenish' THEN 1 ELSE 0 END), 0) AS replenish_count,
        COALESCE(SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END), 0) AS healthy_count,
        COALESCE(SUM(CASE WHEN status = 'slow' THEN 1 ELSE 0 END), 0) AS slow_count,
        COALESCE(SUM(CASE WHEN status = 'stagnant' THEN 1 ELSE 0 END), 0) AS stagnant_count,
        COALESCE(SUM(CASE WHEN status = 'no_sales' THEN 1 ELSE 0 END), 0) AS no_sales_count,
        COALESCE(SUM(CASE WHEN status IN ('slow', 'stagnant', 'no_sales') THEN known_stock_value_cents ELSE 0 END), 0) AS slow_moving_value_cents,
        COALESCE(SUM(CASE WHEN suggested_quantity > 0 THEN 1 ELSE 0 END), 0) AS recommendation_count,
        COALESCE(MAX(CASE WHEN warehouse_type = 'jd_rdc' THEN 1 ELSE 0 END), 0) AS has_jd_rdc
      FROM filtered`).bind(...cte.values, ...filter.values, salesWindowDays).first<OverviewMetricsRow>(),
    db.prepare(`${cte.sql}, filtered AS (SELECT * FROM classified ${filter.sql})
      SELECT * FROM filtered
      ORDER BY CASE status WHEN 'urgent' THEN 0 WHEN 'replenish' THEN 1 WHEN 'healthy' THEN 2 WHEN 'slow' THEN 3 WHEN 'stagnant' THEN 4 ELSE 5 END,
        coverage_days ASC, product_code ASC, warehouse ASC
      LIMIT ? OFFSET ?`).bind(...cte.values, ...filter.values, pagination.pageSize, pagination.offset).all<OverviewRow>(),
    db.prepare(`${cte.sql}, filtered AS (SELECT * FROM classified ${filter.sql})
      SELECT * FROM filtered
      WHERE suggested_quantity > 0
      ORDER BY suggested_quantity DESC, product_code ASC, warehouse ASC
      LIMIT 50 OFFSET 0`).bind(...cte.values, ...filter.values).all<OverviewRow>(),
    db.prepare(`${cte.sql} SELECT DISTINCT warehouse FROM classified ORDER BY warehouse LIMIT 500`)
      .bind(...cte.values).all<{ warehouse: string }>(),
  ]);

  const metrics = metricsRow ?? {
    total: 0, total_available_quantity: 0, known_stock_value_cents: 0, positive_available_quantity: 0,
    covered_quantity: 0, matched_count: 0, total_daily_sales: 0, demand_available_quantity: 0,
    urgent_count: 0, replenish_count: 0, healthy_count: 0, slow_count: 0, stagnant_count: 0,
    no_sales_count: 0, slow_moving_value_cents: 0, recommendation_count: 0, has_jd_rdc: 0,
  };
  const total = Number(metrics.total ?? 0);
  const positiveAvailable = Number(metrics.positive_available_quantity ?? 0);
  const coveredQuantity = Number(metrics.covered_quantity ?? 0);
  const totalDailySales = Number(metrics.total_daily_sales ?? 0);
  const inventoryStale = dayDifference(latestBatch.snapshotDate, shanghaiToday()) > 3;
  const hasJdRdc = Number(metrics.has_jd_rdc ?? 0) > 0;
  return {
    hasInventory: true,
    sync: { latestInventoryBatchId: latestBatch.id, inventoryAsOf: latestBatch.snapshotDate, inventorySyncedAt: latestBatch.completedAt, salesThrough: salesEndDate, salesWindowStart: salesStartDate, latestInventoryFile: latestBatch.fileName, inventoryStale },
    settings,
    metrics: {
      skuWarehouseCount: total,
      totalAvailableQuantity: Number(metrics.total_available_quantity ?? 0),
      totalStockValueCents: Number(metrics.known_stock_value_cents ?? 0),
      knownStockValueCents: Number(metrics.known_stock_value_cents ?? 0),
      stockValueComplete: positiveAvailable <= 0 || coveredQuantity >= positiveAvailable,
      costCoverageRate: positiveAvailable > 0 ? coveredQuantity / positiveAvailable : 1,
      salesDemandMatchRate: total > 0 ? Number(metrics.matched_count ?? 0) / total : 0,
      averageCoverageDays: totalDailySales > 0 ? Number(metrics.demand_available_quantity ?? 0) / totalDailySales : null,
      urgentCount: Number(metrics.urgent_count ?? 0),
      replenishCount: Number(metrics.replenish_count ?? 0),
      slowMovingValueCents: Number(metrics.slow_moving_value_cents ?? 0),
      noSalesCount: Number(metrics.no_sales_count ?? 0),
      recommendationCount: Number(metrics.recommendation_count ?? 0),
    },
    health: {
      urgent: Number(metrics.urgent_count ?? 0), replenish: Number(metrics.replenish_count ?? 0), healthy: Number(metrics.healthy_count ?? 0),
      slow: Number(metrics.slow_count ?? 0), stagnant: Number(metrics.stagnant_count ?? 0), noSales: Number(metrics.no_sales_count ?? 0),
    },
    sources: [
      { key: "warehouse_stock", label: "吉客云分仓库存", status: inventoryStale ? "stale" : "ready", asOfDate: latestBatch.snapshotDate },
      { key: "sales_demand", label: `所选 ${settings.salesWindowDays} 日销售需求`, status: salesEndDate ? "ready" : "missing", asOfDate: salesEndDate },
      { key: "jd_rdc", label: "京东 RDC / DC", status: hasJdRdc ? (inventoryStale ? "stale" : "ready") : "missing", asOfDate: hasJdRdc ? latestBatch.snapshotDate : null },
    ],
    filters: { warehouses: warehouseResult.results.map((row) => row.warehouse), statuses: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"] },
    pagination: { page: pagination.page, pageSize: pagination.pageSize, limit: pagination.pageSize, total, returned: pageResult.results.length, totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize), truncated: pagination.offset + pageResult.results.length < total },
    recommendations: recommendationsResult.results.map((row) => mapItem(row, settings)),
    items: pageResult.results.map((row) => mapItem(row, settings)),
    plans: planPage.items,
    plansPagination: planPage.pagination,
    planSummary,
  };
}
