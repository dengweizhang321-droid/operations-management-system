import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __inventoryAgeBucketEnv?: typeof testEnvironment }).__inventoryAgeBucketEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__inventoryAgeBucketEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { getInventoryAgeAnalysis } = await import("../lib/inventory/age-analysis");
const { inventoryAgeBuckets } = await import("../lib/inventory/query-contract");

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
      };
    },
  };
}

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE inventory_import_batches (
      id TEXT PRIMARY KEY, source TEXT, file_name TEXT, file_size_bytes INTEGER, file_hash TEXT, sheet_name TEXT,
      snapshot_date TEXT, status TEXT, row_count INTEGER, inserted_count INTEGER, warning_count INTEGER,
      warnings_json TEXT, totals_json TEXT, created_at TEXT, completed_at TEXT
    );
    CREATE TABLE erp_reference_import_batches (
      id TEXT PRIMARY KEY, source_key TEXT, source_label TEXT, file_name TEXT, file_size_bytes INTEGER, file_hash TEXT,
      sheet_name TEXT, snapshot_date TEXT, status TEXT, row_count INTEGER, inserted_count INTEGER, updated_count INTEGER,
      excluded_count INTEGER, warning_count INTEGER, warnings_json TEXT, totals_json TEXT, created_at TEXT, completed_at TEXT
    );
    CREATE TABLE erp_inventory_age_lines (
      id INTEGER PRIMARY KEY, snapshot_date TEXT, warehouse TEXT, warehouse_type TEXT, product_code TEXT, product_name TEXT,
      specification TEXT, category TEXT, available_quantity INTEGER, inventory_age_days INTEGER, sales_7d_quantity INTEGER,
      sales_30d_quantity INTEGER, unit_cost_cents INTEGER, stock_value_cents INTEGER, source_row_number INTEGER,
      last_import_batch_id TEXT
    );
    INSERT INTO erp_reference_import_batches VALUES (
      'age-batch', 'inventory_age', '库龄', 'age.xlsx', 1, 'hash', 'Sheet1', '2026-08-24', 'completed',
      5, 5, 0, 0, 0, '[]', '{}', '2026-08-24 10:00:00', '2026-08-24 10:00:00'
    );
    INSERT INTO erp_inventory_age_lines VALUES
      (1, '2026-08-24', '华东仓', 'owned', 'P1', '七天内', '', '类目', 2, 5, 1, 5, 100, 999999, 1, 'age-batch'),
      (2, '2026-08-24', '华东仓', 'owned', 'P2', '三十天内', '', '类目', 3, 20, 1, 5, 200, 999999, 2, 'age-batch'),
      (3, '2026-08-24', '华北仓', 'owned', 'P3', '一百天', '', '类目', 4, 100, 0, 0, 300, 999999, 3, 'age-batch'),
      (4, '2026-08-24', '华北仓', 'owned', 'P4', '一年以上缺成本', '', '类目', 5, 400, 0, 0, 0, 999999, 4, 'age-batch'),
      (5, '2026-08-24', '刷刷仓', 'other', 'X1', '排除货品', '', '类目', 99, 5, 0, 0, 100, 9900, 5, 'age-batch');
  `);
  return sqlite;
}

test("库龄筛选提供固定十档并支持多选后统一更新数量与成本金额分布", async () => {
  assert.deepEqual(inventoryAgeBuckets.map((bucket) => bucket.key), [
    "0-7", "8-15", "16-30", "31-60", "61-90", "91-120", "121-150", "151-180", "181-360", "361+",
  ]);

  const sqlite = createFixture();
  const result = await getInventoryAgeAnalysis(sqliteAdapter(sqlite) as never, {
    ageBuckets: ["0-7", "91-120"],
    page: 1,
    pageSize: 20,
  });

  assert.equal(result.pagination.total, 2);
  assert.deepEqual(new Set(result.items.map((item) => item.productCode)), new Set(["P1", "P3"]));
  assert.deepEqual(result.filters.ageBuckets.map((bucket) => bucket.value), inventoryAgeBuckets.map((bucket) => bucket.key));
  assert.deepEqual(
    result.fineDistribution.filter((bucket) => bucket.quantity > 0).map((bucket) => [bucket.key, bucket.quantity, bucket.valueCents]),
    [["0-7", 2, 200], ["91-120", 4, 1200]],
  );
  assert.equal(result.fineDistribution.reduce((sum, bucket) => sum + bucket.quantityShare, 0), 1);
  assert.equal(result.fineDistribution.reduce((sum, bucket) => sum + bucket.valueShare, 0), 1);
  sqlite.close();
});

test("库龄金额不采用报表库存金额，固定成本缺失时保持未覆盖", async () => {
  const sqlite = createFixture();
  const result = await getInventoryAgeAnalysis(sqliteAdapter(sqlite) as never, {
    ageBuckets: ["361+"],
    page: 1,
    pageSize: 20,
  });

  assert.equal(result.pagination.total, 1);
  assert.equal(result.items[0]?.productCode, "P4");
  assert.equal(result.items[0]?.stockValueCents, null);
  assert.equal(result.metrics.stockValueComplete, false);
  assert.equal(result.fineDistribution.find((bucket) => bucket.key === "361+")?.valueCents, 0);
  sqlite.close();
});

test("库龄页面和接口使用重复 ageBucket 参数连接多选与分布图", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/inventory/age-analysis/route.ts", import.meta.url), "utf8");
  assert.match(page, /ageBucketFilters\.forEach\(\(bucket\) => params\.append\("ageBucket", bucket\)\)/);
  assert.match(page, /ariaLabel="库龄区间"/);
  assert.match(page, /ageAnalysis\.fineDistribution\.map/);
  assert.match(route, /params\.getAll\("ageBucket"\)/);
  assert.match(route, /allowed: allowedAgeBuckets/);
});
