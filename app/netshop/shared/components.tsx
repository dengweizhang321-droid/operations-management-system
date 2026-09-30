"use client";

import type { ReactNode } from "react";
import { decodeInsightPagination, formatMetric, type MetricValue, type MetricComparison, type SourceCoverage, type InsightPagination } from "@/lib/netshop/insights-contract";
import type { ReadStatus } from "./request-state";
import "./shared.css";

const reasons: Record<string, string> = {
  no_records: "未导入记录", missing_day: "日期未覆盖", missing_field: "来源缺少字段", not_applicable: "当前来源不适用", unmapped: "未关联", ambiguous_mapping: "关联不唯一", zero_denominator: "分母为零", negative_denominator: "分母为负", incomplete_baseline: "两期覆盖不足", negative_baseline: "基期为负", unverified_source: "来源未核验", attribution_window_unknown: "归因窗口未核验", unsafe_integer: "数值超出安全范围", incomplete_coverage: "范围覆盖不足", no_comparable_date: "没有一一对应比较日", promotion_not_ready: "推广聚合未就绪", promotion_mismatch: "推广与原始来源不一致",
};
export function InsightFilterBar({ children, sticky = true, label = "经营范围筛选" }: { children: ReactNode; sticky?: boolean; label?: string }) {
  return <section className={`insights-filter-bar${sticky ? " insights-filter-bar-sticky" : ""}`} aria-label={label}>{children}</section>;
}
export function InsightMetric({ label, metric }: { label: string; metric: MetricValue }) {
  return <div className="insights-metric" data-status={metric.status}><span>{label}</span><strong>{formatMetric(metric)}</strong>{metric.status !== "available" && <small>{reasons[metric.reasonCode ?? ""] ?? metric.reasonCode}</small>}</div>;
}
export function InsightComparison({ value }: { value: MetricComparison }) {
  return <span className="insights-comparison" title={value.reasonCode ? reasons[value.reasonCode] ?? value.reasonCode : undefined}>{value.status === "available" && value.value !== null ? `${value.value > 0 ? "+" : ""}${(value.method === "percentage_points" ? value.value : value.value * 100).toFixed(2)}${value.method === "percentage_points" ? " 个百分点" : "%"}` : "—"}</span>;
}
export function InsightReadState({ status, error, onRetry }: { status: ReadStatus; error?: string; onRetry?: () => void }) {
  if (status === "ready") return null;
  const text = status === "loading" ? "正在读取当前范围…" : status === "empty" ? "当前范围没有记录" : status === "version_changed" ? "来源版本已变化，请重新读取" : "当前范围读取失败";
  return <section className={`panel data-state insights-read-state${status === "error" || status === "version_changed" ? " data-state-error" : ""}`} role={status === "error" || status === "version_changed" ? "alert" : "status"}><strong>{text}</strong>{error && <p>{error}</p>}{onRetry && status !== "loading" && <button type="button" className="secondary-button" onClick={onRetry}>重新读取</button>}</section>;
}
export function InsightSourceCoverage({ coverage, label }: { coverage: SourceCoverage; label: string }) {
  return <details className="insights-coverage"><summary>{label}：{coverage.coveredShopDatePairs}/{coverage.expectedShopDatePairs} 店日{coverage.complete ? "，完整" : "，覆盖不足"}</summary><ul>{coverage.missingByShop.map(shop => <li key={shop.shopKey}>{shop.shopKey.replace("\u001f", " · ")}：{shop.dates.join("、")}</li>)}</ul></details>;
}
export function InsightListPagination({ pagination, busy, onPage }: { pagination: InsightPagination; busy?: boolean; onPage: (page: number) => void }) {
  decodeInsightPagination(pagination);
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return <footer className="jd-sku-pagination insights-pagination" aria-label="列表分页"><span>第 {pagination.page}/{totalPages} 页，共 {pagination.total} 条</span><div><button type="button" className="row-action" disabled={busy || pagination.page <= 1} onClick={() => onPage(pagination.page-1)}>上一页</button><button type="button" className="row-action" disabled={busy || !pagination.hasMore} onClick={() => onPage(pagination.page+1)}>下一页</button></div></footer>;
}
