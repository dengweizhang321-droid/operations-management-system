import {
  callOperationsTool,
} from "@/lib/ai/operations-tools";
import {
  executeToolCallWithRegistry,
  getAnthropicTools as deriveAnthropicTools,
  getOpenAiTools as deriveOpenAiTools,
  getToolsForPrincipal as filterToolsForPrincipal,
  getVisibleToolCatalog as deriveVisibleToolCatalog,
  validateToolRegistry,
  type AiToolAnnotations,
  type AiToolEntry,
  type AiToolExecutionContext,
  type AiToolExecutionResult,
  type AnthropicToolDefinition,
  type JsonSchema,
  type OpenAiToolDefinition,
} from "@/lib/ai/tool-registry-contract";
import {
  recordAiToolAudit,
  summarizeToolArguments,
} from "@/lib/ai/tool-audit";
import {
  searchSystemDataForAi,
} from "@/lib/search/ai-tool";
import { GLOBAL_SEARCH_COVERAGE } from "@/lib/search/global-search";

export type {
  AiToolAnnotations,
  AiToolEntry,
  AiToolExecutionContext,
  AiToolExecutionResult,
  AiToolRisk,
  AiToolSurface,
  AnthropicToolDefinition,
  JsonSchema,
  OpenAiToolDefinition,
} from "@/lib/ai/tool-registry-contract";

const allRoles = ["viewer", "analyst", "operator", "admin"] as const;
const chatDataRoles = ["analyst", "operator", "admin"] as const;
const readOnlyAnnotations: AiToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * The sole declaration point for model-callable application capabilities.
 * Never derive this registry from API routes, database tables, or arbitrary SQL.
 */
export const aiToolRegistry = [
  {
    name: "get_data_freshness",
    title: "运营数据更新时间",
    description: "读取销售与库存数据的最新截止日期、导入时间和来源文件。回答任何当前运营数据问题前必须先调用本工具。返回 sales.through、inventory.asOf、importedAt、fileName 和 timezone。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: allRoles,
    supportsScopedPrincipal: false,
    handler: (args) => callOperationsTool("get_data_freshness", args),
  },
  {
    name: "get_sales_summary",
    title: "销售经营汇总",
    description: "按统计周期读取销售额、退款、毛利、订单、渠道、平台和每日趋势。返回 filtersApplied、daily 等汇总字段；所有金额字段单位均为人民币分。custom 时必须提供 startDate 和 endDate。",
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
    risk: "read_only",
    allowedRoles: chatDataRoles,
    supportsScopedPrincipal: false,
    handler: (args) => callOperationsTool("get_sales_summary", args),
  },
  {
    name: "get_inventory_health",
    title: "库存健康分析",
    description: "读取最新库存健康、缺货风险、滞销库存、覆盖天数和补货建议。返回 filtersApplied、totalMatched、returned、truncated 和 items；所有金额字段单位均为人民币分。",
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
    risk: "read_only",
    allowedRoles: chatDataRoles,
    supportsScopedPrincipal: false,
    handler: (args) => callOperationsTool("get_inventory_health", args),
  },
  {
    name: "get_product_performance",
    title: "商品经营表现",
    description: "读取商品销量、销售额、成本、毛利、毛利率和库存价值。返回 filtersApplied、totalMatched、returned、truncated 和 items；所有金额字段单位均为人民币分。",
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
    risk: "read_only",
    allowedRoles: chatDataRoles,
    supportsScopedPrincipal: false,
    handler: (args) => callOperationsTool("get_product_performance", args),
  },
  {
    name: "list_replenishment_plans",
    title: "备货计划查询",
    description: "只读查询备货草稿、已确认、已完成或已取消计划，不会创建或修改计划。返回 filtersApplied、totalMatched、returned、truncated 和 items。",
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
    risk: "read_only",
    allowedRoles: chatDataRoles,
    supportsScopedPrincipal: false,
    handler: (args) => callOperationsTool("list_replenishment_plans", args),
  },
  {
    name: "search_system_data",
    title: "搜索系统全部已授权业务数据",
    description: `按认证账号的角色和数据范围，搜索明确列入白名单的${GLOBAL_SEARCH_COVERAGE.join("、")}。返回 dataCutoff、filtersApplied、groups、returned、truncated、monetaryUnit 和 unavailableDomains；不会返回密钥、原始审计、模型配置或任意数据库内容。`,
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 2, maxLength: 80, description: "搜索关键词。" },
        domain: {
          type: "string",
          enum: ["products", "orders", "jd_products", "inventory", "inventory_age", "combos", "replenishment", "market_skus", "market_annotations", "customer_service", "finance", "targets", "workflow", "imports"],
          description: "可选，只搜索一个获授权业务域；省略时搜索全部获授权域。",
        },
        page: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
        limitPerDomain: { type: "integer", minimum: 1, maximum: 8, default: 4 },
        totalLimit: { type: "integer", minimum: 1, maximum: 50, default: 48 },
      },
      required: ["q"],
      additionalProperties: false,
    } satisfies JsonSchema,
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: allRoles,
    supportsScopedPrincipal: true,
    handler: (args, context) => searchSystemDataForAi(args as never, { execution: context }),
  },
] satisfies readonly AiToolEntry[];

validateToolRegistry(aiToolRegistry);

export function getToolsForPrincipal(
  principal: AiToolExecutionContext["principal"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): readonly AiToolEntry[] {
  return filterToolsForPrincipal(principal, entries);
}

export function getOpenAiTools(
  principal: AiToolExecutionContext["principal"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): OpenAiToolDefinition[] {
  return deriveOpenAiTools(principal, entries);
}

export function getAnthropicTools(
  principal: AiToolExecutionContext["principal"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): AnthropicToolDefinition[] {
  return deriveAnthropicTools(principal, entries);
}

export function getVisibleToolCatalog(
  principal: AiToolExecutionContext["principal"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
) {
  return deriveVisibleToolCatalog(principal, entries);
}

export async function executeRegisteredToolCall(
  name: string,
  rawArguments: unknown,
  context: AiToolExecutionContext,
  options: {
    entries?: readonly AiToolEntry[];
    audit?: typeof recordAiToolAudit;
  } = {},
): Promise<AiToolExecutionResult> {
  return executeToolCallWithRegistry(name, rawArguments, context, {
    entries: options.entries ?? aiToolRegistry,
    audit: options.audit ?? recordAiToolAudit,
    summarizeArguments: summarizeToolArguments,
  });
}
