import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env={};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { env } = await import("cloudflare:workers");
const { importInventoryStockBytes } = await import("../lib/inventory/import-service");
const { createXlsxWorkbookBytes } = await import("../lib/imports/xlsx-write");

function sqliteAdapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues as SQLInputValue[];
          return this;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...values) ?? null) as T | null;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function workbook(headers: Array<string | number>, row: Array<string | number>) {
  return createXlsxWorkbookBytes([{ name: "库存", rows: [headers, row] }]);
}

function warningCodes(value: string) {
  return (JSON.parse(value) as Array<{ code?: string }>).map((item) => item.code);
}

test("库存相同规范化内容命中 duplicate 时保留本次稀疏文件告警，零成本拒绝保留全部审计告警", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  (env as unknown as { DB: unknown }).DB = db;

  const full = workbook(
    ["仓库名称", "货品编号", "货品名称", "库存数量", "可用库存", "锁定数量", "采购在途数", "成本价", "前30天销量", "库存日期"],
    ["华东仓", "SKU-001", "测试商品", 10, 10, 0, 0, 12.34, 0, "2026-08-01"],
  );
  const first = await importInventoryStockBytes({
    bytes: full,
    fileName: "full.xlsx",
    fileSizeBytes: full.byteLength,
  });
  assert.equal(first.status, "imported");

  const sparse = workbook(
    ["仓库名称", "货品编号", "货品名称", "库存数量", "成本价", "库存日期"],
    ["华东仓", "SKU-001", "测试商品", 10, 12.34, "2026-08-01"],
  );
  const duplicate = await importInventoryStockBytes({
    bytes: sparse,
    fileName: "sparse.xlsx",
    fileSizeBytes: sparse.byteLength,
  });
  assert.equal(duplicate.status, "duplicate");
  const expectedSparseWarnings = [
    "DERIVED_AVAILABLE_QUANTITY",
    "MISSING_LOCKED_QUANTITY",
    "MISSING_IN_TRANSIT_QUANTITY",
    "MISSING_AGE_SALES",
  ].sort();
  assert.deepEqual(duplicate.warnings.map((item) => item.code).sort(), expectedSparseWarnings);
  const duplicateAttempt = sqlite.prepare(
    `SELECT warnings_json warningsJson
     FROM import_content_attempts
     WHERE domain = 'inventory-stock' AND outcome = 'duplicate'
     ORDER BY sequence DESC
     LIMIT 1`,
  ).get() as { warningsJson: string };
  assert.deepEqual(warningCodes(duplicateAttempt.warningsJson).sort(), expectedSparseWarnings);

  const fingerprintCountBeforeReject = sqlite.prepare("SELECT COUNT(*) count FROM import_content_fingerprints").get()!.count;
  const scopeHeadCountBeforeReject = sqlite.prepare("SELECT COUNT(*) count FROM import_scope_heads").get()!.count;
  const zeroCost = workbook(
    ["仓库名称", "货品编号", "库存数量", "可用库存", "锁定数量", "采购在途数", "成本价", "前30天销量", "库存日期"],
    ["华南仓", "SKU-ZERO", 5, 5, 0, 0, 0, 0, "2026-08-02"],
  );
  const rejected = await importInventoryStockBytes({
    bytes: zeroCost,
    fileName: "zero-cost.xlsx",
    fileSizeBytes: zeroCost.byteLength,
  });
  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.warnings.some((item) => item.code === "EXCLUDED_ZERO_UNIT_COST"));
  assert.ok(rejected.errors?.some((item) => item.code === "NO_DATA_ROWS_AFTER_FILTER"));
  const rejectedAttempt = sqlite.prepare(
    `SELECT warnings_json warningsJson
     FROM import_content_attempts
     WHERE domain = 'inventory-stock' AND outcome = 'rejected'
     ORDER BY sequence DESC
     LIMIT 1`,
  ).get() as { warningsJson: string };
  assert.deepEqual(
    new Set(warningCodes(rejectedAttempt.warningsJson)),
    new Set(["EXCLUDED_ZERO_UNIT_COST", "NO_DATA_ROWS_AFTER_FILTER"]),
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM import_content_fingerprints").get()!.count, fingerprintCountBeforeReject);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM import_scope_heads").get()!.count, scopeHeadCountBeforeReject);
  sqlite.close();
});
