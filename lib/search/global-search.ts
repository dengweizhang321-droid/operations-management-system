import {
  getGlobalSearchNavigationTarget,
  globalSearchDefaultTargets,
  isGlobalSearchGroupKey,
  type GlobalSearchGroupKey,
  type GlobalSearchNavigationModule,
  type GlobalSearchNavigationTarget,
} from "./target-contract";
import type { AppPrincipal, AppRole } from "@/lib/auth/authorization";
import {
  createDjangoSalesConsumerReader,
  type SalesConsumerReader,
  type SalesConsumerResponseMap,
} from "@/lib/django/sales-consumer-reader";
import {
  createDjangoFinanceConsumerReader,
  type FinanceConsumerReader,
  type FinanceConsumerResponseMap,
} from "@/lib/django/finance-consumer-reader";
import {
  getFinanceBackendMode,
  type FinanceBackendMode,
} from "@/lib/django/finance-service";
import {
  createDjangoNetshopConsumerReader,
  type NetshopConsumerReader,
  type NetshopConsumerResponseMap,
} from "@/lib/django/netshop-consumer-reader";
import {
  createDjangoProductsConsumerReader,
  type ProductsConsumerReader,
  type ProductsConsumerResponseMap,
} from "@/lib/django/products-consumer-reader";
import {
  createDjangoInventoryConsumerReader,
  type InventoryConsumerReader,
  type InventoryConsumerResponseMap,
} from "@/lib/django/inventory-consumer-reader";
import {
  createDjangoWorkflowConsumerReader,
  type WorkflowConsumerReader,
} from "@/lib/django/workflow-consumer-reader";

export { globalSearchGroupKeys, isGlobalSearchGroupKey } from "./target-contract";
export type { GlobalSearchGroupKey, GlobalSearchNavigationTarget } from "./target-contract";

export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_QUERY_LENGTH = 80;
export const GLOBAL_SEARCH_DEFAULT_GROUP_LIMIT = 4;
export const GLOBAL_SEARCH_MAX_GROUP_LIMIT = 8;
export const GLOBAL_SEARCH_DEFAULT_TOTAL_LIMIT = 48;
export const GLOBAL_SEARCH_MAX_TOTAL_LIMIT = 50;
export const GLOBAL_SEARCH_MAX_GROUP_CONCURRENCY = 3;
export const GLOBAL_SEARCH_GROUP_DEADLINE_MS = 2_000;

const GLOBAL_SEARCH_MAX_GROUP_DEADLINE_MS = 10_000;

const GLOBAL_SEARCH_TEXT_LIMITS = {
  id: { characters: 160, bytes: 320 },
  title: { characters: 200, bytes: 768 },
  subtitle: { characters: 240, bytes: 768 },
  detail: { characters: 400, bytes: 1_536 },
  updatedAt: { characters: 48, bytes: 96 },
} as const;

export type GlobalSearchModule = GlobalSearchNavigationModule;

export type GlobalSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  updatedAt: string;
  amountCents: number | null;
  module: GlobalSearchModule;
  kind: GlobalSearchGroupKey;
  target: GlobalSearchNavigationTarget;
};

export type GlobalSearchGroup = {
  key: GlobalSearchGroupKey;
  label: string;
  icon: string;
  module: GlobalSearchModule;
  available: boolean;
  /** `total` is exact only when this flag is true; otherwise it is a known lower bound. */
  total: number;
  totalExact: boolean;
  hasMore: boolean;
  items: GlobalSearchItem[];
};

export type GlobalSearchRequest = {
  query: string;
  page: number;
  groupLimit: number;
  totalLimit: number;
  group: GlobalSearchGroupKey | null;
};

export type GlobalSearchResponse = {
  query: string;
  page: number;
  limits: { perGroup: number; total: number };
  returned: number;
  dataCutoffDate: string | null;
  filtersApplied: {
    query: string;
    group: GlobalSearchGroupKey | null;
    page: number;
    perGroupLimit: number;
    totalLimit: number;
    dataScope: {
      mode: "unrestricted" | "restricted";
      warehouses: string[] | null;
      channels: string[] | null;
      platforms: string[] | null;
    };
  };
  truncated: boolean;
  deadlineExceeded: boolean;
  timedOutDomains: string[];
  groups: GlobalSearchGroup[];
  coveredDomains: string[];
  unavailableDomains: string[];
};

type SearchDatabaseResult<T> = { results?: T[] };
type SearchPreparedStatement = {
  bind: (...values: unknown[]) => SearchPreparedStatement;
  all: <T>() => Promise<SearchDatabaseResult<T>>;
};

export type GlobalSearchDatabase = {
  prepare: (sql: string) => SearchPreparedStatement;
};

type SearchRow = {
  result_id: string | number | null;
  title: string | null;
  subtitle: string | null;
  detail: string | null;
  updated_at: string | null;
  amount_cents: number | null;
  target_hint?: string | null;
  total_count?: number;
};

export type GlobalSearchExecutionOptions = {
  /** Test/worker override; callers cannot raise the hard 10-second ceiling. */
  deadlineMs?: number;
  salesReader?: SalesConsumerReader;
  financeReader?: FinanceConsumerReader;
  netshopReader?: NetshopConsumerReader;
  productsReader?: ProductsConsumerReader;
  inventoryReader?: InventoryConsumerReader;
  financeBackendMode?: FinanceBackendMode;
  workflowReader?: WorkflowConsumerReader;
  /** Test-only compatibility override; terminal production behavior is always Django. */
  workflowBackendMode?: "django";
  signal?: AbortSignal;
};

type SearchGroupDefinitionBase = {
  label: string;
  icon: string;
  requiredTables: readonly string[];
  sql: string;
  likeParameterCount: number;
  allowedRoles: readonly AppRole[];
  scopeKind?: "warehouse" | "channel_platform" | "platform" | "finance" | "shop" | "unscoped_only";
};

type SearchGroupDefinition = {
  [K in GlobalSearchGroupKey]: SearchGroupDefinitionBase & {
    key: K;
    module: (typeof globalSearchDefaultTargets)[K]["module"];
  };
}[GlobalSearchGroupKey];

const allRoles = ["viewer", "analyst", "operator", "admin"] as const;
const businessRoles = ["analyst", "operator", "admin"] as const;
const financeRoles = ["analyst", "admin"] as const;
const operatorRoles = ["operator", "admin"] as const;

export class GlobalSearchRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "GlobalSearchRequestError";
  }
}

const globalSearchQueryKeys = new Set(["q", "group", "page", "pageSize", "limit", "totalLimit"]);

function singleParameter(searchParams: URLSearchParams, key: string): string | null {
  const values = searchParams.getAll(key);
  if (values.length > 1) throw new GlobalSearchRequestError(`${key} 参数不能重复。`);
  return values[0] ?? null;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number, field: string) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new GlobalSearchRequestError(`${field} 必须为十进制正整数。`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new GlobalSearchRequestError(`${field} 超出允许范围。`);
  if (parsed < min || parsed > max) throw new GlobalSearchRequestError(`分页参数必须在 ${min} 到 ${max} 之间。`);
  return parsed;
}

export function normalizeGlobalSearchRequest(searchParams: URLSearchParams): GlobalSearchRequest {
  for (const key of searchParams.keys()) {
    if (!globalSearchQueryKeys.has(key)) throw new GlobalSearchRequestError("存在不支持的查询参数。");
  }
  const query = (singleParameter(searchParams, "q") ?? "").trim();
  const queryLength = Array.from(query).length;
  if (queryLength < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    throw new GlobalSearchRequestError(`请输入至少 ${GLOBAL_SEARCH_MIN_QUERY_LENGTH} 个字符。`);
  }
  if (queryLength > GLOBAL_SEARCH_MAX_QUERY_LENGTH) {
    throw new GlobalSearchRequestError(`搜索词不能超过 ${GLOBAL_SEARCH_MAX_QUERY_LENGTH} 个字符。`);
  }
  const rawGroup = singleParameter(searchParams, "group");
  const group = rawGroup === null
    ? null
    : isGlobalSearchGroupKey(rawGroup) ? rawGroup : null;
  if (rawGroup !== null && !group) throw new GlobalSearchRequestError("搜索分组不在允许清单中。");
  const pageSize = singleParameter(searchParams, "pageSize");
  const legacyLimit = singleParameter(searchParams, "limit");
  if (pageSize !== null && legacyLimit !== null) {
    throw new GlobalSearchRequestError("pageSize 与 limit 不能同时提供。");
  }
  return {
    query,
    page: boundedInteger(singleParameter(searchParams, "page"), 1, 1, 10_000, "page"),
    groupLimit: boundedInteger(
      pageSize ?? legacyLimit,
      GLOBAL_SEARCH_DEFAULT_GROUP_LIMIT,
      1,
      GLOBAL_SEARCH_MAX_GROUP_LIMIT,
      pageSize !== null ? "pageSize" : "limit",
    ),
    totalLimit: boundedInteger(
      singleParameter(searchParams, "totalLimit"),
      GLOBAL_SEARCH_DEFAULT_TOTAL_LIMIT,
      1,
      GLOBAL_SEARCH_MAX_TOTAL_LIMIT,
      "totalLimit",
    ),
    group,
  };
}

export function escapeGlobalSearchLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

const staticDefinitions: readonly SearchGroupDefinition[] = [
  {
    key: "products",
    label: "货品主数据",
    icon: "品",
    module: "product",
    requiredTables: ["erp_product_master"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    sql: `
      SELECT product_code AS result_id, product_name AS title,
        TRIM(COALESCE(specification, '') || CASE WHEN brand <> '' THEN ' · ' || brand ELSE '' END || CASE WHEN supplier <> '' THEN ' · ' || supplier ELSE '' END) AS subtitle,
        COALESCE(category, '') || CASE WHEN product_status <> '' THEN ' · ' || product_status ELSE '' END AS detail,
        updated_at, NULL AS amount_cents
      FROM erp_product_master
      WHERE product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR specification LIKE ? ESCAPE '\\' COLLATE NOCASE OR barcode LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR brand LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR supplier LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC, product_code ASC
      LIMIT ? OFFSET ?`,
  },
  {
    key: "orders",
    label: "销售订单",
    icon: "单",
    module: "sales",
    requiredTables: [],
    likeParameterCount: 0,
    allowedRoles: allRoles,
    scopeKind: "channel_platform",
    sql: "",
  },
  {
    key: "jd_products",
    label: "京东 SKU / SPU / 网店商品",
    icon: "京",
    module: "shop",
    requiredTables: [],
    likeParameterCount: 0,
    allowedRoles: allRoles,
    scopeKind: "platform",
    sql: "",
  },
  {
    key: "inventory",
    label: "库存记录",
    icon: "库",
    module: "inventory",
    requiredTables: [],
    likeParameterCount: 0,
    allowedRoles: allRoles,
    scopeKind: "warehouse",
    sql: "",
  },
  {
    key: "market_skus",
    label: "市场 SKU",
    icon: "市",
    module: "market",
    requiredTables: ["market_ranking_entries", "market_price_snapshots", "market_master_identities"],
    likeParameterCount: 5,
    allowedRoles: allRoles,
    scopeKind: "unscoped_only",
    sql: `
      SELECT market.sku_code || ':' || market.category || ':' || market.scope AS result_id,
        market.product_name AS title,
        market.sku_code || CASE WHEN market.brand <> '' THEN ' · ' || market.brand ELSE '' END AS subtitle,
        market.category || CASE WHEN market.scope <> '' THEN ' · ' || market.scope ELSE '' END
          || CASE WHEN market.rank IS NOT NULL THEN ' · 第 ' || market.rank || ' 名' ELSE '' END AS detail,
        market.period_end AS updated_at,
        COALESCE(price.confirmed_market_price_cents, price.source_price_cents,
          price.average_transaction_price_cents, price.ai_image_price_cents, market.price_cents) AS amount_cents
      FROM market_master_identities identity
      JOIN market_ranking_entries market ON market.id = identity.latest_entry_id
      LEFT JOIN market_price_snapshots price
        ON price.category = market.category AND price.sku_code = market.sku_code
       AND price.ranking_dimension = market.ranking_dimension AND price.month = substr(market.period_end, 1, 7)
      WHERE market.sku_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR market.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR market.brand LIKE ? ESCAPE '\\' COLLATE NOCASE OR market.category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR market.scope LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY market.period_end DESC, market.rank ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "combos",
    label: "组合装关系",
    icon: "组",
    module: "product",
    requiredTables: ["erp_combo_items"],
    likeParameterCount: 4,
    allowedRoles: allRoles,
    sql: `
      SELECT CAST(id AS TEXT) AS result_id, parent_name AS title,
        parent_code || ' · 子件 ' || child_code AS subtitle,
        child_name || ' · 数量 ' || (child_quantity_milli / 1000.0) AS detail,
        updated_at, NULL AS amount_cents
      FROM erp_combo_items
      WHERE parent_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR parent_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR child_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR child_name LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC, parent_code ASC, child_code ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "replenishment",
    label: "备货计划",
    icon: "备",
    module: "inventory",
    requiredTables: [],
    likeParameterCount: 0,
    allowedRoles: businessRoles,
    scopeKind: "warehouse",
    sql: "",
  },
  {
    key: "market_annotations",
    label: "细分品类标注",
    icon: "标",
    module: "market",
    requiredTables: ["market_sku_annotations"],
    likeParameterCount: 3,
    allowedRoles: allRoles,
    scopeKind: "unscoped_only",
    sql: `
      SELECT id AS result_id, sku_code AS title, segment AS subtitle,
        category AS detail,
        updated_at, image_price_cents AS amount_cents
      FROM market_sku_annotations
      WHERE sku_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR segment LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC, sku_code ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "customer_service",
    label: "客服会话",
    icon: "服",
    module: "customer_service",
    requiredTables: ["customer_service_conversations"],
    likeParameterCount: 10,
    allowedRoles: businessRoles,
    scopeKind: "unscoped_only",
    sql: `
      SELECT CAST(id AS TEXT) AS result_id,
        COALESCE(NULLIF(customer_alias, ''), NULLIF(customer_id, ''), NULLIF(chat_customer_alias, ''), '匿名顾客') AS title,
        COALESCE(NULLIF(product_name, ''), NULLIF(product_sku, ''), '未关联商品') || CASE WHEN agent <> '' THEN ' · ' || agent ELSE '' END AS subtitle,
        COALESCE(NULLIF(summary_text, ''), NULLIF(service_issues, ''), consultation_type) || CASE WHEN problem_type <> '' THEN ' · ' || problem_type ELSE '' END AS detail,
        consulted_at AS updated_at, NULL AS amount_cents
      FROM customer_service_conversations
      WHERE customer_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR chat_customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE OR agent LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR product_sku LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR conversation_id LIKE ? ESCAPE '\\' COLLATE NOCASE /*CUSTOMER_MESSAGES*/
        OR problem_type LIKE ? ESCAPE '\\' COLLATE NOCASE OR service_issues LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR summary_text LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY consulted_at DESC, id DESC LIMIT ? OFFSET ?`,
  },
  {
    key: "finance",
    label: "财务科目",
    icon: "财",
    module: "sales",
    requiredTables: ["finance_lines"],
    likeParameterCount: 7,
    allowedRoles: financeRoles,
    scopeKind: "finance",
    sql: `
      SELECT CAST(id AS TEXT) AS result_id, subject_name AS title,
        month || CASE WHEN scope_name <> '' THEN ' · ' || scope_name ELSE '' END AS subtitle,
        section || CASE WHEN group_name <> '' THEN ' · ' || group_name ELSE '' END AS detail,
        created_at AS updated_at, amount_cents
      FROM finance_lines
      WHERE (subject_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR metric_key LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR scope_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR scope_key LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR group_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR month LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR raw_value LIKE ? ESCAPE '\\' COLLATE NOCASE)
        /*SCOPE*/
      ORDER BY month DESC, sort_order ASC, id DESC LIMIT ? OFFSET ?`,
  },
  {
    key: "targets",
    label: "经营目标",
    icon: "目",
    module: "sales",
    requiredTables: ["finance_targets_scoped"],
    likeParameterCount: 7,
    allowedRoles: financeRoles,
    scopeKind: "platform",
    sql: `
      SELECT id AS result_id, period_key AS title,
        CASE WHEN platform <> '' THEN platform || ' · ' ELSE '' END || COALESCE(NULLIF(shop_name, ''), '全局')
          || CASE WHEN category <> '' THEN ' · ' || category ELSE '' END AS subtitle,
        period_type || CASE WHEN manager <> '' THEN ' · ' || manager ELSE '' END AS detail,
        updated_at, sales_target_cents AS amount_cents
      FROM finance_targets_scoped
      WHERE (period_key LIKE ? ESCAPE '\\' COLLATE NOCASE OR period_type LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR platform LIKE ? ESCAPE '\\' COLLATE NOCASE OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR manager LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE)
        /*SCOPE*/
      ORDER BY updated_at DESC, period_key DESC LIMIT ? OFFSET ?`,
  },
] as const;

const financeSearchDefinition = staticDefinitions.find((definition) => definition.key === "finance")!;
const targetSearchDefinition = staticDefinitions.find((definition) => definition.key === "targets")!;
const inventorySearchDefinition = staticDefinitions.find((definition) => definition.key === "inventory")!;
const replenishmentSearchDefinition = staticDefinitions.find((definition) => definition.key === "replenishment")!;

const legacyTargetsDefinition: SearchGroupDefinition = {
  key: "targets",
  label: "经营目标",
  icon: "目",
  module: "sales",
  requiredTables: ["finance_targets"],
  likeParameterCount: 6,
  allowedRoles: financeRoles,
  scopeKind: "unscoped_only",
  sql: `
    SELECT id AS result_id, period_key AS title,
      COALESCE(NULLIF(shop_name, ''), '全局') || CASE WHEN category <> '' THEN ' · ' || category ELSE '' END AS subtitle,
      period_type || CASE WHEN manager <> '' THEN ' · ' || manager ELSE '' END AS detail,
      updated_at, sales_target_cents AS amount_cents
    FROM finance_targets
    WHERE (period_key LIKE ? ESCAPE '\\' COLLATE NOCASE OR period_type LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR manager LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE)
      /*SCOPE*/
    ORDER BY updated_at DESC, period_key DESC LIMIT ? OFFSET ?`,
};

const workflowDefinition = {
  key: "workflow" as const,
  label: "运营事务",
  icon: "务",
  module: "workflow" as const,
};

const salesOrderDefinition = {
  key: "orders" as const,
  label: "销售订单",
  icon: "单",
  module: "sales" as const,
};

const importSources = [
  { table: "erp_reference_import_batches", source: "source_label", file: "file_name", searchable: ["id", "file_name", "source_key", "source_label", "status"] },
  { table: "finance_import_batches", source: "'月度财报'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
  { table: "market_import_batches", source: "'市场 · ' || source_type", file: "file_name", searchable: ["id", "file_name", "source_type", "status"] },
  { table: "customer_service_import_batches", source: "'客服会话'", file: "session_file_name || ' / ' || chat_file_name", searchable: ["id", "session_file_name", "chat_file_name", "status"] },
] as const;

const inventoryAgeDefinition = {
  key: "inventory_age" as const,
  label: "库龄数据",
  icon: "龄",
  module: "inventory" as const,
};

const importDefinition = {
  key: "imports" as const,
  label: "导入批次",
  icon: "入",
  module: "import" as const,
};

export const GLOBAL_SEARCH_COVERAGE = [
  "货品主数据",
  "销售订单",
  "京东 SKU/SPU 与网店商品",
  "库存记录",
  "库龄数据（仓库库龄与滚动销量）",
  "组合装关系",
  "备货计划",
  "市场 SKU 与细分品类标注",
  "客服会话（仅显式客服分组允许授权角色按正文匹配，且只返回最小摘要）",
  "财务科目与经营目标",
  "运营事务",
  "导入批次",
] as const;

/**
 * Every durable table in db/schema.ts must remain classified here. The unit
 * test intentionally fails when a future migration adds an unreviewed table.
 */
export const GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT = {
  searchable: [
    "workflow_tasks", "workflow_operation_records",
    "inventory_import_batches", "inventory_stock_lines", "inventory_age_metrics",
    "product_shipping_rate_import_batches",
    "erp_reference_import_batches", "erp_product_master", "erp_inventory_age_lines", "erp_combo_items",
    "replenishment_plan_items",
    "finance_import_batches", "finance_lines", "finance_targets_scoped",
    "market_import_batches", "market_ranking_entries", "market_sku_annotations",
    "customer_service_conversations", "customer_service_import_batches",
  ],
  coveredByProjection: [
    "finance_months", "finance_targets",
    "market_price_snapshots",
    "product_shipping_rates",
  ],
  excludedSensitiveOrInternal: [
    "app_users", "ai_models", "ai_channels", "ai_channel_callback_events",
    "ai_chat_request_receipts", "ai_chat_provider_dispatches",
    "ai_conversations", "ai_conversation_scopes", "ai_conversation_messages", "ai_conversation_deletion_audits", "system_settings", "workflow_task_bootstrap",
    "ai_space_model_profiles", "ai_space_templates", "ai_space_jobs", "ai_space_job_items", "ai_space_assets",
    "ai_space_asset_favorites", "ai_space_asset_cleanup_queue", "ai_space_admin_audits",
    "ai_space_dispatch_receipts", "ai_space_dispatch_results", "ai_space_schema_upgrades",
    "ai_memory_entries", "ai_memory_audit_logs", "ai_memory_commit_guards",
    "ai_analysis_runs", "ai_agent_jobs", "ai_agent_checkpoints", "ai_agent_events",
    "ai_agent_provider_dispatches", "ai_agent_provider_results", "ai_agent_tool_dispatches", "ai_agent_tool_results",
    "ai_workflow_runs", "ai_workflow_node_runs", "ai_workflow_events",
    "workflow_operation_activities", "workflow_task_states", "workflow_task_template_states",
    "workflow_attachment_cleanup_queue", "workflow_task_activity_logs", "workflow_task_attachments", "workflow_task_comments",
    "workflow_task_entity_links", "workflow_task_reminders", "workflow_task_templates",
    "customer_service_conversation_versions", "customer_service_deletion_audits", "finance_write_authority", "finance_target_versions", "finance_target_deletion_audits",
    "finance_target_scoped_versions", "finance_target_scoped_deletion_audits", "finance_target_legacy_migrations",
    "ai_tool_audit_logs",
    "inventory_import_uploads", "inventory_import_upload_chunks", "inventory_import_upload_results",
    "market_annotation_prompt_versions", "market_annotation_prompt_audits", "market_annotation_jobs", "market_annotation_items",
    "market_annotation_commit_receipts", "market_annotation_validation_samples",
    "market_annotation_validation_runs", "market_annotation_validation_results", "market_annotation_local_agents",
    "market_image_cache", "market_sku_gmv_totals", "market_price_band_versions", "market_price_band_items",
    "market_master_mapping_rules", "market_subcategory_taxonomy", "market_download_configs", "market_download_tasks", "market_master_audit_logs",
  ],
} as const;

type SearchGroupIdentity = Pick<SearchGroupDefinition, "key" | "label" | "icon" | "module">;

function emptyGroup(definition: SearchGroupIdentity, totalExact = true): GlobalSearchGroup {
  return { ...definition, available: false, total: 0, totalExact, hasMore: false, items: [] };
}

function incompleteGroup(definition: SearchGroupIdentity, available: boolean): GlobalSearchGroup {
  return available
    ? { ...definition, available: true, total: 0, totalExact: false, hasMore: false, items: [] }
    : emptyGroup(definition);
}

function mapSearchRows(
  definition: SearchGroupIdentity,
  rows: SearchRow[],
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  totalOverride?: number,
): GlobalSearchGroup {
  const offset = (request.page - 1) * request.groupLimit;
  const hasMore = totalOverride === undefined
    ? rows.length > request.groupLimit
    : offset + Math.min(rows.length, request.groupLimit) < totalOverride;
  const visibleRows = rows.slice(0, request.groupLimit);
  // LIMIT + 1 proves only that another row exists. On a non-empty terminal
  // page the offset makes the count exact; an out-of-range page has no safe
  // lower bound beyond zero without re-running a count query.
  const total = totalOverride ?? (visibleRows.length === 0 && request.page > 1
    ? 0
    : offset + visibleRows.length + (hasMore ? 1 : 0));
  const totalExact = totalOverride !== undefined
    || (!hasMore && (request.page === 1 || visibleRows.length > 0));
  const items = visibleRows.map((row) => {
    const target = getGlobalSearchNavigationTarget(definition.key, row.target_hint);
    return {
      kind: definition.key,
      id: boundGlobalSearchText(row.result_id, GLOBAL_SEARCH_TEXT_LIMITS.id),
      title: boundGlobalSearchText(row.title, GLOBAL_SEARCH_TEXT_LIMITS.title),
      subtitle: boundGlobalSearchText(row.subtitle, GLOBAL_SEARCH_TEXT_LIMITS.subtitle),
      detail: boundGlobalSearchText(row.detail, GLOBAL_SEARCH_TEXT_LIMITS.detail),
      updatedAt: boundGlobalSearchText(row.updated_at, GLOBAL_SEARCH_TEXT_LIMITS.updatedAt),
      amountCents: principal.role === "viewer" || row.amount_cents === null || row.amount_cents === undefined
        ? null
        : Number(row.amount_cents),
      module: target.module,
      target,
    };
  });
  return {
    ...definition,
    available: true,
    total,
    totalExact,
    hasMore,
    items,
  };
}

function boundGlobalSearchText(
  value: unknown,
  limits: { characters: number; bytes: number },
): string {
  const characterBounded = Array.from(String(value ?? "")).slice(0, limits.characters).join("");
  const encoded = new TextEncoder().encode(characterBounded);
  if (encoded.byteLength <= limits.bytes) return characterBounded;
  let end = limits.bytes;
  while (end > 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(encoded.slice(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

function isGroupAuthorized(definition: Pick<SearchGroupDefinition, "allowedRoles" | "scopeKind">, principal: AppPrincipal) {
  return definition.allowedRoles.includes(principal.role)
    && !(definition.scopeKind === "unscoped_only" && principal.scope !== null);
}

function scopeSql(
  principal: AppPrincipal,
  kind: SearchGroupDefinition["scopeKind"],
  columns: { warehouse?: string; channel?: string; platform?: string; shop?: string; financeName?: string; financeKey?: string } = {},
) {
  if (principal.scope === null || !kind || kind === "unscoped_only") return { clause: "", values: [] as string[] };
  const placeholders = (values: readonly string[]) => values.map(() => "?").join(", ");
  if (kind === "warehouse") {
    const values = principal.scope.warehouses;
    return values.length === 0
      ? { clause: "AND 1 = 0", values: [] as string[] }
      : { clause: `AND ${columns.warehouse ?? "warehouse"} IN (${placeholders(values)})`, values: [...values] };
  }
  if (kind === "channel_platform") {
    const channels = principal.scope.channels;
    const platforms = principal.scope.platforms;
    const clauses: string[] = [];
    if (channels.length > 0) clauses.push(`${columns.channel ?? "channel"} IN (${placeholders(channels)})`);
    if (platforms.length > 0) clauses.push(`${columns.platform ?? "platform"} IN (${placeholders(platforms)})`);
    return clauses.length === 0
      ? { clause: "AND 1 = 0", values: [] as string[] }
      : { clause: `AND (${clauses.join(" OR ")})`, values: [...channels, ...platforms] };
  }
  if (kind === "platform") {
    const values = principal.scope.platforms;
    return values.length === 0
      ? { clause: "AND 1 = 0", values: [] as string[] }
      : { clause: `AND ${columns.platform ?? "platform"} IN (${placeholders(values)})`, values: [...values] };
  }
  const values = [...new Set([...principal.scope.channels, ...principal.scope.platforms])];
  if (values.length === 0) return { clause: "AND 1 = 0", values: [] as string[] };
  if (kind === "shop") {
    return { clause: `AND ${columns.shop ?? "shop_name"} IN (${placeholders(values)})`, values };
  }
  const first = columns.financeName ?? "scope_name";
  const second = columns.financeKey ?? "scope_key";
  return {
    clause: `AND (${first} IN (${placeholders(values)}) OR ${second} IN (${placeholders(values)}))`,
    values: [...values, ...values],
  };
}

function activeStaticDefinition(definition: SearchGroupDefinition, tables: Set<string>): SearchGroupDefinition {
  return definition.key === "targets"
    && !definition.requiredTables.every((table) => tables.has(table))
    && legacyTargetsDefinition.requiredTables.every((table) => tables.has(table))
    ? legacyTargetsDefinition
    : definition;
}

async function queryStaticGroup(db: GlobalSearchDatabase, definition: SearchGroupDefinition, tables: Set<string>, request: GlobalSearchRequest, like: string, principal: AppPrincipal) {
  const activeDefinition = activeStaticDefinition(definition, tables);
  if (!activeDefinition.requiredTables.every((table) => tables.has(table))) return emptyGroup(definition);
  // Legacy finance targets do not carry a platform identity. A restricted
  // principal cannot safely infer platform access from the free-form shop name.
  if (!isGroupAuthorized(activeDefinition, principal)) {
    return mapSearchRows(activeDefinition, [], request, principal);
  }
  try {
    const scope = scopeSql(principal, activeDefinition.scopeKind);
    const includeCustomerMessages = activeDefinition.key === "customer_service" && request.group === "customer_service";
    const sql = activeDefinition.sql
      .replace("/*SCOPE*/", scope.clause)
      .replace(
        "/*CUSTOMER_MESSAGES*/",
        includeCustomerMessages ? "OR messages_json LIKE ? ESCAPE '\\' COLLATE NOCASE" : "",
      );
    const likeParameterCount = activeDefinition.likeParameterCount + (includeCustomerMessages ? 1 : 0);
    const values: unknown[] = [...Array.from({ length: likeParameterCount }, () => like), ...scope.values];
    const result = await db.prepare(sql)
      .bind(...values, request.groupLimit + 1, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    return mapSearchRows(activeDefinition, result.results ?? [], request, principal);
  } catch {
    // A partially migrated table must not take down search for every other domain.
    return emptyGroup(definition, false);
  }
}

async function queryWorkflowGroup(
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  workflowReader: WorkflowConsumerReader,
  signal?: AbortSignal,
) {
  const offset = (request.page - 1) * request.groupLimit;
  try {
    const result = await workflowReader.read(principal, {
      operation: "workflow_search",
      query: request.query,
      offset,
      limit: request.groupLimit,
    }, { signal });
    const rows: SearchRow[] = result.data.items.map((item) => ({
      result_id: item.resultId!,
      title: item.title,
      subtitle: item.subtitle,
      detail: item.detail,
      updated_at: item.updatedAt,
      amount_cents: item.amountCents,
      target_hint: item.targetHint ?? "task",
    }));
    return mapSearchRows(workflowDefinition, rows, request, principal, result.data.total);
  } catch {
    return emptyGroup(workflowDefinition, false);
  }
}

function validSalesOrderSearch(value: unknown): value is SalesConsumerResponseMap["order_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.title === "string"
        && typeof row.subtitle === "string" && typeof row.detail === "string"
        && typeof row.updatedAt === "string" && Number.isSafeInteger(row.amountCents);
    });
}

function validSalesImportSearch(value: unknown): value is SalesConsumerResponseMap["import_batch_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.source === "string"
        && typeof row.fileName === "string" && typeof row.status === "string"
        && Number.isSafeInteger(row.rowCount) && typeof row.createdAt === "string"
        && (row.completedAt === null || typeof row.completedAt === "string");
    });
}

function validConsumerPage(
  data: { items: unknown[]; total: number; truncated: boolean },
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize;
  const expectedLength = offset >= data.total ? 0 : Math.min(pageSize, data.total - offset);
  return data.items.length === expectedLength && data.truncated === page * pageSize < data.total;
}

async function querySalesOrderGroup(
  salesReader: SalesConsumerReader,
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  signal?: AbortSignal,
) {
  try {
    const result = await salesReader.read(principal, {
      operation: "order_search",
      query: request.query,
      page: request.page,
      pageSize: request.groupLimit,
    }, { signal });
    if (!result || typeof result.revision !== "string" || !result.revision
      || !validSalesOrderSearch(result.data)
      || !validConsumerPage(result.data, request.page, request.groupLimit)) {
      return emptyGroup(salesOrderDefinition, false);
    }
    const rows: SearchRow[] = result.data.items.map((item) => ({
      result_id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      detail: item.detail,
      updated_at: item.updatedAt,
      amount_cents: item.amountCents,
    }));
    return mapSearchRows(salesOrderDefinition, rows, request, principal, result.data.total);
  } catch {
    return emptyGroup(salesOrderDefinition, false);
  }
}

function validNetshopSearch(
  value: unknown,
): value is NetshopConsumerResponseMap["row_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.title === "string"
        && typeof row.subtitle === "string" && typeof row.detail === "string"
        && typeof row.updatedAt === "string" && row.amountCents === null;
    });
}

function validNetshopImportSearch(
  value: unknown,
): value is NetshopConsumerResponseMap["import_batch_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.source === "string"
        && typeof row.dataset === "string" && typeof row.platform === "string"
        && typeof row.shopName === "string" && typeof row.fileName === "string"
        && typeof row.status === "string" && Number.isSafeInteger(row.rowCount)
        && typeof row.createdAt === "string"
        && (row.completedAt === null || typeof row.completedAt === "string");
    });
}

function validProductsImportSearch(
  value: unknown,
): value is ProductsConsumerResponseMap["import_batch_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.source === "string"
        && typeof row.fileName === "string" && typeof row.status === "string"
        && Number.isSafeInteger(row.rowCount) && typeof row.createdAt === "string"
        && (row.completedAt === null || typeof row.completedAt === "string");
    });
}

async function queryNetshopSearchGroup(
  netshopReader: NetshopConsumerReader,
  definition: SearchGroupDefinition,
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  signal?: AbortSignal,
) {
  try {
    const offset = (request.page - 1) * request.groupLimit;
    const result = await netshopReader.read(principal, {
      operation: "row_search",
      query: request.query,
      offset,
      limit: request.groupLimit,
    }, { signal });
    if (!result.revision || !validNetshopSearch(result.data)
      || !validFinanceConsumerWindow(result.data, offset, request.groupLimit)) {
      return emptyGroup(definition, false);
    }
    return mapSearchRows(
      definition,
      result.data.items.map((item) => ({
        result_id: String(item.id),
        title: String(item.title),
        subtitle: String(item.subtitle),
        detail: String(item.detail),
        updated_at: String(item.updatedAt),
        amount_cents: item.amountCents === null ? null : Number(item.amountCents),
      })),
      request,
      principal,
      result.data.total,
    );
  } catch {
    return emptyGroup(definition, false);
  }
}

type FinanceSearchOperation = "line_search" | "target_search";

function validFinanceSearch(
  value: unknown,
): value is FinanceConsumerResponseMap[FinanceSearchOperation] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.title === "string"
        && typeof row.subtitle === "string" && typeof row.detail === "string"
        && typeof row.updatedAt === "string"
        && (row.amountCents === null || Number.isSafeInteger(row.amountCents));
    });
}

function validFinanceImportSearch(
  value: unknown,
): value is FinanceConsumerResponseMap["import_batch_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.source === "string"
        && typeof row.fileName === "string" && typeof row.status === "string"
        && Number.isSafeInteger(row.rowCount) && typeof row.createdAt === "string"
        && (row.completedAt === null || typeof row.completedAt === "string");
    });
}

function validFinanceConsumerWindow(
  data: { items: unknown[]; total: number; truncated: boolean },
  offset: number,
  limit: number,
) {
  const expectedLength = offset >= data.total ? 0 : Math.min(limit, data.total - offset);
  return data.items.length === expectedLength
    && data.truncated === offset + limit < data.total;
}

async function queryFinanceSearchGroup(
  financeReader: FinanceConsumerReader,
  operation: FinanceSearchOperation,
  definition: SearchGroupDefinition,
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  signal?: AbortSignal,
) {
  try {
    const offset = (request.page - 1) * request.groupLimit;
    const result = await financeReader.read(principal, {
      operation,
      query: request.query,
      offset,
      limit: request.groupLimit,
    }, { signal });
    if (!result || typeof result.revision !== "string" || !result.revision
      || !validFinanceSearch(result.data)
      || !validFinanceConsumerWindow(result.data, offset, request.groupLimit)) {
      return emptyGroup(definition, false);
    }
    const rows: SearchRow[] = result.data.items.map((item) => ({
      result_id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      detail: item.detail,
      updated_at: item.updatedAt,
      amount_cents: item.amountCents,
      total_count: result.data.total,
    }));
    return mapSearchRows(definition, rows, request, principal, result.data.total);
  } catch {
    return emptyGroup(definition, false);
  }
}

type InventorySearchOperation = "inventory_search" | "age_search" | "replenishment_search";

function validInventorySearch(
  value: unknown,
): value is InventoryConsumerResponseMap[InventorySearchOperation] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.title === "string"
        && typeof row.subtitle === "string" && typeof row.detail === "string"
        && typeof row.updatedAt === "string"
        && (row.amountCents === null || Number.isSafeInteger(row.amountCents));
    });
}

async function queryInventorySearchGroup(
  reader: InventoryConsumerReader,
  operation: InventorySearchOperation,
  definition: SearchGroupIdentity,
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  signal?: AbortSignal,
) {
  try {
    const offset = (request.page - 1) * request.groupLimit;
    const result = operation === "replenishment_search"
      ? await reader.read(principal, {
          operation,
          query: request.query,
          status: null,
          warehouse: null,
          offset,
          limit: request.groupLimit,
        }, { signal })
      : await reader.read(principal, {
          operation,
          query: request.query,
          offset,
          limit: request.groupLimit,
        }, { signal });
    if (!result.revision || !validInventorySearch(result.data)
      || !validFinanceConsumerWindow(result.data, offset, request.groupLimit)) {
      return emptyGroup(definition, false);
    }
    return mapSearchRows(
      definition,
      result.data.items.map((item) => ({
        result_id: String(item.id),
        title: String(item.title),
        subtitle: String(item.subtitle),
        detail: String(item.detail),
        updated_at: String(item.updatedAt),
        amount_cents: item.amountCents === null ? null : Number(item.amountCents),
      })),
      request,
      principal,
      result.data.total,
    );
  } catch {
    return emptyGroup(definition, false);
  }
}

function validInventoryImportSearch(
  value: unknown,
): value is InventoryConsumerResponseMap["import_batch_search"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items)
    && Number.isSafeInteger(data.total) && Number(data.total) >= 0
    && typeof data.truncated === "boolean"
    && data.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.source === "string"
        && typeof row.dataset === "string" && typeof row.fileName === "string"
        && typeof row.status === "string" && Number.isSafeInteger(row.rowCount)
        && typeof row.createdAt === "string"
        && (row.completedAt === null || typeof row.completedAt === "string");
    });
}

async function queryLocalImportRows(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  like: string,
  limit: number,
  offset: number,
  includeFinance: boolean,
) {
  const availableSources = importSources.filter((source) =>
    tables.has(source.table) && (includeFinance || source.table !== "finance_import_batches"));
  if (availableSources.length === 0) return { rows: [] as SearchRow[], total: 0 };
  const binds: unknown[] = [];
  const fragments = availableSources.map((source) => {
    const conditions = source.searchable.map((column) => {
      binds.push(like);
      return `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    });
    return `SELECT id AS result_id, ${source.file} AS title, ${source.source} AS subtitle,
      status AS detail, COALESCE(completed_at, created_at) AS updated_at, NULL AS amount_cents
      FROM ${source.table} WHERE ${conditions.join(" OR ")}`;
  });
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents,
    COUNT(*) OVER() AS total_count FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  const result = await db.prepare(sql).bind(
    ...binds,
    limit > 0 ? limit : 1,
    limit > 0 ? offset : 0,
  ).all<SearchRow>();
  const rows = result.results ?? [];
  if (limit <= 0) {
    return { rows: [] as SearchRow[], total: Number(rows[0]?.total_count ?? 0) };
  }
  if (rows.length > 0) return { rows, total: Number(rows[0].total_count ?? 0) };
  const head = await db.prepare(sql).bind(...binds, 1, 0).all<SearchRow>();
  return { rows, total: Number(head.results?.[0]?.total_count ?? 0) };
}

async function queryImportGroup(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  request: GlobalSearchRequest,
  like: string,
  principal: AppPrincipal,
  salesReader: SalesConsumerReader,
  financeReader: FinanceConsumerReader,
  netshopReader: NetshopConsumerReader,
  productsReader: ProductsConsumerReader,
  inventoryReader: InventoryConsumerReader,
  financeMode: FinanceBackendMode,
  signal?: AbortSignal,
) {
  try {
    const salesHead = await salesReader.read(principal, {
      operation: "import_batch_search",
      query: request.query,
      page: 1,
      pageSize: 1,
    }, { signal });
    if (!salesHead || typeof salesHead.revision !== "string" || !salesHead.revision
      || !validSalesImportSearch(salesHead.data)
      || !validConsumerPage(salesHead.data, 1, 1)) return emptyGroup(importDefinition, false);
    const salesTotal = salesHead.data.total;
    let financeRevision = "";
    let financeTotal = 0;
    if (financeMode === "django") {
      const financeHead = await financeReader.read(principal, {
        operation: "import_batch_search",
        query: request.query,
        offset: 0,
        limit: 1,
      }, { signal });
      if (!financeHead || typeof financeHead.revision !== "string" || !financeHead.revision
        || !validFinanceImportSearch(financeHead.data)
        || !validFinanceConsumerWindow(financeHead.data, 0, 1)) {
        return emptyGroup(importDefinition, false);
      }
      financeRevision = financeHead.revision;
      financeTotal = financeHead.data.total;
    }
    const netshopHead = await netshopReader.read(principal, {
      operation: "import_batch_search",
      query: request.query,
      offset: 0,
      limit: 1,
    }, { signal });
    if (!netshopHead.revision || !validNetshopImportSearch(netshopHead.data)
      || !validFinanceConsumerWindow(netshopHead.data, 0, 1)) {
      return emptyGroup(importDefinition, false);
    }
    const netshopRevision = netshopHead.revision;
    const netshopTotal = netshopHead.data.total;
    const productsHead = await productsReader.read(principal, {
      operation: "import_batch_search",
      query: request.query,
      offset: 0,
      limit: 1,
    }, { signal });
    if (!productsHead.revision || !validProductsImportSearch(productsHead.data)
      || !validFinanceConsumerWindow(productsHead.data, 0, 1)) {
      return emptyGroup(importDefinition, false);
    }
    const productsRevision = productsHead.revision;
    const productsTotal = productsHead.data.total;
    const inventoryHead = await inventoryReader.read(principal, {
      operation: "import_batch_search",
      dataset: null,
      query: request.query,
      offset: 0,
      limit: 1,
    }, { signal });
    if (!inventoryHead.revision || !validInventoryImportSearch(inventoryHead.data)
      || !validFinanceConsumerWindow(inventoryHead.data, 0, 1)) {
      return emptyGroup(importDefinition, false);
    }
    const inventoryRevision = inventoryHead.revision;
    const inventoryTotal = inventoryHead.data.total;
    const globalOffset = (request.page - 1) * request.groupLimit;
    const salesTake = globalOffset < salesTotal ? Math.min(request.groupLimit, salesTotal - globalOffset) : 0;
    let salesItems: SalesConsumerResponseMap["import_batch_search"]["items"] = [];
    if (salesTake > 0) {
      const salesPage = await salesReader.read(principal, {
        operation: "import_batch_search",
        query: request.query,
        page: request.page,
        pageSize: request.groupLimit,
      }, { signal });
      if (!salesPage || salesPage.revision !== salesHead.revision
        || !validSalesImportSearch(salesPage.data) || salesPage.data.total !== salesTotal
        || !validConsumerPage(salesPage.data, request.page, request.groupLimit)
        || salesPage.data.items.length !== salesTake) return emptyGroup(importDefinition, false);
      salesItems = salesPage.data.items;
    }
    const financeOffset = Math.max(0, globalOffset - salesTotal);
    const financeTake = financeMode === "django" && financeOffset < financeTotal
      ? Math.min(request.groupLimit - salesItems.length, financeTotal - financeOffset)
      : 0;
    let financeItems: FinanceConsumerResponseMap["import_batch_search"]["items"] = [];
    if (financeTake > 0) {
      const financePage = await financeReader.read(principal, {
        operation: "import_batch_search",
        query: request.query,
        offset: financeOffset,
        limit: financeTake,
      }, { signal });
      if (!financePage || financePage.revision !== financeRevision
        || !validFinanceImportSearch(financePage.data)
        || !validFinanceConsumerWindow(financePage.data, financeOffset, financeTake)
        || financePage.data.total !== financeTotal
        || financePage.data.items.length !== financeTake) {
        return emptyGroup(importDefinition, false);
      }
      financeItems = financePage.data.items;
    }
    const netshopOffset = Math.max(0, globalOffset - salesTotal - financeTotal);
    const netshopTake = netshopOffset < netshopTotal
      ? Math.min(request.groupLimit - salesItems.length - financeItems.length, netshopTotal - netshopOffset)
      : 0;
    let netshopItems: NetshopConsumerResponseMap["import_batch_search"]["items"] = [];
    if (netshopTake > 0) {
      const netshopPage = await netshopReader.read(principal, {
        operation: "import_batch_search",
        query: request.query,
        offset: netshopOffset,
        limit: netshopTake,
      }, { signal });
      if (netshopPage.revision !== netshopRevision
        || !validNetshopImportSearch(netshopPage.data)
        || !validFinanceConsumerWindow(netshopPage.data, netshopOffset, netshopTake)
        || netshopPage.data.total !== netshopTotal
        || netshopPage.data.items.length !== netshopTake) {
        return emptyGroup(importDefinition, false);
      }
      netshopItems = netshopPage.data.items;
    }
    const productsOffset = Math.max(0, globalOffset - salesTotal - financeTotal - netshopTotal);
    const productsTake = productsOffset < productsTotal
      ? Math.min(
          request.groupLimit - salesItems.length - financeItems.length - netshopItems.length,
          productsTotal - productsOffset,
        )
      : 0;
    let productsItems: ProductsConsumerResponseMap["import_batch_search"]["items"] = [];
    if (productsTake > 0) {
      const productsPage = await productsReader.read(principal, {
        operation: "import_batch_search",
        query: request.query,
        offset: productsOffset,
        limit: productsTake,
      }, { signal });
      if (productsPage.revision !== productsRevision
        || !validProductsImportSearch(productsPage.data)
        || !validFinanceConsumerWindow(productsPage.data, productsOffset, productsTake)
        || productsPage.data.total !== productsTotal
        || productsPage.data.items.length !== productsTake) {
        return emptyGroup(importDefinition, false);
      }
      productsItems = productsPage.data.items;
    }
    const inventoryOffset = Math.max(
      0,
      globalOffset - salesTotal - financeTotal - netshopTotal - productsTotal,
    );
    const inventoryTake = inventoryOffset < inventoryTotal
      ? Math.min(
          request.groupLimit - salesItems.length - financeItems.length - netshopItems.length - productsItems.length,
          inventoryTotal - inventoryOffset,
        )
      : 0;
    let inventoryItems: InventoryConsumerResponseMap["import_batch_search"]["items"] = [];
    if (inventoryTake > 0) {
      const inventoryPage = await inventoryReader.read(principal, {
        operation: "import_batch_search",
        dataset: null,
        query: request.query,
        offset: inventoryOffset,
        limit: inventoryTake,
      }, { signal });
      if (inventoryPage.revision !== inventoryRevision
        || !validInventoryImportSearch(inventoryPage.data)
        || !validFinanceConsumerWindow(inventoryPage.data, inventoryOffset, inventoryTake)
        || inventoryPage.data.total !== inventoryTotal
        || inventoryPage.data.items.length !== inventoryTake) {
        return emptyGroup(importDefinition, false);
      }
      inventoryItems = inventoryPage.data.items;
    }
    const localTake = request.groupLimit
      - salesItems.length - financeItems.length - netshopItems.length - productsItems.length - inventoryItems.length;
    const localOffset = Math.max(
      0,
      globalOffset - salesTotal - financeTotal - netshopTotal - productsTotal - inventoryTotal,
    );
    const local = await queryLocalImportRows(
      db,
      tables,
      like,
      localTake,
      localOffset,
      financeMode !== "django",
    );
    const combinedTotal = salesTotal + financeTotal + netshopTotal + productsTotal + inventoryTotal + local.total;
    const rows: SearchRow[] = [
      ...salesItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: "销售明细",
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
      })),
      ...financeItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: item.source,
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
      })),
      ...netshopItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: `网店 · ${item.platform} · ${item.source}`,
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
      })),
      ...productsItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: item.source,
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
      })),
      ...inventoryItems.map((item) => ({
        result_id: String(item.id),
        title: String(item.fileName),
        subtitle: String(item.source),
        detail: String(item.status),
        updated_at: String(item.completedAt ?? item.createdAt),
        amount_cents: null,
      })),
      ...local.rows,
    ];
    return mapSearchRows(importDefinition, rows, request, principal, combinedTotal);
  } catch {
    return emptyGroup(importDefinition, false);
  }
}

type SearchGroupTask = {
  definition: SearchGroupIdentity;
  available: boolean;
  run: () => Promise<GlobalSearchGroup>;
};

const groupDeadlineToken = Symbol("global-search-group-deadline");

function boundedGroupDeadlineMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return GLOBAL_SEARCH_GROUP_DEADLINE_MS;
  return Math.min(Math.max(1, Math.floor(value)), GLOBAL_SEARCH_MAX_GROUP_DEADLINE_MS);
}

async function runBoundedGroupTasks(
  tasks: readonly SearchGroupTask[],
  deadlineMs: number,
): Promise<{ groups: GlobalSearchGroup[]; deadlineExceeded: boolean; timedOutDomains: string[] }> {
  if (tasks.length === 0) return { groups: [], deadlineExceeded: false, timedOutDomains: [] };
  const deadlineAt = Date.now() + deadlineMs;
  const groups: Array<GlobalSearchGroup | undefined> = new Array(tasks.length);
  const timedOutDomains = new Set<string>();
  let nextIndex = 0;
  let deadlineExceeded = false;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      if (Date.now() >= deadlineAt) {
        deadlineExceeded = true;
        return;
      }
      const taskIndex = nextIndex;
      nextIndex += 1;
      const task = tasks[taskIndex];
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<typeof groupDeadlineToken>((resolve) => {
        timer = setTimeout(() => resolve(groupDeadlineToken), remainingMs);
      });
      const result = await Promise.race([
        Promise.resolve().then(task.run).catch(() => emptyGroup(task.definition, false)),
        deadline,
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (result === groupDeadlineToken) {
        deadlineExceeded = true;
        timedOutDomains.add(task.definition.label);
        groups[taskIndex] = incompleteGroup(task.definition, task.available);
        return;
      }
      groups[taskIndex] = result;
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(GLOBAL_SEARCH_MAX_GROUP_CONCURRENCY, tasks.length) },
    () => worker(),
  ));

  for (let index = 0; index < tasks.length; index += 1) {
    if (groups[index]) continue;
    deadlineExceeded = true;
    timedOutDomains.add(tasks[index].definition.label);
    groups[index] = incompleteGroup(tasks[index].definition, tasks[index].available);
  }

  return {
    groups: groups as GlobalSearchGroup[],
    deadlineExceeded,
    timedOutDomains: [...timedOutDomains],
  };
}

function trimToTotalLimit(groups: GlobalSearchGroup[], totalLimit: number) {
  let remaining = totalLimit;
  return groups.map((group) => {
    if (group.items.length <= remaining) {
      remaining -= group.items.length;
      return group;
    }
    const items = group.items.slice(0, Math.max(0, remaining));
    remaining = 0;
    return { ...group, items, hasMore: group.hasMore || items.length < group.items.length };
  });
}

export async function searchAllBusinessData(
  db: GlobalSearchDatabase,
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  options: GlobalSearchExecutionOptions = {},
): Promise<GlobalSearchResponse> {
  const salesReader = options.salesReader ?? createDjangoSalesConsumerReader();
  const financeReader = options.financeReader ?? createDjangoFinanceConsumerReader();
  const netshopReader = options.netshopReader ?? createDjangoNetshopConsumerReader();
  const productsReader = options.productsReader ?? createDjangoProductsConsumerReader();
  const inventoryReader = options.inventoryReader ?? createDjangoInventoryConsumerReader();
  const workflowReader = options.workflowReader ?? createDjangoWorkflowConsumerReader();
  const financeMode = options.financeBackendMode ?? await getFinanceBackendMode();
  const tableResult = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set((tableResult.results ?? []).map((row) => row.name));
  const like = escapeGlobalSearchLike(request.query);
  const selectedStaticDefinitions = staticDefinitions.filter((definition) =>
    (!request.group || definition.key === request.group) && isGroupAuthorized(definition, principal));
  const groupTasks: SearchGroupTask[] = selectedStaticDefinitions.map((definition) => {
    if (definition.key === "orders") {
      return {
        definition: salesOrderDefinition,
        available: true,
        run: () => querySalesOrderGroup(salesReader, request, principal, options.signal),
      };
    }
    if (definition.key === "jd_products") {
      return {
        definition,
        available: true,
        run: () => queryNetshopSearchGroup(
          netshopReader,
          definition,
          request,
          principal,
          options.signal,
        ),
      };
    }
    if (definition.key === "inventory") {
      return {
        definition: inventorySearchDefinition,
        available: true,
        run: () => queryInventorySearchGroup(
          inventoryReader,
          "inventory_search",
          inventorySearchDefinition,
          request,
          principal,
          options.signal,
        ),
      };
    }
    if (definition.key === "replenishment") {
      return {
        definition: replenishmentSearchDefinition,
        available: true,
        run: () => queryInventorySearchGroup(
          inventoryReader,
          "replenishment_search",
          replenishmentSearchDefinition,
          request,
          principal,
          options.signal,
        ),
      };
    }
    if (financeMode === "django" && definition.key === "finance") {
      return {
        definition: financeSearchDefinition,
        available: true,
        run: () => queryFinanceSearchGroup(
          financeReader,
          "line_search",
          financeSearchDefinition,
          request,
          principal,
          options.signal,
        ),
      };
    }
    if (financeMode === "django" && definition.key === "targets") {
      return {
        definition: targetSearchDefinition,
        available: true,
        run: () => queryFinanceSearchGroup(
          financeReader,
          "target_search",
          targetSearchDefinition,
          request,
          principal,
          options.signal,
        ),
      };
    }
    const activeDefinition = activeStaticDefinition(definition, tables);
    return {
      definition,
      available: activeDefinition.requiredTables.every((table) => tables.has(table)),
      run: () => queryStaticGroup(db, definition, tables, request, like, principal),
    };
  });
  if ((!request.group || request.group === "workflow") && allRoles.includes(principal.role)) {
    groupTasks.push({
      definition: workflowDefinition,
      available: true,
      run: () => queryWorkflowGroup(
        request,
        principal,
        workflowReader,
        options.signal,
      ),
    });
  }
  if ((!request.group || request.group === "inventory_age") && allRoles.includes(principal.role)) {
    groupTasks.push({
      definition: inventoryAgeDefinition,
      available: true,
      run: () => queryInventorySearchGroup(
        inventoryReader,
        "age_search",
        inventoryAgeDefinition,
        request,
        principal,
        options.signal,
      ),
    });
  }
  if ((!request.group || request.group === "imports") && operatorRoles.some((role) => role === principal.role) && principal.scope === null) {
    groupTasks.push({
      definition: importDefinition,
      available: true,
      run: () => queryImportGroup(
        db,
        tables,
        request,
        like,
        principal,
        salesReader,
        financeReader,
        netshopReader,
        productsReader,
        inventoryReader,
        financeMode,
        options.signal,
      ),
    });
  }
  const execution = await runBoundedGroupTasks(groupTasks, boundedGroupDeadlineMs(options.deadlineMs));
  const groups = trimToTotalLimit(execution.groups, request.totalLimit);
  const returned = groups.reduce((sum, group) => sum + group.items.length, 0);
  const latestMatchedDate = groups
    .flatMap((group) => group.items.map((item) => item.updatedAt).filter(Boolean))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  return {
    query: request.query,
    page: request.page,
    limits: { perGroup: request.groupLimit, total: request.totalLimit },
    returned,
    dataCutoffDate: latestMatchedDate,
    filtersApplied: {
      query: request.query,
      group: request.group,
      page: request.page,
      perGroupLimit: request.groupLimit,
      totalLimit: request.totalLimit,
      dataScope: principal.scope === null
        ? { mode: "unrestricted", warehouses: null, channels: null, platforms: null }
        : {
            mode: "restricted",
            warehouses: [...principal.scope.warehouses],
            channels: [...principal.scope.channels],
            platforms: [...principal.scope.platforms],
          },
    },
    truncated: execution.deadlineExceeded || groups.some((group) => group.hasMore) || returned >= request.totalLimit,
    deadlineExceeded: execution.deadlineExceeded,
    timedOutDomains: execution.timedOutDomains,
    groups,
    coveredDomains: [...GLOBAL_SEARCH_COVERAGE],
    unavailableDomains: groups.filter((group) => !group.available).map((group) => group.label),
  };
}
