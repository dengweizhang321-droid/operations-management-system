import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { AppPrincipal } from "../lib/auth/authorization";

import {
  escapeGlobalSearchLike,
  GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT,
  GlobalSearchRequestError,
  normalizeGlobalSearchRequest,
  searchAllBusinessData,
  type GlobalSearchDatabase,
} from "../lib/search/global-search";

const admin: AppPrincipal = { email: "admin@example.com", displayName: "Admin", role: "admin", scope: null };
const viewer: AppPrincipal = { email: "viewer@example.com", displayName: "Viewer", role: "viewer", scope: null };

test("全局搜索校验关键词、分组和严格分页上限", () => {
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=一")), GlobalSearchRequestError);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&group=sqlite_master")), /允许清单/);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&limit=9")), /1 到 8/);
  assert.throws(() => normalizeGlobalSearchRequest(new URLSearchParams("q=净水机&totalLimit=51")), /1 到 50/);
  const parsed = normalizeGlobalSearchRequest(new URLSearchParams("q= 净水机 &group=products&page=2&limit=3&totalLimit=9"));
  assert.deepEqual(parsed, { query: "净水机", group: "products", page: 2, groupLimit: 3, totalLimit: 9 });
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
  sqlite.close();
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
