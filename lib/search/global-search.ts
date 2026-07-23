export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_QUERY_LENGTH = 80;
export const GLOBAL_SEARCH_DEFAULT_GROUP_LIMIT = 4;
export const GLOBAL_SEARCH_MAX_GROUP_LIMIT = 8;
export const GLOBAL_SEARCH_DEFAULT_TOTAL_LIMIT = 48;
export const GLOBAL_SEARCH_MAX_TOTAL_LIMIT = 50;

export type GlobalSearchModule =
  | "product"
  | "sales"
  | "shop"
  | "inventory"
  | "inventory_age"
  | "combos"
  | "replenishment"
  | "market"
  | "customer_service"
  | "workflow"
  | "import";

export type GlobalSearchGroupKey =
  | "products"
  | "orders"
  | "jd_products"
  | "inventory"
  | "market_skus"
  | "market_annotations"
  | "customer_service"
  | "finance"
  | "targets"
  | "workflow"
  | "imports";

export type GlobalSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  updatedAt: string;
  amountCents: number | null;
  module: GlobalSearchModule;
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
};

type SearchGroupDefinition = {
  key: GlobalSearchGroupKey;
  label: string;
  icon: string;
  module: GlobalSearchModule;
  requiredTables: readonly string[];
  sql: string;
  likeParameterCount: number;
  allowedRoles: readonly AppRole[];
  scopeKind?: "warehouse" | "channel_platform" | "platform" | "finance" | "shop" | "unscoped_only";
};

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

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new GlobalSearchRequestError("分页参数必须是整数。");
  if (parsed < min || parsed > max) throw new GlobalSearchRequestError(`分页参数必须在 ${min} 到 ${max} 之间。`);
  return parsed;
}

export function normalizeGlobalSearchRequest(searchParams: URLSearchParams): GlobalSearchRequest {
  const query = (searchParams.get("q") ?? "").trim();
  const queryLength = Array.from(query).length;
  if (queryLength < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    throw new GlobalSearchRequestError(`请输入至少 ${GLOBAL_SEARCH_MIN_QUERY_LENGTH} 个字符。`);
  }
  if (queryLength > GLOBAL_SEARCH_MAX_QUERY_LENGTH) {
    throw new GlobalSearchRequestError(`搜索词不能超过 ${GLOBAL_SEARCH_MAX_QUERY_LENGTH} 个字符。`);
  }
  const rawGroup = searchParams.get("group");
  const group = rawGroup && isGlobalSearchGroupKey(rawGroup) ? rawGroup : null;
  if (rawGroup && !group) throw new GlobalSearchRequestError("搜索分组不在允许清单中。");
  return {
    query,
    page: boundedInteger(searchParams.get("page"), 1, 1, 10_000),
    groupLimit: boundedInteger(
      searchParams.get("limit"),
      GLOBAL_SEARCH_DEFAULT_GROUP_LIMIT,
      1,
      GLOBAL_SEARCH_MAX_GROUP_LIMIT,
    ),
    totalLimit: boundedInteger(
      searchParams.get("totalLimit"),
      GLOBAL_SEARCH_DEFAULT_TOTAL_LIMIT,
      1,
      GLOBAL_SEARCH_MAX_TOTAL_LIMIT,
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
    key: "orders",
    label: "销售订单",
    icon: "单",
    module: "sales",
    requiredTables: ["sales_order_lines"],
    likeParameterCount: 6,
    allowedRoles: allRoles,
    scopeKind: "channel_platform",
    sql: `
      WITH matched AS (
        SELECT order_no, online_order_no, MAX(platform) AS platform, MAX(shop_name) AS shop_name,
          MAX(ship_time) AS latest_ship_time, GROUP_CONCAT(DISTINCT product_name) AS product_names,
          SUM(allocated_amount_cents) AS net_sales_cents
        FROM sales_order_lines
        WHERE (order_no LIKE ? ESCAPE '\\' COLLATE NOCASE OR online_order_no LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR platform LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
        GROUP BY order_no, online_order_no
      )
      SELECT COALESCE(NULLIF(order_no, ''), online_order_no) AS result_id,
        COALESCE(NULLIF(order_no, ''), online_order_no, '未编号订单') AS title,
        COALESCE(platform, '') || CASE WHEN shop_name <> '' THEN ' · ' || shop_name ELSE '' END AS subtitle,
        COALESCE(product_names, '') AS detail, latest_ship_time AS updated_at,
        net_sales_cents AS amount_cents, COUNT(*) OVER() AS total_count
      FROM matched ORDER BY latest_ship_time DESC, result_id ASC LIMIT ? OFFSET ?`,
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
    requiredTables: ["market_ranking_entries"],
    likeParameterCount: 5,
    allowedRoles: allRoles,
    scopeKind: "unscoped_only",
    sql: `
      WITH ranked AS (
        SELECT sku_code, product_name, brand, category, scope, period_end, price_cents, rank,
          ROW_NUMBER() OVER (PARTITION BY sku_code, category, scope ORDER BY period_end DESC, id DESC) AS recency_rank
        FROM market_ranking_entries
        WHERE sku_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR brand LIKE ? ESCAPE '\\' COLLATE NOCASE OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR scope LIKE ? ESCAPE '\\' COLLATE NOCASE
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
    likeParameterCount: 8,
    allowedRoles: businessRoles,
    scopeKind: "unscoped_only",
    sql: `
      SELECT CAST(id AS TEXT) AS result_id,
        COALESCE(NULLIF(customer_alias, ''), NULLIF(customer_id, ''), NULLIF(chat_customer_alias, ''), '匿名顾客') AS title,
        COALESCE(NULLIF(product_name, ''), NULLIF(product_sku, ''), '未关联商品') || CASE WHEN agent <> '' THEN ' · ' || agent ELSE '' END AS subtitle,
        consultation_type || CASE WHEN match_status <> '' THEN ' · ' || match_status ELSE '' END AS detail,
        consulted_at AS updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM customer_service_conversations
      WHERE customer_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR chat_customer_alias LIKE ? ESCAPE '\\' COLLATE NOCASE OR agent LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR product_sku LIKE ? ESCAPE '\\' COLLATE NOCASE OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR conversation_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR messages_json LIKE ? ESCAPE '\\' COLLATE NOCASE
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
    requiredTables: ["finance_targets"],
    likeParameterCount: 6,
    allowedRoles: financeRoles,
    scopeKind: "shop",
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
  },
  {
    key: "workflow",
    label: "运营事务",
    icon: "务",
    module: "workflow",
    requiredTables: ["workflow_tasks"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "shop",
    sql: `
      SELECT id AS result_id, title, category || CASE WHEN status <> '' THEN ' · ' || status ELSE '' END AS subtitle,
        COALESCE(NULLIF(work_content, ''), shop_name) || CASE WHEN owner <> '' THEN ' · ' || owner ELSE '' END AS detail,
        updated_at, NULL AS amount_cents, COUNT(*) OVER() AS total_count
      FROM workflow_tasks
      WHERE (title LIKE ? ESCAPE '\\' COLLATE NOCASE OR work_content LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR category LIKE ? ESCAPE '\\' COLLATE NOCASE OR owner LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR status LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR priority LIKE ? ESCAPE '\\' COLLATE NOCASE)
        /*SCOPE*/
      ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
  },
] as const;

const importSources = [
  { table: "sales_import_batches", source: "'销售明细'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
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
    "workflow_tasks",
    "sales_import_batches", "sales_order_lines",
    "inventory_import_batches", "inventory_stock_lines", "inventory_age_metrics",
    "erp_reference_import_batches", "erp_product_master", "erp_inventory_age_lines", "erp_combo_items",
    "replenishment_plan_items",
    "finance_import_batches", "finance_lines", "finance_targets",
    "market_import_batches", "market_ranking_entries", "market_sku_annotations",
  ],
  coveredByProjection: [
    "finance_months",
  ],
  excludedSensitiveOrInternal: [
    "app_users", "ai_models", "ai_channels", "ai_channel_callback_events",
    "ai_conversations", "ai_conversation_messages", "system_settings", "workflow_task_bootstrap",
    "ai_tool_audit_logs",
    "sales_import_uploads", "sales_import_upload_chunks",
    "inventory_import_uploads", "inventory_import_upload_chunks", "inventory_import_upload_results",
    "market_annotation_prompt_versions", "market_annotation_prompt_audits", "market_annotation_jobs", "market_annotation_items",
    "market_annotation_commit_receipts", "market_annotation_validation_samples",
    "market_annotation_validation_runs", "market_annotation_validation_results", "market_annotation_local_agents",
  ],
} as const;

const groupKeys = new Set<GlobalSearchGroupKey>([
  ...staticDefinitions.map((definition) => definition.key),
  "inventory_age",
  "imports",
]);

export function isGlobalSearchGroupKey(value: string): value is GlobalSearchGroupKey {
  return groupKeys.has(value as GlobalSearchGroupKey);
}

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
  const items = rows.map((row) => ({
    id: String(row.result_id ?? ""),
    title: String(row.title ?? ""),
    subtitle: String(row.subtitle ?? ""),
    detail: String(row.detail ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    amountCents: principal.role === "viewer" || row.amount_cents === null || row.amount_cents === undefined
      ? null
      : Number(row.amount_cents),
    module: definition.module,
  }));
  return {
    ...definition,
    available: true,
    total,
    hasMore: request.page * request.groupLimit < total,
    items,
  };
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
  if (!definition.requiredTables.every((table) => tables.has(table))) return emptyGroup(definition);
  try {
    const scope = scopeSql(principal, definition.scopeKind);
    const sql = definition.sql.replace("/*SCOPE*/", scope.clause);
    const values: unknown[] = [...Array.from({ length: definition.likeParameterCount }, () => like), ...scope.values];
    const result = await db.prepare(sql)
      .bind(...values, request.groupLimit, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    const rows = result.results ?? [];
    let totalOverride: number | undefined;
    if (rows.length === 0 && request.page > 1) {
      const firstPage = await db.prepare(sql).bind(...values, 1, 0).all<SearchRow>();
      totalOverride = Number(firstPage.results?.[0]?.total_count ?? 0);
    }
    return mapSearchRows(definition, rows, request, principal, totalOverride);
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

async function queryImportGroup(db: GlobalSearchDatabase, tables: Set<string>, request: GlobalSearchRequest, like: string, principal: AppPrincipal) {
  const definition = { key: "imports" as const, label: "导入批次", icon: "入", module: "import" as const };
  const availableSources = importSources.filter((source) => tables.has(source.table));
  if (availableSources.length === 0) return emptyGroup(definition);
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
    return mapSearchRows(definition, rows, request, principal, totalOverride);
  } catch {
    return emptyGroup(definition);
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
): Promise<GlobalSearchResponse> {
  const tableResult = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set((tableResult.results ?? []).map((row) => row.name));
  const like = escapeGlobalSearchLike(request.query);
  const selectedStaticDefinitions = staticDefinitions.filter((definition) =>
    (!request.group || definition.key === request.group) && isGroupAuthorized(definition, principal));
  const groupTasks: Array<Promise<GlobalSearchGroup>> = selectedStaticDefinitions.map((definition) =>
    queryStaticGroup(db, definition, tables, request, like, principal));
  if ((!request.group || request.group === "inventory_age") && allRoles.includes(principal.role)) {
    groupTasks.push(queryInventoryAgeGroup(db, tables, request, like, principal));
  }
  if ((!request.group || request.group === "imports") && operatorRoles.includes(principal.role) && principal.scope === null) {
    groupTasks.push(queryImportGroup(db, tables, request, like, principal));
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
import type { AppPrincipal, AppRole } from "@/lib/auth/authorization";
