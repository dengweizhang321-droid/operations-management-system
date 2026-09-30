import test from "node:test";
import assert from "node:assert/strict";
import { validatePromotionQuery } from "../lib/netshop/promotion-insights-query";

const query = () => new URLSearchParams({ platform: "京东", startDate: "2026-09-01", endDate: "2026-09-30", periodKind: "month" });
test("promotion uses the frozen context calendar and one attributed platform", () => {
  const value = validatePromotionQuery(query());
  assert.equal(value.context.dimension, "sku"); assert.equal(value.pageSize, 20);
  const both = query(); both.append("platform", "天猫"); assert.throws(() => validatePromotionQuery(both));
});
test("details never accept an ID without an exact scoped shop", () => {
  const value = query(); value.set("objectId", "a".repeat(64));
  assert.throws(() => validatePromotionQuery(value, true));
  value.set("shopKey", "京东\u001fA店"); assert.throws(() => validatePromotionQuery(value, true));
  value.set("sectionToken", "b".repeat(64)); value.set("objectKind", "product");
  assert.equal(validatePromotionQuery(value, true).shopKey, "京东\u001fA店");
  value.append("outlet", "京东\u001fB店"); assert.throws(() => validatePromotionQuery(value, true));
});
test("detail keeps its original whole period instead of mixing an item focus", () => {
  const value = query(); value.set("objectId", "a".repeat(64)); value.set("shopKey", "京东\u001fA店");
  value.set("sectionToken", "b".repeat(64)); value.set("objectKind", "product"); value.set("focusDate", "2026-09-03");
  assert.throws(() => validatePromotionQuery(value, true));
});
test("object focus is bounded separately from the complete summary period", () => {
  const value = query(); value.set("objectStartDate", "2026-09-08"); value.set("objectEndDate", "2026-09-14");
  const parsed = validatePromotionQuery(value);
  assert.equal(parsed.context.window.startDate, "2026-09-01"); assert.equal(parsed.objectStartDate, "2026-09-08");
  value.set("focusDate", "2026-09-09"); assert.throws(() => validatePromotionQuery(value));
  value.delete("focusDate"); value.set("objectEndDate", "2026-10-01"); assert.throws(() => validatePromotionQuery(value));
});
test("promotion rejects unregistered taxonomy, arbitrary parameters and duplicate scalars", () => {
  for (const key of ["category", "principal", "sql", "url", "shop"]) {
    const value = query(); value.set(key, "unsafe"); assert.throws(() => validatePromotionQuery(value));
  }
  const duplicate = query(); duplicate.append("q", "a"); duplicate.append("q", "b"); assert.throws(() => validatePromotionQuery(duplicate));
});
test("new promotion budgets do not reduce the legacy endpoint budgets", () => {
  const oversized = query(); oversized.set("pageSize", "500"); assert.throws(() => validatePromotionQuery(oversized));
  const malformed = query(); malformed.set("q", "a\u0000b"); assert.throws(() => validatePromotionQuery(malformed));
  const wrongDimension = query(); wrongDimension.set("dimension", "spu"); assert.throws(() => validatePromotionQuery(wrongDimension));
});
test("P focus uses an exact canonical shared identity instead of a substring search", () => {
  const value = query(); value.set("productIdentity", JSON.stringify(["京东", "A店", "sku", "SKU-001"]));
  assert.deepEqual(validatePromotionQuery(value).productIdentity, { platform: "京东", shopName: "A店", dimension: "sku", id: "SKU-001" });
  value.set("q", "SKU"); assert.equal(validatePromotionQuery(value).productIdentity?.id, "SKU-001");
  value.set("objectKind", "plan"); assert.throws(() => validatePromotionQuery(value));
});
test("P focus cannot change platform, dimension, shop scope, or detail's exact shop", () => {
  for (const identity of [["京东", "A店", "spu", "SKU-001"], ["天猫", "A店", "spu", "SKU-001"], ["京东", " A店 ", "sku", "SKU-001"], ["京东", "A店", "sku", ""]]) {
    const value = query(); value.set("productIdentity", JSON.stringify(identity)); assert.throws(() => validatePromotionQuery(value));
  }
  const value = query(); value.set("productIdentity", JSON.stringify(["京东", "A店", "sku", "SKU-001"]));
  value.set("outlet", "京东\u001fB店"); assert.throws(() => validatePromotionQuery(value)); value.delete("outlet");
  value.set("objectKind", "product"); value.set("objectId", "a".repeat(64)); value.set("sectionToken", "b".repeat(64)); value.set("shopKey", "京东\u001fB店");
  assert.throws(() => validatePromotionQuery(value, true));
});
