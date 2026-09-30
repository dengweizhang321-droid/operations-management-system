"use client";

import { formatMetric, formatDerivedMoneyPerCount, type DerivedMoneyPerCountV1, type MetricValue } from "@/lib/netshop/insights-contract";
import { MetricCell } from "./ProductsPrimitives";

export function ProductsBars({ rows }: { rows: Array<{ label: string; metric: MetricValue; share?: MetricValue }> }) {
  const maximum = Math.max(0, ...rows.map(row => row.metric.value === null ? 0 : Math.abs(row.metric.value)));
  return <div className="np-bars">{rows.map((row, index) => <div className="np-bar-row" key={`${row.label}:${index}`}><span className="np-bar-label">{row.label}</span><div className="np-bar-track" aria-hidden="true"><div className="np-bar-fill" style={{ width: `${maximum && row.metric.value !== null ? Math.abs(row.metric.value) / maximum * 100 : 0}%` }} /></div><span className="np-bar-value"><MetricCell metric={row.metric} />{row.share && <small>{formatMetric(row.share)}</small>}</span></div>)}{rows.length === 0 && <p className="np-empty">本范围没有可展示的结构记录</p>}</div>;
}

/** Rendering scale only; missing days remain breaks, never zero-filled. The
 * reader owns period pairing, metric values and any temporal grouping. */
export function ProductsTrend({ label, points }: { label: string; points: Array<{ date: string; metric: MetricValue | DerivedMoneyPerCountV1 }> }) {
  const values = points.map(point => point.metric.value);
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return <div className="np-empty">{label}：当前范围没有可靠序列</div>;
  const maximum = Math.max(0, ...known), minimum = Math.min(0, ...known), span = maximum - minimum || 1;
  const x = (index: number) => 45 + index * 525 / Math.max(points.length - 1, 1);
  const y = (value: number) => 115 - (value - minimum) * 95 / span;
  const segments: string[][] = []; let segment: string[] = [];
  values.forEach((value, index) => {
    if (value === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(`${x(index)},${y(value)}`);
  });
  if (segment.length) segments.push(segment);
  return <div><svg className="np-chart" viewBox="0 0 600 150" role="img" aria-label={`${label}；缺日断开，详细数值见明细`}>
    <line x1="45" y1={y(0)} x2="570" y2={y(0)} stroke="var(--np-line)" />
    <text x="5" y="18" className="np-chart-label">{points[0].metric.unit === "CNY_CENT" ? "元" : points[0].metric.unit === "CNY_CENT_PER_COUNT" ? "元/累计次数" : points[0].metric.unit === "RATIO" ? "%" : points[0].metric.unit === "COUNT" ? "累计" : "倍"}</text>
    {segments.map((coordinates, index) => <polyline key={index} points={coordinates.join(" ")} fill="none" stroke="var(--np-brand)" strokeWidth="2" />)}
    {values.map((value, index) => { const metric = points[index].metric; return value === null ? null : <circle key={points[index].date} cx={x(index)} cy={y(value)} r="2.5" fill="var(--np-brand)"><title>{points[index].date}：{metric.unit === "CNY_CENT_PER_COUNT" ? formatDerivedMoneyPerCount(metric) : formatMetric(metric)}</title></circle>; })}
    <text x="45" y="140" className="np-chart-label">{points[0].date}</text><text x="570" y="140" textAnchor="end" className="np-chart-label">{points[points.length - 1].date}</text>
  </svg><span className="np-caption">{known.length}/{points.length} 个有值日期；图形仅显示已读取序列</span></div>;
}
