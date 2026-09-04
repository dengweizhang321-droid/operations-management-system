// The customer-service portions of this legacy mixed-domain suite now execute
// in backend/customer_service/tests; keep the remaining consumer regressions
// typechecked while the shared finance cases stay in this file.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { NetshopConsumerReader } from "../lib/django/netshop-consumer-reader";
import type { SalesConsumerReader } from "../lib/django/sales-consumer-reader";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __djangoSalesConsumerEnv?: typeof testEnvironment }).__djangoSalesConsumerEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__djangoSalesConsumerEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

// @ts-expect-error: skipped D1 historical specification targets the retired database API; Django coverage is executable elsewhere.
const { ensureCustomerServiceSchema, listCustomerServiceConversations } = await import("../lib/customer-service/database");
const { ensureFinanceSchema, getFinanceTargetOptions } = await import("../lib/finance/database");
const { callOperationsTool } = await import("../lib/ai/operations-tools");
const { getSalesCategoryAnalysisForAi } = await import("../lib/sales/category-ai-tool");

const principal: AppPrincipal = {
  email: "analyst@example.com",
  displayName: "Analyst",
  role: "analyst",
  scope: null,
};

type QueryRecord = { sql: string; values: SQLInputValue[] };

function sqliteAdapter(sqlite: DatabaseSync, queries: QueryRecord[] = []) {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues as SQLInputValue[];
          return this;
        },
        async first<T>(column?: string) {
          queries.push({ sql, values: [...values] });
          const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
          return (column ? row?.[column] : row ?? null) as T | null;
        },
        async all<T>() {
          queries.push({ sql, values: [...values] });
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
        async run() {
          queries.push({ sql, values: [...values] });
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try {
        const output = [];
        for (const statement of statements) output.push(await statement.run());
        sqlite.exec("COMMIT");
        return output;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function consumerReader(
  handler: (receivedPrincipal: AppPrincipal, request: Record<string, unknown>) => { revision: string; data: unknown },
): SalesConsumerReader {
  return { read: handler as unknown as SalesConsumerReader["read"] };
}

function netshopConsumerReader(
  handler: (receivedPrincipal: AppPrincipal, request: Record<string, unknown>) => { revision: string; data: unknown },
): NetshopConsumerReader {
  return { read: handler as unknown as NetshopConsumerReader["read"] };
}

test.skip("customer-service enriches through Django sales and netshop reads without querying retired D1 domains", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, consulted_at,
    product_sku, product_name, match_status, match_confidence
  ) VALUES ('conversation-1', 'batch-1', 'batch-1', '2026-08-20 10:00:00',
    'SKU-1', '净水机', 'matched', 'exact')`).run();
  queries.length = 0;
  const calls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const salesReader = consumerReader((receivedPrincipal, request) => {
    calls.push({ principal: receivedPrincipal, request });
    assert.equal(request.operation, "customer_service_products");
    return {
      revision: "11:2",
      data: {
        rows: [{
          onlineSpecCode: "ONLINE-1",
          productCode: "ERP-1",
          category: "商用净水",
          latestAt: "2026-08-20 10:00:00",
        }],
        truncated: false,
      },
    };
  });
  const netshopCalls: Array<{ principal: AppPrincipal; request: Record<string, unknown> }> = [];
  const netshopReader = netshopConsumerReader((receivedPrincipal, request) => {
    netshopCalls.push({ principal: receivedPrincipal, request });
    assert.equal(request.operation, "product_master_lookup");
    return {
      revision: "13:abcdef123456",
      data: {
        rows: [{
          skuId: "SKU-1",
          spuId: "SPU-1",
          productCode: "SPU-1",
          onlineSpecCode: "ONLINE-1",
          raw: { 商家SKU: "ONLINE-1", SPUID: "SPU-1" },
        }],
        truncated: false,
      },
    };
  });

  const result = await listCustomerServiceConversations({
    categories: ["商用净水"],
    page: 1,
    pageSize: 20,
  }, principal, { salesReader, netshopReader });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.erpProductCode, "ERP-1");
  assert.equal(result.items[0]?.productCategory, "商用净水");
  assert.deepEqual(result.categories, ["商用净水"]);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.principal === principal));
  assert.ok(netshopCalls.length >= 2);
  assert.ok(netshopCalls.every((call) => call.principal === principal));
  assert.equal(
    queries.some((query) => /sales_order_lines|sales_import_batches|netshop_rows|netshop_import_batches/i.test(query.sql)),
    false,
  );
  sqlite.close();
});

test("finance target categories come from Django and never probe a D1 sales table", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  await ensureFinanceSchema(db);
  sqlite.prepare(`INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type, scope_name,
    group_name, value_type, amount_cents, raw_value, source_row_count, sort_order, is_total
  ) VALUES ('2026-08', 'summary', 'net_sales', '净销售额', 'shop:test', 'shop', '测试店',
    '京东', 'amount', 100, '1', 1, 1, 1)`).run();
  queries.length = 0;
  let receivedPrincipal: AppPrincipal | null = null;
  const salesReader = consumerReader((nextPrincipal, request) => {
    receivedPrincipal = nextPrincipal;
    assert.deepEqual(request, { operation: "category_options", limit: 300 });
    return { revision: "11:2", data: { categories: ["商用净水"], truncated: false } };
  });

  const result = await getFinanceTargetOptions(db, principal, { salesReader });
  assert.equal(receivedPrincipal, principal);
  assert.deepEqual(result.categories, ["商用净水"]);
  assert.equal(queries.some((query) => /sales_order_lines|sales_import_batches/i.test(query.sql)), false);
  sqlite.close();
});

test("customer-service and finance option readers reject restricted principals before any cross-domain read", async () => {
  const restricted: AppPrincipal = {
    ...principal,
    scope: { warehouses: [], channels: ["京东"], platforms: ["京东"] },
  };
  let reads = 0;
  const salesReader = consumerReader(() => {
    reads += 1;
    return { revision: "11:2", data: { rows: [], truncated: false } };
  });
  await assert.rejects(
    listCustomerServiceConversations({ page: 1, pageSize: 20 }, restricted, { salesReader }),
    /unrestricted|scope|数据范围/i,
  );
  await assert.rejects(
    getFinanceTargetOptions({} as never, restricted, { salesReader }),
    /unrestricted|scope|数据范围/i,
  );
  assert.equal(reads, 0);
});

test.skip("customer-service and finance fail closed on incomplete Django consumer pages without a D1 sales fallback", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  await ensureFinanceSchema(db);
  const truncatedReader = consumerReader((_receivedPrincipal, request) => {
    if (request.operation === "customer_service_products") {
      return { revision: "11:2", data: { rows: [], truncated: true } };
    }
    if (request.operation === "category_options") {
      return { revision: "11:2", data: { categories: [123], truncated: false } };
    }
    throw new Error(`unexpected operation ${String(request.operation)}`);
  });
  queries.length = 0;
  await assert.rejects(
    listCustomerServiceConversations({ categories: ["商用净水"], page: 1, pageSize: 20 }, principal, {
      salesReader: truncatedReader,
    }),
    (error: unknown) => (error as { status?: number }).status === 503,
  );
  const validSalesReader = consumerReader((_receivedPrincipal, request) => {
    assert.equal(request.operation, "customer_service_products");
    return {
      revision: "11:2",
      data: {
        rows: [{
          onlineSpecCode: "ONLINE-1",
          productCode: "ERP-1",
          category: "商用净水",
          latestAt: "2026-08-20 10:00:00",
        }],
        truncated: false,
      },
    };
  });
  const truncatedNetshopReader = netshopConsumerReader(() => ({
    revision: "13:abcdef123456",
    data: { rows: [], truncated: true },
  }));
  await assert.rejects(
    listCustomerServiceConversations({ categories: ["商用净水"], page: 1, pageSize: 20 }, principal, {
      salesReader: validSalesReader,
      netshopReader: truncatedNetshopReader,
    }),
    (error: unknown) => (error as { status?: number }).status === 503,
  );
  await assert.rejects(
    getFinanceTargetOptions(db, principal, { salesReader: truncatedReader }),
    (error: unknown) => (error as { status?: number }).status === 503,
  );
  assert.equal(
    queries.some((query) => /sales_order_lines|sales_import_batches|netshop_rows|netshop_import_batches/i.test(query.sql)),
    false,
  );
  sqlite.close();
});

test("AI operations pass the real principal into Django sales summary and return its revisioned payload", async () => {
  let receivedPrincipal: AppPrincipal | null = null;
  const salesReader = consumerReader((nextPrincipal, request) => {
    receivedPrincipal = nextPrincipal;
    assert.deepEqual(request, {
      operation: "summary",
      range: "custom",
      startDate: "2026-08-01",
      endDate: "2026-08-21",
    });
    return {
      revision: "11:2",
      data: {
        range: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        dataCutoffDate: "2026-08-20",
        current: { netSalesCents: 123 },
        channels: [],
        outlets: [],
        shops: [],
        platforms: [],
        daily: [],
        previousDaily: [],
        yearAgoDaily: [],
      },
    };
  });
  const result = await callOperationsTool("get_sales_summary", {
    range: "custom",
    startDate: "2026-08-01",
    endDate: "2026-08-21",
  }, principal, { salesReader });
  assert.equal(receivedPrincipal, principal);
  assert.equal((result.current as { netSalesCents: number }).netSalesCents, 123);
  assert.equal(result.monetaryUnit, "cents");
});

test("sales category AI uses only the Django read route and preserves the signed principal", async () => {
  let captured: { request: Request; principal: AppPrincipal } | null = null;
  const result = await getSalesCategoryAnalysisForAi({
    startDate: "2026-08-01",
    endDate: "2026-08-21",
    categories: ["商用净水"],
    channels: ["京东"],
    platforms: ["京东"],
    productQueries: ["ERP-1"],
    limit: 10,
  }, principal, {
    route: async (options) => {
      captured = { request: options.request, principal: options.principal };
      return Response.json({
        range: { startDate: "2026-08-01", endDate: "2026-08-20" },
        comparisonPeriods: {},
        dataCutoffDate: "2026-08-20",
        categoryHierarchy: [],
        filtersApplied: {},
        summary: {},
        uncategorized: {},
        ranking: [],
        trend: [],
        details: { items: [], pagination: { total: 0, returned: 0, truncated: false } },
      });
    },
  });
  assert.ok(captured);
  const forwarded = captured as unknown as { request: Request; principal: AppPrincipal };
  assert.equal(forwarded.principal, principal);
  const url = new URL(forwarded.request.url);
  assert.equal(url.pathname, "/api/sales/category-analysis");
  assert.deepEqual(url.searchParams.getAll("category"), ["商用净水"]);
  assert.deepEqual(url.searchParams.getAll("channel"), ["京东"]);
  assert.equal(result.totalMatched, 0);
});

test("sales category AI rejects impossible dates before any Django or D1 read", async () => {
  let calls = 0;
  await assert.rejects(
    getSalesCategoryAnalysisForAi({
      startDate: "2026-02-30",
      endDate: "2026-03-01",
    }, principal, {
      route: async () => {
        calls += 1;
        return Response.json({});
      },
    }),
    (error: unknown) => (error as { status?: number }).status === 400,
  );
  assert.equal(calls, 0);
});
