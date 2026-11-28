"use client";

import { useState } from "react";
import { chartColorAt } from "./chart-utils";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  color?: string;
  centerValue: string;
  centerSublabel?: string;
  centerBadge?: string;
  tooltip?: string;
};

/**
 * Interactive SVG Donut Chart with hover expansion, non-active dimming,
 * dynamic center readout, and optional controlled index for two-way legend sync.
 */
export function InteractiveDonutChart({
  slices,
  size = 176,
  strokeWidth = 24,
  defaultCenterValue,
  defaultCenterLabel,
  defaultCenterBadge,
  activeIndex: controlledIndex,
  onActiveIndexChange,
  ariaLabel,
  className = "",
}: {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  defaultCenterValue: string;
  defaultCenterLabel: string;
  defaultCenterBadge?: string;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [uncontrolledIndex, setUncontrolledIndex] = useState<number | null>(null);
  const activeIndex = controlledIndex !== undefined ? controlledIndex : uncontrolledIndex;
  const setActiveIndex = (next: number | null) => {
    if (onActiveIndexChange) onActiveIndexChange(next);
    else setUncontrolledIndex(next);
  };

  const radius = (size - strokeWidth - 10) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);

  let cumulativeFraction = 0;
  const computedArcs = slices.map((slice, index) => {
    const positiveValue = Math.max(0, slice.value);
    const fraction = total > 0 ? positiveValue / total : 0;
    const startFraction = cumulativeFraction;
    cumulativeFraction += fraction;
    const rawLength = fraction * circumference;
    const gap = total > 0 && slices.filter((item) => item.value > 0).length > 1 ? Math.min(2.2, rawLength * 0.25) : 0;
    const dashLength = Math.max(0, rawLength - gap);
    const dashOffset = -startFraction * circumference;
    return {
      slice,
      index,
      fraction,
      dashLength,
      dashOffset,
      color: slice.color ?? chartColorAt(index),
    };
  });

  const activeSlice = activeIndex !== null ? slices[activeIndex] ?? null : null;

  return (
    <div
      className={`ui-donut-wrap${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      onPointerLeave={() => setActiveIndex(null)}
    >
      <svg
        className="ui-donut-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
      >
        <circle
          className="ui-donut-track"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <g transform={`rotate(-90 ${center} ${center})`}>
          {computedArcs.map(({ slice, index, dashLength, dashOffset, color }) => {
            if (dashLength <= 0.1) return null;
            const isActive = activeIndex === index;
            const isDim = activeIndex !== null && !isActive;
            return (
              <circle
                key={slice.key}
                className={`ui-donut-arc${isActive ? " ui-donut-arc-active" : isDim ? " ui-donut-arc-dim" : ""}`}
                cx={center}
                cy={center}
                r={radius}
                stroke={color}
                strokeWidth={isActive ? strokeWidth + 5 : strokeWidth}
                strokeDasharray={`${dashLength.toFixed(2)} ${circumference.toFixed(2)}`}
                strokeDashoffset={dashOffset.toFixed(2)}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(isActive ? null : index)}
              >
                <title>{slice.tooltip ?? `${slice.label}：${slice.centerValue}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>

      <div className="ui-donut-center" aria-live="polite">
        <strong>{activeSlice ? activeSlice.centerValue : defaultCenterValue}</strong>
        <small title={activeSlice ? (activeSlice.centerSublabel ?? activeSlice.label) : defaultCenterLabel}>
          {activeSlice ? (activeSlice.centerSublabel ?? activeSlice.label) : defaultCenterLabel}
        </small>
        {(activeSlice?.centerBadge ?? defaultCenterBadge) && (
          <em>{activeSlice ? activeSlice.centerBadge : defaultCenterBadge}</em>
        )}
      </div>
    </div>
  );
}
