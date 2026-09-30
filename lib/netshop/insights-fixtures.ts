/** Synthetic consumer fixtures only. Never mounted by a production page. */
import type { InsightsContext, MetricValue, SourceCoverage } from "./insights-contract";

export function syntheticInsightsContext(): InsightsContext {
  const current = { startDate: "2026-09-01", endDate: "2026-09-01", endExclusive: "2026-09-02", days: 1 };
  const previous = { startDate: "2026-08-31", endDate: "2026-08-31", endExclusive: "2026-09-01", days: 1 };
  const yearAgo = { startDate: "2025-09-01", endDate: "2025-09-01", endExclusive: "2025-09-02", days: 1 };
  const scope = { platforms: ["京东"] as ["京东"], shopKeys: ["京东\u001f合成店A"], dimension: "spu" as const, periodKind: "custom" as const };
  const coverageBySource: Record<string, SourceCoverage> = {};
  const capabilities: InsightsContext["capabilities"] = [];
  for (const sourceId of ["jd_sku_daily:spu_daily:京东", "jd_promotion:ad:京东"]) {
    for (const [period, w] of Object.entries({ current, previous, yearAgo }) as Array<["current" | "previous" | "yearAgo", typeof current]>) {
      const complete = sourceId.startsWith("jd_sku_daily") && period === "current";
      const coverageRef = `${sourceId}:${period}`;
      coverageBySource[coverageRef] = { expectedShopDatePairs: 1, coveredShopDatePairs: complete ? 1 : 0, complete, missingByShop: complete ? [] : [{ shopKey: scope.shopKeys[0], dates: [w.startDate] }], truncated: false };
      const fields = sourceId.includes("promotion") ? ["spend", "attributedPayment"] as const : ["payment", "visitors", "customers", "quantity", "addCartCustomers"] as const;
      fields.forEach(field => capabilities.push({ sourceId, period, field, coverageRef, presentShopDatePairs: complete ? 1 : 0, status: complete ? "available" : "unavailable", reasonCode: complete ? null : "no_records" }));
    }
  }
  return { schemaVersion: "netshop-insights-v1", requestId: "synthetic-foundation-context", scopeKey: "a".repeat(64), snapshotToken: "b".repeat(64), requestedScope: scope, effectiveScope: structuredClone(scope), periods: { timezone: "Asia/Shanghai", rule: "前一日", ruleVersion: "sales-period-v1", current, previous, yearAgo }, calendar: [{ date: current.startDate, previous: previous.startDate, yearAgo: yearAgo.startDate }], sourceRevisions: [{ domain: "netshop", kind: "owning_revision", scopeKey: "a".repeat(64), revision: "1:aaaaaaaaaaaa" }, { domain: "netshop", kind: "京东:promotionManifest", scopeKey: "a".repeat(64), revision: "absent" }, { domain: "netshop", kind: "京东:product:京东\u001f合成店A", scopeKey: "a".repeat(64), revision: "1" }, { domain: "netshop", kind: "京东:promotion:京东\u001f合成店A", scopeKey: "a".repeat(64), revision: "absent" }], coverageBySource, capabilities, freshness: [{ sourceId: "jd_sku_daily:spu_daily:京东", dataThrough: current.endDate }, { sourceId: "jd_promotion:ad:京东", dataThrough: null }], limitations: ["合成夹具；不是来源或生产验收", "人数为商品×日累计，不是去重客户"] };
}
export const syntheticMetrics: Record<string, MetricValue> = {
  trueZero: { value: 0, unit: "CNY_CENT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current" },
  missingField: { value: null, unit: "COUNT", status: "unavailable", reasonCode: "missing_field", basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current" },
  partial: { value: 100, unit: "CNY_CENT", status: "partial", reasonCode: "incomplete_coverage", basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum", coverageRef: "jd_sku_daily:spu_daily:京东:previous" },
  unmapped: { value: null, unit: "CNY_CENT", status: "unavailable", reasonCode: "unmapped", basis: "erp_net_sales", sourceIds: ["sales"], aggregation: "sum", coverageRef: "sales:unmapped" },
  invalid: { value: null, unit: "CNY_CENT", status: "invalid", reasonCode: "unsafe_integer", basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current" },
};
export const insightErrorFixtures = [
  { status: 400, body: { code: "invalid_request", error: "共享请求包含未知或重复参数" } },
  { status: 403, body: { code: "access_denied", error: "当前账号或数据权限已变化" } },
  { status: 409, body: { code: "insights_revision_changed", error: "参与来源版本持续变化，请重读" } },
  { status: 422, body: { code: "quality_incomplete", error: "共享来源响应超过2MiB，请缩小范围" } },
  { status: 503, body: { code: "source_not_ready", error: "共享来源读取超出预算" } },
] as const;
