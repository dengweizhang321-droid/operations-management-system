import {
  callOperationsTool,
} from "@/lib/ai/operations-tools";
import {
  getAnthropicTools as deriveAnthropicTools,
  getOpenAiTools as deriveOpenAiTools,
  getToolsForPrincipal as filterToolsForPrincipal,
  getVisibleToolCatalog as deriveVisibleToolCatalog,
  validateToolRegistry,
  type AiToolAnnotations,
  type AiToolEntry,
  type AiToolExecutionContext,
  type AiToolExecutionPolicy,
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
  createAiToolExecutionRuntime,
  type AiToolRuntimeLimits,
} from "@/lib/ai/tool-execution-runtime";
import {
  searchSystemDataForAi,
} from "@/lib/search/ai-tool";
import { GLOBAL_SEARCH_COVERAGE } from "@/lib/search/global-search";
import { getCustomerServiceConversationsForAi } from "@/lib/customer-service/database";
import { callMarketTool } from "@/lib/market/ai-tools";
import { searchAiKnowledge } from "@/lib/ai/data-knowledge";
import { getSalesDatabase } from "@/lib/sales/database";
import { getNetshopPerformanceForAi } from "@/lib/netshop/ai-tool";
import { getSalesCategoryAnalysisForAi } from "@/lib/sales/category-ai-tool";

export type {
  AiToolAnnotations,
  AiToolEntry,
  AiToolExecutionMode,
  AiToolExecutionPolicy,
  AiToolExecutionContext,
  AiToolExecutionResult,
  AiToolRisk,
  AiToolScopePolicy,
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
const synchronousReadOnlyExecution: AiToolExecutionPolicy = {
  environment: "worker_inline",
  mode: "direct",
  allowedSurfaces: ["ai_chat", "codex_mcp", "test"],
  timeoutMs: 12_000,
  maxResultCharacters: 40_000,
  maxCallsPerRequest: 4,
};

/**
 * The sole declaration point for model-callable application capabilities.
 * Never derive this registry from API routes, database tables, or arbitrary SQL.
 */
export const aiToolRegistry = [
  {
    name: "search_system_knowledge",
    title: "检索系统口径与知识",
    description: "检索版本化、可追溯的系统规则、业务指标口径和身份映射知识。只返回稳定解释，不返回当前经营数字；需要当前数据时仍应调用对应数据工具。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 80, description: "要检索的口径、规则或映射问题。" },
        limit: { type: "integer", minimum: 1, maximum: 8, default: 4 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: allRoles,
    scopePolicy: "metadata_safe",
    execution: { ...synchronousReadOnlyExecution, maxCallsPerRequest: 2 },
    handler: (args, context) => searchAiKnowledge(args, context.principal, getSalesDatabase()),
  },
  {
    name: "get_data_freshness",
    title: "运营数据更新时间",
    description: "读取销售与库存数据的最新截止日期、导入时间和来源文件。回答任何当前运营数据问题前必须先调用本工具。返回 sales.through、inventory.asOf、importedAt、fileName 和 timezone。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: allRoles,
    scopePolicy: "metadata_safe",
    execution: synchronousReadOnlyExecution,
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
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callOperationsTool("get_sales_summary", args),
  },
  {
    name: "get_sales_category_analysis",
    title: "销售品类分析",
    description: "按自定义日期和真实用户数据范围只读查询品类净销售额、贡献率、正向销量、退货量、退款、毛利、排名和月度趋势。品类优先来自 ERP 商品主数据，销售明细品类为可追溯兜底，未匹配商品归入未分类；金额单位均为人民币分。",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "开始日期，YYYY-MM-DD。" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "结束日期，YYYY-MM-DD。" },
        categories: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 20 },
        channels: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 20 },
        platforms: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 20 },
        productQueries: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 20 },
        sortBy: { type: "string", enum: ["netSalesCents", "shareRate", "positiveQuantity", "returnQuantity", "refundAmountCents", "grossProfitCents", "grossMarginRate", "productCount"], default: "netSalesCents" },
        direction: { type: "string", enum: ["asc", "desc"], default: "desc" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      required: ["startDate", "endDate"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "principal_scope",
    execution: { ...synchronousReadOnlyExecution, maxCallsPerRequest: 2 },
    handler: (args, context) => getSalesCategoryAnalysisForAi(args, context.principal),
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
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
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
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
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
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callOperationsTool("list_replenishment_plans", args),
  },
  {
    name: "get_customer_service_conversations",
    title: "客服会话分析查询",
    description: "只读查询已导入客服会话的店铺、时间、客服、SKU/SPU、吉客云类目、机器人标注、问题类型、转化状态、服务问题和小结。结果最多返回 50 条，不返回原始聊天全文。",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "可选，咨询开始日期，YYYY-MM-DD。" },
        endDate: { type: "string", description: "可选，咨询结束日期，YYYY-MM-DD。" },
        agent: { type: "string", maxLength: 100, description: "可选，精确客服名称。" },
        problemType: { type: "string", enum: ["商品咨询", "价格优惠", "物流发货", "售后维修", "退换货", "安装使用", "发票开票", "催单改单", "其他"] },
        conversionStatus: { type: "string", enum: ["converted", "not_converted", "unknown"] },
        category: { type: "string", maxLength: 120, description: "可选，精确吉客云类目。" },
        query: { type: "string", minLength: 2, maxLength: 80, description: "可选，搜索顾客、客服、SKU、问题或小结。" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => getCustomerServiceConversationsForAi(args),
  },
  {
    name: "get_market_overview",
    title: "市场 TOP 榜单概览",
    description: "只读查询市场分析 2.0 的核心 KPI、行业趋势、商品进出、经营模式、流量转化象限、标题卖点、机会矩阵、数据质量和正式确认主图市场定位价口径。返回范围仅代表当前 TOP 榜单覆盖口径，不代表完整行业市场；行业结论应锁定单一类目、榜单范围和 SKU/SPU 维度。",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        category: { type: "string", maxLength: 120 },
        scope: { type: "string", maxLength: 120 },
        rankingDimension: { type: "string", enum: ["SKU", "SPU"] },
        operationMode: { type: "string", enum: ["POP", "自营", "未知"] },
        brand: { type: "string", maxLength: 120 },
        subcategory: { type: "string", maxLength: 120 },
        query: { type: "string", maxLength: 100 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callMarketTool("get_market_overview", args),
  },
  {
    name: "get_market_sku_trend",
    title: "市场 SKU 月度趋势",
    description: "按类目、榜单范围、SKU/SPU 维度和商品编码的完整身份，只读查询月度销售额、成交件数、正式市场定位价、成交均价、排名和价格确认状态。结果有上限。",
    inputSchema: {
      type: "object",
      properties: {
        skuCode: { type: "string", minLength: 1, maxLength: 80 },
        category: { type: "string", minLength: 1, maxLength: 120 },
        scope: { type: "string", minLength: 1, maxLength: 120 },
        rankingDimension: { type: "string", enum: ["SKU", "SPU"] },
        limit: { type: "integer", minimum: 1, maximum: 60, default: 24 },
      },
      required: ["skuCode", "category", "scope", "rankingDimension"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callMarketTool("get_market_sku_trend", args),
  },
  {
    name: "get_market_brand_analysis",
    title: "市场品牌份额分析",
    description: "只读查询完整筛选范围内品牌销售额份额、销量、SKU 数、CR3、CR5 和集中度；仅展示列表限制为前 30，份额分母不截断。",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        category: { type: "string", maxLength: 120 },
        rankingDimension: { type: "string", enum: ["SKU", "SPU"] },
        operationMode: { type: "string", enum: ["POP", "自营", "未知"] },
        brand: { type: "string", maxLength: 120 },
        subcategory: { type: "string", maxLength: 120 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callMarketTool("get_market_brand_analysis", args),
  },
  {
    name: "get_market_price_band_analysis",
    title: "市场价格带分析",
    description: "只读查询按已发布版本化价格带配置计算的价格带销售额、成交件数、SKU 数和 POP/自营占比。未人工确认价格不会进入正式价格带。",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        category: { type: "string", maxLength: 120 },
        rankingDimension: { type: "string", enum: ["SKU", "SPU"] },
        operationMode: { type: "string", enum: ["POP", "自营", "未知"] },
        subcategory: { type: "string", maxLength: 120 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callMarketTool("get_market_price_band_analysis", args),
  },
  {
    name: "get_market_pending_review_summary",
    title: "市场价格待确认汇总",
    description: "只读查询待人工确认的主图市场定位价列表摘要，返回候选价来源、月份、图片哈希和商品信息，结果有上限。",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", maxLength: 120 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: chatDataRoles,
    scopePolicy: "unscoped_only",
    execution: synchronousReadOnlyExecution,
    handler: (args) => callMarketTool("get_market_pending_review_summary", args),
  },
  {
    name: "get_netshop_performance",
    title: "网店商品与推广表现",
    description: "按认证账号的平台范围，只读查询网店商品日表现或推广表现。商品访客为商品×日累计，不能解释为店铺去重UV；所有金额字段单位均为人民币分。",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string", enum: ["product_daily", "promotion"], default: "product_daily" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        platform: { type: "string", maxLength: 40 },
        shop: { type: "string", maxLength: 120 },
        query: { type: "string", maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
    risk: "read_only",
    allowedRoles: allRoles,
    scopePolicy: "principal_scope",
    execution: { ...synchronousReadOnlyExecution, maxResultCharacters: 24_000, maxCallsPerRequest: 2 },
    handler: (args, context) => getNetshopPerformanceForAi(args, context.principal),
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
    scopePolicy: "principal_scope",
    execution: { ...synchronousReadOnlyExecution, maxCallsPerRequest: 2 },
    handler: (args, context) => searchSystemDataForAi(args as never, { execution: context }),
  },
] satisfies readonly AiToolEntry[];

validateToolRegistry(aiToolRegistry);

export function getToolsForPrincipal(
  principal: AiToolExecutionContext["principal"],
  surface: AiToolExecutionContext["surface"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): readonly AiToolEntry[] {
  return filterToolsForPrincipal(principal, surface, entries);
}

export function getOpenAiTools(
  principal: AiToolExecutionContext["principal"],
  surface: AiToolExecutionContext["surface"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): OpenAiToolDefinition[] {
  return deriveOpenAiTools(principal, surface, entries);
}

export function getAnthropicTools(
  principal: AiToolExecutionContext["principal"],
  surface: AiToolExecutionContext["surface"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
): AnthropicToolDefinition[] {
  return deriveAnthropicTools(principal, surface, entries);
}

export function getVisibleToolCatalog(
  principal: AiToolExecutionContext["principal"],
  surface: AiToolExecutionContext["surface"],
  entries: readonly AiToolEntry[] = aiToolRegistry,
) {
  return deriveVisibleToolCatalog(principal, surface, entries);
}

export function createRegisteredToolExecutionRuntime(
  context: AiToolExecutionContext,
  limits?: Partial<AiToolRuntimeLimits>,
) {
  const runtime = createAiToolExecutionRuntime({
    context,
    entries: aiToolRegistry,
    audit: recordAiToolAudit,
    summarizeArguments: summarizeToolArguments,
    limits,
  });
  return {
    execute: runtime.execute,
    snapshot: runtime.snapshot,
    getOpenAiTools: () => deriveOpenAiTools(context.principal, context.surface, aiToolRegistry),
    getAnthropicTools: () => deriveAnthropicTools(context.principal, context.surface, aiToolRegistry),
    getVisibleToolCatalog: () => deriveVisibleToolCatalog(context.principal, context.surface, aiToolRegistry),
  };
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
  const runtime = createAiToolExecutionRuntime({
    context,
    entries: options.entries ?? aiToolRegistry,
    audit: options.audit ?? recordAiToolAudit,
    summarizeArguments: summarizeToolArguments,
    limits: { maxTotalCalls: 1 },
  });
  return runtime.execute(name, rawArguments, { providerCallId: context.providerCallId });
}
