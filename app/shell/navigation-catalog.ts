export const moduleKeys = [
  "n8n_workflows",
  "dashboard",
  "shop",
  "market",
  "customer_service",
  "sales",
  "inventory",
  "product",
  "workflow",
  "import",
  "settings",
  "ai",
] as const;

export type ModuleKey = (typeof moduleKeys)[number];

export type NavItem = {
  key: ModuleKey;
  label: string;
  short: string;
  description: string;
  badge?: string;
};

export const navItems = [
  { key: "dashboard", label: "BI 看板", short: "BI", description: "经营驾驶舱" },
  { key: "market", label: "市场分析", short: "市", description: "榜单、行业与竞品洞察" },
  { key: "sales", label: "销售分析", short: "销", description: "利润与渠道表现" },
  { key: "shop", label: "网店分析", short: "店", description: "多网店经营分析" },
  { key: "customer_service", label: "客服分析", short: "服", description: "会话导入与聊天分析" },
  { key: "product", label: "货品详情", short: "品", description: "商品与毛利测算" },
  { key: "inventory", label: "库存管理", short: "库", description: "库存健康与备货" },
  { key: "workflow", label: "运营事务", short: "务", description: "计划、巡店与新品" },
  { key: "n8n_workflows", label: "工作流", short: "流", description: "自动化流程中心" },
  { key: "ai", label: "AI 助理", short: "AI", description: "模型、对话与渠道接入" },
  { key: "import", label: "数据导入", short: "入", description: "批次导入与校验" },
  { key: "settings", label: "系统设置", short: "设", description: "参数、映射与权限" },
] as const satisfies readonly NavItem[];

export type NavGroup = {
  label: string;
  keys: readonly ModuleKey[];
};

export const navGroups = [
  {
    label: "经营管理",
    keys: ["dashboard", "market", "sales", "shop", "customer_service", "product", "inventory", "workflow", "n8n_workflows", "ai"],
  },
  { label: "系统管理", keys: ["import", "settings"] },
] as const satisfies readonly NavGroup[];

export const importSourceKeys = [
  "sales",
  "inventory",
  "products",
  "inventory_age",
  "combos",
  "finance",
  "jd_sku",
  "jd_sku_images",
  "jd_sku_daily",
  "jd_spu_daily",
  "tmall_product_master",
  "tmall_product_daily",
  "tmall_promotion",
  "customer_service",
] as const;

export type ImportSourceKey = (typeof importSourceKeys)[number];

const moduleKeySet: ReadonlySet<string> = new Set(moduleKeys);
const importSourceKeySet: ReadonlySet<string> = new Set(importSourceKeys);

export function isModuleKey(value: string): value is ModuleKey {
  return moduleKeySet.has(value);
}

export function isImportSourceKey(value: string): value is ImportSourceKey {
  return importSourceKeySet.has(value);
}
