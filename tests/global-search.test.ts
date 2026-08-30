import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { SalesConsumerReader } from "../lib/django/sales-consumer-reader";
import type { FinanceConsumerReader } from "../lib/django/finance-consumer-reader";
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
        const items = allItems.slice((page - 1) * pageSize, page * pageSize);
        return { revision: "9:1", data: { items, total, truncated: page * pageSize < total } };
      }
      if (request.operation === "import_batch_search") {
        const allItems = input.imports ?? [];
        const page = Number(request.page);
        const pageSize = Number(request.pageSize);
        const total = input.importTotal ?? allItems.length;
        const items = allItems.slice((page - 1) * pageSize, page * pageSize);
        return { revision: "9:1", data: { items, total, truncated: page * pageSize < total } };
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
          return { results: [{
            result_id: "SKU-1", title: "净水机", subtitle: "商用", detail: "净水设备",
            updated_at: "2026-07-23", amount_cents: null, total_count: 7,
          }] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const request = normalizeGlobalSearchRequest(new URLSearchParams("q=%27%20OR%201%3D1--&group=products&page=2&limit=2&totalLimit=8"));
  const result = await searchAllBusinessData(database, request, admin);
  const businessCall = calls.find((call) => call.sql.includes("erp_product_master"));
  assert.ok(businessCall);
  assert.doesNotMatch(businessCall.sql, /OR 1=1--/);
  assert.equal(businessCall.values.at(-2), 2);
  assert.equal(businessCall.values.at(-1), 2);
  assert.equal(result.groups[0]?.total, 7);
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
    { salesReader: fakeSalesSearchReader({
      orders: [{
        id: "ORDER-LARGE",
        title: "ORDER-LARGE",
        subtitle: "京东 · 测试店",
        detail: `净水机-${"长".repeat(10_000)}`,
        updatedAt: "2026-08-20",
        amountCents: 10_000,
      }],
    }) },
  );
  const detail = result.groups[0]?.items[0]?.detail ?? "";
  assert.ok(Array.from(detail).length <= 400);
  assert.ok(new TextEncoder().encode(detail).byteLength <= 1_536);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 8 * 1024);
  sqlite.close();
});

test("Django 销售搜索不可用时明确标记分组不可用且绝不回查 D1 销售表", async () => {
  const sqlCalls: string[] = [];
  const database = {
    prepare(sql: string) {
      sqlCalls.push(sql);
      return {
        bind() { return this; },
        async all<T>() {
          if (sql.includes("sqlite_master")) {
            return { results: [{ name: "sales_order_lines" }, { name: "sales_import_batches" }] as T[] };
          }
          return { results: [] as T[] };
        },
      };
    },
  } as GlobalSearchDatabase;
  const unavailableReader = {
    read: async () => { throw new Error("django unavailable"); },
  } as unknown as SalesConsumerReader;
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=orders")),
    admin,
    { salesReader: unavailableReader },
  );
  assert.equal(result.groups[0]?.available, false);
  assert.deepEqual(result.unavailableDomains, ["销售订单"]);
  assert.equal(sqlCalls.some((sql) => /FROM\s+sales_|JOIN\s+sales_/i.test(sql)), false);
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

test("Django 财务批次在销售与其余 D1 批次之间保持精确跨源分页", async () => {
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
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=imports&page=3&pageSize=2")),
    admin,
    {
      salesReader: fakeSalesSearchReader({ imports: salesImports }),
      financeReader: fakeFinanceSearchReader({ imports: financeImports }),
      financeBackendMode: "django",
    },
  );
  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["finance-2", "inventory-1"]);
  assert.equal(result.groups[0]?.total, 6);
  assert.equal(result.groups[0]?.hasMore, false);
  assert.equal(sqlCalls.some((sql) => /FROM\s+finance_import_batches/i.test(sql)), false);
  sqlite.close();
});

test("导入搜索以 Django 销售批次和其他域 D1 批次分区精确分页", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE inventory_import_batches (
    id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
  );
  INSERT INTO inventory_import_batches VALUES
    ('inventory-1', '库存净水机.xlsx', 'inventory', 'completed', '2026-08-20', '2026-08-20');`);
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
  const imports = [1, 2, 3].map((index) => ({
    id: `sales-${index}`,
    source: "erp_sales",
    fileName: `销售净水机-${index}.xlsx`,
    status: "completed",
    rowCount: 10,
    createdAt: `2026-08-${20 + index}`,
    completedAt: `2026-08-${20 + index}`,
  }));
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=imports&page=2&pageSize=2")),
    admin,
    { salesReader: fakeSalesSearchReader({ imports }) },
  );
  assert.deepEqual(result.groups[0]?.items.map((item) => item.id), ["sales-3", "inventory-1"]);
  assert.equal(result.groups[0]?.total, 4);
  assert.equal(result.groups[0]?.hasMore, false);
  assert.equal(sqlCalls.some((sql) => /sales_import_batches|sales_order_lines/i.test(sql)), false);
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
    sqlite.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));
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
    { salesReader: fakeSalesSearchReader() },
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

test("运营事务真实 SQLite 结果按记录类型返回对应 target view", async () => {
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
  assert.deepEqual(targets.get("operation:launch-1"), { module: "workflow", view: "launch" });
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
  const salesCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const result = await searchAllBusinessData(
    database,
    normalizeGlobalSearchRequest(new URLSearchParams("q=客户消息")),
    scopedViewer,
    { salesReader: fakeSalesSearchReader({ calls: salesCalls }) },
  );
  assert.equal(result.groups.some((group) => group.key === "customer_service" || group.key === "finance"), false);
  assert.equal(calls.some((call) => call.sql.includes("messages_json") || call.sql.includes("finance_lines")), false);
  assert.equal(calls.some((call) => call.sql.includes("sales_order_lines")), false);
  assert.equal(salesCalls.length, 1);
  assert.equal(salesCalls[0]?.request.operation, "order_search");
  assert.deepEqual(salesCalls[0]?.principal, scopedViewer);
  assert.deepEqual(result.filtersApplied.dataScope, {
    mode: "restricted", warehouses: [], channels: ["线上"], platforms: ["京东"],
  });
});
