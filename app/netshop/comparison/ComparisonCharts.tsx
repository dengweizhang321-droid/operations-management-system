"use client";

import type { ComparisonMetric } from "./contract";
import { formatComparisonMetric } from "./ComparisonFormatting";
type ChartMetric = ComparisonMetric;

/** Chart values are supplied by the owning reader. Missing values stay gaps. */
export type ComparisonChartSeries = {
  key: string;
  label: string;
  values: Array<{ label: string; metric: ChartMetric }>;
};
export type ComparisonDistributionPoint = { key: string; label: string; x: ChartMetric; y: ChartMetric; partial: boolean };
const colors = ["var(--color-brand,#396149)", "#7a9587", "#b19a70", "#748ba5"];
const available = (metric: ChartMetric) => (metric.status === "available" || metric.status === "partial") && metric.value !== null && Number.isFinite(metric.value);
const formatted = formatComparisonMetric;

function ticks(minimum: number, maximum: number) {
  const lower = Math.min(0, minimum), upper = maximum === lower ? lower + 1 : maximum;
  return Array.from({ length: 5 }, (_, index) => lower + (upper - lower) * index / 4);
}
function tickLabel(value: number, unit: string) {
  if (unit === "CNY_CENT" || unit === "CNY_CENT_PER_COUNT") return `${(value / 100).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}元`;
  if (unit === "RATIO") return `${(value * 100).toFixed(1)}%`;
  if (unit === "NATIVE_INTEGER_QUANTITY") return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 原生数量`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

export function ComparisonTrendChart({ series, indexed = false, title }: { series: ComparisonChartSeries[]; indexed?: boolean; title: string }) {
  const chosen = series.slice(0, 4), values = chosen.flatMap(item => item.values.filter(point => available(point.metric)).map(point => point.metric.value!));
  const points = Math.max(0, ...chosen.map(item => item.values.length));
  if (!values.length || !points) return <div className="nc-chart-empty" role="status">{indexed ? "有效正基准和完整覆盖不足，当前不绘制指数。" : "当前范围没有可绘制的趋势。"}</div>;
  const width = 680, height = 270, left = 88, right = 20, top = 20, bottom = 46;
  const scaleTicks = ticks(Math.min(...values), Math.max(...values));
  const [minimum, maximum] = [scaleTicks[0], scaleTicks[4]];
  const x = (index: number) => left + (width - left - right) * (points <= 1 ? .5 : index / (points - 1));
  const y = (value: number) => height - bottom - (height - bottom - top) * (value - minimum) / (maximum - minimum);
  const unit = indexed ? "INDEX" : chosen.flatMap(item => item.values).find(point => available(point.metric))!.metric.unit;
  const labels = chosen.reduce((longest, item) => item.values.length > longest.length ? item.values : longest, chosen[0].values);
  return <div className="nc-chart"><div className="nc-chart-scroll" tabIndex={0} aria-label={`${title}，可横向滚动`}><svg className="nc-chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
    {scaleTicks.map(value => <g key={value}><line className="nc-gridline" x1={left} x2={width-right} y1={y(value)} y2={y(value)} /><text x={left-12} y={y(value)+4} textAnchor="end">{tickLabel(value, unit)}</text></g>)}
    {labels.map((point, index) => index === 0 || index === points-1 || index % Math.max(1, Math.ceil(points/6)) === 0 ? <text key={`${point.label}-${index}`} x={x(index)} y={height-16} textAnchor="middle">{point.label}</text> : null)}
    {chosen.map((item, seriesIndex) => <g key={item.key} style={{ color: colors[seriesIndex] }}>{item.values.map((point, index) => {
      if (!available(point.metric)) return null;
      const prior = index > 0 ? item.values[index-1] : null;
      return <g key={`${point.label}-${index}`}><title>{item.label} · {point.label} · {indexed ? `指数 ${point.metric.value!.toFixed(2)}` : formatted(point.metric)}{point.metric.status === "partial" ? " · 部分覆盖" : ""}</title>{prior && available(prior.metric) && <line x1={x(index-1)} y1={y(prior.metric.value!)} x2={x(index)} y2={y(point.metric.value!)} stroke="currentColor" strokeWidth="2" strokeDasharray={point.metric.status === "partial" || prior.metric.status === "partial" ? "4 3" : undefined} />}<circle cx={x(index)} cy={y(point.metric.value!)} r="3" fill="currentColor" /></g>;
    })}</g>)}
  </svg></div><div className="nc-chart-legend">{chosen.map((item, index) => <span key={item.key}><i style={{ background: colors[index] }} />{item.label}</span>)}</div><p className="nc-caption">缺失或不可用日期留空；各期使用各自的真实日期。{indexed && "指数只展示服务端返回的有效基准，基准为 100。"}</p></div>;
}

export function ComparisonDistributionChart({ points, xLabel, yLabel }: { points: ComparisonDistributionPoint[]; xLabel: string; yLabel: string }) {
  const valid = points.filter(point => available(point.x) && available(point.y));
  if (!valid.length) return <div className="nc-chart-empty" role="status">没有同时具备规模与效率字段的可比对象。</div>;
  const width = 500, height = 270, left = 82, right = 26, top = 32, bottom = 60;
  const xTicks = ticks(Math.min(...valid.map(point => point.x.value!)), Math.max(...valid.map(point => point.x.value!)));
  const yTicks = ticks(Math.min(...valid.map(point => point.y.value!)), Math.max(...valid.map(point => point.y.value!)));
  const x = (value: number) => left + (width-left-right)*(value-xTicks[0])/(xTicks[4]-xTicks[0]);
  const y = (value: number) => height-bottom-(height-bottom-top)*(value-yTicks[0])/(yTicks[4]-yTicks[0]);
  return <div className="nc-chart"><div className="nc-chart-scroll" tabIndex={0} aria-label="规模与效率分布，可横向滚动"><svg className="nc-chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${xLabel}与${yLabel}分布`}>
    {yTicks.map(value => <g key={value}><line className="nc-gridline" x1={left} x2={width-right} y1={y(value)} y2={y(value)} /><text x={left-10} y={y(value)+4} textAnchor="end">{tickLabel(value, valid[0].y.unit)}</text></g>)}
    {xTicks.filter((_, index) => index % 2 === 0).map(value => <text key={value} x={x(value)} y={height-bottom+22} textAnchor="middle">{tickLabel(value, valid[0].x.unit)}</text>)}
    <text x={left} y="16">{yLabel}</text><text x={(left+width-right)/2} y={height-10} textAnchor="middle">{xLabel}</text>
    {valid.map((point, index) => <g key={point.key} style={{ color: colors[index%4] }}><title>{point.label} · {xLabel} {formatted(point.x)} · {yLabel} {formatted(point.y)}{point.partial ? " · 部分覆盖" : ""}</title><circle cx={x(point.x.value!)} cy={y(point.y.value!)} r="7" fill={point.partial ? "var(--color-bg-surface,#fff)" : "currentColor"} stroke="currentColor" strokeWidth="2" /></g>)}
  </svg></div><div className="nc-chart-legend">{valid.map((point, index) => <span key={point.key}><i style={{ background: colors[index%4] }} />{point.label}{point.partial ? "（部分覆盖）" : ""}</span>)}</div><p className="nc-caption">只并列展示来源成立的指标，不计算综合评分。</p></div>;
}

export function ComparisonAmountBars({ rows }: { rows: Array<{ key: string; label: string; metric: ChartMetric }> }) {
  const maximum = Math.max(1, ...rows.filter(row => available(row.metric)).map(row => Math.abs(row.metric.value!)));
  return <div className="nc-amount-bars">{rows.map(row => <div className="nc-amount-bar" key={row.key}><span>{row.label}</span><div className="nc-bar-track">{available(row.metric) && <i className={row.metric.value! < 0 ? "nc-negative" : ""} style={{ width: `${Math.abs(row.metric.value!)/maximum*100}%` }} />}</div><strong>{formatted(row.metric)}</strong></div>)}</div>;
}
