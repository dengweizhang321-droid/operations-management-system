import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { readSalesSharedFilters } from "../app/sales-filter-bar";
import { updateModuleViewLocation } from "../app/shell/navigation-contract";

test("销售公共筛选从 URL 去重、去空并恢复所有跨页签维度", () => {
  const filters = readSalesSharedFilters("https://example.test/?module=sales&salesPlatform=%E4%BA%AC%E4%B8%9C&salesPlatform=%E4%BA%AC%E4%B8%9C&salesOutlet=%E4%BA%AC%E4%B8%9C%1F%E6%97%97%E8%88%B0%E5%BA%97&salesCategory=%E5%95%86%E7%94%A8%E5%87%80%E6%B0%B4&salesChannel=%E7%BA%BF%E4%B8%8A&salesProductQuery=SKU-1");

  assert.deepEqual(filters, {
    platforms: ["京东"],
    outletKeys: ["京东\u001f旗舰店"],
    categories: ["商用净水"],
    channels: ["线上"],
    productQuery: "SKU-1",
  });
});

test("销售 tab 切换保留公共筛选查询参数", () => {
  const next = updateModuleViewLocation(
    "/?module=sales&salesPlatform=%E4%BA%AC%E4%B8%9C&salesCategory=%E5%95%86%E7%94%A8%E5%87%80%E6%B0%B4",
    "sales",
    "category",
  );

  const url = new URL(next, "https://example.test");
  assert.equal(url.searchParams.get("view"), "category");
  assert.deepEqual(url.searchParams.getAll("salesPlatform"), ["京东"]);
  assert.deepEqual(url.searchParams.getAll("salesCategory"), ["商用净水"]);
});

test("销售各分析页由同一父级筛选状态驱动，品类页不再拥有公共 URL 字段", async () => {
  const [page, category] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sales-category-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<SalesFilterBar filters=\{filters\}/);
  assert.match(page, /SalesCategoryView[\s\S]*filters=\{filters\}[\s\S]*onFiltersChange=\{updateFilters\}/);
  assert.match(page, /FinanceAnalysisView[\s\S]*selectedPlatforms=\{filters\.platforms\}[\s\S]*selectedShopKeys=\{filters\.outletKeys\}/);
  assert.doesNotMatch(category.slice(category.indexOf("const categoryOwnedUrlKeys"), category.indexOf("] as const;")), /salesPlatform|salesOutlet|salesCategory"|salesProductQuery/);
});
