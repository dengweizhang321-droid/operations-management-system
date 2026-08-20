import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SalesDatabase } from "../lib/sales/database";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env={};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { getSalesSummary } = await import("../lib/sales/summary");

type SqlValue = string | number | bigint | Uint8Array | null;

function sqliteAdapter(sqlite: DatabaseSync): SalesDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: SqlValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SqlValue[]; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  } as SalesDatabase;
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE erp_product_master (product_code TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '');
    CREATE TABLE sales_import_batches (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      file_hash TEXT NOT NULL, sheet_name TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL, duplicate_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
      warnings_json TEXT NOT NULL, totals_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE sales_order_lines (
      source_line_key TEXT PRIMARY KEY, order_no TEXT NOT NULL, online_order_no TEXT NOT NULL,
      channel TEXT NOT NULL, platform TEXT NOT NULL, shop_name TEXT NOT NULL, warehouse TEXT NOT NULL,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, category TEXT NOT NULL, quantity INTEGER NOT NULL,
      allocated_amount_cents INTEGER NOT NULL, gross_profit_cents INTEGER NOT NULL, ship_time TEXT NOT NULL
    );
    INSERT INTO erp_product_master VALUES
      ('DW-LONG', '长龙洗碗机'),
      ('DW-HOOD', '揭盖洗碗机'),
      ('DW-IDLE', '台下洗碗机');
    INSERT INTO sales_order_lines VALUES
      ('L1', 'O1', '', '京东-洗碗机店', '京东', '洗碗机店', '主仓', 'DW-LONG', '长龙式洗碗机', '商用洗碗机', 1, 120000, 30000, '2026-08-18 10:00:00'),
      ('L2', 'O2', '', '京东-洗碗机店', '京东', '洗碗机店', '主仓', 'DW-HOOD', '揭盖式洗碗机', '', 1, 80000, 20000, '2026-08-18 11:00:00'),
      ('L3', 'O3', '', '天猫-设备店', '天猫', '设备店', '主仓', 'DW-ULTRA', '超声波洗碗机', '超声波洗碗机', 1, 60000, 10000, '2026-08-18 12:00:00');
  `);
  return { sqlite, db: sqliteAdapter(sqlite) };
}

test("sales overview resolves categories from ERP product master and falls back to the sales row", async () => {
  const { sqlite, db } = fixture();
  const result = await getSalesSummary(db, {
    range: "custom",
    startDate: "2026-08-18",
    endDate: "2026-08-18",
  });

  assert.deepEqual(result.filterOptions.categories, ["台下洗碗机", "揭盖洗碗机", "超声波洗碗机", "长龙洗碗机"]);
  assert.equal(result.current.netSalesCents, 260000);
  sqlite.close();
});

test("an ERP-resolved category filters every sales overview aggregation consistently", async () => {
  const { sqlite, db } = fixture();
  const result = await getSalesSummary(db, {
    range: "all",
    categories: ["揭盖洗碗机"],
  });

  assert.equal(result.current.netSalesCents, 80000);
  assert.equal(result.current.lineCount, 1);
  assert.equal(result.outlets.length, 1);
  assert.equal(result.shops.length, 1);
  assert.equal(result.platforms.length, 1);
  assert.deepEqual(result.daily.map((item) => [item.date, item.netSalesCents]), [["2026-08-18", 80000]]);
  assert.deepEqual(result.filters.categories, ["揭盖洗碗机"]);
  sqlite.close();
});

test("销售汇总最大合法商品、品类与 outlet 筛选使用 JSON bind 且单条不超过 100", async () => {
  const bindingCounts: number[] = [];
  const db = {
    prepare() {
      return {
        bind(...values: unknown[]) { bindingCounts.push(values.length); return this; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  } as unknown as SalesDatabase;
  await getSalesSummary(db, {
    range: "custom",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    productQueries: Array.from({ length: 100 }, (_, index) => `SKU-${index}`),
    categories: Array.from({ length: 50 }, (_, index) => `品类-${index}`),
    outlets: Array.from({ length: 50 }, (_, index) => ({ platform: `平台-${index}`, shop: `店铺-${index}` })),
  });
  assert.ok(bindingCounts.length > 0);
  assert.ok(bindingCounts.every((count) => count <= 100), `最大 bind 数应≤100，实际 ${Math.max(...bindingCounts)}`);
});
