import type { ReactNode } from "react";
import { formatMetric, type MetricComparison, type MetricValue } from "@/lib/netshop/insights-contract";
import { InsightComparison, InsightMetric } from "../shared/components";

const reasons: Record<string, string> = {
  no_records: "未导入记录", missing_day: "日期未覆盖", missing_field: "来源缺少字段",
  not_applicable: "当前来源不适用", unmapped: "未关联", ambiguous_mapping: "关联不唯一",
  zero_denominator: "分母或基期为零，不计算比值或增幅", negative_denominator: "分母为负", incomplete_baseline: "两期覆盖不足",
  negative_baseline: "基期为负", unverified_source: "来源未核验", attribution_window_unknown: "归因窗口未核验",
  unsafe_integer: "数值超出安全范围", incomplete_coverage: "范围覆盖不足", promotion_not_ready: "推广聚合未就绪",
  promotion_mismatch: "推广聚合与原始来源不一致", no_comparable_date: "没有对应比较日",
};

export function metricReason(metric: MetricValue): string {
  return metric.reasonCode ? reasons[metric.reasonCode] ?? metric.reasonCode : "";
}

export function MetricCell({ metric }: { metric: MetricValue }) {
  return <span className="promotion-metric-cell" data-status={metric.status} title={metricReason(metric)}>
    {formatMetric(metric)}{metric.status !== "available" && <small>{metric.status === "partial" ? "已覆盖范围 · " : ""}{metricReason(metric)}</small>}
  </span>;
}

export function ComparisonCell({ value }: { value: MetricComparison }) {
  return <span className="promotion-comparison-cell"><InsightComparison value={value}/>{value.status !== "available" && value.reasonCode && <small>{reasons[value.reasonCode] ?? value.reasonCode}</small>}</span>;
}

export function MetricCard({ label, metric, previous, yearAgo, previousChange, yearAgoChange, showPrevious, showYearAgo, note }: {
  label: string; metric: MetricValue; previous?: MetricComparison; yearAgo?: MetricComparison;
  previousChange?: MetricValue; yearAgoChange?: MetricValue;
  showPrevious?: boolean; showYearAgo?: boolean; note?: string;
}) {
  return <article className="promotion-kpi">
    <InsightMetric label={label} metric={metric}/>
    {(showPrevious && previous || showYearAgo && yearAgo) && <div className="promotion-comparisons">
      {showPrevious && previous && <span data-direction={previous.value === null || previous.value === 0 ? "neutral" : previous.value > 0 ? "up" : "down"}>环比 <ComparisonCell value={previous}/>{previousChange && <small>差额 <MetricCell metric={previousChange}/></small>}</span>}
      {showYearAgo && yearAgo && <span data-direction={yearAgo.value === null || yearAgo.value === 0 ? "neutral" : yearAgo.value > 0 ? "up" : "down"}>同比 <ComparisonCell value={yearAgo}/>{yearAgoChange && <small>差额 <MetricCell metric={yearAgoChange}/></small>}</span>}
    </div>}
    {note && <p className="promotion-caption">{note}</p>}
  </article>;
}

export function PromotionSection({ id, title, note, tools, children, className = "" }: {
  id?: string; title: string; note?: string; tools?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section id={id} className={`panel promotion-section ${className}`} aria-label={title}>
    <header className="promotion-section-header"><div><h2>{title}</h2>{note && <p className="promotion-caption">{note}</p>}</div>{tools}</header>
    {children}
  </section>;
}

export function CapabilityGap({ reason, children }: { reason: string; children?: ReactNode }) {
  return <div className="promotion-gap" role="status"><strong>当前范围暂不可用</strong><p>{reason}</p>{children}</div>;
}
