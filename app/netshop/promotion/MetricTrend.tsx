import { useId, useState } from "react";
import type { DerivedMoneyPerCountV1, MetricValue } from "@/lib/netshop/insights-contract";
import { buildSmoothAreaPath, buildSmoothPath, splitPointSegments } from "@/app/ui/charts/chart-utils";
import { MetricCell } from "./presentation";

/** A chart projection only. Values and ratios are supplied by the owning reader. */
export type MetricTrendPoint = { startDate: string; endDate: string; values: Array<MetricValue | DerivedMoneyPerCountV1> };

function formatMetricBrief(metric: MetricValue | DerivedMoneyPerCountV1 | undefined): string {
  if (!metric || metric.status !== "available" || metric.value === null) return "缺数";
  if ("unit" in metric && metric.unit === "CNY_CENT") {
    return `${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(metric.value / 100)} 元`;
  }
  if ("unit" in metric && metric.unit === "RATIO") {
    return `${(metric.value * 100).toFixed(2)}%`;
  }
  if ("unit" in metric && metric.unit === "MULTIPLE") {
    return metric.value.toFixed(2);
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(metric.value);
}

export default function MetricTrend({ points, labels, onSelect }: {
  points: MetricTrendPoint[]; labels: string[];
  onSelect?: (startDate: string, endDate: string) => void;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 800, height = 190, left = 12, right = 12, top = 16, bottom = 16;
  const validValue = (metric: MetricValue | DerivedMoneyPerCountV1 | undefined) => metric?.status === "available" ? metric.value : null;
  const values = points.flatMap(point => point.values.map(validValue)).filter((v): v is number => v !== null);
  const maximum = Math.max(1, ...values), minimum = Math.min(0, ...values), span = maximum - minimum;
  const x = (index: number) => left + (points.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (points.length - 1));
  const y = (value: number) => height - bottom - (value - minimum) / span * (height - top - bottom);
  const seriesColor = (series: number) => series ? "var(--chart-5, #7c6bb8)" : "var(--chart-1, #396149)";

  const seriesSegments = labels.map((_, series) => {
    const nullable = points.map((point, index) => {
      const value = validValue(point.values[series]);
      return value === null ? null : { x: x(index), y: y(value) };
    });
    return splitPointSegments(nullable);
  });

  const selected = focus === null ? null : points[focus];
  const focusXPercent = focus !== null && points.length > 0 ? (x(focus) / width) * 100 : 50;
  const flipTipLeft = focusXPercent > 62;
  const animKey = `${points[0]?.startDate ?? ""}-${points.at(-1)?.endDate ?? ""}-${labels.join("|")}`;

  return <>
    <div className="promotion-chart-legend">{labels.map((label, index) => <span key={label} className={index ? "secondary" : ""}><i aria-hidden="true"/>{label}</span>)}<span>仅绘制完整可用点；缺数处断开</span></div>
    <div className="promotion-trend-scroll"><div className="promotion-chart ui-chart-stage" onPointerLeave={() => setFocus(null)}>
      <svg key={animKey} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labels.join("与")}趋势；使用下方日期选择器查看精确值`}>
        <defs>
          <linearGradient id={`promo-area-0-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#396149" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#396149" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id={`promo-area-1-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c6bb8" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#7c6bb8" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, index) => <line key={index} className="promotion-grid-line" x1={left} x2={width - right} y1={top + index * (height - top - bottom) / 4} y2={top + index * (height - top - bottom) / 4}/>)}
        {focus !== null && <line className="ui-chart-crosshair" x1={x(focus)} x2={x(focus)} y1={top} y2={height - bottom} />}
        {seriesSegments.map((segments, series) => segments.map((segment, segIdx) => {
          const areaPath = buildSmoothAreaPath(segment, height - bottom);
          const linePath = buildSmoothPath(segment);
          return <g key={`${series}-${segIdx}`}>
            {areaPath && <path className="ui-chart-area-anim" d={areaPath} fill={`url(#promo-area-${series ? 1 : 0}-${uid})`} />}
            {segment.length >= 2 && <path className={`promotion-line ui-chart-line-anim${series ? " promotion-line-secondary" : ""}`} d={linePath} pathLength={100} />}
          </g>;
        }))}
        {points.map((point, index) => <g key={point.startDate}>
          {point.values.map((metric, series) => validValue(metric) !== null && (
            <circle
              key={series}
              className="ui-chart-point-anim"
              cx={x(index)}
              cy={y(metric.value!)}
              r={focus === index ? 5.2 : 3.2}
              fill="#ffffff"
              stroke={seriesColor(series)}
              strokeWidth={focus === index ? 2.6 : 2}
              style={{ animationDelay: `${Math.min(360, index * 18)}ms` }}
            />
          ))}
          <rect className={`promotion-hit${onSelect ? "" : " promotion-hit-readonly"}`} x={Math.max(0, x(index) - Math.max(2, width / Math.max(1, points.length) / 2))} y={0} width={Math.max(4, width / Math.max(1, points.length))} height={height} onPointerEnter={() => setFocus(index)} onClick={onSelect ? () => onSelect(point.startDate, point.endDate) : undefined}>
            <title>{point.startDate}—{point.endDate}{onSelect ? "；点击定位对象" : "；仅查看整期趋势数值"}</title>
          </rect>
        </g>)}
      </svg>
      {selected && (
        <div
          className="ui-chart-tip"
          style={
            flipTipLeft
              ? { left: `calc(${focusXPercent.toFixed(2)}% - 12px)`, transform: "translateX(-100%)", top: 8 }
              : { left: `calc(${focusXPercent.toFixed(2)}% + 12px)`, top: 8 }
          }
        >
          <span className="ui-chart-tip-title">
            {selected.startDate}{selected.startDate !== selected.endDate ? ` — ${selected.endDate}` : ""}
          </span>
          {labels.map((label, series) => (
            <div className="ui-chart-tip-row" key={label}>
              <span className="ui-chart-tip-label">
                <i className="ui-chart-tip-dot" style={{ background: seriesColor(series) }} />
                {label}
              </span>
              <span className="ui-chart-tip-value">{formatMetricBrief(selected.values[series])}</span>
            </div>
          ))}
          {onSelect && <div className="ui-chart-tip-note">点击可定位该期间对象明细</div>}
        </div>
      )}
      <div className="promotion-chart-dates"><span>{points[0]?.startDate}</span><span>{points.at(-1)?.endDate}</span></div>
    </div></div>
    <div className="promotion-trend-detail">
      <label className="promotion-filter">观察日期
        <select aria-label="观察趋势日期" value={focus ?? ""} onChange={event => setFocus(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">选择日期查看数值</option>{points.map((point, index) => <option key={point.startDate} value={index}>{point.startDate}{point.startDate !== point.endDate ? `—${point.endDate}` : ""}</option>)}
        </select>
      </label>
      {selected && <div className="promotion-note"><strong>{selected.startDate}—{selected.endDate}</strong><div className="promotion-fact-list">{labels.map((label, index) => <div className="promotion-fact-row" key={label}><span>{label}</span><MetricCell metric={selected.values[index]}/></div>)}</div>{onSelect && <button type="button" className="row-action" onClick={() => onSelect(selected.startDate, selected.endDate)}>查看这一期间的对象明细</button>}</div>}
    </div>
  </>;
}
