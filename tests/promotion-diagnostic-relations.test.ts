import assert from "node:assert/strict";
import test from "node:test";
import { appendPromotionRelations, linksForPromotionTarget, type DiagnosticWithRelations } from "../lib/jd/promotion-diagnostic-relations";
import { promotionSourceIdentityReady } from "../lib/jd/promotion-diagnostic-identity";
import { buildPromotionDiagnosticReport } from "../lib/jd/promotion-diagnostic-report";

const metrics = { spendCents: 1000, impressions: 100, clicks: 20, reportedOrderLines: 2, reportedGmvCents: 8000 };
const group = (key: string, more: Record<string, string | null> = {}) => ({ key, rowCount: 1, metrics, ...more });

function source(): DiagnosticWithRelations {
  return {
    schemaVersion: "jd-promotion-diagnostic-v1", identity: { platform: "京东", shopName: "志高商用设备旗舰店" },
    period: { startDate: "2026-09-20", endDate: "2026-09-20" }, sourceRevision: "1:abc",
    coverage: { requestedDates: ["2026-09-20"], presentDates: ["2026-09-20"], missingDates: [], complete: true, rowCount: 1, aggregateReconciled: true },
    metricAvailability: Object.fromEntries(Object.keys(metrics).map((key) => [key, { presentRows: 1, totalRows: 1, complete: true }])) as DiagnosticWithRelations["metricAvailability"],
    sourceBatches: [{ date: "2026-09-20", batchIds: ["batch"], accountNicknames: ["account"], accountPresentRows: 1, rowCount: 1, aggregateBatchId: "batch" }],
    summary: metrics, daily: [{ date: "2026-09-20", rowCount: 1, metrics }], limitations: [],
    groups: {
      plans: [group('["P1"]', { planId: "P1", name: "计划" })],
      products: [group('["SKU1"]', { skuId: "SKU1", name: "商品" })],
      keywords: [group('["词"]', { keyword: "词", name: "词" })],
      searchTerms: [group('["搜索词"]', { searchTerm: "搜索词", name: "搜索词" })],
      keywordSku: [group('["词","SKU1"]', { keyword: "词", skuId: "SKU1" })],
      searchTermSku: [group('["搜索词","SKU1"]', { searchTerm: "搜索词", skuId: "SKU1" })],
      planSku: [group('[["P1"],"SKU1"]', { planKey: '["P1"]', planId: "P1", skuId: "SKU1" })],
      planKeyword: [group('[["P1"],"词"]', { planKey: '["P1"]', planId: "P1", keyword: "词" })],
    },
  };
}

test("source-row relationships produce three complete, filterable evidence tables", () => {
  const current = source();
  const report = appendPromotionRelations(buildPromotionDiagnosticReport(current), current);
  assert.deepEqual(report.tables.slice(6, 10).map((table) => table.key), ["keywordSku", "planSku", "planKeyword", "searchTermSku"]);
  assert.equal(report.tables.find((table) => table.key === "planSku")?.rows[0]?.[0], '["P1"]');
  assert.equal(report.tables.find((table) => table.key === "searchTermSku")?.rows[0]?.[0], "搜索词");
  assert.deepEqual(linksForPromotionTarget(current, "plans", '["P1"]').map((link) => link.tableKey), ["planSku", "planKeyword"]);
  assert.deepEqual(linksForPromotionTarget(current, "products", '["SKU1"]').map((link) => link.tableKey), ["keywordSku", "searchTermSku"]);
  assert.deepEqual(linksForPromotionTarget(current, "searchTerms", '["搜索词"]').map((link) => link.tableKey), ["searchTermSku"]);
});

test("a missing or fabricated relationship is rejected, not silently omitted", () => {
  const current = source();
  current.groups.planSku[0]!.planKey = '["other"]';
  assert.throws(() => appendPromotionRelations(buildPromotionDiagnosticReport(current), current), /不存在的计划/);
  const incomplete = source();
  incomplete.groups.searchTermSku = [];
  assert.throws(() => appendPromotionRelations(buildPromotionDiagnosticReport(incomplete), incomplete), /未与来源行对平/);
});

test("unmapped source account nickname blocks the model branch despite complete metrics", () => {
  const current = source();
  assert.equal(promotionSourceIdentityReady(current), false);
  current.sourceBatches[0]!.accountNicknames = ["志高亿用-总监"];
  assert.equal(promotionSourceIdentityReady(current), false); // Page label alone is not a verified source alias.
  current.sourceBatches[0]!.accountNicknames = [];
  assert.equal(promotionSourceIdentityReady(current), false);
});
