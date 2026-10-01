"use client";

import type { ReactNode } from "react";
import { formatMetric, formatDerivedMoneyPerCount, type MetricComparison } from "@/lib/netshop/insights-contract";
import { InsightMetric, InsightDerivedMoneyMetric, InsightComparison } from "../shared/components";
import type { ComparisonMetric, ComparisonMetricKey, ComparisonRow } from "./contract";

export const comparisonMetricLabels: Record<ComparisonMetricKey, string> = {
  payment: "平台成交金额", quantity: "商品成交销量", visitors: "商品日访客累计", customers: "商品日成交客户累计", conversion: "商品成交转化率", visitorValue: "商品访客价值", transactionOrders: "商品成交订单累计", spend: "推广花费", attributedPayment: "广告归因成交", roas: "ROAS（倍）", ctr: "广告点击率", cpc: "单次点击成本", spendRate: "整期推广费率", erpNetSales: "ERP 净销售", orderMargin: "订单毛利", largeMargin: "大毛利", erpOrderCount: "ERP 可信去重订单", averageOrderValue: "可信订单客单价", returnQuantity: "ERP 退货件数", returnRate: "ERP 退货件数率",
};
const reasonLabels: Record<string, string> = { no_records: "未导入记录", missing_day: "日期未覆盖", missing_field: "来源缺少字段", not_applicable: "当前来源不适用", unmapped: "身份或分类未关联", ambiguous_mapping: "关联不唯一", zero_denominator: "基准或分母为零", negative_denominator: "分母为负", incomplete_baseline: "两期覆盖不足", negative_baseline: "基期为负", unverified_source: "来源未核验", attribution_window_unknown: "归因窗口未核验", incomplete_coverage: "范围覆盖不足", no_comparable_date: "没有对应比较日", promotion_not_ready: "推广聚合未就绪", promotion_mismatch: "推广与原始来源不一致" };
export const comparisonReason = (reason: string | null | undefined) => reason ? reasonLabels[reason] ?? reason : "";
export const comparisonObjectLabel = (row: Pick<ComparisonRow, "platform" | "shopName">) => row.shopName ? `${row.platform} · ${row.shopName}` : row.platform;
export function ComparisonMetricCard({ label, metric }: { label: string; metric: ComparisonMetric }) { return metric.unit === "CNY_CENT_PER_COUNT" ? <InsightDerivedMoneyMetric label={label} metric={metric} /> : <InsightMetric label={label} metric={metric} />; }
export function ComparisonMetricCell({ metric }: { metric: ComparisonMetric }) {
  return <span className="nc-metric-cell" data-status={metric.status} title={comparisonReason(metric.reasonCode)}>{metric.unit === "CNY_CENT_PER_COUNT" ? formatDerivedMoneyPerCount(metric) : formatMetric(metric)}{metric.status === "partial" && <small>已覆盖范围</small>}{metric.status !== "available" && metric.status !== "partial" && <small>{comparisonReason(metric.reasonCode)}</small>}</span>;
}
export function ComparisonChangeCell({ comparison }: { comparison: MetricComparison }) { return <span><InsightComparison value={comparison} />{comparison.status !== "available" && <small>{comparisonReason(comparison.reasonCode)}</small>}</span>; }
export function ComparisonQualification({ row }: { row: Pick<ComparisonRow, "qualification"> }) {
  const status = row.qualification.comparable ? "complete" : row.qualification.currentComplete || row.qualification.baselineComplete ? "partial" : "unavailable";
  return <span className="nc-pill" data-coverage={status}>{status === "complete" ? "两期完整可比" : status === "partial" ? "部分覆盖" : "不可完整比较"}</span>;
}
export function ComparisonPanel({ number, title, note, tools, children, half = false }: { number: string; title: string; note?: string; tools?: ReactNode; children: ReactNode; half?: boolean }) {
  return <section className={`nc-card${half ? " nc-half" : ""}`} aria-label={`${number} ${title}`}><header className="nc-card-head"><div><h2><span className="nc-section-number">{number}</span>{title}</h2>{note && <p>{note}</p>}</div>{tools}</header>{children}</section>;
}
