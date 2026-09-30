import { useState } from "react";
import type { MetricValue } from "@/lib/netshop/insights-contract";
import { MetricCell } from "./presentation";

/** A chart projection only. Values and ratios are supplied by the owning reader. */
export type MetricTrendPoint = { startDate: string; endDate: string; values: MetricValue[] };
export default function MetricTrend({ points, labels, onSelect }: {
  points: MetricTrendPoint[]; labels: string[];
  onSelect: (startDate: string, endDate: string) => void;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const width = 800, height = 180, left = 10, right = 10, top = 14, bottom = 15;
  const validValue = (metric: MetricValue | undefined) => metric?.status === "available" ? metric.value : null;
  const values = points.flatMap(point => point.values.map(validValue)).filter((v): v is number => v !== null);
  const maximum = Math.max(1, ...values), minimum = Math.min(0, ...values), span = maximum - minimum;
  const x = (index: number) => left + (points.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (points.length - 1));
  const y = (value: number) => height - bottom - (value - minimum) / span * (height - top - bottom);
  function path(series: number) {
    let connected = false;
    return points.map((point, index) => {
      const value = validValue(point.values[series]);
      if (value === null) { connected = false; return ""; }
      const command = connected ? "L" : "M"; connected = true;
      return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    }).join(" ");
  }
  const selected = focus === null ? null : points[focus];
  return <>
    <div className="promotion-chart-legend">{labels.map((label, index) => <span key={label} className={index ? "secondary" : ""}><i aria-hidden="true"/>{label}</span>)}<span>仅绘制完整可用点；缺数处断开</span></div>
    <div className="promotion-trend-scroll"><div className="promotion-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${labels.join("与")}趋势；使用下方日期选择器查看精确值`}>
        {Array.from({ length: 5 }, (_, index) => <line key={index} className="promotion-grid-line" x1={left} x2={width - right} y1={top + index * (height - top - bottom) / 4} y2={top + index * (height - top - bottom) / 4}/>)}
        {labels.map((label, series) => <path key={label} className={`promotion-line${series ? " promotion-line-secondary" : ""}`} d={path(series)}/>)}
        {points.map((point, index) => <g key={point.startDate}>
          {point.values.map((metric, series) => validValue(metric) !== null && <circle key={series} cx={x(index)} cy={y(metric.value!)} r={3} fill={series ? "var(--color-purple,#8167d9)" : "var(--color-brand,#396149)"}/>)}
          <rect className="promotion-hit" x={Math.max(0, x(index) - Math.max(2, width / points.length / 2))} y={0} width={Math.max(4, width / points.length)} height={height} onPointerEnter={() => setFocus(index)} onClick={() => onSelect(point.startDate, point.endDate)}>
            <title>{point.startDate}—{point.endDate}；点击定位对象</title>
          </rect>
        </g>)}
      </svg>
      <div className="promotion-chart-dates"><span>{points[0]?.startDate}</span><span>{points.at(-1)?.endDate}</span></div>
    </div></div>
    <div className="promotion-trend-detail">
      <label className="promotion-filter">观察日期
        <select aria-label="观察趋势日期" value={focus ?? ""} onChange={event => setFocus(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">选择日期查看数值</option>{points.map((point, index) => <option key={point.startDate} value={index}>{point.startDate}{point.startDate !== point.endDate ? `—${point.endDate}` : ""}</option>)}
        </select>
      </label>
      {selected && <div className="promotion-note"><strong>{selected.startDate}—{selected.endDate}</strong><div className="promotion-fact-list">{labels.map((label, index) => <div className="promotion-fact-row" key={label}><span>{label}</span><MetricCell metric={selected.values[index]}/></div>)}</div><button type="button" className="row-action" onClick={() => onSelect(selected.startDate, selected.endDate)}>查看这一期间的对象明细</button></div>}
    </div>
  </>;
}
