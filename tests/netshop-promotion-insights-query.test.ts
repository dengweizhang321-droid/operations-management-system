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
