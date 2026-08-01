import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SalesDatabase } from "../lib/sales/database";
import { parseProductQueries, resolveProductFilterCodes } from "../lib/sales/product-query";

function sqliteAdapter(sqlite: DatabaseSync): SalesDatabase {
  type SqlValue = string | number | bigint | Uint8Array | null;
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

test("product query parsing preserves spaces in Chinese names and whitespace-separated ASCII codes", () => {
  assert.deepEqual(
    parseProductQueries("志高YT-3H 柜式直饮机（遥控款）五级超滤（一开二温）-不锈钢\nSKU-1 SKU-2"),
    ["志高YT-3H 柜式直饮机（遥控款）五级超滤（一开二温）-不锈钢", "SKU-1", "SKU-2"],
  );
});

test("product filter resolves an exact product name while preserving code and unmatched queries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sales_order_lines (
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL
    );
  `);
  const productName = "志高YT-3H 柜式直饮机（遥控款）五级超滤（一开二温）-不锈钢";
  const insert = sqlite.prepare("INSERT INTO sales_order_lines (product_code, product_name) VALUES (?, ?)");
  insert.run("ZG-YT-3H-008", productName);
  insert.run("OTHER-001", "其他货品");

  const resolved = await resolveProductFilterCodes(
    sqliteAdapter(sqlite),
    [productName, "OTHER-001", "NOT-FOUND"],
  );

  assert.deepEqual(resolved, ["ZG-YT-3H-008", "OTHER-001", "NOT-FOUND"]);
  sqlite.close();
});

test("sales page and API send product names through the shared resolver", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/sales/summary/route.ts", import.meta.url), "utf8");
  const summary = readFileSync(new URL("../lib/sales/summary.ts", import.meta.url), "utf8");

  assert.match(page, /query\.append\("productQuery", productQuery\)/);
  assert.match(route, /parseProductQueries\([\s\S]*getAll\("productQuery"\)/);
  assert.match(summary, /resolveProductFilterCodes\(db, productQueries\)/);
});
