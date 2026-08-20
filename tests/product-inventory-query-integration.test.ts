import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __productInventoryEnv?: typeof testEnvironment }).__productInventoryEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__productInventoryEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { ensureSalesSchema } = await import("../lib/sales/database");
const { ensureInventorySchema } = await import("../lib/inventory/database");
const { ensureErpReferenceSchema } = await import("../lib/erp-reference/database");
const { getProductSummary } = await import("../lib/products/summary");
const { getInventoryOverview } = await import("../lib/inventory/overview");
const { getInventoryAgeAnalysis } = await import("../lib/inventory/age-analysis");

function sqliteAdapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
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

function insertStockLine(sqlite: DatabaseSync, input: {
  rowKey: string;
  productCode: string;
  productName: string;
  category: string;
  availableQuantity: number;
  unitCostCents: number;
  ageDays: number;
}) {
  sqlite.prepare(`INSERT INTO inventory_stock_lines (
    batch_id, row_key, source_row_number, snapshot_date, warehouse, warehouse_type,
    product_code, product_name, brand, specification, barcode, category,
    on_hand_quantity, available_quantity, locked_quantity, in_transit_quantity,
    unit_cost_cents, inventory_age_days
  ) VALUES ('inventory-batch', ?, 1, '2026-08-18', '上海仓', 'owned', ?, ?, '', '', '', ?, ?, ?, 0, 0, ?, ?)`)
    .run(
      input.rowKey,
      input.productCode,
      input.productName,
      input.category,
      input.availableQuantity,
      input.availableQuantity,
      input.unitCostCents,
      input.ageDays,
    );
}

test("真实 SQL 分页保持稳定类目 facet，并披露部分成本覆盖", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db), ensureErpReferenceSchema(db)]);

  sqlite.prepare(`INSERT INTO sales_import_batches (
    id, source, file_name, file_size_bytes, file_hash, sheet_name, status, row_count, inserted_count, completed_at
  ) VALUES ('sales-batch', 'test', 'sales.xlsx', 1, 'sales-hash', 'Sheet1', 'completed', 2, 2, '2026-08-18 10:00:00')`).run();
  sqlite.prepare(`INSERT INTO inventory_import_batches (
    id, source, file_name, file_size_bytes, file_hash, sheet_name, snapshot_date, status,
    row_count, inserted_count, totals_json, completed_at
  ) VALUES ('inventory-batch', 'test', 'inventory.xlsx', 1, 'inventory-hash', 'Sheet1', '2026-08-18', 'completed', 3, 3, '{}', '2026-08-18 10:00:00')`).run();

  insertSalesLine(sqlite, { productCode: "A", productName: "货品A", category: "类目A", quantity: 10, netSalesCents: 10_000, costCents: 0 });
  insertSalesLine(sqlite, { productCode: "B", productName: "货品B", category: "类目B", quantity: 5, netSalesCents: 5_000, costCents: 2_500 });
  insertStockLine(sqlite, { rowKey: "a-priced", productCode: "A", productName: "货品A", category: "类目A", availableQuantity: 1, unitCostCents: 1_000, ageDays: 120 });
  insertStockLine(sqlite, { rowKey: "a-missing", productCode: "A", productName: "货品A", category: "类目A", availableQuantity: 99, unitCostCents: 0, ageDays: 120 });
  insertStockLine(sqlite, { rowKey: "b-priced", productCode: "B", productName: "货品B", category: "类目B", availableQuantity: 5, unitCostCents: 500, ageDays: 30 });

  const product = await getProductSummary(db, {
    range: "custom",
    startDate: "2026-08-18",
    endDate: "2026-08-18",
    categories: ["类目A"],
    page: 1,
    pageSize: 1,
  });
  assert.equal(product.pagination.total, 1);
  assert.deepEqual(product.filters.categories, ["类目A", "类目B"], "选中类目后可选类目不应收缩");
  assert.equal(product.items[0]?.stockValueCents, null);
  assert.equal(product.items[0]?.knownStockValueCents, 1_000);
  assert.equal(product.items[0]?.costCoverageRate, 0.01);

  const overview = await getInventoryOverview(db, {
    exactKey: `上海仓\u001fA`,
    startDate: "2026-08-18",
    endDate: "2026-08-18",
    page: 1,
    pageSize: 1,
  });
  assert.equal(overview.pagination.total, 1);
  assert.equal(overview.metrics.stockValueComplete, false);
  assert.equal(overview.metrics.knownStockValueCents, 1_000);
  assert.equal(overview.metrics.costCoverageRate, 0.01);
  assert.equal(overview.items[0]?.stockValueCents, null);

  const age = await getInventoryAgeAnalysis(db, { query: "A", page: 1, pageSize: 1 });
  assert.equal(age.pagination.total, 1);
  assert.equal(age.metrics.stockValueComplete, false);
  assert.equal(age.items[0]?.stockValueCents, null);
  assert.equal(age.items[0]?.sales30dQuantity, null);
  sqlite.close();
});
