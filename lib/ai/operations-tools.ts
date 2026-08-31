import {
  ensureInventorySchema,
  findLatestInventoryImportBatch,
  getInventoryDatabase,
  queryReplenishmentPlans,
} from "@/lib/inventory/database";
import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoSalesConsumerReader,
  type SalesConsumerReader,
} from "@/lib/django/sales-consumer-reader";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { getProductSummary } from "@/lib/products/summary";
import { ensureProductShippingRateSchema } from "@/lib/products/shipping-rate-database";
import {
  isSalesRange,
} from "@/lib/sales/read-contract";
import { getOperationsBusinessDates } from "@/lib/ai/business-time";
import { PublicApiError } from "@/lib/http/api-error";

type OperationsToolDependencies = {
  salesReader?: SalesConsumerReader;
  signal?: AbortSignal;
};

function salesConsumerUnavailable(): PublicApiError {
  return new PublicApiError(503, "service_unavailable", "Django 销售读取服务暂时不可用，请稍后重试。");
}

function validTextOrNull(value: unknown, maximum = 500): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validFreshnessData(value: unknown): boolean {
  if (!isRecord(value) || !validTextOrNull(value.dataStartDate, 10)
    || !validTextOrNull(value.dataCutoffDate, 10)) return false;
  if (value.latestBatch === null) return true;
  if (!isRecord(value.latestBatch)) return false;
  return typeof value.latestBatch.id === "string" && value.latestBatch.id.length <= 200
    && typeof value.latestBatch.fileName === "string" && value.latestBatch.fileName.length <= 500
    && validTextOrNull(value.latestBatch.completedAt, 80)
    && Number.isSafeInteger(value.latestBatch.rowCount) && Number(value.latestBatch.rowCount) >= 0;
}

function validSummaryData(value: unknown): boolean {
  if (!isRecord(value) || typeof value.range !== "string" || !isSalesRange(value.range)
    || typeof value.startDate !== "string" || typeof value.endDate !== "string"
    || !validTextOrNull(value.dataCutoffDate, 10) || !isRecord(value.current)) return false;
  return ["channels", "outlets", "shops", "platforms", "daily", "previousDaily", "yearAgoDaily"]
    .every((key) => Array.isArray(value[key]));
}

export async function callOperationsTool(
  name: string,
  rawArguments: unknown,
  principal: AppPrincipal,
  dependencies: OperationsToolDependencies = {},
): Promise<Record<string, unknown>> {
  const args = asRecord(rawArguments);
  const salesReader = dependencies.salesReader ?? createDjangoSalesConsumerReader();

  if (name === "get_data_freshness") {
    assertOnlyKeys(args, []);
    const db = getInventoryDatabase();
    await ensureInventorySchema(db);
    const [sales, inventoryBatch] = await Promise.all([
      salesReader.read(
        principal,
        { operation: "freshness" },
        { signal: dependencies.signal },
      ),
      findLatestInventoryImportBatch(db),
    ]);
    if (!sales || typeof sales.revision !== "string" || !sales.revision
      || !validFreshnessData(sales.data)) {
      throw salesConsumerUnavailable();
    }
    const businessDates = getOperationsBusinessDates();
    return {
      sales: {
        through: sales.data.dataCutoffDate,
        importedAt: sales.data.latestBatch?.completedAt ?? null,
        fileName: sales.data.latestBatch?.fileName ?? null,
      },
      inventory: {
        asOf: inventoryBatch?.snapshotDate ?? null,
        importedAt: inventoryBatch?.completedAt ?? null,
        fileName: inventoryBatch?.fileName ?? null,
      },
      timezone: businessDates.timeZone,
      currentBusinessDate: businessDates.today,
      yesterdayBusinessDate: businessDates.yesterday,
    };
  }

  if (name === "get_sales_summary") {
    assertOnlyKeys(args, ["range", "startDate", "endDate"]);
    const requestedRange = optionalString(args.range) ?? "month";
    if (!isSalesRange(requestedRange)) throw new ToolInputError("range 参数无效");
    const summary = await salesReader.read(principal, {
      operation: "summary",
      range: requestedRange,
      startDate: optionalString(args.startDate),
      endDate: optionalString(args.endDate),
    }, { signal: dependencies.signal });
    if (!summary || typeof summary.revision !== "string" || !summary.revision
      || !validSummaryData(summary.data)) throw salesConsumerUnavailable();
    return { ...summary.data, currency: "CNY", monetaryUnit: "cents" };
  }

  if (name === "get_inventory_health") {
    assertOnlyKeys(args, ["warehouse", "category", "status", "query", "limit"]);
    const status = optionalEnum(args.status, ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"] as const);
    const warehouse = optionalString(args.warehouse);
    const category = optionalString(args.category);
    const query = optionalString(args.query);
    const limit = integer(args.limit, 20, 1, 100);
    const db = getInventoryDatabase();
    await ensureInventorySchema(db);
    const overview = await getInventoryOverview(db, principal, {
      page: 1,
      pageSize: limit,
      query,
      warehouses: warehouse ? [warehouse] : [],
      categories: category ? [category] : [],
      statuses: status ? [status] : [],
      signal: dependencies.signal,
    }, salesReader);
    return {
      sync: overview.sync,
      settings: overview.settings,
      metrics: overview.metrics,
      health: overview.health,
      filtersApplied: { status, warehouse, category, query: query ?? null },
      totalMatched: overview.pagination.total,
      returned: overview.pagination.returned,
      truncated: overview.pagination.truncated,
      items: overview.items,
      currency: "CNY",
      monetaryUnit: "cents",
    };
  }

  if (name === "get_product_performance") {
    assertOnlyKeys(args, ["days", "category", "query", "sortBy", "direction", "limit"]);
    const days = integer(args.days, 30, 7, 365);
    const category = optionalString(args.category);
    const query = optionalString(args.query);
    const sortBy = optionalEnum(args.sortBy, ["netSalesCents", "grossProfitCents", "grossMarginRate", "stockValueCents", "netQuantity"] as const) ?? "netSalesCents";
    const direction = optionalEnum(args.direction, ["asc", "desc"] as const) ?? "desc";
    const limit = integer(args.limit, 20, 1, 100);
    const db = getInventoryDatabase();
    await ensureInventorySchema(db);
    const summary = await getProductSummary(db, principal, {
      days,
      page: 1,
      pageSize: limit,
      query,
      categories: category ? [category] : [],
      sortBy,
      direction,
      signal: dependencies.signal,
    }, salesReader);
    return {
      sync: summary.sync,
      metrics: summary.metrics,
      days,
      filtersApplied: { category, query: query ?? null, sortBy, direction },
      totalMatched: summary.pagination.total,
      returned: summary.pagination.returned,
      truncated: summary.pagination.truncated,
      items: summary.items,
      currency: "CNY",
      monetaryUnit: "cents",
    };
  }

  if (name !== "list_replenishment_plans") throw new ToolInputError("工具未注册");
  assertOnlyKeys(args, ["status", "warehouse", "query", "limit"]);
  const status = optionalEnum(args.status, ["draft", "confirmed", "completed", "cancelled"] as const);
  const warehouse = optionalString(args.warehouse);
  const query = optionalString(args.query);
  const limit = integer(args.limit, 20, 1, 100);
  const db = getInventoryDatabase();
  await ensureInventorySchema(db);
  const plans = await queryReplenishmentPlans(db, {
    page: 1,
    pageSize: limit,
    status,
    includeCancelled: status === "cancelled",
    warehouse,
    query,
  });
  return {
    filtersApplied: { status, warehouse, query: query ?? null },
    totalMatched: plans.pagination.total,
    returned: plans.pagination.returned,
    truncated: plans.pagination.truncated,
    items: plans.items,
  };
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError("工具参数必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new ToolInputError(`不支持的参数：${unexpected.join(", ")}`);
  }
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolInputError("字符串参数格式无效");
  const normalized = value.trim();
  if (normalized.length > 200) throw new ToolInputError("字符串参数过长");
  return normalized || undefined;
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return undefined;
  if (!allowed.includes(normalized)) throw new ToolInputError(`参数必须是 ${allowed.join(", ")} 之一`);
  return normalized as T[number];
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ToolInputError(`整数参数必须在 ${minimum} 到 ${maximum} 之间`);
  }
  return value;
}
