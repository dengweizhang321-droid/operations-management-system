import {
  getGlobalSearchNavigationTarget,
  globalSearchDefaultTargets,
  isGlobalSearchGroupKey,
  type GlobalSearchGroupKey,
  type GlobalSearchNavigationModule,
  type GlobalSearchNavigationTarget,
} from "./target-contract";

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
};

export type GlobalSearchExecutionOptions = {
  /** Test/worker override; callers cannot raise the hard 10-second ceiling. */
  deadlineMs?: number;
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
    requiredTables: ["sales_order_lines"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "channel_platform",
    sql: `
      WITH matched AS (
        SELECT order_no, online_order_no, MAX(platform) AS platform, MAX(shop_name) AS shop_name,
          MAX(ship_time) AS latest_ship_time,
          MIN(substr(COALESCE(product_name, ''), 1, 120)) AS sample_product_name,
          COUNT(DISTINCT CASE WHEN product_name <> '' THEN product_name END) AS product_name_count,
          SUM(allocated_amount_cents) AS net_sales_cents
        FROM sales_order_lines
        WHERE (order_no LIKE ? ESCAPE '\\' COLLATE NOCASE OR online_order_no LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR online_spec_code LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR product_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR platform LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
        GROUP BY order_no, online_order_no
      )
      SELECT COALESCE(NULLIF(order_no, ''), online_order_no) AS result_id,
        COALESCE(NULLIF(order_no, ''), online_order_no, '未编号订单') AS title,
        COALESCE(platform, '') || CASE WHEN shop_name <> '' THEN ' · ' || shop_name ELSE '' END AS subtitle,
        COALESCE(sample_product_name, '')
          || CASE WHEN product_name_count > 1 THEN ' 等 ' || product_name_count || ' 个商品' ELSE '' END AS detail,
        latest_ship_time AS updated_at,
        net_sales_cents AS amount_cents
      FROM matched ORDER BY latest_ship_time DESC, result_id ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "jd_products",
    label: "京东 SKU / SPU / 网店商品",
    icon: "京",
    module: "shop",
    requiredTables: ["netshop_rows", "netshop_import_batches"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "platform",
    sql: `
      WITH ranked_batches AS (
        SELECT id AS batch_id, source AS batch_source, dataset AS batch_dataset,
          platform AS batch_platform, shop_name AS batch_shop_name,
          ROW_NUMBER() OVER (
            PARTITION BY source, dataset, platform, shop_name
            ORDER BY COALESCE(NULLIF(snapshot_date, ''), NULLIF(date_max, ''), '') DESC,
              completed_at DESC, created_at DESC, id DESC
          ) AS scope_rank
        FROM netshop_import_batches
        WHERE status = 'completed' AND source NOT IN ('jd_promotion', 'tmall_promotion')
      ), matched AS (
        SELECT item.sku_id, item.spu_id, item.product_code, item.product_name, item.shop_name, item.platform,
          MAX(item.dataset) AS dataset,
          MAX(COALESCE(item.business_date, item.snapshot_date, item.updated_at)) AS latest_date
        FROM ranked_batches batch
        JOIN netshop_rows item
          ON item.source = batch.batch_source
         AND item.dataset = batch.batch_dataset
         AND item.platform = batch.batch_platform
         AND item.shop_name = batch.batch_shop_name
         AND item.last_import_batch_id = batch.batch_id
        WHERE batch.scope_rank = 1
          AND (item.sku_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.spu_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.shop_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.platform LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.dataset LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
        GROUP BY item.sku_id, item.spu_id, item.product_code, item.product_name, item.shop_name, item.platform
      )
      SELECT COALESCE(NULLIF(sku_id, ''), NULLIF(spu_id, ''), NULLIF(product_code, ''), product_name) || ':' || shop_name AS result_id,
        COALESCE(NULLIF(product_name, ''), NULLIF(product_code, ''), NULLIF(sku_id, ''), NULLIF(spu_id, ''), '未命名商品') AS title,
        TRIM(CASE WHEN sku_id <> '' THEN 'SKU ' || sku_id ELSE '' END || CASE WHEN spu_id <> '' THEN ' · SPU ' || spu_id ELSE '' END || CASE WHEN product_code <> '' THEN ' · ' || product_code ELSE '' END) AS subtitle,
        COALESCE(platform, '') || CASE WHEN shop_name <> '' THEN ' · ' || shop_name ELSE '' END || CASE WHEN dataset <> '' THEN ' · ' || dataset ELSE '' END AS detail,
        latest_date AS updated_at, NULL AS amount_cents
      FROM matched ORDER BY latest_date DESC, result_id ASC LIMIT ? OFFSET ?`,
  },
  {
    key: "inventory",
    label: "库存记录",
    icon: "库",
    module: "inventory",
    requiredTables: ["inventory_stock_lines", "inventory_import_batches"],
    likeParameterCount: 7,
    allowedRoles: allRoles,
    scopeKind: "warehouse",
    sql: `
      WITH latest_batch AS (
        SELECT id AS batch_id
        FROM inventory_import_batches
        WHERE status = 'completed'
        ORDER BY snapshot_date DESC, rowid DESC
        LIMIT 1
      )
      SELECT item.product_code || ':' || item.warehouse AS result_id, item.product_name AS title,
        item.product_code || CASE WHEN item.specification <> '' THEN ' · ' || item.specification ELSE '' END AS subtitle,
        item.warehouse || CASE WHEN item.warehouse_type <> '' THEN ' · ' || item.warehouse_type ELSE '' END || ' · 可用 ' || item.available_quantity AS detail,
        item.snapshot_date AS updated_at, item.unit_cost_cents AS amount_cents
      FROM latest_batch batch
      JOIN inventory_stock_lines item ON item.batch_id = batch.batch_id
      WHERE TRIM(item.warehouse) <> '刷刷仓'
        AND (item.product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.warehouse_type LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.specification LIKE ? ESCAPE '\\' COLLATE NOCASE OR item.brand LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR item.category LIKE ? ESCAPE '\\' COLLATE NOCASE)
          /*SCOPE*/
      ORDER BY item.snapshot_date DESC, item.product_code ASC LIMIT ? OFFSET ?`,
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
    requiredTables: ["replenishment_plan_items"],
    likeParameterCount: 5,
    allowedRoles: businessRoles,
    scopeKind: "warehouse",
    sql: `
      SELECT id AS result_id, product_name AS title, product_code || ' · ' || warehouse AS subtitle,
        status || ' · 计划 ' || planned_quantity || CASE WHEN reason <> '' THEN ' · ' || reason ELSE '' END AS detail,
        updated_at, NULL AS amount_cents
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

const importSources = [
  { table: "sales_import_batches", source: "'销售明细'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
  { table: "inventory_import_batches", source: "'库存快照'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
  { table: "product_shipping_rate_import_batches", source: "'SKU 快递费率'", file: "file_name", searchable: ["id", "file_name", "source", "status"] },
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
    "sales_import_batches", "sales_order_lines",
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
    "ai_workflow_runs", "ai_workflow_node_runs", "ai_workflow_events",
    "workflow_operation_activities", "workflow_task_states", "workflow_task_template_states",
    "workflow_attachment_cleanup_queue", "workflow_task_activity_logs", "workflow_task_attachments", "workflow_task_comments",
    "workflow_task_entity_links", "workflow_task_reminders", "workflow_task_templates",
    "customer_service_conversation_versions", "customer_service_deletion_audits", "finance_target_versions", "finance_target_deletion_audits",
    "finance_target_scoped_versions", "finance_target_scoped_deletion_audits", "finance_target_legacy_migrations",
    "ai_tool_audit_logs",
    "sales_import_uploads", "sales_import_upload_chunks", "sales_projection_outbox", "sales_projection_source_state",
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
): GlobalSearchGroup {
  const hasMore = rows.length > request.groupLimit;
  const visibleRows = rows.slice(0, request.groupLimit);
  const offset = (request.page - 1) * request.groupLimit;
  // LIMIT + 1 proves only that another row exists. On a non-empty terminal
  // page the offset makes the count exact; an out-of-range page has no safe
  // lower bound beyond zero without re-running a count query.
  const total = visibleRows.length === 0 && request.page > 1
    ? 0
    : offset + visibleRows.length + (hasMore ? 1 : 0);
  const totalExact = !hasMore && (request.page === 1 || visibleRows.length > 0);
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

async function queryInventoryAgeGroup(
  db: GlobalSearchDatabase,
  tables: Set<string>,
  request: GlobalSearchRequest,
  like: string,
  principal: AppPrincipal,
) {
  const fragments: string[] = [];
  const binds: unknown[] = [];
  if (tables.has("erp_inventory_age_lines") && tables.has("erp_reference_import_batches")) {
    const scope = scopeSql(principal, "warehouse", { warehouse: "age.warehouse" });
    fragments.push(`SELECT 'erp:' || age.id AS result_id, age.product_name AS title,
      age.product_code || ' · ' || age.warehouse AS subtitle,
      COALESCE(age.category, '') || ' · 库龄 ' || COALESCE(age.inventory_age_days, 0) || ' 天 · 可用 ' || age.available_quantity AS detail,
      age.snapshot_date AS updated_at, age.stock_value_cents AS amount_cents
      FROM (
        SELECT id, snapshot_date
        FROM erp_reference_import_batches
        WHERE source_key = 'inventory_age' AND status = 'completed'
          AND snapshot_date IS NOT NULL AND snapshot_date <> ''
        ORDER BY snapshot_date DESC, completed_at DESC, created_at DESC, id DESC
        LIMIT 1
      ) batch
      JOIN erp_inventory_age_lines age
        ON age.last_import_batch_id = batch.id AND age.snapshot_date = batch.snapshot_date
      WHERE TRIM(age.warehouse) <> '刷刷仓'
        AND (age.product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR age.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR age.warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR age.category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR age.specification LIKE ? ESCAPE '\\' COLLATE NOCASE) ${scope.clause}`);
    binds.push(like, like, like, like, like, ...scope.values);
  }
  if (tables.has("inventory_age_metrics") && tables.has("inventory_stock_lines") && tables.has("inventory_import_batches")) {
    const scope = scopeSql(principal, "warehouse", { warehouse: "stock.warehouse" });
    fragments.push(`SELECT 'metric:' || stock.id AS result_id, stock.product_name AS title,
      stock.product_code || ' · ' || stock.warehouse AS subtitle,
      COALESCE(stock.category, '') || ' · 7日销量 ' || metric.sales_7d_quantity || ' · 30日销量 ' || metric.sales_30d_quantity AS detail,
      stock.snapshot_date AS updated_at, NULL AS amount_cents
      FROM (
        SELECT id
        FROM inventory_import_batches
        WHERE status = 'completed'
        ORDER BY snapshot_date DESC, rowid DESC
        LIMIT 1
      ) batch
      JOIN inventory_stock_lines stock ON stock.batch_id = batch.id
      JOIN inventory_age_metrics metric ON metric.batch_id = stock.batch_id AND metric.row_key = stock.row_key
      WHERE TRIM(stock.warehouse) <> '刷刷仓'
        AND (stock.product_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR stock.product_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR stock.warehouse LIKE ? ESCAPE '\\' COLLATE NOCASE OR stock.category LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR stock.specification LIKE ? ESCAPE '\\' COLLATE NOCASE) ${scope.clause}`);
    binds.push(like, like, like, like, like, ...scope.values);
  }
  if (fragments.length === 0) return emptyGroup(inventoryAgeDefinition);
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents
    FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(sql)
      .bind(...binds, request.groupLimit + 1, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    return mapSearchRows(inventoryAgeDefinition, result.results ?? [], request, principal);
  } catch {
    return emptyGroup(inventoryAgeDefinition, false);
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
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents, target_hint
    FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(sql)
      .bind(...binds, request.groupLimit + 1, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    return mapSearchRows(workflowDefinition, result.results ?? [], request, principal);
  } catch {
    return emptyGroup(workflowDefinition, false);
  }
}

async function queryImportGroup(db: GlobalSearchDatabase, tables: Set<string>, request: GlobalSearchRequest, like: string, principal: AppPrincipal) {
  const availableSources = importSources.filter((source) => tables.has(source.table));
  if (availableSources.length === 0) return emptyGroup(importDefinition);
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
  const sql = `SELECT result_id, title, subtitle, detail, updated_at, amount_cents
    FROM (${fragments.join(" UNION ALL ")})
    ORDER BY updated_at DESC, result_id ASC LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(sql)
      .bind(...binds, request.groupLimit + 1, (request.page - 1) * request.groupLimit)
      .all<SearchRow>();
    return mapSearchRows(importDefinition, result.results ?? [], request, principal);
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
  const tableResult = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set((tableResult.results ?? []).map((row) => row.name));
  const like = escapeGlobalSearchLike(request.query);
  const selectedStaticDefinitions = staticDefinitions.filter((definition) =>
    (!request.group || definition.key === request.group) && isGroupAuthorized(definition, principal));
  const groupTasks: SearchGroupTask[] = selectedStaticDefinitions.map((definition) => {
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
      available: (tables.has("workflow_tasks") && principal.scope === null) || tables.has("workflow_operation_records"),
      run: () => queryWorkflowGroup(db, tables, request, like, principal),
    });
  }
  if ((!request.group || request.group === "inventory_age") && allRoles.includes(principal.role)) {
    groupTasks.push({
      definition: inventoryAgeDefinition,
      available: (tables.has("erp_inventory_age_lines") && tables.has("erp_reference_import_batches"))
        || (tables.has("inventory_age_metrics") && tables.has("inventory_stock_lines") && tables.has("inventory_import_batches")),
      run: () => queryInventoryAgeGroup(db, tables, request, like, principal),
    });
  }
  if ((!request.group || request.group === "imports") && operatorRoles.some((role) => role === principal.role) && principal.scope === null) {
    groupTasks.push({
      definition: importDefinition,
      available: importSources.some((source) => tables.has(source.table)),
      run: () => queryImportGroup(db, tables, request, like, principal),
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
import type { AppPrincipal, AppRole } from "@/lib/auth/authorization";
