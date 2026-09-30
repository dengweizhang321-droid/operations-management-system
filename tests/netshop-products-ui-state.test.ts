import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { decodeProductsUiState, productsUiStorageKey, safeProductUrl } from "../app/netshop/products/ui-state";
import type { MetricValue } from "../lib/netshop/insights-contract";

// CSS is still consumed by the real browser harness; Node server rendering
// verifies text/state semantics without treating the stylesheet as JavaScript.
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context); } });
const { CompareCell, MetricCell, ProductPicture } = await import("../app/netshop/products/ProductsPrimitives");
const { productsQuery } = await import("../app/netshop/products/ProductsRead");
import { validateProductQuery } from "../app/netshop/products/contract";

test("presentation settings preserve columns and sort without retaining results or API tokens", () => {
  const value = decodeProductsUiState(JSON.stringify({ sort: "decline_desc", columns: { traffic: false, comparison: false }, gallery: true, topic: "growth", snapshotToken: "old", data: [{ payment: 100 }] }));
  assert.deepEqual(value, { sort: "decline_desc", columns: { traffic: false, comparison: false, association: true, coverage: true }, gallery: true, detailSource: "platform", topic: "growth" });
  assert.equal("snapshotToken" in value, false);
  assert.equal("data" in value, false);
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
const available: MetricValue = { value: 0, unit: "CNY_CENT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["platform"], aggregation: "sum", coverageRef: "platform:current" };
test("a proven zero renders zero yuan; missing fields and mappings render separate reasons", () => {
  const zero = renderToStaticMarkup(React.createElement(MetricCell, { metric: available }));
  assert.match(zero, /0 元/); assert.doesNotMatch(zero, /缺少/);
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
