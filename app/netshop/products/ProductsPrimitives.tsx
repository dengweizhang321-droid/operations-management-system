"use client";

import { useState, type ReactNode } from "react";
import { formatMetric, formatDerivedMoneyPerCount, type DerivedMoneyPerCountV1, type MetricValue, type MetricComparison, type InsightPeriods } from "@/lib/netshop/insights-contract";
import { InsightMetric, InsightDerivedMoneyMetric, InsightComparison } from "../shared/components";
import { productReasonLabels, safeProductImageUrl, safeProductUrl } from "./ui-state";

export function ProductsPanel({ title, note, children, action }: { title: string; note?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="np-panel"><div className="np-panel-heading"><div><h2>{title}</h2>{note && <p className="np-caption">{note}</p>}</div>{action}</div>{children}</section>;
}
export function ProductsMetric({ label, metric, previous, yearAgo, showPrevious = true, showYearAgo = true }: { label: string; metric: MetricValue; previous?: MetricComparison; yearAgo?: MetricComparison; showPrevious?: boolean; showYearAgo?: boolean }) {
  return <article className="np-metric"><InsightMetric label={label} metric={metric} /><div className="np-metric-foot">{showPrevious && previous && <span>环比 <CompareCell comparison={previous} /></span>}{showYearAgo && yearAgo && <span>同比 <CompareCell comparison={yearAgo} /></span>}</div></article>;
}
export function MetricCell({ metric }: { metric: MetricValue }) {
  const formatted = formatMetric(metric);
  const display = metric.unit === "CNY_CENT" && metric.value !== null ? `${(metric.value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元` : formatted;
  return <span className="np-value" data-status={metric.status} title={metric.reasonCode ? productReasonLabels[metric.reasonCode] ?? metric.reasonCode : undefined}>{display}{metric.status !== "available" && <small>{productReasonLabels[metric.reasonCode ?? ""] ?? metric.reasonCode}</small>}</span>;
}
export function ProductsDerivedMetric({ label, metric, previous, yearAgo, showPrevious = true, showYearAgo = true }: { label: string; metric: DerivedMoneyPerCountV1; previous?: MetricComparison; yearAgo?: MetricComparison; showPrevious?: boolean; showYearAgo?: boolean }) {
  return <article className="np-metric"><InsightDerivedMoneyMetric label={label} metric={metric} /><div className="np-metric-foot">{showPrevious && previous && <span>环比 <CompareCell comparison={previous} /></span>}{showYearAgo && yearAgo && <span>同比 <CompareCell comparison={yearAgo} /></span>}</div></article>;
}
export function DerivedMoneyCell({ metric }: { metric: DerivedMoneyPerCountV1 }) {
  return <span className="np-value" data-status={metric.status}>{formatDerivedMoneyPerCount(metric)}{metric.reasonCode && <small>{productReasonLabels[metric.reasonCode] ?? metric.reasonCode}</small>}</span>;
}
export function CompareCell({ comparison }: { comparison: MetricComparison }) {
  return <span className={comparison.value === null ? "np-comparison" : comparison.value > 0 ? "np-comparison np-up" : comparison.value < 0 ? "np-comparison np-down" : "np-comparison"}><InsightComparison value={comparison} />{comparison.reasonCode && <small>{productReasonLabels[comparison.reasonCode] ?? comparison.reasonCode}</small>}</span>;
}
export function ProductPicture({ url, title, link, large = false, imageStatus }: { url: string | null; title: string; link?: string | null; large?: boolean; imageStatus?: "available" | "missing" | "unverified" }) {
  const safeImage = safeProductImageUrl(url), safeLink = safeProductUrl(link);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const content = <span className={`np-thumb${large ? " np-big" : ""}`}>{safeImage && imageStatus !== "unverified" && failedUrl !== safeImage ? <img src={safeImage} alt={`${title}主图`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(safeImage)} /> : <span className="np-empty-image">{imageStatus === "unverified" ? "图片身份未核验" : safeImage ? "图片读取失败" : "缺少主图"}</span>}</span>;
  return safeLink ? <a href={safeLink} target="_blank" rel="noreferrer" aria-label={`${title}平台商品链接`}>{content}</a> : content;
}
export function PeriodContext({ periods, previous, yearAgo, dimension }: { periods: InsightPeriods; previous: boolean; yearAgo: boolean; dimension: "sku" | "spu" }) {
  return <div className="np-context"><span><strong>本期</strong> {periods.current.startDate} — {periods.current.endDate}</span>{previous && <span><strong>环比基期</strong> {periods.previous.startDate} — {periods.previous.endDate}</span>}{yearAgo && <span><strong>同比基期</strong> {periods.yearAgo.startDate} — {periods.yearAgo.endDate}</span>}<span>Asia/Shanghai · {dimension.toUpperCase()} 独立统计</span><span>{periods.rule}</span></div>;
}
export function MissingSource({ title, reason, children }: { title: string; reason: string; children?: ReactNode }) {
  return <div className="np-missing"><strong>{title}</strong><p>{productReasonLabels[reason] ?? reason}</p>{children}</div>;
}
