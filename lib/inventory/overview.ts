import {
  findLatestInventoryImportBatch,
  listReplenishmentPlans,
  type InventoryDatabase,
  type ReplenishmentPlanItem,
} from "@/lib/inventory/database";
import { readOperatingSettings } from "@/lib/settings/service";

export type InventoryHealthStatus =
  | "urgent"
  | "replenish"
  | "healthy"
  | "slow"
  | "stagnant"
  | "no_sales";

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
  warehouses?: string[];
  warehouseTypes?: InventoryOverviewItem["warehouseType"][];
  statuses?: InventoryHealthStatus[];
  limit?: number;
};

type StockRow = {
  product_code: string;
  product_name: string;
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
};

type SalesRow = {
  product_code: string;
  product_name: string;
  warehouse: string;
  net_quantity: number;
  absolute_quantity: number;
  absolute_cost_cents: number;
};

type InventoryThresholdSettings = {
  targetDays: number;
  criticalDays: number;
  replenishDays: number;
  slowDays: number;
  stagnantDays: number;
  salesWindowDays: number;
};

const DEFAULT_SETTINGS: Readonly<InventoryThresholdSettings> = Object.freeze({
  targetDays: 30,
  criticalDays: 7,
  replenishDays: 30,
  slowDays: 45,
  stagnantDays: 90,
  salesWindowDays: 30,
});

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function dayDifference(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function planKey(productCode: string, warehouse: string) {
  return `${warehouse}\u001f${productCode}`;
}

function normalizedWarehouseKey(warehouse: string) {
  return warehouse
    .trim()
    .toLowerCase()
    .replace(/[\s（）()·._-]+/g, "")
    .replace(/(?:配送中心|仓库|库房|仓)$/u, "");
}

function demandKey(productCode: string, warehouse: string) {
  return `${normalizedWarehouseKey(warehouse)}\u001f${productCode.trim()}`;
}

function statusFor(input: {
  available: number;
  dailySales: number | null;
  coverageDays: number | null;
  inventoryAgeDays: number | null;
}, settings: Readonly<InventoryThresholdSettings> = DEFAULT_SETTINGS) {
  if (input.dailySales === null) {
    return {
      status: "no_sales" as const,
      label: "未匹配销量",
      reason: "近 30 日未匹配到同货品、同仓库的销售明细，暂不生成补货量",
    };
  }
  if (input.dailySales <= 0) {
    if (input.available > 0 && (input.inventoryAgeDays ?? 0) >= settings.stagnantDays) {
      return { status: "stagnant" as const, label: "呆滞风险", reason: `库龄已达到 ${input.inventoryAgeDays} 天且近 30 日无有效销量` };
    }
    return {
      status: "no_sales" as const,
      label: "无销量数据",
      reason: input.available > 0 ? "近 30 日无有效销量，暂不生成补货量" : "暂无库存且近 30 日无有效销量",
    };
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

function normalizeWarehouseType(value: string): InventoryOverviewItem["warehouseType"] {
  return value === "owned" || value === "jd_rdc" ? value : "other";
}

function planSummary(plans: ReplenishmentPlanItem[], currentBatchId: string | null) {
  return plans.reduce(
    (summary, plan) => {
      if (plan.status === "draft") summary.draftCount += 1;
      if (plan.status === "confirmed") summary.confirmedCount += 1;
      if (plan.status === "completed") summary.completedCount += 1;
      if (
        plan.status === "draft"
        || plan.status === "confirmed"
        || (plan.status === "completed" && plan.sourceBatchId === currentBatchId)
      ) summary.activeQuantity += plan.plannedQuantity;
      return summary;
    },
    { draftCount: 0, confirmedCount: 0, completedCount: 0, activeQuantity: 0 },
  );
}

export async function getInventoryOverview(db: InventoryDatabase, options: InventoryOverviewOptions = {}) {
  const [latestBatch, salesBounds, plans, persistedSettings] = await Promise.all([
    findLatestInventoryImportBatch(db),
    db
      .prepare("SELECT MAX(substr(ship_time, 1, 10)) AS end_date FROM sales_order_lines WHERE TRIM(warehouse) <> '刷刷仓'")
      .first<{ end_date: string | null }>(),
    listReplenishmentPlans(db),
    readOperatingSettings(db),
  ]);
  const settings = {
    targetDays: persistedSettings.targetDays,
    criticalDays: persistedSettings.criticalDays,
    replenishDays: persistedSettings.targetDays,
    slowDays: persistedSettings.slowDays,
    stagnantDays: persistedSettings.stagnantDays,
    salesWindowDays: DEFAULT_SETTINGS.salesWindowDays,
  };
  const salesEndDate = salesBounds?.end_date ?? null;
  const salesStartDate = salesEndDate ? addDays(salesEndDate, -(settings.salesWindowDays - 1)) : null;

  if (!latestBatch) {
    return {
      hasInventory: false,
      sync: {
        latestInventoryBatchId: null,
        inventoryAsOf: null,
        inventorySyncedAt: null,
        salesThrough: salesEndDate,
        salesWindowStart: salesStartDate,
        latestInventoryFile: null,
        inventoryStale: false,
      },
      settings,
      metrics: {
        skuWarehouseCount: 0,
        totalAvailableQuantity: 0,
        totalStockValueCents: 0,
        costCoverageRate: 0,
        salesDemandMatchRate: 0,
        averageCoverageDays: null,
        urgentCount: 0,
        replenishCount: 0,
        slowMovingValueCents: 0,
        noSalesCount: 0,
        recommendationCount: 0,
      },
      health: { urgent: 0, replenish: 0, healthy: 0, slow: 0, stagnant: 0, noSales: 0 },
      sources: [
        { key: "warehouse_stock", label: "吉客云分仓库存", status: "missing", asOfDate: null },
        { key: "sales_demand", label: "近 30 日销售需求", status: salesEndDate ? "ready" : "missing", asOfDate: salesEndDate },
        { key: "jd_rdc", label: "京东 RDC / DC", status: "missing", asOfDate: null },
      ],
      filters: { warehouses: [], statuses: [] },
      pagination: { total: 0, limit: Math.max(1, Math.min(300, Math.trunc(options.limit ?? 300))), truncated: false },
      recommendations: [] as InventoryOverviewItem[],
      items: [] as InventoryOverviewItem[],
      plans,
      planSummary: planSummary(plans, null),
    };
  }

  const stockPromise = db
    .prepare(
      `SELECT
        product_code,
        MAX(NULLIF(product_name, '')) AS product_name,
        MAX(NULLIF(specification, '')) AS specification,
        MAX(NULLIF(category, '')) AS category,
        warehouse,
        warehouse_type,
        SUM(on_hand_quantity) AS on_hand_quantity,
        SUM(available_quantity) AS available_quantity,
        SUM(locked_quantity) AS locked_quantity,
        SUM(in_transit_quantity) AS in_transit_quantity,
        SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END) AS imported_stock_value_cents,
        SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) ELSE 0 END) AS priced_available_quantity,
        MAX(inventory_age_days) AS inventory_age_days
       FROM inventory_stock_lines
       WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
       GROUP BY product_code, warehouse, warehouse_type
       ORDER BY product_code, warehouse`,
    )
    .bind(latestBatch.id)
    .all<StockRow>();

  const salesPromise = salesStartDate && salesEndDate
    ? db
      .prepare(
        `SELECT
          product_code,
          MAX(NULLIF(product_name, '')) AS product_name,
          warehouse,
          COALESCE(SUM(CASE
            WHEN product_code <> 'ERP_PRICE_ADJUSTMENT'
             AND TRIM(product_name) <> '补差价专用'
            THEN quantity ELSE 0 END), 0) AS net_quantity,
          COALESCE(SUM(ABS(quantity)), 0) AS absolute_quantity,
          COALESCE(SUM(ABS(cost_amount_cents)), 0) AS absolute_cost_cents
         FROM sales_order_lines
         WHERE ship_time >= ? AND ship_time < ?
           AND TRIM(warehouse) <> '刷刷仓'
         GROUP BY product_code, warehouse`,
      )
      .bind(`${salesStartDate} 00:00:00`, `${addDays(salesEndDate, 1)} 00:00:00`)
      .all<SalesRow>()
    : Promise.resolve({ results: [] as SalesRow[] });

  const [stockResult, salesResult] = await Promise.all([stockPromise, salesPromise]);
  const salesByKey = new Map<string, SalesRow>();
  for (const row of salesResult.results) {
    const key = demandKey(row.product_code, row.warehouse);
    const existing = salesByKey.get(key);
    if (!existing) {
      salesByKey.set(key, row);
      continue;
    }
    existing.net_quantity = Number(existing.net_quantity) + Number(row.net_quantity);
    existing.absolute_quantity = Number(existing.absolute_quantity) + Number(row.absolute_quantity);
    existing.absolute_cost_cents = Number(existing.absolute_cost_cents) + Number(row.absolute_cost_cents);
    if (!existing.product_name && row.product_name) existing.product_name = row.product_name;
  }
  const plansByKey = new Map<string, ReplenishmentPlanItem[]>();
  for (const plan of plans) {
    const pendingCurrentSnapshot = plan.status === "completed" && plan.sourceBatchId === latestBatch.id;
    if (plan.status !== "draft" && plan.status !== "confirmed" && !pendingCurrentSnapshot) continue;
    const key = planKey(plan.productCode, plan.warehouse);
    const existing = plansByKey.get(key) ?? [];
    existing.push(plan);
    plansByKey.set(key, existing);
  }

  const items: InventoryOverviewItem[] = stockResult.results.map((stock) => {
    const key = planKey(stock.product_code, stock.warehouse);
    const sales = salesByKey.get(demandKey(stock.product_code, stock.warehouse));
    const available = Number(stock.available_quantity ?? 0);
    const sales30d = salesEndDate && sales ? Math.max(0, Number(sales.net_quantity ?? 0)) : null;
    const dailySales = sales30d === null ? null : sales30d / settings.salesWindowDays;
    const coverageDays = dailySales && dailySales > 0 ? Math.max(0, available) / dailySales : null;
    const activePlans = plansByKey.get(key) ?? [];
    const plannedInTransit = activePlans.reduce((sum, plan) => sum + plan.plannedQuantity, 0);
    const sourceInTransit = Number(stock.in_transit_quantity ?? 0);
    const inventoryAgeDays = stock.inventory_age_days === null ? null : Number(stock.inventory_age_days);
    const status = statusFor({ available, dailySales, coverageDays, inventoryAgeDays }, settings);
    const suggestedQuantity = dailySales === null || dailySales <= 0
      ? null
      : Math.max(0, Math.ceil(dailySales * settings.targetDays - available - sourceInTransit - plannedInTransit));
    const absoluteQuantity = Number(sales?.absolute_quantity ?? 0);
    const salesUnitCost = absoluteQuantity > 0 ? Number(sales?.absolute_cost_cents ?? 0) / absoluteQuantity : 0;
    const importedValue = Number(stock.imported_stock_value_cents ?? 0);
    const pricedQuantity = Number(stock.priced_available_quantity ?? 0);
    const missingPricedQuantity = Math.max(0, available) - Math.max(0, pricedQuantity);
    const fallbackValue = salesUnitCost > 0 ? Math.round(missingPricedQuantity * salesUnitCost) : 0;
    const stockValueCents = importedValue + fallbackValue;
    const unitCostCents = Math.max(0, available) > 0 ? Math.round(stockValueCents / Math.max(1, available)) : Math.round(salesUnitCost);

    return {
      key,
      productCode: stock.product_code,
      productName: stock.product_name || sales?.product_name || stock.product_code,
      specification: stock.specification || "",
      category: stock.category || "",
      warehouse: stock.warehouse,
      warehouseType: normalizeWarehouseType(stock.warehouse_type),
      onHandQuantity: Number(stock.on_hand_quantity ?? 0),
      availableQuantity: available,
      lockedQuantity: Number(stock.locked_quantity ?? 0),
      sourceInTransitQuantity: sourceInTransit,
      plannedInTransitQuantity: plannedInTransit,
      totalInTransitQuantity: sourceInTransit + plannedInTransit,
      unitCostCents,
      inventoryAgeDays,
      stockValueCents: stockValueCents > 0 || available <= 0 ? stockValueCents : null,
      sales30d,
      averageDailySales: dailySales,
      coverageDays,
      suggestedQuantity,
      status: status.status,
      statusLabel: status.label,
      reason: status.reason,
      inDraftPlan: activePlans.some((plan) => plan.status === "draft"),
    };
  });

  const priority: Record<InventoryHealthStatus, number> = {
    urgent: 0,
    replenish: 1,
    healthy: 2,
    slow: 3,
    stagnant: 4,
    no_sales: 5,
  };
  items.sort((left, right) => priority[left.status] - priority[right.status]
    || (left.coverageDays ?? Infinity) - (right.coverageDays ?? Infinity)
    || left.productCode.localeCompare(right.productCode, "zh-CN"));

  const positiveAvailable = items.reduce((sum, item) => sum + Math.max(0, item.availableQuantity), 0);
  const pricedAvailable = items.reduce(
    (sum, item) => sum + (item.stockValueCents === null ? 0 : Math.max(0, item.availableQuantity)),
    0,
  );
  const totalDailySales = items.reduce((sum, item) => sum + Math.max(0, item.averageDailySales ?? 0), 0);
  const totalAvailableForDemand = items.reduce(
    (sum, item) => sum + ((item.averageDailySales ?? 0) > 0 ? Math.max(0, item.availableQuantity) : 0),
    0,
  );
  const health = {
    urgent: items.filter((item) => item.status === "urgent").length,
    replenish: items.filter((item) => item.status === "replenish").length,
    healthy: items.filter((item) => item.status === "healthy").length,
    slow: items.filter((item) => item.status === "slow").length,
    stagnant: items.filter((item) => item.status === "stagnant").length,
    noSales: items.filter((item) => item.status === "no_sales").length,
  };
  const hasJdRdc = items.some((item) => item.warehouseType === "jd_rdc");
  const today = shanghaiToday();
  const inventoryStale = dayDifference(latestBatch.snapshotDate, today) > 3;
  const normalized = (values: string[] | undefined, max = 50) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, max);
  const queryKeywords = normalized(options.query?.split(/[\s,，;；]+/) ?? [], 100).map((value) => value.toLowerCase());
  const warehouses = new Set(normalized(options.warehouses));
  const warehouseTypes = new Set(normalized(options.warehouseTypes) as InventoryOverviewItem["warehouseType"][]);
  const statuses = new Set(normalized(options.statuses) as InventoryHealthStatus[]);
  const filteredItems = items.filter((item) => {
    const searchable = `${item.productCode}\n${item.productName}\n${item.specification}\n${item.category}\n${item.warehouse}`.toLowerCase();
    return (queryKeywords.length === 0 || queryKeywords.some((keyword) => searchable.includes(keyword)))
      && (warehouses.size === 0 || warehouses.has(item.warehouse))
      && (warehouseTypes.size === 0 || warehouseTypes.has(item.warehouseType))
      && (statuses.size === 0 || statuses.has(item.status));
  });
  const limit = Math.max(1, Math.min(300, Math.trunc(options.limit ?? 300)));
  const recommendationItems = items
    .filter((item) => (item.suggestedQuantity ?? 0) > 0)
    .sort((left, right) => (right.suggestedQuantity ?? 0) - (left.suggestedQuantity ?? 0));
  const recommendations = recommendationItems.slice(0, 50);

  return {
    hasInventory: true,
    sync: {
      latestInventoryBatchId: latestBatch.id,
      inventoryAsOf: latestBatch.snapshotDate,
      inventorySyncedAt: latestBatch.completedAt,
      salesThrough: salesEndDate,
      salesWindowStart: salesStartDate,
      latestInventoryFile: latestBatch.fileName,
      inventoryStale,
    },
    settings,
    metrics: {
      skuWarehouseCount: items.length,
      totalAvailableQuantity: items.reduce((sum, item) => sum + item.availableQuantity, 0),
      totalStockValueCents: items.reduce((sum, item) => sum + (item.stockValueCents ?? 0), 0),
      costCoverageRate: positiveAvailable > 0 ? pricedAvailable / positiveAvailable : 0,
      salesDemandMatchRate: items.length > 0
        ? items.filter((item) => item.sales30d !== null).length / items.length
        : 0,
      averageCoverageDays: totalDailySales > 0 ? totalAvailableForDemand / totalDailySales : null,
      urgentCount: health.urgent,
      replenishCount: health.replenish,
      slowMovingValueCents: items.reduce(
        (sum, item) => sum + (["slow", "stagnant", "no_sales"].includes(item.status) ? item.stockValueCents ?? 0 : 0),
        0,
      ),
      noSalesCount: health.noSales,
      recommendationCount: recommendationItems.length,
    },
    health,
    sources: [
      { key: "warehouse_stock", label: "吉客云分仓库存", status: inventoryStale ? "stale" : "ready", asOfDate: latestBatch.snapshotDate },
      { key: "sales_demand", label: "近 30 日销售需求", status: salesEndDate ? "ready" : "missing", asOfDate: salesEndDate },
      { key: "jd_rdc", label: "京东 RDC / DC", status: hasJdRdc ? (inventoryStale ? "stale" : "ready") : "missing", asOfDate: hasJdRdc ? latestBatch.snapshotDate : null },
    ],
    filters: {
      warehouses: [...new Set(items.map((item) => item.warehouse))].sort((left, right) => left.localeCompare(right, "zh-CN")),
      statuses: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"],
    },
    pagination: { total: filteredItems.length, limit, truncated: filteredItems.length > limit },
    recommendations,
    items: filteredItems.slice(0, limit),
    plans,
    planSummary: planSummary(plans, latestBatch.id),
  };
}
