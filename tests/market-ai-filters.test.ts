import assert from "node:assert/strict";
import test from "node:test";
import { marketAiFilters } from "../lib/market/ai-tools";

test("market AI's registered singular inputs reach the Django array filters", () => {
  assert.deepEqual(marketAiFilters({
    category: "商用切菜机", scope: "成交榜", rankingDimension: "SKU",
    operationMode: "POP", brand: "测试品牌", subcategory: "切菜机",
    startDate: "2026-08-01", endDate: "2026-08-31", query: "切菜",
  }), {
    categories: ["商用切菜机"], scopes: ["成交榜"], rankingDimensions: ["SKU"],
    operationModes: ["POP"], brands: ["测试品牌"], subcategories: ["切菜机"],
    startDate: "2026-08-01", endDate: "2026-08-31", query: "切菜", priceBands: [],
  });
});

test("market AI keeps explicit legacy array filters and deduplicates equal values", () => {
  const filters = marketAiFilters({categories: ["A", "B", "A"], scopes: ["榜单"], rankingDimensions: ["SPU"]});
  assert.deepEqual(filters.categories, ["A", "B"]);
  assert.deepEqual(filters.scopes, ["榜单"]);
  assert.deepEqual(filters.rankingDimensions, ["SPU"]);
  assert.deepEqual(marketAiFilters({category: "A", categories: ["A"]}).categories, ["A"]);
});

test("market AI never widens conflicting, invalid or over-limit filters", () => {
  for (const input of [
    {category: "A", categories: ["B"]}, {category: "A", categories: ["A", "B"]},
    {category: 1}, {rankingDimension: ["SKU"]}, {scope: "x".repeat(201)},
    {categories: Array.from({length: 51}, (_, index) => String(index))},
  ]) assert.throws(() => marketAiFilters(input));
  assert.deepEqual(marketAiFilters({category: "  A  "}).categories, ["A"]);
  assert.deepEqual(marketAiFilters({}).categories, []);
});
