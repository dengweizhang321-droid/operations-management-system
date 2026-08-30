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
import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoSalesConsumerReader,
  type SalesConsumerReader,
  type SalesConsumerResponseMap,
} from "@/lib/django/sales-consumer-reader";
import { PublicApiError } from "@/lib/http/api-error";

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
  signal?: AbortSignal;
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

type InventoryStockAggregateRow = Omit<
  OverviewRow,
  | "resolved_product_name"
  | "sales_quantity"
  | "absolute_quantity"
  | "absolute_cost_cents"
  | "fallback_unit_cost_cents"
  | "planned_in_transit_quantity"
  | "in_draft_plan"
  | "status"
  | "suggested_quantity"
>;

type ActivePlanRow = {
  product_code: string;
  warehouse: string;
  planned_in_transit_quantity: number;
  in_draft_plan: number;
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

const INVENTORY_DEMAND_PRODUCT_CHUNK_SIZE = 500;
const INVENTORY_DEMAND_LIMIT = 10_000;
const MAX_INVENTORY_STOCK_GROUPS = 20_000;
const MAX_ACTIVE_PLAN_GROUPS = 20_000;

function salesConsumerUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 销售读取服务返回的数据不完整，请稍后重试。",
  );
}

function isIsoDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function normalizedWarehouseKey(value: string) {
  let normalized = value.trim().toLowerCase();
  for (const token of ["配送中心", "仓库", "库房", "仓", " ", "（", "）", "(", ")", "-"]) {
    normalized = normalized.split(token).join("");
  }
  return normalized;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertFiniteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw salesConsumerUnavailable();
}

function validateLatestBatch(value: SalesConsumerResponseMap["freshness"]["latestBatch"]) {
  if (value === null) return;
  if (!value || typeof value !== "object"
    || typeof value.id !== "string" || value.id.length === 0
    || typeof value.fileName !== "string" || value.fileName.length === 0
    || (value.completedAt !== null && typeof value.completedAt !== "string")
    || !Number.isSafeInteger(value.rowCount) || value.rowCount < 0) {
    throw salesConsumerUnavailable();
  }
}

function validateFreshness(data: SalesConsumerResponseMap["freshness"]) {
  if (!data || !isIsoDateOrNull(data.dataStartDate) || !isIsoDateOrNull(data.dataCutoffDate)) {
    throw salesConsumerUnavailable();
  }
  validateLatestBatch(data.latestBatch);
}

async function readInventoryDemand(
  reader: SalesConsumerReader,
  principal: AppPrincipal,
  input: {
    productCodes: string[];
    startDate: string | null;
    endDateExclusive: string | null;
    expectedRevision: string;
    signal?: AbortSignal;
  },
) {
  const rows = new Map<string, SalesConsumerResponseMap["inventory_demand"]["rows"][number]>();
  const chunks: string[][] = [];
  for (let offset = 0; offset < input.productCodes.length; offset += INVENTORY_DEMAND_PRODUCT_CHUNK_SIZE) {
    chunks.push(input.productCodes.slice(offset, offset + INVENTORY_DEMAND_PRODUCT_CHUNK_SIZE));
  }
  for (let offset = 0; offset < chunks.length; offset += 4) {
    const group = chunks.slice(offset, offset + 4);
    const results = await Promise.all(group.map((productCodes) => reader.read(principal, {
      operation: "inventory_demand",
      startDate: input.startDate,
      endDate: input.endDateExclusive,
      productCodes,
      limit: INVENTORY_DEMAND_LIMIT,
    }, { signal: input.signal })));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const requested = new Set(group[index]);
      if (!result || typeof result !== "object" || !result.data || typeof result.data !== "object"
        || result.revision !== input.expectedRevision
        || result.data.truncated !== false
        || !Array.isArray(result.data.rows)
        || !isIsoDateOrNull(result.data.dataStartDate)
        || !isIsoDateOrNull(result.data.dataCutoffDate)) {
        throw salesConsumerUnavailable();
      }
      for (const row of result.data.rows) {
        if (!row || typeof row.productCode !== "string" || !requested.has(row.productCode)
          || typeof row.warehouseKey !== "string" || typeof row.productName !== "string") {
          throw salesConsumerUnavailable();
        }
        assertFiniteNumber(row.salesQuantity);
        assertFiniteNumber(row.absoluteQuantity);
        assertFiniteNumber(row.absoluteCostCents);
        if (row.warehouseKey !== normalizedWarehouseKey(row.warehouseKey)
          || row.absoluteQuantity < 0 || row.absoluteCostCents < 0) {
          throw salesConsumerUnavailable();
        }
        const key = `${row.productCode}\u001f${row.warehouseKey}`;
        if (rows.has(key)) throw salesConsumerUnavailable();
        rows.set(key, row);
      }
    }
  }
  return rows;
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

function uniqueStrings(values: readonly string[] | undefined, max = 20) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, max);
}

async function loadInventoryStockRows(db: InventoryDatabase, batchId: string) {
  const result = await db.prepare(
    `SELECT
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
      MAX(inventory_age_days) AS inventory_age_days
     FROM inventory_stock_lines
     WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
     GROUP BY product_code, warehouse
     ORDER BY product_code, warehouse
     LIMIT ?`,
  ).bind(batchId, MAX_INVENTORY_STOCK_GROUPS + 1).all<InventoryStockAggregateRow>();
  if (result.results.length > MAX_INVENTORY_STOCK_GROUPS) throw salesConsumerUnavailable();
  return result.results;
}

async function loadActivePlans(db: InventoryDatabase, batchId: string) {
  const result = await db.prepare(
    `SELECT
      product_code,
      warehouse,
      COALESCE(SUM(planned_quantity), 0) AS planned_in_transit_quantity,
      MAX(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS in_draft_plan
     FROM replenishment_plan_items
     WHERE status IN ('draft', 'confirmed') OR (status = 'completed' AND source_batch_id = ?)
     GROUP BY product_code, warehouse
     ORDER BY product_code, warehouse
     LIMIT ?`,
  ).bind(batchId, MAX_ACTIVE_PLAN_GROUPS + 1).all<ActivePlanRow>();
  if (result.results.length > MAX_ACTIVE_PLAN_GROUPS) throw salesConsumerUnavailable();
  return result.results;
}

function mergeInventoryRows(input: {
  stockRows: InventoryStockAggregateRow[];
  demandRows: Map<string, SalesConsumerResponseMap["inventory_demand"]["rows"][number]>;
  activePlans: ActivePlanRow[];
  settings: InventoryThresholdSettings;
}) {
  const plans = new Map(input.activePlans.map((row) => [
    `${row.product_code}\u001f${row.warehouse}`,
    row,
  ]));
  return input.stockRows.map((stock): OverviewRow => {
    const demand = input.demandRows.get(`${stock.product_code}\u001f${normalizedWarehouseKey(stock.warehouse)}`);
    const plan = plans.get(`${stock.product_code}\u001f${stock.warehouse}`);
    const salesQuantity = demand ? Number(demand.salesQuantity) : null;
    const absoluteQuantity = demand ? Number(demand.absoluteQuantity) : 0;
    const absoluteCostCents = demand ? Number(demand.absoluteCostCents) : 0;
    const fallbackUnitCostCents = absoluteQuantity > 0 ? absoluteCostCents / absoluteQuantity : 0;
    const plannedInTransit = Number(plan?.planned_in_transit_quantity ?? 0);
    const available = Number(stock.available_quantity ?? 0);
    const sourceInTransit = Number(stock.in_transit_quantity ?? 0);
    const suggestedQuantity = salesQuantity === null || salesQuantity <= 0
      ? null
      : Math.max(0, Math.ceil(
        salesQuantity * input.settings.targetDays / input.settings.salesWindowDays
          - available
          - sourceInTransit
          - plannedInTransit,
      ));
    const dailySales = salesQuantity === null ? null : Math.max(0, salesQuantity) / input.settings.salesWindowDays;
    const coverageDays = dailySales && dailySales > 0 ? Math.max(available, 0) / dailySales : null;
    const inventoryAgeDays = stock.inventory_age_days === null ? null : Number(stock.inventory_age_days);
    const status = statusFor({ available, dailySales, coverageDays, inventoryAgeDays }, input.settings).status;
    return {
      ...stock,
      resolved_product_name: stock.product_name || demand?.productName || stock.product_code,
      sales_quantity: salesQuantity,
      absolute_quantity: absoluteQuantity,
      absolute_cost_cents: absoluteCostCents,
      fallback_unit_cost_cents: fallbackUnitCostCents,
      planned_in_transit_quantity: plannedInTransit,
      in_draft_plan: Number(plan?.in_draft_plan ?? 0),
      status,
      suggested_quantity: suggestedQuantity,
    };
  });
}

function filterInventoryRows(rows: OverviewRow[], options: InventoryOverviewOptions) {
  const query = options.query?.trim().slice(0, 100);
  const keywords = query ? uniqueStrings(query.split(/[\s,，;；]+/), 8).map((value) => value.toLowerCase()) : [];
  const warehouses = uniqueStrings(options.warehouses, 10);
  const warehouseTypes = uniqueStrings(options.warehouseTypes)
    .filter((value) => ["owned", "jd_rdc", "other"].includes(value));
  const categories = uniqueStrings(options.categories, 10);
  const statuses = uniqueStrings(options.statuses)
    .filter((value) => ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"].includes(value));
  return rows.filter((row) => {
    if (keywords.length > 0) {
      const fields = [row.product_code, row.resolved_product_name, row.specification, row.category, row.warehouse]
        .map((value) => (value ?? "").toLowerCase());
      if (!keywords.some((keyword) => fields.some((field) => field.includes(keyword)))) return false;
    }
    if (warehouses.length > 0 && !warehouses.includes(row.warehouse)) return false;
    if (warehouseTypes.length > 0 && !warehouseTypes.includes(row.warehouse_type)) return false;
    if (categories.length > 0 && !categories.includes(row.category)) return false;
    if (statuses.length > 0 && !statuses.includes(row.status)) return false;
    if (options.exactKey && `${row.warehouse}\u001f${row.product_code}` !== options.exactKey) return false;
    return true;
  });
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

export async function getInventoryOverview(
  db: InventoryDatabase,
  principal: AppPrincipal,
  options: InventoryOverviewOptions = {},
  salesReader: SalesConsumerReader = createDjangoSalesConsumerReader(),
) {
  const pagination = normalizeInventoryPagination(options);
  const [latestBatch, persistedSettings, freshness] = await Promise.all([
    findLatestInventoryImportBatch(db),
    readOperatingSettings(db),
    salesReader.read(principal, { operation: "freshness" }, { signal: options.signal }),
  ]);
  if (!freshness || typeof freshness !== "object" || typeof freshness.revision !== "string"
    || !freshness.revision || freshness.revision.length > 128) throw salesConsumerUnavailable();
  validateFreshness(freshness.data);
  const { salesStartDate, salesEndDate, salesWindowDays } = resolveInventorySalesPeriod(options, {
    startDate: freshness.data.dataStartDate,
    endDate: freshness.data.dataCutoffDate,
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

  const [stockRows, activePlans] = await Promise.all([
    loadInventoryStockRows(db, latestBatch.id),
    loadActivePlans(db, latestBatch.id),
  ]);
  const productCodes = [...new Set(stockRows.map((row) => row.product_code).filter(Boolean))];
  const demandRows = salesStartDate && salesEndDate && productCodes.length > 0
    ? await readInventoryDemand(salesReader, principal, {
      productCodes,
      startDate: salesStartDate,
      endDateExclusive: addDays(salesEndDate, 1),
      expectedRevision: freshness.revision,
      signal: options.signal,
    })
    : new Map<string, SalesConsumerResponseMap["inventory_demand"]["rows"][number]>();
  const allRows = mergeInventoryRows({ stockRows, demandRows, activePlans, settings });
  const filteredRows = filterInventoryRows(allRows, options);
  const statusOrder: Record<InventoryHealthStatus, number> = {
    urgent: 0,
    replenish: 1,
    healthy: 2,
    slow: 3,
    stagnant: 4,
    no_sales: 5,
  };
  const orderedRows = [...filteredRows].sort((left, right) => {
    const byStatus = statusOrder[left.status] - statusOrder[right.status];
    if (byStatus !== 0) return byStatus;
    const leftCoverage = left.sales_quantity !== null && left.sales_quantity > 0
      ? Math.max(0, Number(left.available_quantity)) * salesWindowDays / left.sales_quantity
      : null;
    const rightCoverage = right.sales_quantity !== null && right.sales_quantity > 0
      ? Math.max(0, Number(right.available_quantity)) * salesWindowDays / right.sales_quantity
      : null;
    if (leftCoverage === null && rightCoverage !== null) return -1;
    if (leftCoverage !== null && rightCoverage === null) return 1;
    if (leftCoverage !== null && rightCoverage !== null && leftCoverage !== rightCoverage) return leftCoverage - rightCoverage;
    return compareText(left.product_code, right.product_code) || compareText(left.warehouse, right.warehouse);
  });
  const recommendationCandidates = filteredRows
    .filter((row) => Number(row.suggested_quantity ?? 0) > 0)
    .sort((left, right) => Number(right.suggested_quantity ?? 0) - Number(left.suggested_quantity ?? 0)
      || compareText(left.product_code, right.product_code)
      || compareText(left.warehouse, right.warehouse));
  const recommendations = recommendationCandidates.slice(0, 50);
  let totalAvailableQuantity = 0;
  let knownStockValueCents = 0;
  let positiveAvailable = 0;
  let coveredQuantity = 0;
  let matchedCount = 0;
  let totalDailySales = 0;
  let demandAvailableQuantity = 0;
  let slowMovingValueCents = 0;
  let hasJdRdc = false;
  const health = { urgent: 0, replenish: 0, healthy: 0, slow: 0, stagnant: 0, noSales: 0 };
  for (const row of filteredRows) {
    const available = Number(row.available_quantity ?? 0);
    const valuation = calculateInventoryCostValuation({
      availableQuantity: available,
      importedValueCents: Number(row.imported_stock_value_cents ?? 0),
      importedPricedQuantity: Number(row.priced_available_quantity ?? 0),
      fallbackUnitCostCents: Number(row.fallback_unit_cost_cents ?? 0),
    });
    totalAvailableQuantity += available;
    knownStockValueCents += valuation.knownStockValueCents;
    positiveAvailable += Math.max(available, 0);
    coveredQuantity += valuation.coveredQuantity;
    if (row.sales_quantity !== null) matchedCount += 1;
    if (row.sales_quantity !== null && row.sales_quantity > 0) {
      totalDailySales += row.sales_quantity / salesWindowDays;
      demandAvailableQuantity += Math.max(available, 0);
    }
    if (row.status === "urgent") health.urgent += 1;
    else if (row.status === "replenish") health.replenish += 1;
    else if (row.status === "healthy") health.healthy += 1;
    else if (row.status === "slow") health.slow += 1;
    else if (row.status === "stagnant") health.stagnant += 1;
    else health.noSales += 1;
    if (["slow", "stagnant", "no_sales"].includes(row.status)) slowMovingValueCents += valuation.knownStockValueCents;
    if (row.warehouse_type === "jd_rdc") hasJdRdc = true;
  }
  const total = filteredRows.length;
  const pageRows = orderedRows.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const inventoryStale = dayDifference(latestBatch.snapshotDate, shanghaiToday()) > 3;
  return {
    hasInventory: true,
    sync: { latestInventoryBatchId: latestBatch.id, inventoryAsOf: latestBatch.snapshotDate, inventorySyncedAt: latestBatch.completedAt, salesThrough: salesEndDate, salesWindowStart: salesStartDate, latestInventoryFile: latestBatch.fileName, inventoryStale },
    settings,
    metrics: {
      skuWarehouseCount: total,
      totalAvailableQuantity,
      totalStockValueCents: knownStockValueCents,
      knownStockValueCents,
      stockValueComplete: positiveAvailable <= 0 || coveredQuantity >= positiveAvailable,
      costCoverageRate: positiveAvailable > 0 ? coveredQuantity / positiveAvailable : 1,
      salesDemandMatchRate: total > 0 ? matchedCount / total : 0,
      averageCoverageDays: totalDailySales > 0 ? demandAvailableQuantity / totalDailySales : null,
      urgentCount: health.urgent,
      replenishCount: health.replenish,
      slowMovingValueCents,
      noSalesCount: health.noSales,
      recommendationCount: recommendationCandidates.length,
    },
    health,
    sources: [
      { key: "warehouse_stock", label: "吉客云分仓库存", status: inventoryStale ? "stale" : "ready", asOfDate: latestBatch.snapshotDate },
      { key: "sales_demand", label: `所选 ${settings.salesWindowDays} 日销售需求`, status: salesEndDate ? "ready" : "missing", asOfDate: salesEndDate },
      { key: "jd_rdc", label: "京东 RDC / DC", status: hasJdRdc ? (inventoryStale ? "stale" : "ready") : "missing", asOfDate: hasJdRdc ? latestBatch.snapshotDate : null },
    ],
    filters: { warehouses: [...new Set(allRows.map((row) => row.warehouse))].sort(compareText).slice(0, 500), statuses: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"] },
    pagination: { page: pagination.page, pageSize: pagination.pageSize, limit: pagination.pageSize, total, returned: pageRows.length, totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize), truncated: pagination.offset + pageRows.length < total },
    recommendations: recommendations.map((row) => mapItem(row, settings)),
    items: pageRows.map((row) => mapItem(row, settings)),
    plans: planPage.items,
    plansPagination: planPage.pagination,
    planSummary,
  };
}
