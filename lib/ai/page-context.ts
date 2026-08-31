export const AI_PAGE_CONTEXT_VERSION = 1 as const;

export const AI_PAGE_CONTEXT_CATALOG = {
  n8n_workflows: {
    label: "自动化中心",
    views: ["jackyun", "tmall", "jd", "jd_market", "jd_promotion", "jd_promotion_cut_meat"],
    suggestedTools: ["get_automation_run_status", "search_system_data"],
  },
  dashboard: {
    label: "BI 看板",
    views: ["overview"],
    suggestedTools: ["get_data_freshness", "get_sales_summary", "get_inventory_health", "get_netshop_performance"],
  },
  shop: {
    label: "网店分析",
    views: ["analysis", "outlets", "platforms", "products", "promotion"],
    suggestedTools: ["get_data_freshness", "get_netshop_performance", "get_netshop_page_data", "search_system_data"],
  },
  market: {
    label: "市场分析",
    views: ["ranking", "overview", "compare", "settings"],
    suggestedTools: ["get_data_freshness", "get_market_overview", "get_market_sku_trend", "get_market_brand_analysis", "get_market_price_band_analysis", "get_market_workspace_data"],
  },
  customer_service: {
    label: "客服分析",
    views: ["conversations"],
    suggestedTools: ["get_data_freshness", "get_customer_service_conversations", "search_system_knowledge"],
  },
  sales: {
    label: "销售分析",
    views: ["overview", "channel", "category", "finance", "targets"],
    suggestedTools: ["get_data_freshness", "get_sales_summary", "get_sales_category_analysis", "get_finance_page_data", "search_system_data"],
  },
  inventory: {
    label: "库存管理",
    views: ["overview", "age", "plan", "stale", "inbound"],
    suggestedTools: ["get_data_freshness", "get_inventory_health", "get_inventory_page_data", "list_replenishment_plans", "search_system_data"],
  },
  product: {
    label: "商品经营",
    views: ["overview", "calculator"],
    suggestedTools: ["get_data_freshness", "get_product_performance", "search_system_data"],
  },
  workflow: {
    label: "运营事务",
    views: ["plan", "inspection", "reviews", "launch", "variables"],
    suggestedTools: ["get_workflow_page_data", "search_system_data"],
  },
  import: {
    label: "数据导入",
    views: ["files", "history", "continuity"],
    suggestedTools: ["get_data_freshness", "get_import_status", "search_system_data"],
  },
  settings: {
    label: "系统设置",
    views: ["parameters", "master", "permissions"],
    suggestedTools: ["get_operating_settings_summary", "search_system_knowledge", "search_system_data"],
  },
  ai: {
    label: "AI 助理",
    views: ["assistant", "agents", "memory", "sandbox", "space", "management"],
    suggestedTools: ["list_my_agent_jobs", "list_my_agent_workflows", "search_personal_memory", "describe_analysis_datasets", "run_analysis_plan", "search_system_knowledge"],
  },
} as const;

export type AiPageModule = keyof typeof AI_PAGE_CONTEXT_CATALOG;

export type AiPageContext = {
  version: typeof AI_PAGE_CONTEXT_VERSION;
  module: AiPageModule;
  moduleLabel: string;
  view: string;
  period: { startDate: string; endDate: string } | null;
  importSource: string | null;
  suggestedTools: string[];
};

const isoDayPattern = /^\d{4}-\d{2}-\d{2}$/;
const safeKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

export function createAiPageContext(input: {
  module: string;
  view: string;
  startDate?: string | null;
  endDate?: string | null;
  importSource?: string | null;
}): AiPageContext {
  const context = normalizeAiPageContext({
    version: AI_PAGE_CONTEXT_VERSION,
    module: input.module,
    view: input.view,
    period: input.startDate && input.endDate
      ? { startDate: input.startDate, endDate: input.endDate }
      : null,
    importSource: input.importSource ?? null,
  });
  if (!context) throw new Error("AI 页面上下文无效");
  return context;
}

export function normalizeAiPageContext(value: unknown): AiPageContext | null {
  if (!isRecord(value)) return null;
  if (value.version !== undefined && value.version !== AI_PAGE_CONTEXT_VERSION) return null;
  if (typeof value.module !== "string" || !Object.hasOwn(AI_PAGE_CONTEXT_CATALOG, value.module)) return null;
  const pageModule = value.module as AiPageModule;
  const definition = AI_PAGE_CONTEXT_CATALOG[pageModule];
  if (typeof value.view !== "string" || !(definition.views as readonly string[]).includes(value.view)) return null;
  const period = normalizePeriod(value.period);
  if (value.period !== undefined && value.period !== null && period === null) return null;
  const importSource = value.importSource === undefined || value.importSource === null
    ? null
    : typeof value.importSource === "string" && safeKeyPattern.test(value.importSource)
      ? value.importSource
      : null;
  if (value.importSource !== undefined && value.importSource !== null && importSource === null) return null;
  return {
    version: AI_PAGE_CONTEXT_VERSION,
    module: pageModule,
    moduleLabel: definition.label,
    view: value.view,
    period,
    importSource,
    suggestedTools: [...definition.suggestedTools],
  };
}

export function buildAiPageContextPrompt(context: AiPageContext): string {
  const period = context.period
    ? `${context.period.startDate} 至 ${context.period.endDate}`
    : "当前页面不使用统一统计周期";
  return `请结合当前页面“${context.moduleLabel} / ${context.view}”分析。统计周期：${period}。请先核对数据新鲜度，再按我的问题调用有界只读工具。`;
}

export function serializeAiPageContextForSystemPrompt(context: AiPageContext): string {
  return JSON.stringify({
    version: context.version,
    module: context.module,
    moduleLabel: context.moduleLabel,
    view: context.view,
    period: context.period,
    importSource: context.importSource,
    suggestedTools: context.suggestedTools,
  });
}

function normalizePeriod(value: unknown): AiPageContext["period"] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)
    || typeof value.startDate !== "string"
    || typeof value.endDate !== "string"
    || !isoDayPattern.test(value.startDate)
    || !isoDayPattern.test(value.endDate)
    || value.startDate > value.endDate) return null;
  return { startDate: value.startDate, endDate: value.endDate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
