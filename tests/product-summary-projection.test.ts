import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __productSummaryProjectionEnv?: typeof testEnvironment }).__productSummaryProjectionEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__productSummaryProjectionEnv;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/headers") {
      return {
        url: "data:text/javascript,export async function headers(){return new Headers({'oai-authenticated-user-email':'product-reader@example.com'});}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

function sqliteAdapter(sqlite: DatabaseSync, onPrepare?: (sql: string) => void) {
  return {
    prepare(sql: string) {
      onPrepare?.(sql);
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues as SQLInputValue[];
          return this;
        },
        async first<T>(column?: string) {
          const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
          return (column ? row?.[column] : row ?? null) as T | null;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

function insertSalesLine(sqlite: DatabaseSync, input: {
  productCode: string;
  productName: string;
  category: string;
  quantity: number;
  netSalesCents: number;
  costCents: number;
}) {
  sqlite.prepare(`INSERT INTO sales_order_lines (
    source_line_key, source_row_hash, first_import_batch_id, last_import_batch_id, source_row_number,
    order_no, online_order_no, channel, platform, shop_name, logistics_company, warehouse,
    product_code, online_spec_code, product_name, specification, barcode, supplier, category,
    quantity, list_unit_price_cents, cost_amount_cents, allocated_unit_price_cents,
    allocated_amount_cents, fee_allocation_cents, gross_profit_cents, gross_margin_bps,
    untaxed_gross_profit_cents, untaxed_gross_margin_bps, order_time, sales_time, ship_time,
    line_ship_time, business_type
  ) VALUES (
    ?, ?, 'sales-batch', 'sales-batch', 1,
    ?, '', '京东', '京东', '测试店铺', '', '上海仓',
    ?, '', ?, '', '', '', ?,
    ?, 0, ?, 0,
    ?, 0, ?, 0,
    0, 0, '2026-08-18 08:00:00', '2026-08-18 08:00:00', '2026-08-18 08:00:00',
    '2026-08-18 08:00:00', '销售'
  )`).run(
    `${input.productCode}-line`,
    `${input.productCode}-hash`,
    `${input.productCode}-order`,
    input.productCode,
    input.productName,
    input.category,
    input.quantity,
    input.costCents,
    input.netSalesCents,
    input.netSalesCents - input.costCents,
  );
}

type ProductApiPayload = {
  projection: "full" | "page";
  snapshotToken: string;
  items: Array<{ productCode: string }>;
  pagination: Record<string, unknown>;
  sort: Record<string, unknown>;
  filters?: { categories: string[]; [key: string]: unknown };
  metrics?: Record<string, unknown>;
};

test("商品汇总真实 API 将指标与分页合并，并让翻页排序跳过 facet bootstrap", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const preparedSql: string[] = [];
  const database = sqliteAdapter(sqlite, (sql) => preparedSql.push(sql));
  testEnvironment.DB = database;

  const { ensureAuthorizationSchema } = await import("../lib/auth/authorization");
  const { ensureSalesSchema } = await import("../lib/sales/database");
  const { ensureInventorySchema } = await import("../lib/inventory/database");
  const { ensureErpReferenceSchema } = await import("../lib/erp-reference/database");
  await Promise.all([
    ensureAuthorizationSchema(database as never),
    ensureSalesSchema(database as never),
    ensureInventorySchema(database as never),
    ensureErpReferenceSchema(database as never),
  ]);
  sqlite.prepare(`INSERT INTO app_users (email, display_name, role, status, scope_json)
    VALUES ('product-reader@example.com', 'Product reader', 'viewer', 'active', NULL)`).run();
  sqlite.prepare(`INSERT INTO sales_import_batches (
    id, source, file_name, file_size_bytes, file_hash, sheet_name, status, row_count, inserted_count, completed_at
  ) VALUES ('sales-batch', 'test', 'sales.xlsx', 1, 'sales-hash', 'Sheet1', 'completed', 2, 2, '2026-08-18 10:00:00')`).run();
  insertSalesLine(sqlite, { productCode: "A", productName: "货品A", category: "类目A", quantity: 10, netSalesCents: 10_000, costCents: 9_000 });
  insertSalesLine(sqlite, { productCode: "B", productName: "货品B", category: "类目B", quantity: 5, netSalesCents: 5_000, costCents: 2_500 });

  const route = await import("../app/api/products/summary/route");
  const base = "https://example.test/api/products/summary?range=custom&startDate=2026-08-18&endDate=2026-08-18&pageSize=1";

  preparedSql.length = 0;
  const bootstrapResponse = await route.GET(new Request(`${base}&page=1&sortBy=netSalesCents&direction=desc`));
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json() as ProductApiPayload;
  const bootstrapSql = [...preparedSql];
  assert.equal(bootstrap.projection, "full");
  assert.match(bootstrap.snapshotToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(bootstrap.items.map((item) => item.productCode), ["A"]);
  assert.deepEqual(bootstrap.filters?.categories, ["类目A", "类目B"]);
  assert.equal(bootstrap.metrics?.skuCount, 2);
  assert.equal(bootstrap.metrics?.netSalesCents, 15_000);
  assert.equal(bootstrap.metrics?.grossProfitCents, 3_500);
  assert.equal(bootstrap.pagination.total, 2);
  const boundsSql = bootstrapSql.find((sql) => sql.includes("substr(MIN(ship_time)") && sql.includes("substr(MAX(ship_time)"));
  assert.ok(boundsSql, "商品汇总应通过独立标量子查询读取销售日期上下界");
  assert.doesNotMatch(boundsSql, /MIN\(substr\(ship_time/);
  assert.doesNotMatch(boundsSql, /MAX\(substr\(ship_time/);
  const boundsPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${boundsSql}`).all() as Array<{ detail: string }>;
  assert.equal(
    boundsPlan.filter((row) => row.detail.includes("USING INDEX sales_order_lines_ship_time_idx")).length,
    2,
    "日期上下界都应命中 ship_time 索引的 min/max 快速路径",
  );
  assert.equal(boundsPlan.some((row) => row.detail === "SCAN sales_order_lines"), false);
  assert.equal(bootstrapSql.filter((sql) => sql.includes("WITH sales_agg AS (")).length, 2);
  assert.equal(bootstrapSql.filter((sql) => sql.includes("metrics AS MATERIALIZED")).length, 1);
  assert.equal(bootstrapSql.filter((sql) => sql.includes("paged AS MATERIALIZED")).length, 1);

  preparedSql.length = 0;
  const pageResponse = await route.GET(new Request(`${base}&view=page&snapshotToken=${bootstrap.snapshotToken}&page=2&sortBy=grossProfitCents&direction=asc`));
  assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.headers.get("cache-control"), "no-store");
  const page = await pageResponse.json() as ProductApiPayload;
  const pageSql = [...preparedSql];
  assert.deepEqual(Object.keys(page).sort(), ["items", "pagination", "projection", "snapshotToken", "sort"]);
  assert.equal(page.projection, "page");
  assert.equal(page.snapshotToken, bootstrap.snapshotToken);
  assert.deepEqual(page.items.map((item) => item.productCode), ["B"]);
  assert.equal(pageSql.filter((sql) => sql.includes("WITH sales_agg AS (")).length, 1);
  assert.equal(pageSql.some((sql) => sql.includes("SELECT DISTINCT category FROM filtered")), false);
  assert.equal(pageSql.some((sql) => sql.includes("GROUP BY platform, shop_name, channel")), false);
  const pageOutletSql = pageSql.find((sql) => sql.includes("ranged_outlet_sales AS MATERIALIZED"));
  assert.ok(pageOutletSql, "当前页渠道查询应先物化日期范围");
  assert.match(
    pageOutletSql,
    /WITH ranged_outlet_sales AS MATERIALIZED \([\s\S]+WHERE ship_time >= \? AND ship_time < \?[\s\S]+\)\s+SELECT[\s\S]+FROM ranged_outlet_sales\s+WHERE product_code IN/,
  );
  assert.doesNotMatch(pageOutletSql, /INDEXED BY/, "查询不应依赖脆弱的强制索引名称");
  const pageOutletPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${pageOutletSql}`).all(
    "2026-08-18 00:00:00",
    "2026-08-19 00:00:00",
    "B",
  ) as Array<{ detail: string }>;
  assert.equal(pageOutletPlan.some((row) => row.detail === "MATERIALIZE ranged_outlet_sales"), true);
  assert.equal(
    pageOutletPlan.some((row) => row.detail.includes("USING INDEX sales_order_lines_ship_time_idx")),
    true,
    "日期物化阶段应使用 ship_time 范围索引",
  );

  preparedSql.length = 0;
  const equivalentResponse = await route.GET(new Request(`${base}&page=2&sortBy=grossProfitCents&direction=asc`));
  assert.equal(equivalentResponse.status, 200);
  const equivalent = await equivalentResponse.json() as ProductApiPayload;
  assert.deepEqual(page.items, equivalent.items);
  assert.deepEqual(page.pagination, equivalent.pagination);
  assert.deepEqual(page.sort, equivalent.sort);
  assert.deepEqual(bootstrap.metrics, equivalent.metrics, "仅翻页和排序不应改变业务指标");
  assert.deepEqual(bootstrap.filters, equivalent.filters, "仅翻页和排序不应改变 bootstrap facet");
  assert.equal(preparedSql.filter((sql) => sql.includes("WITH sales_agg AS (")).length, 2);

  preparedSql.length = 0;
  const scopedResponse = await route.GET(new Request(
    `${base}&page=1&platform=${encodeURIComponent("京东")}&shop=${encodeURIComponent("京东\u001f测试店铺")}`,
  ));
  assert.equal(scopedResponse.status, 200);
  const scoped = await scopedResponse.json() as ProductApiPayload;
  assert.deepEqual(scoped.items.map((item) => item.productCode), ["A"]);
  const scopedBoundsSql = preparedSql.find((sql) => sql.includes("substr(MIN(ship_time)") && sql.includes("platform IN"));
  assert.ok(scopedBoundsSql, "带平台和店铺筛选的上下界查询应复用相同过滤条件并完成双份绑定");
  assert.match(scopedBoundsSql, /platform IN \(\?\)[\s\S]+platform = \? AND shop_name IN \(\?\)/);

  preparedSql.length = 0;
  const beyondResponse = await route.GET(new Request(`${base}&view=page&snapshotToken=${bootstrap.snapshotToken}&page=99&sortBy=netSalesCents&direction=desc`));
  assert.equal(beyondResponse.status, 200);
  const beyond = await beyondResponse.json() as ProductApiPayload;
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.pagination.total, 2);
  assert.equal(beyond.pagination.returned, 0);
  assert.equal(preparedSql.filter((sql) => sql.includes("WITH sales_agg AS (")).length, 1);

  for (const suffix of ["view=other", "view=page&view=page", "view=page", "view=page&snapshotToken=bad"]) {
    preparedSql.length = 0;
    const response = await route.GET(new Request(`${base}&${suffix}`));
    assert.equal(response.status, 400, suffix);
    assert.equal(preparedSql.some((sql) => sql.includes("WITH sales_agg AS (")), false, suffix);
  }

  sqlite.exec("UPDATE sales_overview_cache_state SET sales_revision=sales_revision+1 WHERE id=1");
  preparedSql.length = 0;
  const stalePageResponse = await route.GET(new Request(`${base}&view=page&snapshotToken=${bootstrap.snapshotToken}&page=1`));
  assert.equal(stalePageResponse.status, 503);
  const stalePage = await stalePageResponse.json() as { code?: string; error?: string };
  assert.equal(stalePage.code, "service_unavailable");
  assert.match(stalePage.error ?? "", /数据版本已变化/);
  assert.equal(preparedSql.some((sql) => sql.includes("WITH sales_agg AS (")), false);

  sqlite.close();
});

test("商品汇总拆分日期上下界后保持空库 full 与 page 语义", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const preparedSql: string[] = [];
  const database = sqliteAdapter(sqlite, (sql) => preparedSql.push(sql));
  const { ensureSalesSchema } = await import("../lib/sales/database");
  const { ensureInventorySchema } = await import("../lib/inventory/database");
  const { ensureErpReferenceSchema } = await import("../lib/erp-reference/database");
  const { getProductSummary } = await import("../lib/products/summary");
  await Promise.all([
    ensureSalesSchema(database as never),
    ensureInventorySchema(database as never),
    ensureErpReferenceSchema(database as never),
  ]);

  preparedSql.length = 0;
  const full = await getProductSummary(database as never, { range: "last30" });
  assert.equal(full.projection, "full");
  assert.equal(full.hasSales, false);
  assert.equal(full.sync.dataStartDate, null);
  assert.equal(full.sync.dataCutoffDate, null);
  assert.deepEqual(full.items, []);
  assert.equal(full.pagination.total, 0);
  assert.equal(preparedSql.filter((sql) => sql.includes("substr(MIN(ship_time)")).length, 1);
  assert.equal(preparedSql.some((sql) => sql.includes("WITH sales_agg AS (")), false);

  const page = await getProductSummary(database as never, {
    range: "last30",
    projection: "page",
    expectedSnapshotToken: full.snapshotToken,
    page: 7,
    pageSize: 25,
  });
  assert.equal(page.projection, "page");
  assert.equal(page.snapshotToken, full.snapshotToken);
  assert.deepEqual(page.items, []);
  assert.deepEqual(page.pagination, {
    page: 7,
    pageSize: 25,
    total: 0,
    returned: 0,
    totalPages: 0,
    truncated: false,
  });
  sqlite.close();
});

test("商品前端只在同一 bootstrap 和 snapshot 下请求 page 投影，版本漂移有界回到 full", async () => {
  const product = await readFile(new URL("../app/product-module-view.tsx", import.meta.url), "utf8");
  assert.match(product, /productSummaryBootstrapKeyRef/);
  assert.match(product, /productSummarySnapshotTokenRef/);
  assert.match(product, /productSummaryRestartedTokensRef = useRef\(new Set<string>\(\)\)/);
  assert.match(product, /const expectedSnapshotToken = productSummarySnapshotTokenRef\.current/);
  assert.match(product, /const pageOnly = !forceFull[\s\S]+productSummaryBootstrapKeyRef\.current === bootstrapKey[\s\S]+snapshotTokenPattern\.test\(expectedSnapshotToken\)/);
  assert.match(product, /params\.set\("view", "page"\)[\s\S]+params\.set\("snapshotToken", expectedSnapshotToken\)/);
  assert.match(product, /pageSnapshotMismatch = pageOnly && response\.ok && payload\?\.snapshotToken !== expectedSnapshotToken/);
  assert.match(product, /response\.status === 503 \|\| pageSnapshotMismatch/);
  assert.match(product, /claimSnapshotRestart\(productSummaryRestartedTokensRef\.current, expectedSnapshotToken\)/);
  assert.match(product, /productSummaryBootstrapKeyRef\.current = ""[\s\S]+productSummarySnapshotTokenRef\.current = ""[\s\S]+setSummary\(null\)[\s\S]+setProductSummarySnapshotRecoveryKey/);
  assert.match(product, /payload\.snapshotToken !== expectedSnapshotToken/);
  assert.match(product, /current\.snapshotToken === expectedSnapshotToken[\s\S]+productSummarySnapshotTokenRef\.current === expectedSnapshotToken/);
  assert.match(product, /productSummarySnapshotTokenRef\.current = payload\.snapshotToken/);
  assert.match(product, /\[loadSummary, productSummarySnapshotRecoveryKey\]/);
  assert.match(product, /\{ \.\.\.current, sort: payload\.sort, pagination: payload\.pagination, items: payload\.items \}/);
  assert.match(product, /onClick=\{\(\) => void loadSummary\(true\)\}/);
});
