import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { SalesConsumerReader } from "../lib/django/sales-consumer-reader";
import type { FinanceConsumerReader } from "../lib/django/finance-consumer-reader";
import type { NetshopConsumerReader } from "../lib/django/netshop-consumer-reader";
import type { ProductsConsumerReader } from "../lib/django/products-consumer-reader";
import type { InventoryConsumerReader } from "../lib/django/inventory-consumer-reader";
import type { WorkflowConsumerReader } from "../lib/django/workflow-consumer-reader";
import { globalSearchErrorResponse } from "../lib/search/api-response";

import {
  escapeGlobalSearchLike,
  GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT,
  GlobalSearchRequestError,
  normalizeGlobalSearchRequest,
  searchAllBusinessData,
  type GlobalSearchDatabase,
} from "../lib/search/global-search";
import {
  getGlobalSearchNavigationTarget,
  globalSearchDefaultTargets,
  globalSearchGroupKeys,
  isGlobalSearchNavigationTargetForGroup,
} from "../lib/search/target-contract";

const admin: AppPrincipal = { email: "admin@example.com", displayName: "Admin", role: "admin", scope: null };
const viewer: AppPrincipal = { email: "viewer@example.com", displayName: "Viewer", role: "viewer", scope: null };

const allSearchTables = [
  "erp_product_master", "netshop_rows", "inventory_stock_lines",
  "market_ranking_entries", "market_price_snapshots", "market_master_identities", "erp_combo_items", "replenishment_plan_items",
  "market_sku_annotations", "customer_service_conversations", "finance_lines", "finance_targets_scoped",
  "workflow_tasks", "workflow_task_states", "workflow_operation_records", "erp_inventory_age_lines",
  "inventory_import_batches", "erp_reference_import_batches", "finance_import_batches",
  "netshop_import_batches", "market_import_batches", "customer_service_import_batches",
] as const;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function fakeSalesSearchReader(input: {
  orders?: Array<{ id: string; title: string; subtitle: string; detail: string; updatedAt: string; amountCents: number }>;
  orderTotal?: number;
  imports?: Array<{ id: string; source: string; fileName: string; status: string; rowCount: number; createdAt: string; completedAt: string | null }>;
  importTotal?: number;
  calls?: Array<{ principal: AppPrincipal; request: Record<string, unknown> }>;
} = {}): SalesConsumerReader {
  return {
    read: (async (principal: AppPrincipal, request: Record<string, unknown>) => {
      input.calls?.push({ principal, request });
      if (request.operation === "order_search") {
        const allItems = input.orders ?? [];
        const page = Number(request.page);
        const pageSize = Number(request.pageSize);
        const total = input.orderTotal ?? allItems.length;
        return {
          revision: "9:1",
          data: { items: allItems.slice((page - 1) * pageSize, page * pageSize), total, truncated: page * pageSize < total },
        };
      }
      if (request.operation === "import_batch_search") {
        const allItems = input.imports ?? [];
        const page = Number(request.page);
        const pageSize = Number(request.pageSize);
        const total = input.importTotal ?? allItems.length;
        return {
          revision: "9:1",
          data: { items: allItems.slice((page - 1) * pageSize, page * pageSize), total, truncated: page * pageSize < total },
        };
      }
      throw new Error(`unexpected operation ${String(request.operation)}`);
    }) as SalesConsumerReader["read"],
  };
}

function fakeFinanceSearchReader(input: {
  lines?: Array<{ id: string; title: string; subtitle: string; detail: string; updatedAt: string; amountCents: number | null }>;
  targets?: Array<{ id: string; title: string; subtitle: string; detail: string; updatedAt: string; amountCents: number | null }>;
  imports?: Array<{ id: string; source: string; fileName: string; status: string; rowCount: number; createdAt: string; completedAt: string | null }>;
  calls?: Array<{ principal: AppPrincipal; request: Record<string, unknown> }>;
} = {}): FinanceConsumerReader {
  return {
    read: (async (principal: AppPrincipal, request: Record<string, unknown>) => {
      input.calls?.push({ principal, request });
      const allItems = request.operation === "line_search"
        ? input.lines ?? []
        : request.operation === "target_search"
          ? input.targets ?? []
          : input.imports ?? [];
      const offset = Number(request.offset);
      const limit = Number(request.limit);
      return {
        revision: "3:abcdef123456",
        data: {
          items: allItems.slice(offset, offset + limit),
          total: allItems.length,
          truncated: offset + limit < allItems.length,
        },
      };
    }) as FinanceConsumerReader["read"],
  };
}

function fakeNetshopSearchReader(input: {
  rows?: Array<{ id: string; title: string; subtitle: string; detail: string; updatedAt: string; amountCents: null }>;
  imports?: Array<{ id: string; source: string; dataset: string; platform: string; shopName: string; fileName: string; status: string; rowCount: number; createdAt: string; completedAt: string | null }>;
  calls?: Array<{ principal: AppPrincipal; request: Record<string, unknown> }>;
} = {}): NetshopConsumerReader {
  return {
    read: (async (principal: AppPrincipal, request: Record<string, unknown>) => {
      input.calls?.push({ principal, request });
      const allItems = request.operation === "row_search" ? input.rows ?? [] : input.imports ?? [];
      const offset = Number(request.offset);
      const limit = Number(request.limit);
      return {
        revision: "4:abcdef123456",
        data: {
          items: allItems.slice(offset, offset + limit),
          total: allItems.length,
          truncated: offset + limit < allItems.length,
        },
      };
    }) as NetshopConsumerReader["read"],
  };
}

function fakeProductsSearchReader(input: {
  imports?: Array<{ id: string; source: string; fileName: string; status: string; rowCount: number; createdAt: string; completedAt: string | null }>;
  calls?: Array<{ principal: AppPrincipal; request: Record<string, unknown> }>;
} = {}): ProductsConsumerReader {
  return {
    read: (async (principal: AppPrincipal, request: Record<string, unknown>) => {
      input.calls?.push({ principal, request });
      if (request.operation !== "import_batch_search") {
        throw new Error(`unexpected operation ${String(request.operation)}`);
      }
      const allItems = input.imports ?? [];
      const offset = Number(request.offset);
      const limit = Number(request.limit);
      return {
        revision: "2:abcdef123456",
        data: {
          items: allItems.slice(offset, offset + limit),
          total: allItems.length,
          truncated: offset + limit < allItems.length,
        },
      };
    }) as ProductsConsumerReader["read"],
  };
}

type InventorySearchItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  updatedAt: string;
  amountCents: number | null;
};

type InventoryImportItem = {
  id: string;
  source: string;
  dataset: string;
  fileName: string;
  status: string;
  rowCount: number;
  createdAt: string;
  completedAt: string | null;
};

function fakeInventorySearchReader(input: {
  inventory?: InventorySearchItem[];
  age?: InventorySearchItem[];
  replenishment?: InventorySearchItem[];
  imports?: InventoryImportItem[];
  calls?: Array<{ principal: AppPrincipal; request: Record<string, unknown> }>;
} = {}): InventoryConsumerReader {
  return {
    read: (async (principal: AppPrincipal, request: Record<string, unknown>) => {
      input.calls?.push({ principal, request });
      const allItems = request.operation === "inventory_search"
        ? input.inventory ?? []
        : request.operation === "age_search"
          ? input.age ?? []
          : request.operation === "replenishment_search"
            ? input.replenishment ?? []
            : request.operation === "import_batch_search"
              ? input.imports ?? []
              : (() => { throw new Error(`unexpected operation ${String(request.operation)}`); })();
      const offset = Number(request.offset);
      const limit = Number(request.limit);
      return {
        revision: "inventory:2:abcdef123456",
        data: {
          items: allItems.slice(offset, offset + limit),
          total: allItems.length,
          truncated: offset + limit < allItems.length,
        },
      };
    }) as InventoryConsumerReader["read"],
  };
}

test("全局搜索校验关键词、分组和严格分页上限", () => {
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=一")), GlobalSearchRequestError);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=sqlite_master")), /允许清单/);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=")), /允许清单/);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&limit=9")), /1 到 8/);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&totalLimit=51")), /1 到 50/);
  const parsed = normalizeGlobalSearchRequest(new URLSearchParams("q= 净水机 &group=products&page=2&limit=3&totalLimit=9"));
  assert.deepEqual(parsed, { query: "净水机", group: "products", page: 2, groupLimit: 3, totalLimit: 9 });
  assert.equal(normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&pageSize=3")).groupLimit, 3);

  for (const query of [
    "q=净水机&page=1e2",
    "q=净水机&page=1.5",
    "q=净水机&page=%2B1",
    "q=净水机&page=%201",
    "q=净水机&page=01",
    "q=净水机&pageSize=1e2",
    "q=净水机&pageSize=1.5",
    "q=净水机&limit=1e2",
    "q=净水机&limit=1.5",
  ]) {
    assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams(query)), /十进制正整数/);
  }
  for (const query of [
    "q=净水机&q=净水器",
    "q=净水机&page=1&page=2",
    "q=净水机&pageSize=2&pageSize=3",
    "q=净水机&limit=2&limit=3",
    "q=净水机&group=products&group=orders",
  ]) {
    assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams(query)), /不能重复/);
  }
  assert.throws(
    () => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&pageSize=2&limit=2")),
    /不能同时提供/,
  );
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&unknown=1")), /不支持的查询参数/);
});

test("每个搜索分组都有精确 module+view target 且不伪造实体", () => {
  assert.deepEqual(globalSearchDefaultTargets, {
    products: { module: "product", view: "overview" },
    orders: { module: "sales", view: "overview" },
    jd_products: { module: "shop", view: "products" },
    inventory: { module: "inventory", view: "overview" },
    inventory_age: { module: "inventory", view: "age" },
    combos: { module: "product", view: "overview" },
    replenishment: { module: "inventory", view: "plan" },
    market_skus: { module: "market", view: "ranking" },
    market_annotations: { module: "market", view: "settings" },
    customer_service: { module: "customer_service", view: "conversations" },
    finance: { module: "sales", view: "finance" },
    targets: { module: "sales", view: "targets" },
    workflow: { module: "workflow", view: "plan" },
    imports: { module: "import", view: "history" },
  });
  assert.deepEqual(Object.keys(globalSearchDefaultTargets), [...globalSearchGroupKeys]);
  for (const group of globalSearchGroupKeys) {
    const target = getGlobalSearchNavigationTarget(group);
    assert.equal(isGlobalSearchNavigationTargetForGroup(group, target), true);
    assert.equal(Object.hasOwn(target, "entity"), false);
  }
  assert.deepEqual(getGlobalSearchNavigationTarget("workflow", "inspection"), { module: "workflow", view: "inspection" });
  assert.deepEqual(getGlobalSearchNavigationTarget("workflow", "review"), { module: "workflow", view: "reviews" });
  assert.deepEqual(getGlobalSearchNavigationTarget("workflow", "launch"), { module: "workflow", view: "launch" });
  assert.deepEqual(getGlobalSearchNavigationTarget("workflow", "unknown"), { module: "workflow", view: "plan" });
});

test("LIKE 模式字符只作为字面量绑定", () => {
  assert.equal(escapeGlobalSearchLike("A%_\\B"), "%A\\%\\_\\\\B%");
});

test("网店商品搜索只使用有界 Django 消费接口且不回查 D1 网店事实", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE netshop_import_batches (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, dataset TEXT NOT NULL,
      platform TEXT NOT NULL, shop_name TEXT NOT NULL, status TEXT NOT NULL,
      snapshot_date TEXT, date_max TEXT, completed_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE netshop_rows (
      id INTEGER PRIMARY KEY, source TEXT NOT NULL, dataset TEXT NOT NULL,
      platform TEXT NOT NULL, shop_name TEXT NOT NULL, last_import_batch_id TEXT NOT NULL,
      sku_id TEXT NOT NULL DEFAULT '', spu_id TEXT NOT NULL DEFAULT '',
      product_code TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '',
      business_date TEXT, snapshot_date TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX netshop_rows_lock_ownership_idx
      ON netshop_rows (source, dataset, platform, shop_name, last_import_batch_id);
    INSERT INTO netshop_import_batches VALUES
      ('old', 'jd_sku_daily', 'sku_daily', '京东', '测试店', 'completed', '2026-08-01', '2026-08-01', '2026-08-01 10:00:00', '2026-08-01 09:00:00'),
      ('current', 'jd_sku_daily', 'sku_daily', '京东', '测试店', 'completed', '2026-08-25', '2026-08-25', '2026-08-25 10:00:00', '2026-08-25 09:00:00'),
      ('promotion', 'jd_promotion', 'ad', '京东', '测试店', 'completed', NULL, '2026-08-25', '2026-08-25 11:00:00', '2026-08-25 10:00:00'),
      ('processing', 'tmall_product_daily', 'spu_daily', '天猫', '测试店', 'processing', NULL, '2026-08-25', '2026-08-25 11:00:00', '2026-08-25 10:00:00');
    INSERT INTO netshop_rows VALUES
      (1, 'jd_sku_daily', 'sku_daily', '京东', '测试店', 'old', 'OLD-SKU', '', '', '历史命中', '2026-08-01', '', '2026-08-01'),
      (2, 'jd_sku_daily', 'sku_daily', '京东', '测试店', 'current', 'CURRENT-SKU', '', '', '当前命中', '2026-08-25', '', '2026-08-25'),
      (3, 'jd_promotion', 'ad', '京东', '测试店', 'promotion', 'PROMOTION-SKU', '', '', '促销命中', '2026-08-25', '', '2026-08-25'),
      (4, 'tmall_product_daily', 'spu_daily', '天猫', '测试店', 'processing', '', 'PROCESSING-SPU', '', '处理中命中', '2026-08-25', '', '2026-08-25');
  `);
  const businessCalls: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() {
          if (!sql.includes("sqlite_master")) businessCalls.push({ sql, values });
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=命中&group=jd_products")),
    admin,
    {
      netshopReader: fakeNetshopSearchReader({ rows: [{
        id: "CURRENT-SKU:测试店",
        title: "当前命中",
        subtitle: "京东 · 测试店",
        detail: "CURRENT-SKU",
        updatedAt: "2026-08-25",
        amountCents: null,
      }] }),
    },
  );

  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["CURRENT-SKU:测试店"]);
  assert.equal(result.groups[0]?.available, true);
  assert.equal(businessCalls.length, 0);
  sqlite.close();
});

test("库存搜索只读取当前完成快照并保持刷刷仓排除", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE inventory_import_batches (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot_date TEXT NOT NULL
    );
    CREATE TABLE inventory_stock_lines (
      id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, product_code TEXT NOT NULL,
      product_name TEXT NOT NULL, warehouse TEXT NOT NULL, warehouse_type TEXT NOT NULL,
      specification TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      snapshot_date TEXT NOT NULL, available_quantity INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL
    );
    CREATE INDEX inventory_stock_lines_batch_idx ON inventory_stock_lines (batch_id);
    INSERT INTO inventory_import_batches VALUES
      ('old', 'completed', '2026-08-01'), ('current', 'completed', '2026-08-25');
    INSERT INTO inventory_stock_lines VALUES
      (1, 'old', 'OLD', '历史命中', '主仓', 'owned', '', '', '', '2026-08-01', 1, 100),
      (2, 'current', 'CURRENT', '当前命中', '主仓', 'owned', '', '', '', '2026-08-25', 2, 200),
      (3, 'current', 'EXCLUDED', '排除命中', '刷刷仓', 'other', '', '', '', '2026-08-25', 3, 300);
  `);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;

  const inventoryCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=命中&group=inventory")),
    admin,
    {
      inventoryReader: fakeInventorySearchReader({
        inventory: [{
          id: "CURRENT:主仓", title: "当前命中", subtitle: "CURRENT", detail: "主仓 · 可用 2",
          updatedAt: "2026-08-25", amountCents: 200,
        }],
        calls: inventoryCalls,
      }),
    },
  );

  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["CURRENT:主仓"]);
  assert.deepEqual(inventoryCalls.map((call) => call.request.operation), ["inventory_search"]);
  sqlite.close();
});

test("库龄搜索只读取最新权威库龄批次并保持刷刷仓排除", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE erp_reference_import_batches (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL, status TEXT NOT NULL,
      snapshot_date TEXT, completed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE erp_inventory_age_lines (
      id INTEGER PRIMARY KEY, last_import_batch_id TEXT NOT NULL, snapshot_date TEXT NOT NULL,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '', warehouse TEXT NOT NULL, inventory_age_days INTEGER,
      available_quantity INTEGER NOT NULL, stock_value_cents INTEGER
    );
    CREATE INDEX erp_inventory_age_last_batch_idx ON erp_inventory_age_lines (last_import_batch_id);
    INSERT INTO erp_reference_import_batches VALUES
      ('old', 'inventory_age', 'completed', '2026-08-01', '2026-08-01 10:00:00', '2026-08-01 09:00:00'),
      ('current', 'inventory_age', 'completed', '2026-08-25', '2026-08-25 10:00:00', '2026-08-25 09:00:00');
    INSERT INTO erp_inventory_age_lines VALUES
      (1, 'old', '2026-08-01', 'OLD', '历史命中', '', '', '主仓', 90, 1, 100),
      (2, 'current', '2026-08-25', 'CURRENT', '当前命中', '', '', '主仓', 30, 2, 200),
      (3, 'current', '2026-08-25', 'EXCLUDED', '排除命中', '', '', '刷刷仓', 10, 3, 300);
  `);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;

  const inventoryCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=命中&group=inventory_age")),
    admin,
    {
      inventoryReader: fakeInventorySearchReader({
        age: [{
          id: "erp:2", title: "当前命中", subtitle: "CURRENT · 主仓", detail: "库龄 30 天",
          updatedAt: "2026-08-25", amountCents: 200,
        }],
        calls: inventoryCalls,
      }),
    },
  );

  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["erp:2"]);
  assert.deepEqual(inventoryCalls.map((call) => call.request.operation), ["age_search"]);
  sqlite.close();
});

test("市场搜索复用最新身份投影而不扫描历史榜单", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE market_ranking_entries (
      id INTEGER PRIMARY KEY, sku_code TEXT NOT NULL, product_name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, scope TEXT NOT NULL,
      ranking_dimension TEXT NOT NULL, period_end TEXT NOT NULL, price_cents INTEGER, rank INTEGER
    );
    CREATE TABLE market_master_identities (
      category TEXT NOT NULL, scope TEXT NOT NULL, ranking_dimension TEXT NOT NULL,
      sku_code TEXT NOT NULL, latest_entry_id INTEGER NOT NULL,
      PRIMARY KEY (category, scope, ranking_dimension, sku_code)
    );
    CREATE TABLE market_price_snapshots (
      category TEXT NOT NULL, sku_code TEXT NOT NULL, ranking_dimension TEXT NOT NULL, month TEXT NOT NULL,
      confirmed_market_price_cents INTEGER, source_price_cents INTEGER,
      average_transaction_price_cents INTEGER, ai_image_price_cents INTEGER
    );
    INSERT INTO market_ranking_entries VALUES
      (1, 'SKU-1', '历史命中', '', '类目', 'POP', 'SKU', '2026-07-31', 10000, 2),
      (2, 'SKU-1', '当前命中', '', '类目', 'POP', 'SKU', '2026-08-31', 12000, 1);
    INSERT INTO market_master_identities VALUES ('类目', 'POP', 'SKU', 'SKU-1', 2);
    INSERT INTO market_price_snapshots VALUES ('类目', 'SKU-1', 'SKU', '2026-08', 12345, NULL, NULL, NULL);
  `);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=命中&group=market_skus")),
    admin,
  );

  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["SKU-1:类目:POP"]);
  assert.equal(result.groups[0]?.items[0]?.amountCents, 12345);
  sqlite.close();
});

test("统一搜索只把关键词作为绑定参数并在数据库分页", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as typeof values; return this; },
        async all<T>() {
          calls.push({ sql, values });
          if (sql.includes("sqlite_master")) return { results: [{ name: "erp_product_master" }] as T[] };
          return { results: Array.from({ length: 3 }, (_, index) => ({
            result_id: `SKU-${index + 1}`, title: "净水机", subtitle: "商用", detail: "净水设备",
            updated_at: "2026-07-23", amount_cents: null,
          })) as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const request = normalizeGlobalSearchRequest(new URLSearchParams("q=%27%20OR%201%3D1--&group=products&page=2&limit=2&totalLimit=8"));
  const result = await searchAllBusinessData(database, request, admin);
  const businessCall = calls.find((call) => call.sql.includes("erp_product_master"));
  assert.ok(businessCall);
  assert.doesNotMatch(businessCall.sql, /OR 1=1--/);
  assert.equal(businessCall.values.at(-2), 3);
  assert.equal(businessCall.values.at(-1), 2);
  assert.doesNotMatch(businessCall.sql, /COUNT\s*\(\s*\*\s*\)\s*OVER/i);
  assert.equal(calls.length, 2);
  assert.equal(result.groups[0]?.items.length, 2);
  assert.equal(result.groups[0]?.total, 5);
  assert.equal(result.groups[0]?.totalExact, false);
  assert.equal(result.groups[0]?.hasMore, true);
  assert.equal(result.filtersApplied.group, "products");
  assert.equal(result.truncated, true);
});

test("销售订单搜索仅读 Django 并在统一投影层限制响应体积", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=orders&pageSize=1&totalLimit=1")),
    admin,
    { salesReader: fakeSalesSearchReader({ orders: [{
      id: "ORDER-LARGE",
      title: "ORDER-LARGE",
      subtitle: "京东 · 测试店",
      detail: `净水机-${"长".repeat(10_000)}`,
      updatedAt: "2026-08-20",
      amountCents: 10_000,
    }] }) },
  );
  const detail = result.groups[0]?.items[0]?.detail ?? "";
  assert.ok(Array.from(detail).length <= 400);
  assert.ok(new TextEncoder().encode(detail).byteLength <= 1_536);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 8 * 1024);
  sqlite.close();
});

test("Django 财务模式下财务科目和目标搜索不再读取 D1 财务表", async () => {
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind() { return this; },
        async all<T>() {
          assert.match(sql, /sqlite_master/);
          return { results: [{ name: "finance_lines" }, { name: "finance_targets_scoped" }] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const financeCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const dependencies = {
    salesReader: fakeSalesSearchReader(),
    financeReader: fakeFinanceSearchReader({
      calls: financeCalls,
      lines: [{
        id: "line-1", title: "财务迁移科目", subtitle: "2026-08", detail: "summary",
        updatedAt: "2026-08-30", amountCents: 10_000,
      }],
      targets: [{
        id: "target-1", title: "2026-08", subtitle: "京东 · 财务迁移店", detail: "month",
        updatedAt: "2026-08-30", amountCents: 20_000,
      }],
    }),
    financeBackendMode: "django" as const,
  };
  const financeResult = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=财务迁移&group=finance")),
    admin,
    dependencies,
  );
  const targetResult = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=财务迁移&group=targets")),
    admin,
    dependencies,
  );
  assert.equal(financeResult.groups[0]?.items[0]?.id, "line-1");
  assert.equal(targetResult.groups[0]?.items[0]?.id, "target-1");
  assert.deepEqual(financeCalls.map((call) => call.request.operation), ["line_search", "target_search"]);
  assert.equal(calls.some((sql) => /FROM\s+finance_(?:lines|targets_scoped)/i.test(sql)), false);
});

test("Django 财务与商品批次在销售及其余 D1 批次之间保持精确跨源分页", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE inventory_import_batches (
    id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
  );
  CREATE TABLE finance_import_batches (
    id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
  );
  INSERT INTO inventory_import_batches VALUES
    ('inventory-1', '库存净水机.xlsx', 'inventory', 'completed', '2026-08-20', '2026-08-20');
  INSERT INTO finance_import_batches VALUES
    ('stale-d1-finance', '旧财务净水机.xlsx', 'finance', 'completed', '2026-08-19', '2026-08-19');`);
  const sqlCalls: string[] = [];
  const database = {
    prepare(sql: string) {
      sqlCalls.push(sql);
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const salesImports = [1, 2, 3].map((index) => ({
    id: `sales-${index}`,
    source: "erp_sales",
    fileName: `销售净水机-${index}.xlsx`,
    status: "completed",
    rowCount: 10,
    createdAt: `2026-08-${20 + index}`,
    completedAt: `2026-08-${20 + index}`,
  }));
  const financeImports = [1, 2].map((index) => ({
    id: `finance-${index}`,
    source: "月度财报",
    fileName: `财务净水机-${index}.xlsx`,
    status: "completed",
    rowCount: 10,
    createdAt: `2026-08-${18 + index}`,
    completedAt: `2026-08-${18 + index}`,
  }));
  const productImports = [1, 2].map((index) => ({
    id: `products-${index}`,
    source: "SKU 快递费率",
    fileName: `商品净水机-${index}.xlsx`,
    status: "completed",
    rowCount: 10,
    createdAt: `2026-08-${16 + index}`,
    completedAt: `2026-08-${16 + index}`,
  }));
  const inventoryImports = [{
    id: "inventory-1",
    source: "inventory",
    dataset: "stock",
    fileName: "库存净水机.xlsx",
    status: "completed",
    rowCount: 10,
    createdAt: "2026-08-20",
    completedAt: "2026-08-20",
  }];
  const dependencies = {
    salesReader: fakeSalesSearchReader({ imports: salesImports }),
    financeReader: fakeFinanceSearchReader({ imports: financeImports }),
    netshopReader: fakeNetshopSearchReader(),
    productsReader: fakeProductsSearchReader({ imports: productImports }),
    inventoryReader: fakeInventorySearchReader({ imports: inventoryImports }),
    financeBackendMode: "django" as const,
  };
  const middle = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=imports&page=3&pageSize=2")),
    admin,
    dependencies,
  );
  assert.deepEqual(middle.groups[0]?.items.map((item) => item.id), ["finance-2", "products-1"]);
  assert.equal(middle.groups[0]?.total, 8);
  assert.equal(middle.groups[0]?.hasMore, true);
  const last = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=imports&page=4&pageSize=2")),
    admin,
    dependencies,
  );
  assert.deepEqual(last.groups[0]?.items.map((item) => item.id), ["products-2", "inventory-1"]);
  assert.equal(last.groups[0]?.total, 8);
  assert.equal(last.groups[0]?.hasMore, false);
  assert.equal(sqlCalls.some((sql) => /FROM\s+finance_import_batches/i.test(sql)), false);
  sqlite.close();
});

test("业务表尚未创建时分组安全降级且不执行对应查询", async () => {
  let statementCount = 0;
  const database = {
    prepare(sql: string) {
      statementCount += 1;
      return {
        bind() { return this; },
        async all<T>() {
          assert.match(sql, /sqlite_master/);
          return { results: [] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const request = normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=inventory"));
  const result = await searchAllBusinessData(database, request, admin);
  assert.equal(statementCount, 1);
  assert.equal(result.returned, 0);
  assert.equal(result.groups[0]?.available, false);
  assert.deepEqual(result.unavailableDomains, ["库存记录"]);
});

test("所有登记分组 SQL 可在真实 SQLite 架构执行", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, migrationDirectory), "utf8");
    if (/Operator-only terminal retirement/.test(sql)) continue;
    sqlite.exec(sql);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customer_service_import_batches (
      id TEXT PRIMARY KEY, session_file_name TEXT NOT NULL, chat_file_name TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS customer_service_conversations (
      id INTEGER PRIMARY KEY, consulted_at TEXT NOT NULL, customer_id TEXT NOT NULL DEFAULT '',
      customer_alias TEXT NOT NULL DEFAULT '', chat_customer_alias TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '', product_sku TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '', messages_json TEXT NOT NULL DEFAULT '[]',
      consultation_type TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL DEFAULT ''
    );
  `);
  const database = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as typeof values; return this; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机")),
    admin,
    {
      salesReader: fakeSalesSearchReader(),
      financeReader: fakeFinanceSearchReader(),
      netshopReader: fakeNetshopSearchReader(),
      productsReader: fakeProductsSearchReader(),
      inventoryReader: fakeInventorySearchReader(),
      financeBackendMode: "django",
    },
  );
  assert.equal(result.groups.length, 14);
  assert.equal(result.groups.every((group) => group.available), true);
  sqlite.close();
});

test("运营事务搜索兼容尚未创建运营记录和状态表的旧库", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE workflow_tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, work_content TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '', shop_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO workflow_tasks (id, title, work_content, category, owner, shop_name, status, priority)
    VALUES ('legacy-1', '旧库巡店任务', '检查价格', '巡店检查', '运营组', '测试店', '待开始', 'normal');`);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const result = await searchAllBusinessData(database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=旧库巡店&group=workflow")), admin);
  assert.equal(result.groups[0]?.available, true);
  assert.equal(result.groups[0]?.total, 1);
  assert.equal(result.groups[0]?.items[0]?.id, "task:legacy-1");
  assert.deepEqual(result.groups[0]?.items[0]?.target, { module: "workflow", view: "plan" });
  sqlite.close();
});

test("运营事务真实 SQLite 结果只返回仍由 D1 承载的记录类型", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE workflow_operation_records (
    id TEXT PRIMARY KEY, record_type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
  );
  INSERT INTO workflow_operation_records
    (id, record_type, title, platform, channel, shop_name, content)
  VALUES
    ('inspection-1', 'inspection', '导航巡店', '京东', '线上', '一店', '导航'),
    ('review-1', 'review', '导航评价', '京东', '线上', '一店', '导航'),
    ('launch-1', 'launch', '导航新品', '京东', '线上', '一店', '导航');`);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=导航&group=workflow&limit=8")),
    admin,
  );
  const targets = new Map(result.groups[0]?.items.map((item) => [item.id, item.target]));
  assert.deepEqual(targets.get("operation:inspection-1"), { module: "workflow", view: "inspection" });
  assert.deepEqual(targets.get("operation:review-1"), { module: "workflow", view: "reviews" });
  assert.equal(targets.has("operation:launch-1"), false);
  sqlite.close();
});

test("Django 运营事务模式优先检索结构化新品且不回查旧新品记录", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE workflow_operation_records (
    id TEXT PRIMARY KEY, record_type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
  );
  INSERT INTO workflow_operation_records
    (id, record_type, title, platform, channel, shop_name, content, updated_at)
  VALUES
    ('review-1', 'review', '净水器复盘', '京东', '线上', '一店', '净水器', '2026-09-02'),
    ('legacy-launch-1', 'launch', '净水器旧新品', '京东', '线上', '一店', '净水器', '2026-09-03');`);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const calls: Array<Record<string, unknown>> = [];
  const workflowReader: WorkflowConsumerReader = {
    async read(_principal, request) {
      calls.push(request);
      return {
        revision: "2:abcdef123456",
        data: {
          items: [{
            id: "7e28149d-f0bd-4fb8-b87f-77e507b28130",
            title: "净水器结构化新品",
            subtitle: "供应商甲 · 商用净水 · 进行中",
            detail: "SKU-NEW-1 · 新品负责人",
            updatedAt: "2026-09-01T10:00:00+08:00",
            amountCents: 399_900,
          }],
          total: 1,
          truncated: false,
        },
      };
    },
  };
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水器&group=workflow&limit=8")),
    admin,
    { workflowBackendMode: "django", workflowReader },
  );
  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), [
    "launch:7e28149d-f0bd-4fb8-b87f-77e507b28130",
    "operation:review-1",
  ]);
  assert.equal(result.groups[0]?.total, 2);
  assert.equal(result.groups[0]?.totalExact, true);
  assert.deepEqual(result.groups[0]?.items[0]?.target, { module: "workflow", view: "launch" });
  assert.equal(calls[0]?.operation, "launch_project_search");
  assert.equal(result.groups[0]?.items.some((item) => item.id.includes("legacy-launch")), false);
  sqlite.close();
});

test("经营目标搜索在 scoped 表尚未迁移的旧库回退 legacy 表且不影响其他分组", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE finance_targets (
    id TEXT PRIMARY KEY, period_type TEXT NOT NULL, period_key TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO finance_targets (id, period_type, period_key, shop_name, manager, sales_target_cents)
    VALUES ('legacy-target', 'month', '2026-08', '旧库店铺', '旧目标负责人', 10000);`);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const result = await searchAllBusinessData(database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=旧目标&group=targets")), admin);
  assert.equal(result.groups[0]?.available, true);
  assert.equal(result.groups[0]?.total, 1);
  assert.equal(result.groups[0]?.items[0]?.id, "legacy-target");
  assert.deepEqual(result.groups[0]?.items[0]?.target, { module: "sales", view: "targets" });
  sqlite.close();
});

test("搜索 API 对受控输入返回400，对未知异常固定脱敏且全部no-store", async () => {
  const invalid = globalSearchErrorResponse(new GlobalSearchRequestError("page 必须为十进制正整数。"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalid.json(), {
    error: "page 必须为十进制正整数。",
    code: "invalid_request",
  });

  const unknown = globalSearchErrorResponse(new Error("SQLITE_SECRET_INTERNAL_DETAIL"));
  assert.equal(unknown.status, 500);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  const body = await unknown.json() as { error: string; code: string };
  assert.deepEqual(body, { error: "搜索系统数据失败", code: "internal_error" });
  assert.doesNotMatch(JSON.stringify(body), /SQLITE_SECRET_INTERNAL_DETAIL/);
});

test("经营目标搜索按平台列限制 scoped 目标而不把同名店铺误作平台", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE finance_targets_scoped (
    id TEXT PRIMARY KEY, period_type TEXT NOT NULL, period_key TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '', shop_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO finance_targets_scoped
    (id, period_type, period_key, platform, shop_name, manager, sales_target_cents)
  VALUES
    ('tmall-shop-named-jd', 'month', '2026-08', '天猫', '京东', '隔离目标', 10000),
    ('jd-shop-named-tmall', 'month', '2026-08', '京东', '天猫', '隔离目标', 20000);`);
  const database = {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const restrictedAdmin: AppPrincipal = {
    ...admin,
    scope: { warehouses: [], channels: [], platforms: ["京东"] },
  };
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=隔离目标&group=targets")),
    restrictedAdmin,
  );
  assert.equal(result.groups[0]?.available, true);
  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["jd-shop-named-tmall"]);
  assert.equal(result.groups[0]?.items.some((item) => item.id === "tmall-shop-named-jd"), false);
  sqlite.close();
});

test("restricted principal 在旧库不搜索无平台目标且其他分组继续返回", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE finance_targets (
    id TEXT PRIMARY KEY, period_type TEXT NOT NULL, period_key TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE erp_product_master (
    product_code TEXT PRIMARY KEY, product_name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '', product_status TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO finance_targets (id, period_type, period_key, shop_name, manager, sales_target_cents)
    VALUES ('legacy-restricted-target', 'month', '2026-08', '京东', '旧库隔离词', 10000);
  INSERT INTO erp_product_master (product_code, product_name)
    VALUES ('P-LEGACY', '旧库隔离词商品');`);
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...next: unknown[]) { values = next as typeof values; return this; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
      };
    },
  } as GlobalSearchDatabase;
  const restrictedAdmin: AppPrincipal = {
    ...admin,
    scope: { warehouses: [], channels: [], platforms: ["京东"] },
  };
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=旧库隔离词")),
    restrictedAdmin,
  );
  const targets = result.groups.find((group) => group.key === "targets");
  const products = result.groups.find((group) => group.key === "products");
  assert.equal(targets?.available, true);
  assert.equal(targets?.total, 0);
  assert.deepEqual(targets?.items, []);
  assert.equal(products?.total, 1);
  assert.equal(products?.items[0]?.id, "P-LEGACY");
  assert.equal(calls.some((sql) => /FROM finance_targets\b/.test(sql)), false);
  sqlite.close();
});

test("API、分组 UI 和 AI 注册入口复用同一搜索核心", async () => {
  const [route, page, dialog, tool, guide] = await Promise.all([
    readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/global-search-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/search/ai-tool.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/GLOBAL_SEARCH.md", import.meta.url), "utf8"),
  ]);
  assert.match(route, /searchAllBusinessData/);
  assert.match(route, /requireAppPrincipal/);
  assert.match(route, /globalSearchErrorResponse/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
  assert.match(page, /const GlobalSearchDialog = lazy/);
  assert.match(dialog, /result\.groups/);
  assert.match(page, /搜索系统全部数据/);
  assert.doesNotMatch(tool, /ToolDefinition/);
  assert.match(tool, /searchSystemDataForAi/);
  assert.match(guide, /字段白名单/);
  assert.match(guide, /客服会话/);
  assert.match(guide, /导入批次/);
});

test("every durable schema table is explicitly searchable, projected, or security-excluded", async () => {
  const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const schemaTables = [...schemaSource.matchAll(/sqliteTable\(\s*"([^"]+)"/g)].map((match) => match[1]).sort();
  const classified = [
    ...GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT.searchable,
    ...GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT.coveredByProjection,
    ...GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT.excludedSensitiveOrInternal,
  ].sort();
  assert.deepEqual(classified, schemaTables);
  assert.equal(new Set(classified).size, classified.length);
  for (const sensitive of ["app_users", "ai_models", "ai_tool_audit_logs", "market_annotation_local_agents"]) {
    assert.equal(GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT.excludedSensitiveOrInternal.includes(sensitive as never), true);
    assert.equal(GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT.searchable.includes(sensitive as never), false);
  }
});

test("viewer cannot probe customer-service bodies or finance and scoped SQL binds the real principal scope", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const salesCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async all<T>() {
          calls.push({ sql, values });
          if (sql.includes("sqlite_master")) return { results: [
            { name: "customer_service_conversations" }, { name: "finance_lines" },
          ] as T[] };
          return { results: [] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const scopedViewer: AppPrincipal = {
    ...viewer,
    scope: { warehouses: [], channels: ["线上"], platforms: ["京东"] },
  };
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=客户消息")),
    scopedViewer,
    { salesReader: fakeSalesSearchReader({ calls: salesCalls }) },
  );
  assert.equal(result.groups.some((group) => group.key === "customer_service" || group.key === "finance"), false);
  assert.equal(calls.some((call) => call.sql.includes("messages_json") || call.sql.includes("finance_lines")), false);
  assert.equal(calls.some((call) => /sales_order_lines|sales_import_batches/.test(call.sql)), false);
  assert.equal(salesCalls.length, 1);
  assert.equal(salesCalls[0]?.principal, scopedViewer);
  assert.equal(salesCalls[0]?.request.operation, "order_search");
  assert.deepEqual(result.filtersApplied.dataScope, {
    mode: "restricted", warehouses: [], channels: ["线上"], platforms: ["京东"],
  });
});

test("multi-domain search caps database concurrency at three and performs one LIMIT+1 query per group", async () => {
  const businessCalls: Array<{ sql: string; values: unknown[] }> = [];
  let statementCount = 0;
  let active = 0;
  let peak = 0;
  const database = {
    prepare(sql: string) {
      statementCount += 1;
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) {
            return { results: allSearchTables.map((name) => ({ name })) as T[] };
          }
          businessCalls.push({ sql, values });
          active += 1;
          peak = Math.max(peak, active);
          try {
            await wait(8);
            return { results: [] as T[] };
          } finally {
            active -= 1;
          }
        },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&limit=2")),
    admin,
    {
      salesReader: fakeSalesSearchReader(),
      financeReader: fakeFinanceSearchReader(),
      netshopReader: fakeNetshopSearchReader(),
      productsReader: fakeProductsSearchReader(),
      inventoryReader: fakeInventorySearchReader(),
      financeBackendMode: "django",
    },
  );

  assert.equal(result.groups.length, 14);
  assert.equal(result.deadlineExceeded, false);
  assert.equal(peak, 3);
  assert.ok(peak <= 3);
  assert.equal(businessCalls.length, 9);
  assert.equal(statementCount, 10);
  const localImportCalls = businessCalls.filter(({ sql }) => /COUNT\s*\(\s*\*\s*\)\s*OVER/i.test(sql));
  const workflowCountCalls = businessCalls.filter(({ sql }) => /SELECT COUNT\(\*\) AS total_count FROM \(/i.test(sql));
  assert.equal(businessCalls.filter(({ sql }) => /LIMIT \? OFFSET \?/i.test(sql))
    .every(({ values }) => [1, 2, 3].includes(Number(values.at(-2))) && values.at(-1) === 0), true);
  assert.equal(localImportCalls.length, 2);
  assert.equal(workflowCountCalls.length, 1);
  assert.equal(businessCalls.some(({ sql }) => /sales_order_lines|sales_import_batches/i.test(sql)), false);
  assert.equal(businessCalls.some(({ sql }) => sql.includes("messages_json")), false);
});

test("explicit group stays single-query and only explicit customer-service search scans messages_json", async () => {
  const businessCalls: Array<{ sql: string; values: unknown[] }> = [];
  let statementCount = 0;
  const database = {
    prepare(sql: string) {
      statementCount += 1;
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) {
            return { results: [{ name: "customer_service_conversations" }] as T[] };
          }
          businessCalls.push({ sql, values });
          return { results: [] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;

  await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=客户消息")),
    admin,
  );
  assert.equal(businessCalls.length, 1);
  assert.doesNotMatch(businessCalls[0]?.sql ?? "", /messages_json/);

  businessCalls.length = 0;
  const explicit = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=客户消息&group=customer_service")),
    admin,
  );
  assert.equal(businessCalls.length, 1);
  assert.match(businessCalls[0]?.sql ?? "", /messages_json LIKE \?/);
  assert.equal(businessCalls[0]?.values.at(-2), 5);
  assert.equal(statementCount, 4);
  assert.equal(explicit.groups.length, 1);
  assert.equal(explicit.groups[0]?.key, "customer_service");
});

test("LIMIT+1 derives hasMore and marks a non-empty terminal page total as exact without a count query", async () => {
  let businessQueryCount = 0;
  let returnEmptyPage = false;
  const database = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) return { results: [{ name: "erp_product_master" }] as T[] };
          businessQueryCount += 1;
          if (returnEmptyPage) return { results: [] as T[] };
          return { results: [{
            result_id: "SKU-3", title: "净水机三号", subtitle: "", detail: "",
            updated_at: "2026-08-25", amount_cents: null,
          }] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=products&page=2&limit=2")),
    admin,
  );
  assert.equal(businessQueryCount, 1);
  assert.equal(result.groups[0]?.items.length, 1);
  assert.equal(result.groups[0]?.hasMore, false);
  assert.equal(result.groups[0]?.total, 3);
  assert.equal(result.groups[0]?.totalExact, true);

  returnEmptyPage = true;
  const beforeEmptyPage = businessQueryCount;
  const emptyPage = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=products&page=3&limit=2")),
    admin,
  );
  assert.equal(businessQueryCount, beforeEmptyPage + 1);
  assert.equal(emptyPage.groups[0]?.items.length, 0);
  assert.equal(emptyPage.groups[0]?.hasMore, false);
  assert.equal(emptyPage.groups[0]?.total, 0);
  assert.equal(emptyPage.groups[0]?.totalExact, false);
});

test("one failed group is isolated and does not prevent another group from returning", async () => {
  let businessQueryCount = 0;
  const database = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) {
            return { results: [{ name: "erp_product_master" }] as T[] };
          }
          businessQueryCount += 1;
          if (sql.includes("erp_product_master")) throw new Error("simulated product query failure");
          return { results: [{
            result_id: "ORDER-1", title: "ORDER-1", subtitle: "京东 · 测试店", detail: "净水机",
            updated_at: "2026-08-25", amount_cents: 100,
          }] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机")),
    admin,
    { salesReader: fakeSalesSearchReader({ orders: [{
      id: "ORDER-1", title: "ORDER-1", subtitle: "京东 · 测试店", detail: "净水机",
      updatedAt: "2026-08-25", amountCents: 100,
    }] }) },
  );
  assert.equal(businessQueryCount, 1);
  assert.equal(result.groups.find((group) => group.key === "products")?.available, false);
  assert.equal(result.groups.find((group) => group.key === "products")?.totalExact, false);
  assert.equal(result.groups.find((group) => group.key === "orders")?.items[0]?.id, "ORDER-1");
});

test("group deadline returns a disclosed partial response and never starts queued groups afterward", async () => {
  let businessStarts = 0;
  const database = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) {
            return { results: allSearchTables.map((name) => ({ name })) as T[] };
          }
          businessStarts += 1;
          await wait(60);
          return { results: [] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;

  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机")),
    admin,
    {
      deadlineMs: 15,
      salesReader: { read: async () => { await wait(60); throw new Error("simulated timeout"); } } as SalesConsumerReader,
      financeReader: { read: async () => { await wait(60); throw new Error("simulated timeout"); } } as FinanceConsumerReader,
      netshopReader: { read: async () => { await wait(60); throw new Error("simulated timeout"); } } as NetshopConsumerReader,
      financeBackendMode: "django",
    },
  );
  assert.equal(businessStarts, 1);
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.truncated, true);
  assert.equal(result.timedOutDomains.length, 14);
  assert.equal(result.groups.every((group) => group.totalExact === false), true);
  await wait(70);
  assert.equal(businessStarts, 1);
});
