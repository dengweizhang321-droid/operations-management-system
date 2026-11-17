import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  inspectTmallImportBytes, netshopBusinessContentRows, prepareNormalizedNetshopImport, prepareTmallPromotionRows,
} from "../lib/netshop/normalized-import";
import {
  datedProductReport, directReport, mixedRows, productOnlyRows, promoRow,
} from "./tmall-promotion-store-fixtures";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("real shape: two store-direct plan rows merge into one store-level row, products stay products", async () => {
  const input = directReport(mixedRows);
  const result = await inspectTmallImportBytes(input);
  assert.deepEqual(result.errors, []);
  // 3 products + 1 merged store-level row (the two plan rows share date and store subject).
  assert.equal(result.totals.rowCount, 4);
  assert.equal(result.totals.uniqueProductCount, 3);
  const store = result.rows.filter((row) => row.spuId.startsWith("店铺:"));
  assert.equal(store.length, 1);
  assert.equal(store[0]!.spuId, "店铺:355577887");
  assert.equal(store[0]!.raw["主体类型"], "店铺");
  assert.equal(store[0]!.metrics.spendCents, 3984);
  assert.equal(store[0]!.metrics.netTransactionAmountCents, 35800);
  assert.equal(store[0]!.raw["计划明细行数"], 2);
  const products = result.rows.filter((row) => !row.spuId.startsWith("店铺:"));
  assert.deepEqual(products.map((row) => row.spuId).sort(), ["10001", "10002", "10003"]);
  const productSpend = products.reduce((sum, row) => sum + Number(row.metrics.spendCents), 0);
  assert.equal(result.totals.spendCents, productSpend + 3984);
  assert.equal(new Set(result.rows.map((row) => row.sourceRowKey)).size, 4);
});

test("a single store-level row is not imported as product 355577887", async () => {
  const input = directReport([...productOnlyRows, promoRow("direct-1", "355577887", "店铺", "店铺首页", { spend: 35.21 })]);
  const result = await inspectTmallImportBytes(input);
  assert.deepEqual(result.errors, []);
  const store = result.rows.find((row) => row.raw["主体类型"] === "店铺")!;
  assert.equal(store.spuId, "店铺:355577887");
  assert.equal(result.rows.filter((row) => row.spuId === "355577887").length, 0);
  assert.equal(result.totals.uniqueProductCount, 3);
  assert.equal(result.totals.rowCount, 4);
});

test("a store subject sharing its numeric ID with a product keeps separate row identities", async () => {
  const input = directReport([
    promoRow("a", "355577887", "商品", "同号商品", { spend: 5 }),
    promoRow("direct", "355577887", "店铺", "店铺首页", { spend: 7 }),
  ]);
  const result = await inspectTmallImportBytes(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.spuId).sort(), ["355577887", "店铺:355577887"]);
  assert.equal(new Set(result.rows.map((row) => row.sourceRowKey)).size, 2);
  assert.equal(result.rows.find((row) => row.spuId === "355577887")!.metrics.spendCents, 500);
  assert.equal(result.rows.find((row) => row.spuId === "店铺:355577887")!.metrics.spendCents, 700);
});

test("unknown non-product subject types are still rejected, alone or merged", async () => {
  const rows = [...productOnlyRows, promoRow("x", "999", "品牌", "品牌专区")];
  const single = await inspectTmallImportBytes(directReport(rows));
  assert.ok(single.errors.some((issue) => issue.code === "UNSUPPORTED_SUBJECT_TYPE"));
  const prepared = await prepareNormalizedNetshopImport(directReport(rows));
  assert.equal(prepared.disposition, "rejected");
  const row = (type: string, id: string) => ({ rowNumber: 2, raw: { "日期": "2026-09-05", "主体ID": id, "主体类型": type, "主体名称": type, "花费": 1 } });
  // The reserved message stays for genuinely unrecognised subjects.
  assert.throws(() => prepareTmallPromotionRows([row("商品", "10001"), row("品牌", "10001")]), /非商品主体/);
  assert.throws(() => prepareTmallPromotionRows([row("品牌", "10001"), row("品牌", "10001")]), /非商品主体/);
});

test("store rows are never merged with product rows and need a numeric store ID to merge", () => {
  const row = (type: string, id: string, n: number) => ({ rowNumber: n, raw: { "日期": "2026-09-05", "主体ID": id, "主体类型": type, "主体名称": type, "花费": 1 } });
  assert.equal(prepareTmallPromotionRows([row("商品", "10001", 2), row("店铺", "10001", 3)]).length, 2);
  assert.throws(() => prepareTmallPromotionRows([row("店铺", "", 2), row("店铺", "", 3)]), /有效商品 ID/);
});

test("parser totals disclose store-level spend only when store rows exist", async () => {
  const withStore = await prepareNormalizedNetshopImport(directReport(mixedRows));
  assert.equal(withStore.disposition, "prepared");
  assert.equal(withStore.parserTotals?.storeLevelRowCount, 1);
  assert.equal(withStore.parserTotals?.storeLevelSpendCents, 3984);
  assert.equal(withStore.parserTotals?.uniqueProductCount, 3);
  const without = await prepareNormalizedNetshopImport(directReport(productOnlyRows));
  assert.equal(without.disposition, "prepared");
  assert.equal(Object.hasOwn(without.parserTotals ?? {}, "storeLevelRowCount"), false);
});

// Digests captured by running the unmodified (2321b923) normalized-import.ts and this branch on the
// same input; they were identical. Files without store-level rows must keep rows, errors, totals,
// the normalized payload and the business-content rows (the import fingerprint input) byte for byte.
const GOLDEN = {
  productOnly: {
    inspectRows: "bb80cdca6c644a3082767414360dba3ee4edfecf0f7e2b3c31d6ac76a07c8104",
    inspectTotals: "be8a153c2862eb49f233dd040e6f1ffa83c88dd04750410b3e5f2679c8eb6cda",
    inspectErrors: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preparedPayload: "dc08b1c8218f4e4ea71be1aaeb7df3a59f6f54001099c5638b7de4a553225fa7",
    contentRows: "09f55ba791aaf22d3e3fbf7737f05c8f27fffb1e945179c730c64df3d6d142d0",
  },
  dated: {
    inspectRows: "09bde74c7f6525b28c91398bc75d6b264846846099d9da58bb4b7315f419e65c",
    inspectTotals: "48d68286823330a35f529ee92d055e394eec74db007ca54d81797e56bb3e3de3",
    inspectErrors: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preparedPayload: "c77ce79436193b96f50d02dffa6ac09db409ac69bdf0ddfab2c48cdd2b2db0e7",
    contentRows: "fac71c10e67a2a571b94c1fd64b09c86eb108412cbf2dfb5adbfbee3833b465a",
  },
} as const;

for (const [name, make] of [["productOnly", () => directReport(productOnlyRows)], ["dated", datedProductReport]] as const) {
  test(`files without store-level rows are byte-identical to the pre-change importer (${name})`, async () => {
    const input = make();
    const inspected = await inspectTmallImportBytes(input);
    const prepared = await prepareNormalizedNetshopImport(input);
    assert.deepEqual({
      inspectRows: digest(inspected.rows), inspectTotals: digest(inspected.totals), inspectErrors: digest(inspected.errors),
      preparedPayload: digest(prepared), contentRows: digest(netshopBusinessContentRows(inspected.rows)),
    }, GOLDEN[name]);
  });
}
