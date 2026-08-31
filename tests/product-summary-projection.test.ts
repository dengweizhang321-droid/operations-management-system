import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { SalesConsumerReader, SalesProductAggregate } from "../lib/django/sales-consumer-reader";

const testEnvironment: {
  DB?: unknown;
  TERUISI_DJANGO_SALES_READER_BASE_URL?: string;
  TERUISI_DJANGO_INTERNAL_SECRET?: string;
} = {};
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

const testPrincipal: AppPrincipal = {
  email: "product-reader@example.com",
  displayName: "Product reader",
  role: "viewer",
  scope: null,
};

const salesProducts: SalesProductAggregate[] = [
  {
    productCode: "A", productName: "货品A", specification: "", category: "类目A", supplier: "",
    netQuantity: 10, grossSalesCents: 10_000, refundAmountCents: 0, netSalesCents: 10_000,
    costCents: 9_000, feeCents: 0, grossProfitCents: 1_000, absoluteQuantity: 10,
    absoluteCostCents: 9_000, outlets: [{ platform: "京东", shopName: "测试店铺", channel: "京东" }],
  },
  {
    productCode: "B", productName: "货品B", specification: "", category: "类目B", supplier: "",
    netQuantity: 5, grossSalesCents: 5_000, refundAmountCents: 0, netSalesCents: 5_000,
    costCents: 2_500, feeCents: 0, grossProfitCents: 2_500, absoluteQuantity: 5,
    absoluteCostCents: 2_500, outlets: [{ platform: "京东", shopName: "测试店铺", channel: "京东" }],
  },
];

const latestSalesBatch = {
  id: "sales-batch",
  fileName: "sales.xlsx",
  completedAt: "2026-08-18 10:00:00",
  rowCount: 2,
};

function fixtureSalesReader(input: {
  products?: SalesProductAggregate[];
  revision?: () => string;
  hasSales?: boolean;
} = {}): SalesConsumerReader {
  const products = input.products ?? salesProducts;
  const revision = input.revision ?? (() => "sales:fixture:1");
  const hasSales = input.hasSales ?? true;
  return {
    async read(_principal, request) {
      if (request.operation === "freshness") {
        return {
          revision: revision(),
          data: {
            dataStartDate: hasSales ? "2026-08-18" : null,
            dataCutoffDate: hasSales ? "2026-08-18" : null,
            latestBatch: hasSales ? latestSalesBatch : null,
          },
        } as never;
      }
      if (request.operation !== "product_performance") throw new Error(`unexpected operation: ${request.operation}`);
      const requested = new Set(request.productCodes ?? []);
      const platformAllowed = !request.platforms?.length || request.platforms.includes("京东");
      const outletAllowed = !request.outlets?.length || request.outlets.some((outlet) => (
        outlet.platform === "京东" && outlet.shopName === "测试店铺"
      ));
      return {
        revision: revision(),
        data: {
          dataStartDate: hasSales ? "2026-08-18" : null,
          dataCutoffDate: hasSales ? "2026-08-18" : null,
          latestBatch: hasSales ? latestSalesBatch : null,
          rows: platformAllowed && outletAllowed ? products.filter((row) => requested.has(row.productCode)) : [],
          outletOptions: platformAllowed && outletAllowed
            ? [{ platform: "京东", shopName: "测试店铺", channel: "京东" }]
            : [],
          truncated: false,
        },
      } as never;
    },
  };
}

function insertErpProducts(sqlite: DatabaseSync) {
  const insert = sqlite.prepare(`INSERT INTO erp_product_master
    (product_code,product_name,brand,specification,barcode,category,supplier,product_status,source_row_number,last_import_batch_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insert.run("A", "货品A", "", "", "", "类目A", "", "active", 1, "erp-batch");
  insert.run("B", "货品B", "", "", "", "类目B", "", "active", 2, "erp-batch");
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
  const { ensureInventorySchema } = await import("../lib/inventory/database");
  const { ensureErpReferenceSchema } = await import("../lib/erp-reference/database");
  await Promise.all([
    ensureAuthorizationSchema(database as never),
    ensureInventorySchema(database as never),
    ensureErpReferenceSchema(database as never),
  ]);
  sqlite.prepare(`INSERT INTO app_users (email, display_name, role, status, scope_json)
    VALUES ('product-reader@example.com', 'Product reader', 'viewer', 'active', NULL)`).run();
  insertErpProducts(sqlite);

  let salesRevision = "sales:fixture:1";
  const reader = fixtureSalesReader({ revision: () => salesRevision });
  const originalFetch = globalThis.fetch;
  testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL = "http://127.0.0.1:8001";
  testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET = "product-summary-test-secret-at-least-32-bytes";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8")) as { operation: string };
    const result = await reader.read(testPrincipal, body as never);
    return Response.json({ operation: body.operation, data: result.data }, {
      headers: {
        "x-sales-data-revision": result.revision,
        "x-sales-source-revision": result.revision,
      },
    });
  };

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
  assert.equal(bootstrapSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);
  assert.equal(bootstrapSql.some((sql) => /FROM erp_product_master/i.test(sql)), true);

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
  assert.equal(pageSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  preparedSql.length = 0;
  const equivalentResponse = await route.GET(new Request(`${base}&page=2&sortBy=grossProfitCents&direction=asc`));
  assert.equal(equivalentResponse.status, 200);
  const equivalent = await equivalentResponse.json() as ProductApiPayload;
  assert.deepEqual(page.items, equivalent.items);
  assert.deepEqual(page.pagination, equivalent.pagination);
  assert.deepEqual(page.sort, equivalent.sort);
  assert.deepEqual(bootstrap.metrics, equivalent.metrics, "仅翻页和排序不应改变业务指标");
  assert.deepEqual(bootstrap.filters, equivalent.filters, "仅翻页和排序不应改变 bootstrap facet");
  assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  preparedSql.length = 0;
  const scopedResponse = await route.GET(new Request(
    `${base}&page=1&platform=${encodeURIComponent("京东")}&shop=${encodeURIComponent("京东\u001f测试店铺")}`,
  ));
  assert.equal(scopedResponse.status, 200);
  const scoped = await scopedResponse.json() as ProductApiPayload;
  assert.deepEqual(scoped.items.map((item) => item.productCode), ["A"]);
  assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  preparedSql.length = 0;
  const beyondResponse = await route.GET(new Request(`${base}&view=page&snapshotToken=${bootstrap.snapshotToken}&page=99&sortBy=netSalesCents&direction=desc`));
  assert.equal(beyondResponse.status, 200);
  const beyond = await beyondResponse.json() as ProductApiPayload;
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.pagination.total, 2);
  assert.equal(beyond.pagination.returned, 0);
  assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  for (const suffix of ["view=other", "view=page&view=page", "view=page", "view=page&snapshotToken=bad"]) {
    preparedSql.length = 0;
    const response = await route.GET(new Request(`${base}&${suffix}`));
    assert.equal(response.status, 400, suffix);
    assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false, suffix);
  }

  salesRevision = "sales:fixture:2";
  preparedSql.length = 0;
  const stalePageResponse = await route.GET(new Request(`${base}&view=page&snapshotToken=${bootstrap.snapshotToken}&page=1`));
  assert.equal(stalePageResponse.status, 503);
  const stalePage = await stalePageResponse.json() as { code?: string; error?: string };
  assert.equal(stalePage.code, "service_unavailable");
  assert.match(stalePage.error ?? "", /数据版本已变化/);
  assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  globalThis.fetch = originalFetch;
  delete testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL;
  delete testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET;
  sqlite.close();
});

test("商品汇总拆分日期上下界后保持空库 full 与 page 语义", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const preparedSql: string[] = [];
  const database = sqliteAdapter(sqlite, (sql) => preparedSql.push(sql));
  const { ensureInventorySchema } = await import("../lib/inventory/database");
  const { ensureErpReferenceSchema } = await import("../lib/erp-reference/database");
  const { getProductSummary } = await import("../lib/products/summary");
  await Promise.all([
    ensureInventorySchema(database as never),
    ensureErpReferenceSchema(database as never),
  ]);
  const reader = fixtureSalesReader({ products: [], hasSales: false });

  preparedSql.length = 0;
  const full = await getProductSummary(database as never, testPrincipal, { range: "last30" }, reader);
  assert.equal(full.projection, "full");
  assert.equal(full.hasSales, false);
  assert.equal(full.sync.dataStartDate, null);
  assert.equal(full.sync.dataCutoffDate, null);
  assert.deepEqual(full.items, []);
  assert.equal(full.pagination.total, 0);
  assert.equal(preparedSql.some((sql) => /sales_order_lines|sales_import_batches/i.test(sql)), false);

  const page = await getProductSummary(database as never, testPrincipal, {
    range: "last30",
    projection: "page",
    expectedSnapshotToken: full.snapshotToken,
    page: 7,
    pageSize: 25,
  }, reader);
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
