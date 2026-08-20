import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  normalizeProductSummarySelections,
  normalizeProductSummaryPagination,
  parseProductSummaryPaginationParameter,
  resolveProductSummaryPeriod,
} from "../lib/products/query-contract";
import {
  calculateInventoryCostValuation,
  classifyInventoryAge,
  normalizeInventorySelections,
  normalizeInventoryPagination,
  parseInventoryPaginationParameter,
} from "../lib/inventory/query-contract";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("product summary pagination and actual period are bounded", () => {
  for (const options of [
    { page: -10 }, { page: 1.5 }, { page: Number.POSITIVE_INFINITY }, { page: 10_001 },
    { pageSize: 0 }, { pageSize: 1.5 }, { pageSize: 101 }, { pageSize: Number.POSITIVE_INFINITY },
  ]) assert.throws(() => normalizeProductSummaryPagination(options), /page|pageSize/);
  for (const raw of ["1e2", "+1", "1.5", "0", "101", "Infinity"]) {
    assert.throws(() => parseProductSummaryPaginationParameter(raw, "pageSize"), /pageSize/);
  }
  assert.deepEqual(normalizeProductSummaryPagination({ page: 3, pageSize: 25 }), {
    page: 3,
    pageSize: 25,
    offset: 50,
  });
  assert.throws(
    () => normalizeProductSummarySelections(["below35", "typo"], {
      maximum: 5,
      allowed: ["below35", "35to40"],
      label: "毛利率",
    }),
    /允许清单/,
  );
  assert.throws(
    () => normalizeProductSummarySelections(Array.from({ length: 11 }, (_, index) => `类目${index}`), {
      maximum: 10,
      label: "类目",
    }),
    /数量或长度/,
  );
  assert.deepEqual(resolveProductSummaryPeriod(
    { startDate: "2026-01-01", endDate: "2026-08-18" },
    { range: "custom", startDate: "2026-08-01", endDate: "2026-08-20" },
  ), {
    range: "custom",
    requestedStartDate: "2026-08-01",
    requestedEndDate: "2026-08-20",
    startDate: "2026-08-01",
    endDate: "2026-08-18",
  });
  assert.throws(
    () => resolveProductSummaryPeriod(
      { startDate: "2024-01-01", endDate: "2026-08-18" },
      { range: "custom", startDate: "2024-01-01", endDate: "2026-08-18" },
    ),
    /最多支持 730 天/,
  );
});

test("inventory pagination and partial cost coverage remain honest", () => {
  for (const options of [
    { page: -1 }, { page: 0 }, { page: 1.5 }, { page: Number.POSITIVE_INFINITY }, { page: 10_001 },
    { pageSize: 0 }, { pageSize: 1.5 }, { pageSize: 101 }, { pageSize: Number.POSITIVE_INFINITY },
  ]) assert.throws(() => normalizeInventoryPagination(options), /page|pageSize/);
  for (const raw of ["1e2", "+1", "1.5", "0", "101", "Infinity"]) {
    assert.throws(() => parseInventoryPaginationParameter(raw, "pageSize"), /pageSize/);
  }
  assert.deepEqual(calculateInventoryCostValuation({
    availableQuantity: 100,
    importedValueCents: 1_000,
    importedPricedQuantity: 1,
    fallbackUnitCostCents: 0,
  }), {
    coveredQuantity: 1,
    coverageRate: 0.01,
    knownStockValueCents: 1_000,
    completeStockValueCents: null,
    unitCostCents: 1_000,
  });
  assert.throws(
    () => normalizeInventorySelections(["healthy", "unknown"], {
      maximum: 5,
      allowed: ["healthy", "aged", "slow", "stagnant", "no_stock"],
      label: "库龄状态",
    }),
    /允许清单/,
  );
  assert.throws(
    () => normalizeInventorySelections(Array.from({ length: 11 }, (_, index) => `仓库${index}`), {
      maximum: 10,
      label: "仓库",
    }),
    /数量或长度/,
  );
  assert.deepEqual(calculateInventoryCostValuation({
    availableQuantity: 100,
    importedValueCents: 1_000,
    importedPricedQuantity: 1,
    fallbackUnitCostCents: 50,
  }), {
    coveredQuantity: 100,
    coverageRate: 1,
    knownStockValueCents: 5_950,
    completeStockValueCents: 5_950,
    unitCostCents: 60,
  });
});

test("missing row-level age sales never becomes zero sales", () => {
  assert.equal(classifyInventoryAge({
    availableQuantity: 10,
    inventoryAgeDays: 120,
    sales30dQuantity: null,
  }).status, "aged");
  assert.equal(classifyInventoryAge({
    availableQuantity: 10,
    inventoryAgeDays: 120,
    sales30dQuantity: 0,
  }).status, "stagnant");
});

test("product and inventory APIs expose real page contracts", async () => {
  const [product, productRoute, inventory, age, erpDatabase, plans] = await Promise.all([
    source("../lib/products/summary.ts"),
    source("../app/api/products/summary/route.ts"),
    source("../lib/inventory/overview.ts"),
    source("../lib/inventory/age-analysis.ts"),
    source("../lib/erp-reference/database.ts"),
    source("../lib/inventory/database.ts"),
  ]);
  assert.match(product, /LIMIT \? OFFSET \?/);
  assert.match(product, /pagination:/);
  assert.match(product, /categoryFacetCte/);
  assert.match(product, /known_stock_value_cents/);
  assert.match(product, /priced_available_quantity/);
  assert.match(product, /st\.available_quantity <= st\.priced_available_quantity/);
  assert.match(productRoute, /searchParams\.get\("page"\)/);
  assert.match(productRoute, /searchParams\.get\("pageSize"\)/);
  assert.match(productRoute, /parseProductSummaryPaginationParameter/);
  assert.match(productRoute, /searchParams\.get\("q"\)/);
  assert.match(inventory, /LIMIT \? OFFSET \?/);
  assert.match(inventory, /returned:/);
  assert.match(inventory, /stockValueComplete/);
  assert.match(age, /findLatestCompletedErpReferenceBatch/);
  assert.match(erpDatabase, /status = 'completed'/);
  assert.match(age, /LIMIT \? OFFSET \?/);
  assert.match(plans, /total:/);
  assert.match(plans, /includeCancelled/);
});

test("replenishment, AI and frontend do not reuse truncated pages", async () => {
  const [route, ai, page] = await Promise.all([
    source("../app/api/inventory/replenishment/route.ts"),
    source("../lib/ai/operations-tools.ts"),
    source("../app/page.tsx"),
  ]);
  assert.match(route, /exactKey: body\.key/);
  assert.match(route, /startDate: body\.startDate/);
  assert.doesNotMatch(ai, /const overview = await getInventoryOverview\(db\);[\s\S]*?overview\.items\.filter/);
  assert.match(page, /useState\(shanghaiIsoToday\)/);
  assert.match(page, /currentUser\?\.role === "admin"/);
  assert.match(page, /overviewGenerationRef/);
  assert.match(page, /productSummaryGenerationRef/);
  assert.match(page, /已覆盖库存货值/);
  assert.match(page, /成本缺口/);
  assert.match(page, /stockValueComplete/);
  assert.doesNotMatch(page, /filtered\.slice\(0, 300\)/);
  assert.doesNotMatch(page, /filteredItems\.slice\(0, 300\)/);
  assert.doesNotMatch(page, /cleanupItems\.slice\(/);
});

test("netshop requests reject late filter responses", async () => {
  const page = await source("../app/page.tsx");
  for (const gate of [
    "productPerformanceGenerationRef",
    "skuCatalogGenerationRef",
    "promotionGenerationRef",
  ]) {
    assert.match(page, new RegExp(`${gate}\\.current`));
  }
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /generation === productPerformanceGenerationRef\.current/);
  assert.match(page, /generation === skuCatalogGenerationRef\.current/);
  assert.match(page, /generation === promotionGenerationRef\.current/);
});

test("page consumes customer and finance bounded detail, pagination and CAS contracts", async () => {
  const page = await source("../app/page.tsx");
  assert.match(page, /listControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /listGenerationRef\.current === generation/);
  assert.match(page, /listRequestKeyRef\.current === requestKey/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /customer-service\/conversations\?id=\$\{id\}/);
  assert.match(page, /detailGenerationRef/);
  assert.match(page, /messageTotalCount/);
  assert.match(page, /messagesTruncated/);
  assert.match(page, /expectedVersion: item\.version/);
  assert.match(page, /payload\.incomplete === true/);
  assert.match(page, /冲突 \$\{conflictCount\}、失败 \$\{failedCount\}/);
  assert.match(page, /finance\/targets\?page=\$\{targetPage\}&pageSize=100/);
  assert.match(page, /targetRequestGenerationRef/);
  assert.match(page, /expectedVersion: form\.id \? form\.expectedVersion/);
  assert.match(page, /const query = new URLSearchParams\(\{[\s\S]*?expectedVersion: String\(item\.version\),[\s\S]*?reason: reasonResult\.reason,/);
  assert.match(page, /finance\/targets\?\$\{query\.toString\(\)\}/);
  assert.match(page, /targetPagination\.truncated/);
  assert.match(page, /data\.selection\?\.truncated/);
});

test("customer detail uses the shared dialog and saves both draft fields through one CAS", async () => {
  const page = await source("../app/page.tsx");
  assert.match(page, /import Dialog from "\.\/ui\/dialog"/);
  assert.match(page, /dialogId="customer-service-conversation-detail"/);
  assert.match(page, /initialFocusRef=\{customerDialogCloseRef\}/);
  assert.match(page, /if \(selected && busyId === selected\.id\) return/);
  assert.match(page, /expectedVersion: item\.version,[\s\S]*?serviceIssues: draft\.serviceIssues,[\s\S]*?summaryText: draft\.summaryText/);
  assert.match(page, /服务端版本已刷新，你的两项草稿均已保留/);
  assert.match(page, /"保存详情标注"/);
  assert.doesNotMatch(page, /\{selected && <div className="modal-backdrop"/);
  assert.doesNotMatch(page, /onBlur=\{\(\) => void saveAnnotation\(selected/);
});
