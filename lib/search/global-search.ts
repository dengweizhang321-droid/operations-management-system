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

export { globalSearchGroupKeys, isGlobalSearchGroupKey } from "./target-contract";
export type { GlobalSearchGroupKey, GlobalSearchNavigationTarget } from "./target-contract";

export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_QUERY_LENGTH = 80;
export const GLOBAL_SEARCH_DEFAULT_GROUP_LIMIT = 4;
export const GLOBAL_SEARCH_MAX_GROUP_LIMIT = 8;
export const GLOBAL_SEARCH_DEFAULT_TOTAL_LIMIT = 48;
export const GLOBAL_SEARCH_MAX_TOTAL_LIMIT = 50;

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
  total: number;
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
  total_count: number;
  target_hint?: string | null;
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
        updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM erp_product_master
      WHERE product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR specification LIKE ? ESCAPE '\\' COLLATE NOCASE OR barcode LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR brand LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR supplier LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY updated_at DESC, product_code ASC
      LIMIT ? OFFSET ?`,
  },
  {
    key: "jd_products",
    label: "京东 SKU / SPU / 网店商品",
    icon: "京",
    module: "shop",
    requiredTables: ["netshop_rows"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "platform",
    sql: `
      WITH matched AS (
        SELECT sku_id, spu_id, product_code, product_name, shop_name, platform,
          MAX(dataset) AS dataset, MAX(COALESCE(business_date, snapshot_date, updated_at)) AS latest_date
        FROM netshop_rows
        WHERE (sku_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR spu_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR platform LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR dataset LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
        GROUP BY sku_id, spu_id, product_code, product_name, shop_name, platform
      )
      SELECT COALESCE(NULLIF(sku_id, ''), NULLIF(spu_id, ''), NULLIF(product_code, ''), product_name) || ':' || shop_name AS result_id,
        COALESCE(NULLIF(product_name, ''), NULLIF(product_code, ''), NULLIF(sku_id, ''), NULLIF(spu_id, ''), '未命名商品') AS title,
        TRIM(CASE WHEN sku_id <> '' THEN 'SKU ' || sku_id ELSE '' END || CASE WHEN spu_id <> '' THEN ' · SPU ' || spu_id ELSE '' END || CASE WHEN product_code <> '' THEN ' · ' || product_code ELSE '' END) AS subtitle,
        COALESCE(platform, '') || CASE WHEN shop_name <> '' THEN ' · ' || shop_name ELSE '' END || CASE WHEN dataset <> '' THEN ' · ' || dataset ELSE '' END AS detail,
        latest_date AS updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM matched ORDER BY latest_date DESC, result_id ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "inventory",
    label: "库存记录",
    icon: "库",
    module: "inventory",
    requiredTables: ["inventory_stock_lines"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "warehouse",
    sql: `
      WITH ranked AS (
        SELECT product_code, product_name, warehouse, warehouse_type, specification, brand, category,
          snapshot_date, available_quantity, unit_cost_cents,
          ROW_NUMBER() OVER (PARTITION BY product_code, warehouse ORDER BY snapshot_date DESC, id DESC) AS recency_rank
        FROM inventory_stock_lines
        WHERE (product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR warehouse_type LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR specification LIKE ? ESCAPE '\\' COLLATE NOCASE OR brand LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR category LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
      )
      SELECT product_code || ':' || warehouse AS result_id, product_name AS title,
        product_code || CASE WHEN specification <> '' THEN ' · ' || specification ELSE '' END AS subtitle,
        warehouse || CASE WHEN warehouse_type <> '' THEN ' · ' || warehouse_type ELSE '' END || ' · 可用 ' || available_quantity AS detail,
        snapshot_date AS updated_at, unit_cost_cents AS amount_cents, COUNT(*) OVER() AS total_count
      FROM ranked WHERE recency_rank = 1 ORDER BY snapshot_date DESC, product_code ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "market_skus",
    label: "市场 SKU",
    icon: "市",
    module: "market",
    requiredTables: ["market_ranking_entries", "market_price_snapshots"],
    likeParameterCount: 5,
    allowedRoles: allRoles,
    scopeKind: "unscoped_only",
    sql: `
      WITH ranked AS (
        SELECT m.sku_code, m.product_name, m.brand, m.category, m.scope, m.period_end,
          COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents, m.price_cents) price_cents,
          m.rank,
          ROW_NUMBER() OVER (PARTITION BY m.sku_code, m.category, m.scope ORDER BY m.period_end DESC, m.id DESC) AS recency_rank
        FROM market_ranking_entries m
        LEFT JOIN market_price_snapshots ps ON ps.category=m.category AND ps.sku_code=m.sku_code
          AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end, 1, 7)
        WHERE m.sku_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR m.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR m.brand LIKE ? ESCAPE '\\' COLLATE NOCASE OR m.category LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR m.scope LIKE ? ESCAPE '\\' COLLATE NOCASE
      )
      SELECT sku_code || ':' || category || ':' || scope AS result_id, product_name AS title,
        sku_code || CASE WHEN brand <> '' THEN ' · ' || brand ELSE '' END AS subtitle,
        category || CASE WHEN scope <> '' THEN ' · ' || scope ELSE '' END || CASE WHEN rank IS NOT NULL THEN ' · 第 ' || rank || ' 名' ELSE '' END AS detail,
        period_end AS updated_at, price_cents AS amount_cents, COUNT(*) OVER() AS total_count
      FROM ranked WHERE recency_rank = 1 ORDER BY period_end DESC, rank ASC LIMIT ? OFFSET ?`,
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
        updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
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
    requiredTables: ["replenishment_plan_items"],
    likeParameterCount: 5,
    allowedRoles: businessRoles,
    scopeKind: "warehouse",
    sql: `
      SELECT id AS result_id, product_name AS title, product_code || ' · ' || warehouse AS subtitle,
        status || ' · 计划 ' || planned_quantity || CASE WHEN reason <> '' THEN ' · ' || reason ELSE '' END AS detail,
        updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM replenishment_plan_items
      WHERE (product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR status LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR reason LIKE ? ESCAPE '\\' COLLATE NOCASE)
        /*SCOPE*/
      ORDER BY updated_at DESC, product_code ASC LIMIT ? OFFSET ?`,
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
        updated_at, image_price_cents AS amount_cents, COUNT(*) OVER() AS total_count
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
    likeParameterCount: 11,
    allowedRoles: businessRoles,
    scopeKind: "unscoped_only",
    sql: `
      SELECT CAST(id AS TEXT) AS result_id,
        COALESCE(NULLIF(customer_alias, ''), NULLIF(customer_id, ''), NULLIF(chat_customer_alias, ''), '匿名顾客') AS title,
        COALESCE(NULLIF(product_name, ''), NULLIF(product_sku, ''), '未关联商品') || CASE WHEN agent <> '' THEN ' · ' || agent ELSE '' END AS subtitle,
        COALESCE(NULLIF(summary_text, ''), NULLIF(service_issues, ''), consultation_type) || CASE WHEN problem_type <> '' THEN ' · ' || problem_type ELSE '' END AS detail,
        consulted_at AS updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM customer_service_conversations
      WHERE customer_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR chat_customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE OR agent LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR product_sku LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR conversation_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR messages_json LIKE ? ESCAPE '\\' COLLATE NOCASE
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
        created_at AS updated_at, amount_cents, COUNT(*) OVER() AS total_count
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
        updated_at, sales_target_cents AS amount_cents, COUNT(*) OVER() AS total_count
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
      updated_at, sales_target_cents AS amount_cents, COUNT(*) OVER() AS total_count
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

const importDefinition = {
  key: "imports" as const,
  label: "导入批次",
  icon: "入",
  module: "import" as const,
};

const importSources = [
  { table: "inventory_import_batches", source: "'库存快照'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
  { table: "erp_reference_import_batches", source: "source_label", file: "file_name", searchable: ["id", "file_name", "source_key", "source_label", "status"] },
  { table: "finance_import_batches", source: "'月度财报'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
  { table: "netshop_import_batches", source: "'网店 · ' || source", file: "file_name", searchable: ["id", "file_name", "source", "dataset", "platform", "shop_name", "status"] },
  { table: "market_import_batches", source: "'市场 · ' || source_type", file: "file_name", searchable: ["id", "file_name", "source_type", "status"] },
  { table: "customer_service_import_batches", source: "'客服会话'", file: "session_file_name || ' / ' || chat_file_name", searchable: ["id", "session_file_name", "chat_file_name", "status"] },
] as const;

const inventoryAgeDefinition = {
  key: "inventory_age" as const,
  label: "库龄数据",
  icon: "龄",
  module: "inventory" as const,
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
  "客服会话（授权角色可按正文匹配，仅返回最小摘要）",
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
    "erp_reference_import_batches", "erp_product_master", "erp_inventory_age_lines", "erp_combo_items",
    "replenishment_plan_items",
    "finance_import_batches", "finance_lines", "finance_targets_scoped",
    "market_import_batches", "market_ranking_entries", "market_sku_annotations",
    "customer_service_conversations", "customer_service_import_batches",
  ],
  coveredByProjection: [
    "finance_months", "finance_targets",
    "market_price_snapshots",
  ],
  excludedSensitiveOrInternal: [
    "app_users", "ai_models", "ai_channels", "ai_channel_callback_events",
    "ai_conversations", "ai_conversation_scopes", "ai_conversation_messages", "ai_conversation_deletion_audits", "system_settings", "workflow_task_bootstrap",
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

function emptyGroup(definition: Pick<SearchGroupDefinition, "key" | "label" | "icon" | "module">): GlobalSearchGroup {
  return { ...definition, available: false, total: 0, hasMore: false, items: [] };
}

function mapSearchRows(
  definition: Pick<SearchGroupDefinition, "key" | "label" | "icon" | "module">,
  rows: SearchRow[],
  request: GlobalSearchRequest,
  principal: AppPrincipal,
  totalOverride?: number,
): GlobalSearchGroup {
  const total = totalOverride ?? Number(rows[0]?.total_count ?? 0);
  const items = rows.map((row) => {
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
    hasMore: request.page * request.groupLimit < total,
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

async function queryStaticGroup(db: GlobalSearchDatabase, definition: SearchGroupDefinition, tables: Set<string>, request: GlobalSearchRequest, like: string, principal: AppPrincipal) {
  const activeDefinition = definition.key === "targets"
    && !definition.requiredTables.every((table) => tables.has(table))
    && legacyTargetsDefinition.requiredTables.every((table) => tables.has(table))
    ? legacyTargetsDefinition
    : definition;
  if (!activeDefinition.requiredTables.every((table) => tables.has(table))) return emptyGroup(definition);
  // Legacy finance targets do not carry a platform identity. A restricted
  // principal cannot safely infer platform access from the free-form shop name.
  if (!isGroupAuthorized(activeDefinition, principal)) {
    return mapSearchRows(activeDefinition, [], request, principal);
  }
  try {
    const scope = scopeSql(principal, activeDefinition.scopeKind);
    const sql = activeDefinition.sql.replace("/*SCOPE*/", scope.clause);
    const values: unknown[] = [...Array.from({ length: activeDefinition.likeParameterCount }, () => like), ...scope.values];
    const result = await db.prepare(sql)
      .bind(...values, request.groupLimit, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    const rows = result.results ?? [];
    let totalOverride: number | undefined;
    if (rows.length === 0 && request.page > 1) {
      const firstPage = await db.prepare(sql).bind(...values, 1, 0).all<SearchRow>();
      totalOverride = Number(firstPage.results?.[0]?.total_count ?? 0);
    }
    return mapSearchRows(activeDefinition, rows, request, principal, totalOverride);
  } catch {
    // A partially migrated table must not take down search for every other domain.
    return emptyGroup(definition);
  }
}

async function queryInventoryAgeGroup(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  request: GlobalSearchRequest,
  like: string,
  principal: AppPrincipal,
) {
  const fragments: string[] = [];
  const binds: unknown[] = [];
  if (tables.has("erp_inventory_age_lines")) {
    const scope = scopeSql(principal, "warehouse");
    fragments.push(`SELECT 'erp:' || id AS result_id, product_name AS title,
      product_code || ' · ' || warehouse AS subtitle,
      COALESCE(category, '') || ' · 库龄 ' || COALESCE(inventory_age_days, 0) || ' 天 · 可用 ' || available_quantity AS detail,
      snapshot_date AS updated_at, stock_value_cents AS amount_cents
      FROM erp_inventory_age_lines
      WHERE (product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR specification LIKE ? ESCAPE '\\' COLLATE NOCASE) ${scope.clause}`);
    binds.push(like, like, like, like, like, ...scope.values);
  }
  if (tables.has("inventory_age_metrics") && tables.has("inventory_stock_lines")) {
    const scope = scopeSql(principal, "warehouse", { warehouse: "s.warehouse" });
    fragments.push(`SELECT 'metric:' || s.id AS result_id, s.product_name AS title,
      s.product_code || ' · ' || s.warehouse AS subtitle,
      COALESCE(s.category, '') || ' · 7日销量 ' || m.sales_7d_quantity || ' · 30日销量 ' || m.sales_30d_quantity AS detail,
      s.snapshot_date AS updated_at, NULL AS amount_cents
      FROM inventory_age_metrics m
      JOIN inventory_stock_lines s ON s.batch_id = m.batch_id AND s.row_key = m.row_key
      WHERE (s.product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR s.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR s.warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR s.category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR s.specification LIKE ? ESCAPE '\\' COLLATE NOCASE) ${scope.clause}`);
    binds.push(like, like, like, like, like, ...scope.values);
  }
  if (fragments.length === 0) return emptyGroup(inventoryAgeDefinition);
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents,
    COUNT(*) OVER() AS total_count FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(sql)
      .bind(...binds, request.groupLimit, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    const rows = result.results ?? [];
    let totalOverride: number | undefined;
    if (rows.length === 0 && request.page > 1) {
      const firstPage = await db.prepare(sql).bind(...binds, 1, 0).all<SearchRow>();
      totalOverride = Number(firstPage.results?.[0]?.total_count ?? 0);
    }
    return mapSearchRows(inventoryAgeDefinition, rows, request, principal, totalOverride);
  } catch {
    return emptyGroup(inventoryAgeDefinition);
  }
}

async function queryWorkflowGroup(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  request: GlobalSearchRequest,
  like: string,
  principal: AppPrincipal,
) {
  const fragments: string[] = [];
  const binds: unknown[] = [];
  // Legacy task databases did not have the state companion table. They remain
  // searchable until the idempotent schema upgrader backfills that table.
  if (tables.has("workflow_tasks") && principal.scope === null) {
    const stateJoin = tables.has("workflow_task_states")
      ? "JOIN workflow_task_states s ON s.task_id = t.id"
      : "";
    const activeClause = tables.has("workflow_task_states") ? "AND s.deleted_at IS NULL" : "";
    fragments.push(`SELECT 'task:' || t.id AS result_id, t.title AS title,
      t.category || CASE WHEN t.status <> '' THEN ' · ' || t.status ELSE '' END AS subtitle,
      COALESCE(NULLIF(t.work_content, ''), t.shop_name) || CASE WHEN t.owner <> '' THEN ' · ' || t.owner ELSE '' END AS detail,
      t.updated_at AS updated_at, NULL AS amount_cents, 'task' AS target_hint
      FROM workflow_tasks t ${stateJoin}
      WHERE (t.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.work_content LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR t.category LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.owner LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR t.shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.status LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR t.priority LIKE ? ESCAPE '\\' COLLATE NOCASE) ${activeClause}`);
    binds.push(like, like, like, like, like, like, like);
  }
  if (tables.has("workflow_operation_records")) {
    const scope = scopeSql(principal, "channel_platform", { channel: "o.channel", platform: "o.platform" });
    fragments.push(`SELECT 'operation:' || o.id AS result_id, o.title AS title,
      CASE o.record_type WHEN 'inspection' THEN '巡店检查' WHEN 'review' THEN '评价维护' ELSE '新品上架' END
        || CASE WHEN o.status <> '' THEN ' · ' || o.status ELSE '' END AS subtitle,
      COALESCE(NULLIF(o.content, ''), o.shop_name) || CASE WHEN o.owner <> '' THEN ' · ' || o.owner ELSE '' END AS detail,
      o.updated_at AS updated_at, NULL AS amount_cents, o.record_type AS target_hint
      FROM workflow_operation_records o
      WHERE o.deleted_at IS NULL AND (o.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR o.content LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR (CASE o.record_type WHEN 'inspection' THEN '巡店检查' WHEN 'review' THEN '评价维护' ELSE '新品上架' END) LIKE ? ESCAPE '\\' COLLATE NOCASE OR o.owner LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR o.shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR o.status LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR o.priority LIKE ? ESCAPE '\\' COLLATE NOCASE) ${scope.clause}`);
    binds.push(like, like, like, like, like, like, like, ...scope.values);
  }
  if (fragments.length === 0) return emptyGroup(workflowDefinition);
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents, target_hint,
    COUNT(*) OVER() AS total_count FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(sql)
      .bind(...binds, request.groupLimit, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    const rows = result.results ?? [];
    let totalOverride: number | undefined;
    if (rows.length === 0 && request.page > 1) {
      const firstPage = await db.prepare(sql).bind(...binds, 1, 0).all<SearchRow>();
      totalOverride = Number(firstPage.results?.[0]?.total_count ?? 0);
    }
    return mapSearchRows(workflowDefinition, rows, request, principal, totalOverride);
  } catch {
    return emptyGroup(workflowDefinition);
  }
}

function validSalesOrderSearch(
  value: unknown,
): value is SalesConsumerResponseMap["order_search"] {
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

function validSalesImportSearch(
  value: unknown,
): value is SalesConsumerResponseMap["import_batch_search"] {
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
  return data.items.length === expectedLength
    && data.truncated === page * pageSize < data.total;
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
      return emptyGroup(salesOrderDefinition);
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
    return mapSearchRows(salesOrderDefinition, rows, request, principal, result.data.total);
  } catch {
    return emptyGroup(salesOrderDefinition);
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
      return emptyGroup(definition);
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
    return emptyGroup(definition);
  }
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
  const result = await db.prepare(sql).bind(...binds, limit, offset).all<SearchRow>();
  const rows = result.results ?? [];
  if (rows.length > 0) return { rows, total: Number(rows[0]?.total_count ?? 0) };
  const firstPage = await db.prepare(sql).bind(...binds, 1, 0).all<SearchRow>();
  return { rows, total: Number(firstPage.results?.[0]?.total_count ?? 0) };
}

async function queryImportGroup(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  request: GlobalSearchRequest,
  like: string,
  principal: AppPrincipal,
  salesReader: SalesConsumerReader,
  financeReader: FinanceConsumerReader,
  financeMode: FinanceBackendMode,
  signal?: AbortSignal,
) {
  try {
    // Keep pagination exact without a cross-database offset join. Migrated
    // sales and finance batches are stable leading partitions; domains still
    // owned by D1 form the final partition.
    const salesHead = await salesReader.read(principal, {
      operation: "import_batch_search",
      query: request.query,
      page: 1,
      pageSize: 1,
    }, { signal });
    if (!salesHead || typeof salesHead.revision !== "string" || !salesHead.revision
      || !validSalesImportSearch(salesHead.data)
      || !validConsumerPage(salesHead.data, 1, 1)) return emptyGroup(importDefinition);
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
        || !validFinanceConsumerWindow(financeHead.data, 0, 1)) return emptyGroup(importDefinition);
      financeRevision = financeHead.revision;
      financeTotal = financeHead.data.total;
    }
    const globalOffset = (request.page - 1) * request.groupLimit;
    const salesTake = globalOffset < salesTotal
      ? Math.min(request.groupLimit, salesTotal - globalOffset)
      : 0;
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
        || salesPage.data.items.length !== salesTake) return emptyGroup(importDefinition);
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
        || financePage.data.items.length !== financeTake) return emptyGroup(importDefinition);
      financeItems = financePage.data.items;
    }
    const localTake = request.groupLimit - salesItems.length - financeItems.length;
    const localOffset = Math.max(0, globalOffset - salesTotal - financeTotal);
    const local = await queryLocalImportRows(
      db,
      tables,
      like,
      localTake,
      localOffset,
      financeMode !== "django",
    );
    const combinedTotal = salesTotal + financeTotal + local.total;
    const rows: SearchRow[] = [
      ...salesItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: "销售明细",
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
        total_count: combinedTotal,
      })),
      ...financeItems.map((item) => ({
        result_id: item.id,
        title: item.fileName,
        subtitle: item.source,
        detail: item.status,
        updated_at: item.completedAt ?? item.createdAt,
        amount_cents: null,
        total_count: combinedTotal,
      })),
      ...local.rows.map((row) => ({ ...row, total_count: combinedTotal })),
    ];
    return mapSearchRows(importDefinition, rows, request, principal, combinedTotal);
  } catch {
    return emptyGroup(importDefinition);
  }
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
  dependencies: {
    salesReader?: SalesConsumerReader;
    financeReader?: FinanceConsumerReader;
    financeBackendMode?: FinanceBackendMode;
    signal?: AbortSignal;
  } = {},
): Promise<GlobalSearchResponse> {
  const salesReader = dependencies.salesReader ?? createDjangoSalesConsumerReader();
  const financeReader = dependencies.financeReader ?? createDjangoFinanceConsumerReader();
  const financeMode = dependencies.financeBackendMode ?? await getFinanceBackendMode();
  const tableResult = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set((tableResult.results ?? []).map((row) => row.name));
  const like = escapeGlobalSearchLike(request.query);
  const selectedStaticDefinitions = staticDefinitions.filter((definition) =>
    (!request.group || definition.key === request.group) && isGroupAuthorized(definition, principal));
  const groupTasks: Array<Promise<GlobalSearchGroup>> = selectedStaticDefinitions.map((definition) => {
    if (financeMode === "django" && definition.key === "finance") {
      return queryFinanceSearchGroup(
        financeReader,
        "line_search",
        financeSearchDefinition,
        request,
        principal,
        dependencies.signal,
      );
    }
    if (financeMode === "django" && definition.key === "targets") {
      return queryFinanceSearchGroup(
        financeReader,
        "target_search",
        targetSearchDefinition,
        request,
        principal,
        dependencies.signal,
      );
    }
    return queryStaticGroup(db, definition, tables, request, like, principal);
  });
  if (!request.group) {
    groupTasks.splice(1, 0, querySalesOrderGroup(salesReader, request, principal, dependencies.signal));
  } else if (request.group === "orders" && allRoles.includes(principal.role)) {
    groupTasks.push(querySalesOrderGroup(salesReader, request, principal, dependencies.signal));
  }
  if ((!request.group || request.group === "workflow") && allRoles.includes(principal.role)) {
    groupTasks.push(queryWorkflowGroup(db, tables, request, like, principal));
  }
  if ((!request.group || request.group === "inventory_age") && allRoles.includes(principal.role)) {
    groupTasks.push(queryInventoryAgeGroup(db, tables, request, like, principal));
  }
  if ((!request.group || request.group === "imports") && operatorRoles.some((role) => role === principal.role) && principal.scope === null) {
    groupTasks.push(queryImportGroup(
      db,
      tables,
      request,
      like,
      principal,
      salesReader,
      financeReader,
      financeMode,
      dependencies.signal,
    ));
  }
  const groups = trimToTotalLimit(await Promise.all(groupTasks), request.totalLimit);
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
    truncated: groups.some((group) => group.hasMore) || returned >= request.totalLimit,
    groups,
    coveredDomains: [...GLOBAL_SEARCH_COVERAGE],
    unavailableDomains: groups.filter((group) => !group.available).map((group) => group.label),
  };
}
