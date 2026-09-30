import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { decodeProductsUiState, defaultProductsUiState, productsUiStorageKey, safeProductImageUrl, safeProductUrl } from "../app/netshop/products/ui-state";
import type { MetricValue } from "../lib/netshop/insights-contract";

// CSS is still consumed by the real browser harness; Node server rendering
// verifies text/state semantics without treating the stylesheet as JavaScript.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context); }')}`, import.meta.url);
const { CompareCell, MetricCell, ProductPicture } = await import("../app/netshop/products/ProductsPrimitives");
const { productsQuery } = await import("../app/netshop/products/ProductsRead");
const { checkCatalog } = await import("../app/netshop/products/ProductsCatalog");
import { validateProductQuery } from "../app/netshop/products/contract";

test("presentation settings preserve columns and sort without retaining results or API tokens", () => {
  const value = decodeProductsUiState(JSON.stringify({ sort: "decline_desc", columns: { traffic: false, comparison: false, association: true, coverage: true }, gallery: true, detailSource: "platform", topic: "growth" }));
  assert.deepEqual(value, { sort: "decline_desc", columns: { traffic: false, comparison: false, association: true, coverage: true }, gallery: true, detailSource: "platform", topic: "growth", catalogFilters: { status: "all", quality: "all", mapping: "all" } });
  assert.equal("snapshotToken" in value, false);
  assert.equal("data" in value, false);
});
test("preference enums never coerce arrays and unknown keys or malformed column objects default completely", () => {
  const variants = [
    { detailSource: ["erp"] }, { topic: ["growth"] }, { sort: ["decline_desc"] },
    { columns: [true, true, true, true] }, { columns: { ...defaultProductsUiState.columns, traffic: "true" } },
    { columns: { ...defaultProductsUiState.columns, sql: true } }, { snapshotToken: "old" }, { data: [{ payment: 100 }] },
  ];
  for (const invalid of variants) assert.deepEqual(decodeProductsUiState(JSON.stringify({ ...defaultProductsUiState, ...invalid })), defaultProductsUiState);
});
test("invalid and oversized local presentation state falls back safely", () => {
  for (const raw of ["null", "[]", "{", "x".repeat(1501)]) assert.equal(decodeProductsUiState(raw).sort, "payment_desc");
  const value = decodeProductsUiState('{"sort":"sql", "columns":{"traffic":"false"}, "topic":"bad"}');
  assert.equal(value.sort, "payment_desc"); assert.equal(value.columns.traffic, true); assert.equal(value.topic, "home");
});
test("settings are isolated by account, exact shop, period and dimension", () => {
  const context = { ...defaultShopLocationContext, platforms: ["京东" as const], outlets: ["京东\u001f店A"] };
  const key = productsUiStorageKey(context, "2026-09-01", "2026-09-30", "user-a");
  assert.notEqual(key, productsUiStorageKey(context, "2026-09-01", "2026-09-30", "user-b"));
  assert.notEqual(key, productsUiStorageKey({ ...context, outlets: ["京东\u001f店B"] }, "2026-09-01", "2026-09-30", "user-a"));
  assert.notEqual(key, productsUiStorageKey({ ...context, dimension: "sku" }, "2026-09-01", "2026-09-30", "user-a"));
  assert.notEqual(key, productsUiStorageKey(context, "2026-08-01", "2026-08-30", "user-a"));
  assert.notEqual(key, productsUiStorageKey(context, "2026-09-01", "2026-09-30", "user-a", "rolling"));
  assert.equal(key, productsUiStorageKey({ ...context, q: "search", page: 3, product: { platform: "京东", shopName: "店A", dimension: "spu", id: "1" } }, "2026-09-01", "2026-09-30", "user-a"));
});
test("product links reject scripts, inline data and credential-bearing URLs", () => {
  for (const raw of ["javascript:alert(1)", "data:image/png;base64,x", "//example.com/x", "https://user:pass@example.com/x", "/relative", ""]) assert.equal(safeProductUrl(raw), null);
  assert.equal(safeProductUrl("https://example.com/product?id=1"), "https://example.com/product?id=1");
});
test("existing authenticated Tmall image paths are preserved with exact hash validation", () => {
  const path = `/api/netshop/product-images/${"a".repeat(64)}`;
  assert.equal(safeProductImageUrl(path), path);
  for (const input of ["/api/netshop/product-images/not-a-hash", `${path}?url=https://other.invalid`, `/api/netshop/product-images/../${"a".repeat(64)}`, "//other.invalid/picture", "/relative.png"]) assert.equal(safeProductImageUrl(input), null);
  const html = renderToStaticMarkup(React.createElement(ProductPicture, { title: "天猫主图", url: path }));
  assert.match(html, new RegExp(`src="${path}"`)); assert.doesNotMatch(html, /缺少主图/);
});
const available: MetricValue = { value: 0, unit: "CNY_CENT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["platform"], aggregation: "sum", coverageRef: "platform:current" };
test("a proven zero renders zero yuan; missing fields and mappings render separate reasons", () => {
  const zero = renderToStaticMarkup(React.createElement(MetricCell, { metric: available }));
  assert.match(zero, /0\.00 元/); assert.doesNotMatch(zero, /缺少/);
  for (const [reason, text] of [["missing_field", "来源缺少字段"], ["missing_day", "缺少日期"], ["unmapped", "未关联"]] as const) {
    const html = renderToStaticMarkup(React.createElement(MetricCell, { metric: { ...available, value: null, status: "unavailable", reasonCode: reason } }));
    assert.match(html, new RegExp(text)); assert.match(html, /—/); assert.doesNotMatch(html, /0 元/);
  }
});
test("comparisons consume server percentage points and preserve zero/negative/missing baseline reasons", () => {
  const pp = renderToStaticMarkup(React.createElement(CompareCell, { comparison: { value: 1.5, method: "percentage_points", status: "available", reasonCode: null } }));
  assert.match(pp, /\+1.50 个百分点/); assert.doesNotMatch(pp, /150.00/);
  for (const [reason, text] of [["zero_denominator", "分母为零"], ["negative_baseline", "基期为负"], ["incomplete_baseline", "基期覆盖不足"]] as const) {
    const html = renderToStaticMarkup(React.createElement(CompareCell, { comparison: { value: null, method: "relative_change", status: "unavailable", reasonCode: reason } }));
    assert.match(html, new RegExp(text)); assert.doesNotMatch(html, /Infinity|NaN|新增/);
  }
});
test("missing images do not invent a product photograph", () => {
  const html = renderToStaticMarkup(React.createElement(ProductPicture, { title: "<script>", url: null, link: "javascript:alert(1)" }));
  assert.match(html, /缺少主图/); assert.doesNotMatch(html, /<img|<a|<script>/);
});
test("detail query normalizes to exactly the selected product platform/shop/dimension", () => {
  const context = { ...defaultShopLocationContext, platforms: ["京东", "天猫"] as ("京东" | "天猫")[], outlets: ["京东\u001f店A", "天猫\u001f店A"], product: { platform: "京东" as const, shopName: "店A", dimension: "sku" as const, id: "SKU1" }, page: 3, q: "SKU1" };
  const query = productsQuery({ context, startDate: "2026-09-01", endDate: "2026-09-01", periodKind: "custom" }, "payment_desc", { section: "daily", source: "erp", page: 1 });
  assert.deepEqual(query.getAll("platform"), ["京东"]);
  assert.deepEqual(query.getAll("outlet"), ["京东\u001f店A"]);
  assert.equal(query.get("dimension"), "sku"); assert.equal(query.get("source"), "erp"); assert.equal(query.get("q"), "SKU1");
  assert.doesNotThrow(() => validateProductQuery(query, true));
});
test("empty global platform selection explicitly requests the two permitted platforms", () => {
  const query = productsQuery({ context: defaultShopLocationContext, startDate: "2026-09-01", endDate: "2026-09-01", periodKind: "custom" }, "payment_desc");
  assert.deepEqual(query.getAll("platform"), ["京东", "天猫"]);
  assert.doesNotThrow(() => validateProductQuery(query));
});
test("old catalog rejects null rows/shops, string match flags and nonfinite rates without TypeError", () => {
  const query = new URLSearchParams({ page: "1", pageSize: "20", platform: "京东", outlet: "京东\u001f店A" });
  const item = { platform: "京东", shopName: "店A", spuId: "P1", skuId: "S1", saleAttribute: "", productCode: "", productName: "商品", imageUrl: "", category: "", brand: "", status: "", productUrl: "", createdAt: "2026-09-01", snapshotDate: "2026-09-01", priceCents: 0, costPriceCents: null, netSalesCents: null, totalInventory: 0, availableInventory: 0, salesMatched: false, grossMarginRate: null, refundRate: null };
  const fixture = () => ({ snapshotToken: "a".repeat(64), items: [{ ...item }], shops: [{ platform: "京东", shopName: "店A", snapshotDate: "2026-09-01", completedAt: "2026-09-01" }], summary: { totalSkus: 1, onSaleSkus: 0, totalInventory: 0, availableInventory: 0 }, batch: null, sales: { periodStart: null, periodEnd: null, dataCutoffDate: null, platform: "京东" }, pagination: { page: 1, pageSize: 20, total: 1, returned: 1, truncated: false } });
  assert.doesNotThrow(() => checkCatalog(fixture(), query));
  for (const mutate of [(data: unknown) => { (data as { items: unknown[] }).items = [null]; }, (data: unknown) => { (data as { shops: unknown[] }).shops = [null]; }, (data: unknown) => { (data as { items: Array<Record<string, unknown>> }).items[0].salesMatched = "false"; }, (data: unknown) => { (data as { items: Array<Record<string, unknown>> }).items[0].grossMarginRate = Infinity; }]) {
    const data = fixture(); mutate(data);
    assert.throws(() => checkCatalog(data, query), error => error instanceof Error && !(error instanceof TypeError));
  }
  const negative = fixture(); negative.items[0].grossMarginRate = -1.5 as never; negative.items[0].refundRate = 2.5 as never;
  assert.equal(checkCatalog(negative, query).items[0].grossMarginRate, -1.5);
});
