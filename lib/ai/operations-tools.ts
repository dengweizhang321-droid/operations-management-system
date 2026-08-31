import {
  ensureInventorySchema,
  findLatestInventoryImportBatch,
  getInventoryDatabase,
  queryReplenishmentPlans,
} from "@/lib/inventory/database";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { getProductSummary } from "@/lib/products/summary";
import { ensureProductShippingRateSchema } from "@/lib/products/shipping-rate-database";
import {
  ensureSalesSchema,
  findLatestSalesImportBatch,
  getSalesDatabase,
} from "@/lib/sales/database";
import {
  getSalesSummary,
  isSalesRange,
} from "@/lib/sales/summary";
import { getOperationsBusinessDates } from "@/lib/ai/business-time";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";

export async function callOperationsTool(
  name: string,
  rawArguments: unknown,
): Promise<Record<string, unknown>> {
  const args = asRecord(rawArguments);

  if (name === "get_data_freshness") {
    assertOnlyKeys(args, []);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db), ensureProductShippingRateSchema(db)]);
    const [salesBatch, inventoryBatch, salesBounds] = await Promise.all([
      findLatestSalesImportBatch(db),
      findLatestInventoryImportBatch(db),
      db.prepare("SELECT MAX(substr(ship_time, 1, 10)) AS end_date FROM sales_order_lines")
        .first<{ end_date: string | null }>(),
    ]);
    const businessDates = getOperationsBusinessDates();
    return {
      sales: {
        through: salesBounds?.end_date ?? null,
        importedAt: salesBatch?.completedAt ?? null,
        fileName: salesBatch?.fileName ?? null,
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
    const db = getSalesDatabase();
    await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
    const summary = await getSalesSummary(db, {
      range: requestedRange,
      startDate: optionalString(args.startDate),
      endDate: optionalString(args.endDate),
    });
    return { ...summary, currency: "CNY", monetaryUnit: "cents" };
  }

  if (name === "get_inventory_health") {
    assertOnlyKeys(args, ["warehouse", "category", "status", "query", "limit"]);
    const status = optionalEnum(args.status, ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"] as const);
    const warehouse = optionalString(args.warehouse);
    const category = optionalString(args.category);
    const query = optionalString(args.query);
    const limit = integer(args.limit, 20, 1, 100);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const overview = await getInventoryOverview(db, {
      page: 1,
      pageSize: limit,
      query,
      warehouses: warehouse ? [warehouse] : [],
      categories: category ? [category] : [],
      statuses: status ? [status] : [],
    });
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
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const summary = await getProductSummary(db, {
      days,
      page: 1,
      pageSize: limit,
      query,
      categories: category ? [category] : [],
      sortBy,
      direction,
    });
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
