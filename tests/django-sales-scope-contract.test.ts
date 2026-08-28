import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import { getSalesCategoryAnalysis, getSalesCategoryOutletBreakdown } from "../lib/sales/category-analysis";
import type { SalesDatabase } from "../lib/sales/database";
import { resolveProductFilterCodes } from "../lib/sales/product-query";

type SqlValue = string | number | bigint | Uint8Array | null;

function adapter(sqlite: DatabaseSync): SalesDatabase {
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

test("category product-name resolution cannot expose codes outside the principal scope", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE erp_product_master (product_code TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '');
    CREATE TABLE sales_order_lines (
      source_line_key TEXT PRIMARY KEY, order_no TEXT NOT NULL, online_order_no TEXT NOT NULL,
      channel TEXT NOT NULL, platform TEXT NOT NULL, shop_name TEXT NOT NULL, warehouse TEXT NOT NULL,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, category TEXT NOT NULL, quantity INTEGER NOT NULL,
      allocated_amount_cents INTEGER NOT NULL, cost_amount_cents INTEGER NOT NULL,
      gross_profit_cents INTEGER NOT NULL, ship_time TEXT NOT NULL
    );
    INSERT INTO sales_order_lines VALUES
      ('JD-1','O1','','渠道A','京东','京东一店','主仓','P-JD','同名商品','范围品类',1,2000,1000,1000,'2026-08-02 10:00:00'),
      ('TM-1','O2','','渠道B','天猫','天猫一店','主仓','P-TM','同名商品','范围品类',1,9000,4000,5000,'2026-08-02 11:00:00');
  `);
  const principal: AppPrincipal = {
    email: "analyst@example.test",
    displayName: "Scoped analyst",
    role: "analyst",
    scope: { warehouses: [], channels: [], platforms: ["京东"] },
  };
  const result = await getSalesCategoryAnalysis(adapter(sqlite), {
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    productQueries: ["同名商品"],
    pageSize: 100,
  }, principal);
  assert.deepEqual(result.filtersApplied.productCodes, ["P-JD"]);
  assert.equal(result.summary.netSalesCents, 2_000);
  sqlite.close();
});

test("the shared sales product resolver never maps names from the excluded 刷刷仓", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sales_order_lines (
      product_name TEXT NOT NULL, product_code TEXT NOT NULL, warehouse TEXT NOT NULL
    );
    INSERT INTO sales_order_lines VALUES ('仅排除仓商品', 'SHUA-SECRET', ' 刷刷仓 ');
  `);
  const codes = await resolveProductFilterCodes(adapter(sqlite), ["仅排除仓商品"]);
  assert.deepEqual(codes, ["仅排除仓商品"]);
  sqlite.close();
});

test("category detail uses the UTF-8 binary tie-break contract", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE erp_product_master (product_code TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '');
    CREATE TABLE sales_order_lines (
      source_line_key TEXT PRIMARY KEY, order_no TEXT NOT NULL, online_order_no TEXT NOT NULL,
      channel TEXT NOT NULL, platform TEXT NOT NULL, shop_name TEXT NOT NULL, warehouse TEXT NOT NULL,
      product_code TEXT NOT NULL, product_name TEXT NOT NULL, category TEXT NOT NULL, quantity INTEGER NOT NULL,
      allocated_amount_cents INTEGER NOT NULL, cost_amount_cents INTEGER NOT NULL,
      gross_profit_cents INTEGER NOT NULL, ship_time TEXT NOT NULL
    );
    INSERT INTO sales_order_lines VALUES
      ('O-1','O1','','渠道','中','中店','主仓','P1','商品1','并列品类',1,1000,600,400,'2026-08-03 10:00:00'),
      ('O-2','O2','','渠道','é','é店','主仓','P2','商品2','并列品类',1,1000,600,400,'2026-08-03 10:00:00'),
      ('O-3','O3','','渠道','a','a店','主仓','P3','商品3','并列品类',1,1000,600,400,'2026-08-03 10:00:00'),
      ('O-4','O4','','渠道','A','A店','主仓','P4','商品4','并列品类',1,1000,600,400,'2026-08-03 10:00:00');
  `);
  const result = await getSalesCategoryOutletBreakdown(adapter(sqlite), {
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    category: "并列品类",
  }, { email: "admin@example.test", displayName: "Admin", role: "admin", scope: null });
  assert.deepEqual(result.platforms.map((item) => item.platform), ["A", "a", "é", "中"]);
  sqlite.close();
});
