import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { AppPrincipal } from "../lib/auth/authorization";
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

test("销售订单搜索在 SQL 聚合和统一投影两层限制响应体积", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE sales_order_lines (
    order_no TEXT NOT NULL,
    online_order_no TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    channel TEXT NOT NULL,
    ship_time TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_code TEXT NOT NULL,
    online_spec_code TEXT NOT NULL,
    allocated_amount_cents INTEGER NOT NULL
  )`);
  const insert = sqlite.prepare(`INSERT INTO sales_order_lines (
    order_no, online_order_no, platform, shop_name, channel, ship_time,
    product_name, product_code, online_spec_code, allocated_amount_cents
  ) VALUES ('ORDER-LARGE', '', '京东', '测试店', '京东', '2026-08-20', ?, ?, '', 1)`);
  sqlite.exec("BEGIN");
  for (let index = 0; index < 10_000; index += 1) {
    insert.run(`净水机-${index}-${"长".repeat(1_000)}`, `SKU-${index}`);
  }
  sqlite.exec("COMMIT");
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
  );
  const detail = result.groups[0]?.items[0]?.detail ?? "";
  assert.ok(Array.from(detail).length <= 400);
  assert.ok(new TextEncoder().encode(detail).byteLength <= 1_536);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 8 * 1024);
  assert.doesNotMatch(detail, /净水机-9999/);
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
  for (const migration of migrations) sqlite.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));
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
            { name: "customer_service_conversations" }, { name: "finance_lines" }, { name: "sales_order_lines" },
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
  );
  assert.equal(result.groups.some((group) => group.key === "customer_service" || group.key === "finance"), false);
  assert.equal(calls.some((call) => call.sql.includes("messages_json") || call.sql.includes("finance_lines")), false);
  const sales = calls.find((call) => call.sql.includes("sales_order_lines"));
  assert.ok(sales);
  assert.match(sales.sql, /online_spec_code LIKE \?/);
  assert.match(sales.sql, /channel IN \(\?\)[\s\S]*platform IN \(\?\)/);
  assert.deepEqual(sales.values.slice(7, 9), ["线上", "京东"]);
  assert.deepEqual(result.filtersApplied.dataScope, {
    mode: "restricted", warehouses: [], channels: ["线上"], platforms: ["京东"],
  });
});
