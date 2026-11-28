"use client";

import { useId, useState } from "react";
import { buildSmoothAreaPath, buildSmoothPath } from "./chart-utils";

export type AgeDualAxisBucket = {
  key: string;
  label: string;
  quantity: number;
  valueCents: number;
  count: number;
};

/**
 * Dual-axis animated bar (quantity) + smooth Bezier curve (inventory value) SVG chart
 * for Inventory Age Analysis.
 */
export function AgeDualAxisChart({
  buckets,
  stockValueComplete,
  niceMaximum,
  formatNumber,
  formatAmount,
  formatCurrencyFromCents,
}: {
  buckets: AgeDualAxisBucket[];
  stockValueComplete: boolean;
  niceMaximum: (value: number) => number;
  formatNumber: (value: number) => string;
  formatAmount: (value: number) => string;
  formatCurrencyFromCents: (cents: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const width = 1200;
  const height = 360;
  const plotLeft = 68;
  const plotRight = 1122;
  const plotTop = 44;
  const plotBottom = 300;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const quantityMaximum = niceMaximum(Math.max(0, ...buckets.map((bucket) => bucket.quantity)));
  const valueMaximum = niceMaximum(Math.max(0, ...buckets.map((bucket) => bucket.valueCents / 100)));
  const slotWidth = buckets.length > 0 ? plotWidth / buckets.length : plotWidth;
  const barWidth = Math.min(58, slotWidth * 0.56);
  const xFor = (index: number) => plotLeft + slotWidth * (index + 0.5);
  const quantityY = (value: number) => plotBottom - (Math.max(0, value) / quantityMaximum) * plotHeight;
  const valueY = (valueCents: number) => plotBottom - (Math.max(0, valueCents / 100) / valueMaximum) * plotHeight;

  const curvePoints = buckets.map((bucket, index) => ({
    x: xFor(index),
    y: valueY(bucket.valueCents),
  }));
  const smoothLinePath = buildSmoothPath(curvePoints);
  const smoothAreaPath = buildSmoothAreaPath(curvePoints, plotBottom);
  const ticks = [0, 1, 2, 3, 4];

  const activeBucket = hoveredIndex !== null ? buckets[hoveredIndex] : null;
  const activeXPercent = hoveredIndex !== null ? (xFor(hoveredIndex) / width) * 100 : 50;
  const flipTipLeft = activeXPercent > 62;
  const animKey = `${buckets.length}-${buckets.reduce((s, b) => s + b.quantity, 0)}`;

  return (
    <div
      className="age-distribution-chart ui-chart-stage"
      role="group"
      aria-label="库龄分布双轴组合图"
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <div className="age-distribution-svg-wrap">
        <svg
          key={animKey}
          className="age-distribution-svg ui-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby="inventory-age-chart-title inventory-age-chart-description"
        >
          <title id="inventory-age-chart-title">库龄库存数量与库存金额分布</title>
          <desc id="inventory-age-chart-description">森林绿柱形表示各库龄区间的可用库存数量，琥珀金平滑曲线表示按固定成本计算的库存金额。</desc>

          <defs>
            <linearGradient id={`age-bar-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#528667" />
              <stop offset="100%" stopColor="#396149" />
            </linearGradient>
            <linearGradient id={`age-val-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d48a29" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#d48a29" stopOpacity="0" />
            </linearGradient>
          </defs>

          <text className="age-chart-axis-title" x={plotLeft - 12} y={24}>数量（件）</text>
          <text className="age-chart-axis-title" x={plotRight + 12} y={24} textAnchor="end">金额（元）</text>

          {ticks.map((tick) => {
            const y = plotBottom - (plotHeight * tick) / 4;
            return (
              <g key={tick}>
                <line className={tick === 0 ? "ui-chart-zero-axis" : "ui-chart-grid"} x1={plotLeft} x2={plotRight} y1={y} y2={y} />
                <text className="age-chart-axis-label" x={plotLeft - 12} y={y + 4} textAnchor="end">{formatNumber((quantityMaximum * tick) / 4)}</text>
                <text className="age-chart-axis-label" x={plotRight + 12} y={y + 4}>{formatAmount((valueMaximum * tick) / 4)}</text>
              </g>
            );
          })}

          {hoveredIndex !== null && (
            <rect
              className="ui-chart-hover-band"
              x={plotLeft + slotWidth * hoveredIndex}
              y={plotTop - 6}
              width={slotWidth}
              height={plotHeight + 10}
              rx={6}
            />
          )}

          {smoothAreaPath && (
            <path className="ui-chart-area-anim" d={smoothAreaPath} fill={`url(#age-val-area-${uid})`} />
          )}

          {buckets.map((bucket, index) => {
            const center = xFor(index);
            const top = quantityY(bucket.quantity);
            const barHeight = Math.max(0, plotBottom - top);
            const labelInside = barHeight >= 30;
            const isHovered = hoveredIndex === index;
            const isDim = hoveredIndex !== null && !isHovered;

            return (
              <g key={bucket.key}>
                <rect
                  className={`ui-chart-bar-pos${isHovered ? " ui-chart-bar-active" : isDim ? " ui-chart-bar-dim" : ""}`}
                  x={center - barWidth / 2}
                  y={top}
                  width={barWidth}
                  height={barHeight}
                  rx="6"
                  fill={`url(#age-bar-${uid})`}
                  style={{ animationDelay: `${index * 36}ms` }}
                />
                {bucket.quantity > 0 && (
                  <text
                    className={labelInside ? "age-chart-bar-label inside" : "age-chart-bar-label"}
                    x={center}
                    y={labelInside ? top + 20 : Math.max(plotTop + 12, top - 8)}
                    textAnchor="middle"
                  >
                    {formatNumber(bucket.quantity)}
                  </text>
                )}
                <text className="age-chart-x-label" x={center} y={plotBottom + 26} textAnchor="middle">
                  {bucket.label.replace(" 天", "天")}
                </text>
              </g>
            );
          })}

          {smoothLinePath && (
            <path
              className="age-chart-value-line ui-chart-line-anim"
              d={smoothLinePath}
              pathLength={100}
              stroke="#d48a29"
              strokeWidth="2.8"
            />
          )}

          {buckets.map((bucket, index) => {
            const x = xFor(index);
            const y = valueY(bucket.valueCents);
            const isHovered = hoveredIndex === index;
            const labelY = y > plotBottom - 30 ? plotBottom - 36 : Math.max(plotTop + 14, y - 12);

            return (
              <g key={`value-${bucket.key}`}>
                <circle
                  className="age-chart-value-point ui-chart-point-anim"
                  cx={x}
                  cy={y}
                  r={isHovered ? 6 : 4.2}
                  fill="#ffffff"
                  stroke="#d48a29"
                  strokeWidth={isHovered ? 3 : 2.2}
                  style={{ animationDelay: `${260 + index * 28}ms` }}
                />
                {(isHovered || buckets.length <= 10) && (
                  <text className="age-chart-value-label" x={x} y={labelY} textAnchor="middle">
                    {formatAmount(bucket.valueCents / 100)}
                  </text>
                )}
                <rect
                  className="ui-chart-hit"
                  x={plotLeft + slotWidth * index}
                  y={plotTop - 6}
                  width={slotWidth}
                  height={plotHeight + 36}
                  onPointerEnter={() => setHoveredIndex(index)}
                  onFocus={() => setHoveredIndex(index)}
                >
                  <title>{`${bucket.label}：库存数量 ${formatNumber(bucket.quantity)} 件；库存金额 ${formatCurrencyFromCents(bucket.valueCents)}；${formatNumber(bucket.count)} 个 SKU × 仓库`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>

      {activeBucket && (
        <div
          className="ui-chart-tip"
          style={
            flipTipLeft
              ? { left: `calc(${activeXPercent.toFixed(2)}% - 14px)`, transform: "translateX(-100%)", top: 44 }
              : { left: `calc(${activeXPercent.toFixed(2)}% + 14px)`, top: 44 }
          }
        >
          <span className="ui-chart-tip-title">库龄 {activeBucket.label}</span>
          <div className="ui-chart-tip-row">
            <span className="ui-chart-tip-label">
              <i className="ui-chart-tip-dot" style={{ background: "#396149" }} />
              库存数量
            </span>
            <span className="ui-chart-tip-value">{formatNumber(activeBucket.quantity)} 件</span>
          </div>
          <div className="ui-chart-tip-row">
            <span className="ui-chart-tip-label">
              <i className="ui-chart-tip-dot" style={{ background: "#d48a29" }} />
              库存金额
            </span>
            <span className="ui-chart-tip-value">{formatCurrencyFromCents(activeBucket.valueCents)}</span>
          </div>
          <div className="ui-chart-tip-note">覆盖 {formatNumber(activeBucket.count)} 个 SKU × 仓库</div>
        </div>
      )}

      {!stockValueComplete && (
        <p className="age-chart-coverage-note">库存金额仅统计已有可信固定成本的库存；缺失成本未按 0 元处理。</p>
      )}
    </div>
  );
}
