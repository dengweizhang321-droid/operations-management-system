import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env={};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { ensureSalesSchema, saveSalesImport } = await import("../lib/sales/database");
const { ensureErpReferenceSchema, saveProductMasterImport } = await import("../lib/erp-reference/database");

type SalesDatabase = import("../lib/sales/database").SalesDatabase;
type SalesLineInput = import("../lib/sales/database").SalesLineInput;
type ErpReferenceDatabase = import("../lib/erp-reference/database").ErpReferenceDatabase;

type RunHook = (sql: string, values: readonly SQLInputValue[]) => void;

function sqliteAdapter(sqlite: DatabaseSync, hook: { beforeRun?: RunHook } = {}) {
  let batchTail: Promise<unknown> = Promise.resolve();
  const prepare = (sql: string) => {
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
        hook.beforeRun?.(sql, values);
        const result = sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  };
  return {
    prepare,
    batch(statements: Array<{ run(): Promise<unknown> }>) {
      const execute = async () => {
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
      };
      const result = batchTail.then(execute, execute);
      batchTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

function salesLine(orderNo: string, shipDate: string, channel: string): SalesLineInput {
  return {
    sourceRowNumber: 1,
    sourceLineKey: orderNo,
    sourceRowHash: orderNo.padEnd(64, "0").slice(0, 64),
    orderNo,
    onlineOrderNo: orderNo,
    channel,
    platform: channel.startsWith("京东") ? "京东" : "天猫",
    shopName: `${channel}店铺`,
    logisticsCompany: "",
    warehouse: "正常仓",
    productCode: "SKU-1",
    onlineSpecCode: "SKU-1",
    productName: "测试商品",
    specification: "",
    barcode: "",
    supplier: "",
    category: "测试类目",
    quantity: 1,
    listUnitPriceCents: 100,
    costAmountCents: 40,
    allocatedUnitPriceCents: 100,
    allocatedAmountCents: 100,
    feeAllocationCents: 0,
    grossProfitCents: 60,
    grossMarginBps: 6_000,
    untaxedGrossProfitCents: 60,
    untaxedGrossMarginBps: 6_000,
    orderTime: `${shipDate} 08:00:00`,
    salesTime: `${shipDate} 08:00:00`,
    shipTime: `${shipDate} 09:00:00`,
    lineShipTime: `${shipDate} 09:00:00`,
    businessType: "sale",
  };
}

function productRow(productCode: string, productName: string, sourceRowNumber: number) {
  return {
    sourceRowNumber,
    productCode,
    productName,
    brand: "品牌",
    specification: "规格",
    barcode: "",
    category: "类目",
    supplier: "供应商",
    productStatus: "启用",
  };
}

function rows(sqlite: DatabaseSync) {
  return sqlite.prepare(`SELECT
    event_sequence AS eventSequence,
    event_id AS eventId,
    source_epoch AS sourceEpoch,
    domain,
    operation,
    scope_json AS scopeJson,
    source_batch_id AS sourceBatchId,
    sales_revision AS salesRevision,
    erp_revision AS erpRevision,
    row_count AS rowCount,
    content_hash AS contentHash,
    canonical_format_version AS canonicalFormatVersion
  FROM sales_projection_outbox ORDER BY event_sequence`).all().map((row) => ({ ...row }));
}

test("0089 migration and runtime ensure create a stable source epoch without inventing historical events", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../drizzle/0089_sales_projection_outbox.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  const firstEpoch = String(sqlite.prepare(
    "SELECT source_epoch FROM sales_projection_source_state WHERE id = 1",
  ).get()?.source_epoch);
  assert.match(firstEpoch, /^[0-9a-f]{32}$/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_projection_outbox").get()?.count, 0);

  sqlite.exec(migration);
  const db = sqliteAdapter(sqlite);
  await ensureSalesSchema(db as unknown as SalesDatabase);
  await ensureErpReferenceSchema(db as unknown as ErpReferenceDatabase);
  assert.equal(sqlite.prepare(
    "SELECT source_epoch FROM sales_projection_source_state WHERE id = 1",
  ).get()?.source_epoch, firstEpoch);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_projection_outbox").get()?.count, 0);
  sqlite.close();
});

test("sales and ERP authoritative replacements publish ordered revision-bound outbox events", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureSalesSchema(db as unknown as SalesDatabase);
  await ensureErpReferenceSchema(db as unknown as ErpReferenceDatabase);

  const firstSales = {
    fileHash: "1".repeat(64),
    fileName: "sales-all.xlsx",
    fileSizeBytes: 1,
    sheetName: "销售",
    rows: [salesLine("JD-KEEP", "2026-08-01", "京东"), salesLine("TMALL-OLD", "2026-08-01", "天猫-A")],
    warnings: [],
    totals: {},
    contentHash: "a".repeat(64),
    replaceStartDate: "2026-08-01",
    replaceEndDate: "2026-08-02",
  };
  assert.equal((await saveSalesImport(db as unknown as SalesDatabase, firstSales)).created, true);

  const scopedSales = {
    ...firstSales,
    fileHash: "2".repeat(64),
    fileName: "sales-scoped.xlsx",
    rows: [salesLine("TMALL-NEW", "2026-08-01", "天猫-B")],
    contentHash: "b".repeat(64),
    replaceChannels: ["天猫-B", "天猫-A", "天猫-B"],
  };
  assert.equal((await saveSalesImport(db as unknown as SalesDatabase, scopedSales)).created, true);
  assert.deepEqual(sqlite.prepare(
    "SELECT order_no AS orderNo, channel FROM sales_order_lines ORDER BY order_no",
  ).all().map((row) => ({ ...row })), [
    { orderNo: "JD-KEEP", channel: "京东" },
    { orderNo: "TMALL-NEW", channel: "天猫-B" },
  ]);

  const firstProducts = {
    id: `products:${"3".repeat(64)}`,
    fileName: "products-all.xlsx",
    fileSizeBytes: 1,
    fileHash: "3".repeat(64),
    sheetName: "货品",
    rows: [productRow("P1", "货品1", 1), productRow("P2", "货品2", 2)],
    warnings: [],
    totals: {},
    contentHash: "c".repeat(64),
  };
  assert.equal((await saveProductMasterImport(db as unknown as ErpReferenceDatabase, firstProducts)).created, true);
  const changedProducts = {
    ...firstProducts,
    id: `products:${"4".repeat(64)}`,
    fileHash: "4".repeat(64),
    rows: [productRow("P1", "货品1更新", 1)],
    contentHash: "d".repeat(64),
  };
  assert.equal((await saveProductMasterImport(db as unknown as ErpReferenceDatabase, changedProducts)).created, true);
  assert.deepEqual(sqlite.prepare(
    "SELECT product_code AS productCode, product_name AS productName FROM erp_product_master",
  ).all().map((row) => ({ ...row })), [{ productCode: "P1", productName: "货品1更新" }]);

  const publishedEvents = rows(sqlite);
  const stableEpoch = String(publishedEvents[0]?.sourceEpoch);
  assert.match(stableEpoch, /^[0-9a-f]{32}$/);
  assert.ok(publishedEvents.every((event) => event.sourceEpoch === stableEpoch));
  assert.deepEqual(publishedEvents.map((event) => ({
    ...event,
    eventId: String(event.eventId).slice(`${stableEpoch}:`.length),
    sourceEpoch: "<stable>",
  })), [
    {
      eventSequence: 1,
      eventId: `sales:${"1".repeat(64)}`,
      sourceEpoch: "<stable>",
      domain: "sales",
      operation: "replace_scope",
      scopeJson: JSON.stringify({ startDate: "2026-08-01", endDate: "2026-08-02", channels: null }),
      sourceBatchId: "1".repeat(64),
      salesRevision: 2,
      erpRevision: 1,
      rowCount: 2,
      contentHash: "a".repeat(64),
      canonicalFormatVersion: "sales-projection-v2",
    },
    {
      eventSequence: 2,
      eventId: `sales:${"2".repeat(64)}`,
      sourceEpoch: "<stable>",
      domain: "sales",
      operation: "replace_scope",
      scopeJson: JSON.stringify({ startDate: "2026-08-01", endDate: "2026-08-02", channels: ["天猫-A", "天猫-B"] }),
      sourceBatchId: "2".repeat(64),
      salesRevision: 3,
      erpRevision: 1,
      rowCount: 1,
      contentHash: "b".repeat(64),
      canonicalFormatVersion: "sales-projection-v2",
    },
    {
      eventSequence: 3,
      eventId: `erp:products:${"3".repeat(64)}`,
      sourceEpoch: "<stable>",
      domain: "erp",
      operation: "replace_all",
      scopeJson: JSON.stringify({ source: "products" }),
      sourceBatchId: `products:${"3".repeat(64)}`,
      salesRevision: 3,
      erpRevision: 2,
      rowCount: 2,
      contentHash: "c".repeat(64),
      canonicalFormatVersion: "sales-projection-v2",
    },
    {
      eventSequence: 4,
      eventId: `erp:products:${"4".repeat(64)}`,
      sourceEpoch: "<stable>",
      domain: "erp",
      operation: "replace_all",
      scopeJson: JSON.stringify({ source: "products" }),
      sourceBatchId: `products:${"4".repeat(64)}`,
      salesRevision: 3,
      erpRevision: 3,
      rowCount: 1,
      contentHash: "d".repeat(64),
      canonicalFormatVersion: "sales-projection-v2",
    },
  ]);

  assert.equal((await saveSalesImport(db as unknown as SalesDatabase, scopedSales)).created, false);
  assert.equal((await saveProductMasterImport(db as unknown as ErpReferenceDatabase, changedProducts)).created, false);
  assert.equal(rows(sqlite).length, 4);
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT sales_revision AS salesRevision, erp_product_revision AS erpRevision FROM sales_overview_cache_state WHERE id = 1",
  ).get()! }, { salesRevision: 3, erpRevision: 3 });
  sqlite.close();
});

test("an outbox write failure rolls back facts, revision, batch, and event together", async () => {
  const sqlite = new DatabaseSync(":memory:");
  let rejectOutbox = false;
  const db = sqliteAdapter(sqlite, {
    beforeRun(sql) {
      if (rejectOutbox && sql.includes("INSERT INTO sales_projection_outbox")) {
        throw new Error("injected outbox failure");
      }
    },
  });
  await ensureSalesSchema(db as unknown as SalesDatabase);
  await ensureErpReferenceSchema(db as unknown as ErpReferenceDatabase);
  rejectOutbox = true;
  await assert.rejects(saveSalesImport(db as unknown as SalesDatabase, {
    fileHash: "5".repeat(64),
    fileName: "failed.xlsx",
    fileSizeBytes: 1,
    sheetName: "销售",
    rows: [salesLine("ROLLBACK", "2026-08-01", "天猫")],
    warnings: [],
    totals: {},
    contentHash: "e".repeat(64),
    replaceStartDate: "2026-08-01",
    replaceEndDate: "2026-08-01",
  }), /injected outbox failure/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_order_lines").get()?.count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_import_batches").get()?.count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_projection_outbox").get()?.count, 0);
  assert.equal(sqlite.prepare(
    "SELECT sales_revision FROM sales_overview_cache_state WHERE id = 1",
  ).get()?.sales_revision, 1);

  rejectOutbox = false;
  const initialProducts = {
    id: `products:${"7".repeat(64)}`,
    fileName: "products-before.xlsx",
    fileSizeBytes: 1,
    fileHash: "7".repeat(64),
    sheetName: "货品",
    rows: [productRow("P1", "货品1", 1), productRow("P2", "货品2", 2)],
    warnings: [],
    totals: {},
    contentHash: "7".repeat(64),
  };
  await saveProductMasterImport(db as unknown as ErpReferenceDatabase, initialProducts);
  rejectOutbox = true;
  await assert.rejects(saveProductMasterImport(db as unknown as ErpReferenceDatabase, {
    ...initialProducts,
    id: `products:${"8".repeat(64)}`,
    fileName: "products-failed.xlsx",
    fileHash: "8".repeat(64),
    rows: [productRow("P1", "不应发布", 1)],
    contentHash: "8".repeat(64),
  }), /injected outbox failure/);
  assert.deepEqual(sqlite.prepare(
    "SELECT product_code AS productCode, product_name AS productName FROM erp_product_master ORDER BY product_code",
  ).all().map((row) => ({ ...row })), [
    { productCode: "P1", productName: "货品1" },
    { productCode: "P2", productName: "货品2" },
  ]);
  assert.equal(sqlite.prepare(
    "SELECT erp_product_revision FROM sales_overview_cache_state WHERE id = 1",
  ).get()?.erp_product_revision, 2);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM erp_reference_import_batches WHERE id = ?",
  ).get(`products:${"8".repeat(64)}`)?.count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_projection_outbox").get()?.count, 1);
  sqlite.close();
});

test("concurrent exact retries serialize to one fact publication and one stable event", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  await ensureSalesSchema(db as unknown as SalesDatabase);
  const input = {
    fileHash: "6".repeat(64),
    fileName: "same.xlsx",
    fileSizeBytes: 1,
    sheetName: "销售",
    rows: [salesLine("SAME", "2026-08-01", "天猫")],
    warnings: [],
    totals: {},
    contentHash: "f".repeat(64),
    replaceStartDate: "2026-08-01",
    replaceEndDate: "2026-08-01",
  };
  const results = await Promise.all([
    saveSalesImport(db as unknown as SalesDatabase, input),
    saveSalesImport(db as unknown as SalesDatabase, input),
  ]);
  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sales_order_lines").get()?.count, 1);
  assert.equal(sqlite.prepare("SELECT sales_revision FROM sales_overview_cache_state WHERE id = 1").get()?.sales_revision, 2);
  assert.deepEqual(rows(sqlite).map((event) => ({
    eventSequence: event.eventSequence,
    eventId: String(event.eventId).slice(`${event.sourceEpoch}:`.length),
    salesRevision: event.salesRevision,
  })), [{
    eventSequence: 1,
    eventId: `sales:${"6".repeat(64)}`,
    salesRevision: 2,
  }]);
  sqlite.close();
});
