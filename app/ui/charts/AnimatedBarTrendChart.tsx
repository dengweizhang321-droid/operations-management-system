"use client";

import { useId, useState } from "react";

export type BarTrendItem = {
  key: string;
  label: string;
  value: number;
  tooltipTitle?: string;
  tooltipValue: string;
  tooltipNote?: string;
};

/**
 * Zero-dependency responsive forest-green animated bar trend chart.
 * Supports positive & negative values around a clear zero axis, staggered GPU rise animations,
 * hover band highlight, and floating deep forest-green glass tooltip.
 */
export function AnimatedBarTrendChart({
  items,
  ariaLabel,
  seriesLabel = "净销售额",
  height = 176,
  formatAxisValue,
}: {
  items: BarTrendItem[];
  ariaLabel: string;
  seriesLabel?: string;
  height?: number;
  formatAxisValue?: (value: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (items.length === 0) return null;

  const width = 760;
  const padLeft = formatAxisValue ? 54 : 14;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(0, ...items.map((item) => item.value));
  const minVal = Math.min(0, ...items.map((item) => item.value));
  const span = maxVal - minVal || 1;
  const yFor = (val: number) => padTop + ((maxVal - val) / span) * plotH;
  const zeroY = yFor(0);

  const slotW = plotW / items.length;
  const barW = Math.max(4, Math.min(26, slotW * 0.62));
  const labelStep = Math.max(1, Math.ceil(items.length / 8));
  const activeItem = hoveredIndex !== null ? items[hoveredIndex] : null;
  const activeXPercent = hoveredIndex !== null
    ? ((padLeft + slotW * (hoveredIndex + 0.5)) / width) * 100
    : 50;
  const flipTipLeft = activeXPercent > 62;

  const gridTicks = [maxVal, maxVal - span * 0.333, maxVal - span * 0.666, minVal];
  const animationKey = `${items[0]?.key ?? ""}-${items.at(-1)?.key ?? ""}-${items.length}`;

  return (
    <div
      className="ui-chart-stage"
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <svg
        key={animationKey}
        className="ui-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={`bar-pos-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8264" />
            <stop offset="100%" stopColor="#396149" />
          </linearGradient>
          <linearGradient id={`bar-neg-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16825d" />
            <stop offset="100%" stopColor="#26a379" />
          </linearGradient>
        </defs>

        {gridTicks.map((tick, index) => {
          const y = yFor(tick);
          return (
            <g key={index}>
              <line className="ui-chart-grid" x1={padLeft} x2={width - padRight} y1={y} y2={y} />
              {formatAxisValue && (
                <text className="ui-chart-axis-text" x={padLeft - 8} y={y + 4} textAnchor="end">
                  {formatAxisValue(tick)}
                </text>
              )}
            </g>
          );
        })}

        <line className="ui-chart-zero-axis" x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} />

        {hoveredIndex !== null && (
          <rect
            className="ui-chart-hover-band"
            x={padLeft + slotW * hoveredIndex}
            y={padTop - 4}
            width={slotW}
            height={plotH + 8}
            rx={4}
          />
        )}

        {items.map((item, index) => {
          const cx = padLeft + slotW * (index + 0.5);
          const isNeg = item.value < 0;
          const valY = yFor(item.value);
          const topY = isNeg ? zeroY : valY;
          const barH = Math.max(item.value === 0 ? 1.5 : 3, Math.abs(valY - zeroY));
          const isHovered = hoveredIndex === index;
          const isDim = hoveredIndex !== null && !isHovered;
          const delayMs = Math.min(340, index * 14);
          const showLabel = index % labelStep === 0 || index === items.length - 1;

          return (
            <g key={item.key}>
              <rect
                className={`${isNeg ? "ui-chart-bar-neg" : "ui-chart-bar-pos"}${isHovered ? " ui-chart-bar-active" : isDim ? " ui-chart-bar-dim" : ""}`}
                x={cx - barW / 2}
                y={topY}
                width={barW}
                height={barH}
                rx={Math.min(4, barW / 2)}
                fill={isNeg ? `url(#bar-neg-${uid})` : `url(#bar-pos-${uid})`}
                style={{ animationDelay: `${delayMs}ms` }}
              />
              {showLabel && (
                <text className="ui-chart-axis-text" x={cx} y={height - 7} textAnchor="middle">
                  {item.label}
                </text>
              )}
              <rect
                className="ui-chart-hit"
                x={padLeft + slotW * index}
                y={padTop - 6}
                width={slotW}
                height={plotH + padBottom}
                onPointerEnter={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
              >
                <title>{`${item.tooltipTitle ?? item.label} ${seriesLabel} ${item.tooltipValue}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      {activeItem && (
        <div
          className="ui-chart-tip"
          style={
            flipTipLeft
              ? { left: `calc(${activeXPercent.toFixed(2)}% - 12px)`, transform: "translateX(-100%)" }
              : { left: `calc(${activeXPercent.toFixed(2)}% + 12px)` }
          }
        >
          <span className="ui-chart-tip-title">{activeItem.tooltipTitle ?? activeItem.label}</span>
          <div className="ui-chart-tip-row">
            <span className="ui-chart-tip-label">
              <i
                className="ui-chart-tip-dot"
                style={{ background: activeItem.value < 0 ? "var(--color-metric-down, #16825d)" : "var(--chart-1, #396149)" }}
              />
              {seriesLabel}
            </span>
            <span className="ui-chart-tip-value">{activeItem.tooltipValue}</span>
          </div>
          {activeItem.tooltipNote && <div className="ui-chart-tip-note">{activeItem.tooltipNote}</div>}
        </div>
      )}
    </div>
  );
}
