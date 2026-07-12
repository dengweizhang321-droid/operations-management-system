import {
  ensureInventorySchema,
  findLatestInventoryImportBatch,
  getInventoryDatabase,
  listReplenishmentPlans,
} from "@/lib/inventory/database";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { getProductSummary } from "@/lib/products/summary";
import {
  ensureSalesSchema,
  findLatestSalesImportBatch,
  getSalesDatabase,
} from "@/lib/sales/database";
import {
  getSalesSummary,
  isSalesRange,
} from "@/lib/sales/summary";

export const operationsToolNames = [
  "get_data_freshness",
  "get_sales_summary",
  "get_inventory_health",
  "get_product_performance",
  "list_replenishment_plans",
] as const;

export type OperationsToolName = (typeof operationsToolNames)[number];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const operationsToolDefinitions = [
  {
    name: "get_data_freshness",
    title: "运营数据更新时间",
    description: "读取销售与库存数据的最新截止日期、导入时间和来源文件。分析任何时效性问题前优先调用。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_sales_summary",
    title: "销售经营汇总",
    description: "按统计周期读取销售额、退款、毛利、订单、渠道、平台和每日趋势。所有金额字段单位均为人民币分。",
    inputSchema: {
      type: "object",
      properties: {
        range: {
          type: "string",
          enum: ["today", "last7", "month", "quarter", "custom", "all"],
          description: "统计周期；custom 时必须同时提供 startDate 和 endDate。",
        },
        startDate: { type: "string", description: "自定义开始日期，YYYY-MM-DD。" },
        endDate: { type: "string", description: "自定义结束日期，YYYY-MM-DD。" },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_inventory_health",
    title: "库存健康分析",
    description: "读取最新库存健康、缺货风险、滞销库存、覆盖天数和补货建议。所有金额字段单位均为人民币分。",
    inputSchema: {
      type: "object",
      properties: {
        warehouse: { type: "string", description: "可选，精确仓库名称。" },
        category: { type: "string", description: "可选，精确商品品类。" },
        status: {
          type: "string",
          enum: ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"],
        },
        query: { type: "string", description: "可选，匹配商品编码或名称。" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_product_performance",
    title: "商品经营表现",
    description: "读取商品销量、销售额、成本、毛利、毛利率和库存价值。所有金额字段单位均为人民币分。",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 7, maximum: 365, default: 30 },
        category: { type: "string", description: "可选，精确商品品类。" },
        query: { type: "string", description: "可选，匹配商品编码或名称。" },
        sortBy: {
          type: "string",
          enum: ["netSalesCents", "grossProfitCents", "grossMarginRate", "stockValueCents", "netQuantity"],
          default: "netSalesCents",
        },
        direction: { type: "string", enum: ["asc", "desc"], default: "desc" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "list_replenishment_plans",
    title: "备货计划查询",
    description: "只读查询备货草稿、已确认、已完成或已取消计划，不会创建或修改计划。",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "confirmed", "completed", "cancelled"] },
        warehouse: { type: "string", description: "可选，精确仓库名称。" },
        query: { type: "string", description: "可选，匹配商品编码或名称。" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
] as const;

export function isOperationsToolName(value: string): value is OperationsToolName {
  return operationsToolNames.includes(value as OperationsToolName);
}

export async function callOperationsTool(
  name: OperationsToolName,
  rawArguments: unknown,
): Promise<Record<string, unknown>> {
  const args = asRecord(rawArguments);

  if (name === "get_data_freshness") {
    assertOnlyKeys(args, []);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const [salesBatch, inventoryBatch, salesBounds] = await Promise.all([
      findLatestSalesImportBatch(db),
      findLatestInventoryImportBatch(db),
      db.prepare("SELECT MAX(substr(sales_time, 1, 10)) AS end_date FROM sales_order_lines")
        .first<{ end_date: string | null }>(),
    ]);
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
      timezone: "Asia/Shanghai",
    };
  }

  if (name === "get_sales_summary") {
    assertOnlyKeys(args, ["range", "startDate", "endDate"]);
    const requestedRange = optionalString(args.range) ?? "month";
    if (!isSalesRange(requestedRange)) throw new ToolInputError("range 参数无效");
    const db = getSalesDatabase();
    await ensureSalesSchema(db);
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
    const query = optionalString(args.query)?.toLocaleLowerCase("zh-CN");
    const limit = integer(args.limit, 20, 1, 100);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const overview = await getInventoryOverview(db);
    const filtered = overview.items.filter((item) =>
      (!status || item.status === status)
      && (!warehouse || item.warehouse === warehouse)
      && (!category || item.category === category)
      && (!query || `${item.productCode} ${item.productName}`.toLocaleLowerCase("zh-CN").includes(query))
    );
    return {
      sync: overview.sync,
      settings: overview.settings,
      metrics: overview.metrics,
      health: overview.health,
      filtersApplied: { status, warehouse, category, query: query ?? null },
      totalMatched: filtered.length,
      returned: Math.min(filtered.length, limit),
      truncated: filtered.length > limit,
      items: filtered.slice(0, limit),
      currency: "CNY",
      monetaryUnit: "cents",
    };
  }

  if (name === "get_product_performance") {
    assertOnlyKeys(args, ["days", "category", "query", "sortBy", "direction", "limit"]);
    const days = integer(args.days, 30, 7, 365);
    const category = optionalString(args.category);
    const query = optionalString(args.query)?.toLocaleLowerCase("zh-CN");
    const sortBy = optionalEnum(args.sortBy, ["netSalesCents", "grossProfitCents", "grossMarginRate", "stockValueCents", "netQuantity"] as const) ?? "netSalesCents";
    const direction = optionalEnum(args.direction, ["asc", "desc"] as const) ?? "desc";
    const limit = integer(args.limit, 20, 1, 100);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const summary = await getProductSummary(db, days);
    const filtered = summary.items.filter((item) =>
      (!category || item.category === category)
      && (!query || `${item.productCode} ${item.productName}`.toLocaleLowerCase("zh-CN").includes(query))
    );
    filtered.sort((left, right) => {
      const leftValue = left[sortBy] ?? Number.NEGATIVE_INFINITY;
      const rightValue = right[sortBy] ?? Number.NEGATIVE_INFINITY;
      return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
    return {
      sync: summary.sync,
      metrics: summary.metrics,
      days,
      filtersApplied: { category, query: query ?? null, sortBy, direction },
      totalMatched: filtered.length,
      returned: Math.min(filtered.length, limit),
      truncated: filtered.length > limit,
      items: filtered.slice(0, limit),
      currency: "CNY",
      monetaryUnit: "cents",
    };
  }

  assertOnlyKeys(args, ["status", "warehouse", "query", "limit"]);
  const status = optionalEnum(args.status, ["draft", "confirmed", "completed", "cancelled"] as const);
  const warehouse = optionalString(args.warehouse);
  const query = optionalString(args.query)?.toLocaleLowerCase("zh-CN");
  const limit = integer(args.limit, 20, 1, 100);
  const db = getInventoryDatabase();
  await ensureInventorySchema(db);
  const plans = await listReplenishmentPlans(db, 500);
  const filtered = plans.filter((plan) =>
    (!status || plan.status === status)
    && (!warehouse || plan.warehouse === warehouse)
    && (!query || `${plan.productCode} ${plan.productName}`.toLocaleLowerCase("zh-CN").includes(query))
  );
  return {
    filtersApplied: { status, warehouse, query: query ?? null },
    totalMatched: filtered.length,
    returned: Math.min(filtered.length, limit),
    truncated: filtered.length > limit,
    items: filtered.slice(0, limit),
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
