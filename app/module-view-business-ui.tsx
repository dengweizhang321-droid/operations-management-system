"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type SalesStats,
  type SalesChannel,
  formatCurrencyFromCents,
  formatCount,
  formatRate,
} from "./module-view-shared";

import { SearchableMultiSelect } from "./ui/searchable-select";
import { prefersReducedMotion } from "./ui/charts/chart-utils";

type MultiFilterOption = string | { value: string; label: string };

export function MultiFilterSelect({ label, allLabel, ariaLabel, options, selected, onChange }: { label: string; allLabel: string; ariaLabel: string; options: MultiFilterOption[]; selected: string[]; onChange: (next: string[]) => void }) {
  return <SearchableMultiSelect className="multi-filter-select" ariaLabel={ariaLabel}
    menuAriaLabel={`${ariaLabel}多选`} allLabel={allLabel} values={selected} onChange={onChange}
    searchPlaceholder={`搜索${label}`} options={options.map(option => typeof option === "string" ? { value: option, label: option } : option)} />;
}

export function InventoryKpiCard({
  label,
  value,
  note,
  tone,
  icon,
  selected,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  tone: "blue" | "green" | "orange" | "purple";
  icon: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "article";
  return (
    <Tag className={`inventory-kpi-card${onClick ? " summary-filter-card" : ""}`} type={onClick ? "button" : undefined} aria-pressed={onClick ? selected : undefined} onClick={onClick}>
      <div><span>{label}</span><i className={`inventory-kpi-icon ${tone}`}>{icon}</i></div>
      <strong>{value}</strong>
      <p>{note}</p>
    </Tag>
  );
}

type TrendMetric = "netSales" | "netQuantity" | "grossMargin";
type TrendGranularity = "day" | "week" | "month";
type TrendChartMode = "combo" | "smooth";
type ProductTrendPoint = { key: string; label: string; netSalesCents: number; netQuantity: number; costAmountCents: number; grossProfitCents: number; grossMarginRate: number };

const trendMetricMeta: Record<TrendMetric, { label: string; color: string; areaRgb: string }> = {
  netSales: { label: "净销售额", color: "#396149", areaRgb: "57, 97, 73" },
  netQuantity: { label: "净销量", color: "#2d8a7e", areaRgb: "45, 138, 126" },
  grossMargin: { label: "大毛利率", color: "#7c6bb8", areaRgb: "124, 107, 184" },
};

function traceSmoothCanvasCurve(
  context: CanvasRenderingContext2D,
  coords: Array<{ x: number; y: number }>,
  tension = 0.2,
) {
  if (coords.length === 0) return;
  context.moveTo(coords[0].x, coords[0].y);
  if (coords.length === 1) return;
  if (coords.length === 2) {
    context.lineTo(coords[1].x, coords[1].y);
    return;
  }
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const clampY = (val: number) => Math.max(minY, Math.min(maxY, val));
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = clampY(p1.y + (p2.y - p0.y) * tension);
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = clampY(p2.y - (p3.y - p1.y) * tension);
    context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function drawRoundedBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  roundTop: boolean,
) {
  const r = Math.min(radius, width / 2, Math.abs(height) / 2);
  context.beginPath();
  if (roundTop) {
    context.moveTo(x, y + height);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height);
  } else {
    context.moveTo(x, y);
    context.lineTo(x + width, y);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
  }
  context.closePath();
  context.fill();
}

function aggregateProductTrend(daily: Array<{ date: string } & SalesStats>, granularity: TrendGranularity): ProductTrendPoint[] {
  const buckets = new Map<string, Omit<ProductTrendPoint, "grossMarginRate">>();
  for (const item of daily) {
    let key = item.date;
    let label = item.date.slice(5);
    if (granularity === "week") {
      const date = new Date(`${item.date}T00:00:00Z`);
      const weekDay = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() + (weekDay === 0 ? -6 : 1 - weekDay));
      key = date.toISOString().slice(0, 10);
      label = `${key.slice(5)}周`;
    } else if (granularity === "month") {
      key = item.date.slice(0, 7);
      label = key;
    }
    const current = buckets.get(key) ?? { key, label, netSalesCents: 0, netQuantity: 0, costAmountCents: 0, grossProfitCents: 0 };
    current.netSalesCents += item.netSalesCents;
    current.netQuantity += item.netQuantity;
    current.costAmountCents += item.costAmountCents;
    current.grossProfitCents += item.grossProfitCents;
    buckets.set(key, current);
  }
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key)).map((item) => ({
    ...item,
    grossMarginRate: item.netSalesCents === 0 ? 0 : (item.netSalesCents - item.costAmountCents) / item.netSalesCents,
  }));
}

export function ProductSalesTrend({ daily, selectedProductCount }: { daily: Array<{ date: string } & SalesStats>; selectedProductCount: number }) {
  const [granularity, setGranularity] = useState<TrendGranularity>("day");
  const [chartMode, setChartMode] = useState<TrendChartMode>("combo");
  const [selectedMetrics, setSelectedMetrics] = useState<TrendMetric[]>(["netSales", "netQuantity", "grossMargin"]);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animProgressRef = useRef(1);
  const lastAnimKeyRef = useRef("");
  const points = useMemo(() => aggregateProductTrend(daily, granularity), [daily, granularity]);
  const activePointIndex = points.length === 0 ? null : Math.min(hoveredPointIndex ?? points.length - 1, points.length - 1);
  const activePoint = activePointIndex === null ? null : points[activePointIndex];
  const hoveredPoint = hoveredPointIndex !== null && hoveredPointIndex < points.length ? points[hoveredPointIndex] : null;
  const totals = useMemo(() => {
    const netSalesCents = points.reduce((sum, item) => sum + item.netSalesCents, 0);
    const netQuantity = points.reduce((sum, item) => sum + item.netQuantity, 0);
    const costAmountCents = points.reduce((sum, item) => sum + item.costAmountCents, 0);
    return { netSalesCents, netQuantity, grossMarginRate: netSalesCents === 0 ? 0 : (netSalesCents - costAmountCents) / netSalesCents };
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const animKey = `${granularity}|${chartMode}|${selectedMetrics.join(",")}|${points.length}|${points[0]?.key ?? ""}|${points.at(-1)?.key ?? ""}`;
    const shouldAnimate = lastAnimKeyRef.current !== animKey && !prefersReducedMotion();
    lastAnimKeyRef.current = animKey;
    if (shouldAnimate) animProgressRef.current = 0;

    let rafId = 0;
    const startTime = typeof performance !== "undefined" ? performance.now() : 0;
    const durationMs = 480;

    const drawFrame = (progress: number) => {
      const width = Math.max(320, Math.floor(container.getBoundingClientRect().width));
      const height = 308;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const fontSans = '"Segoe UI Variable Text", "Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", sans-serif';
      const plot = { left: 26, right: width - 22, top: 24, bottom: height - 36 };
      const plotW = Math.max(1, plot.right - plot.left);
      const plotH = Math.max(1, plot.bottom - plot.top);

      // Horizontal dashed forest-neutral grid lines
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "#e4eae6";
      context.setLineDash([3, 4]);
      for (let index = 0; index <= 4; index += 1) {
        const y = plot.top + (plotH * index) / 4;
        context.beginPath();
        context.moveTo(plot.left, y);
        context.lineTo(plot.right, y);
        context.stroke();
      }
      context.restore();

      if (points.length === 0 || selectedMetrics.length === 0) return;

      const slotW = plotW / Math.max(1, points.length);
      const xFor = (index: number) =>
        points.length === 1
          ? (plot.left + plot.right) / 2
          : chartMode === "combo" && selectedMetrics.includes("netSales")
            ? plot.left + slotW * (index + 0.5)
            : plot.left + (plotW * index) / (points.length - 1);

      const metricValue = (point: ProductTrendPoint, metric: TrendMetric) =>
        metric === "netSales" ? point.netSalesCents / 100 : metric === "netQuantity" ? point.netQuantity : point.grossMarginRate * 100;

      // Hover highlight band + crosshair
      if (activePointIndex !== null) {
        const activeX = xFor(activePointIndex);
        if (hoveredPointIndex !== null) {
          context.save();
          const bandW = Math.max(16, Math.min(48, slotW));
          context.fillStyle = "rgba(57, 97, 73, 0.075)";
          context.fillRect(activeX - bandW / 2, plot.top - 4, bandW, plotH + 8);
          context.restore();
        }
        context.save();
        context.strokeStyle = "#abc4b4";
        context.setLineDash([4, 3]);
        context.lineWidth = 1.25;
        context.beginPath();
        context.moveTo(activeX, plot.top);
        context.lineTo(activeX, plot.bottom);
        context.stroke();
        context.restore();
      }

      const showPointLabels = points.length <= 10;
      const useComboBars = chartMode === "combo" && selectedMetrics.includes("netSales");

      // Draw netSales bars first in combo mode
      if (useComboBars) {
        const values = points.map((point) => metricValue(point, "netSales"));
        const minimum = Math.min(0, ...values);
        const maximum = Math.max(0, ...values);
        const span = maximum - minimum || 1;
        const zeroY = plot.bottom - ((0 - minimum) / span) * plotH;
        const barW = Math.max(5, Math.min(28, slotW * 0.54));

        // Zero axis line when negative values exist
        if (minimum < 0) {
          context.save();
          context.strokeStyle = "#c5d3ca";
          context.lineWidth = 1.2;
          context.beginPath();
          context.moveTo(plot.left, zeroY);
          context.lineTo(plot.right, zeroY);
          context.stroke();
          context.restore();
        }

        values.forEach((value, index) => {
          const cx = xFor(index);
          const rawY = plot.bottom - ((value - minimum) / span) * plotH;
          const animatedHeight = Math.abs(zeroY - rawY) * progress;
          const isNeg = value < 0;
          const y = isNeg ? zeroY : zeroY - animatedHeight;
          const isHovered = hoveredPointIndex === index;
          const isDim = hoveredPointIndex !== null && !isHovered;

          context.save();
          context.globalAlpha = isDim ? 0.36 : 0.9;
          const grad = context.createLinearGradient(0, y, 0, y + Math.max(1, animatedHeight));
          if (isNeg) {
            grad.addColorStop(0, "#16825d");
            grad.addColorStop(1, "#26a379");
          } else {
            grad.addColorStop(0, isHovered ? "#558c6c" : "#4d7f62");
            grad.addColorStop(1, "#396149");
          }
          context.fillStyle = grad;
          drawRoundedBar(context, cx - barW / 2, y, barW, Math.max(2, animatedHeight), 4, !isNeg);
          context.restore();
        });
      }

      // Draw smooth curve series
      const lineMetrics = useComboBars ? selectedMetrics.filter((m) => m !== "netSales") : selectedMetrics;
      const revealRightX = plot.left + plotW * progress;

      for (const [metricIndex, metric] of lineMetrics.entries()) {
        const meta = trendMetricMeta[metric];
        const values = points.map((point) => metricValue(point, metric));
        const minimum = Math.min(0, ...values);
        const maximum = Math.max(0, ...values);
        const span = maximum - minimum || 1;
        const coords = values.map((value, index) => ({
          x: xFor(index),
          y: plot.bottom - ((value - minimum) / span) * plotH,
        }));

        // Clip horizontally for smooth left-to-right entrance
        context.save();
        context.beginPath();
        context.rect(plot.left - 8, plot.top - 16, Math.max(0, revealRightX - plot.left + 16), plotH + 32);
        context.clip();

        // Subtle forest-green area fill on primary curve
        if (coords.length >= 2 && (metricIndex === 0 || !useComboBars)) {
          const areaGrad = context.createLinearGradient(0, plot.top, 0, plot.bottom);
          areaGrad.addColorStop(0, `rgba(${meta.areaRgb}, ${metricIndex === 0 ? 0.19 : 0.09})`);
          areaGrad.addColorStop(1, `rgba(${meta.areaRgb}, 0)`);
          context.beginPath();
          traceSmoothCanvasCurve(context, coords);
          context.lineTo(coords[coords.length - 1].x, plot.bottom);
          context.lineTo(coords[0].x, plot.bottom);
          context.closePath();
          context.fillStyle = areaGrad;
          context.fill();
        }

        // Smooth Bezier stroke
        context.strokeStyle = meta.color;
        context.lineWidth = 2.6;
        context.lineJoin = "round";
        context.lineCap = "round";
        if (metric === "grossMargin" && lineMetrics.length > 1) {
          context.setLineDash([6, 4]);
        }
        context.beginPath();
        traceSmoothCanvasCurve(context, coords);
        context.stroke();
        context.setLineDash([]);
        context.restore();

        // Data points & concise value labels
        coords.forEach((coord, index) => {
          if (coord.x > revealRightX + 2) return;
          const isActive = activePointIndex === index;
          const r = isActive ? 5.2 : 3.2;

          context.save();
          if (isActive) {
            context.fillStyle = `rgba(${meta.areaRgb}, 0.22)`;
            context.beginPath();
            context.arc(coord.x, coord.y, 9.5, 0, Math.PI * 2);
            context.fill();
          }
          context.fillStyle = "#ffffff";
          context.strokeStyle = meta.color;
          context.lineWidth = isActive ? 2.6 : 2;
          context.beginPath();
          context.arc(coord.x, coord.y, r, 0, Math.PI * 2);
          context.fill();
          context.stroke();

          if (showPointLabels && progress >= 0.98) {
            const point = points[index];
            const valueLabel = metric === "netSales"
              ? formatCurrencyFromCents(point.netSalesCents)
              : metric === "netQuantity"
                ? `${formatCount(point.netQuantity)}件`
                : formatRate(point.grossMarginRate);
            const labelY = Math.max(plot.top + 12, coord.y - 10 - metricIndex * 14);
            context.font = `600 11px ${fontSans}`;
            context.textAlign = "center";
            const labelWidth = context.measureText(valueLabel).width + 8;
            const labelX = Math.min(plot.right - labelWidth / 2, Math.max(plot.left + labelWidth / 2, coord.x));
            context.fillStyle = "rgba(255, 255, 255, 0.92)";
            context.fillRect(labelX - labelWidth / 2, labelY - 10, labelWidth, 13);
            context.fillStyle = meta.color;
            context.fillText(valueLabel, labelX, labelY);
          }
          context.restore();
        });
      }

      // X-axis labels (>=12px crisp tabular typography)
      const labelStep = Math.max(1, Math.ceil(points.length / 7));
      context.save();
      context.font = `500 12px ${fontSans}`;
      context.fillStyle = "#6e7e74";
      context.textAlign = "center";
      points.forEach((point, index) => {
        if (index % labelStep !== 0 && index !== points.length - 1) return;
        context.fillText(point.label, xFor(index), height - 11);
      });
      context.restore();
    };

    const tick = (now: number) => {
      if (!shouldAnimate) {
        animProgressRef.current = 1;
        drawFrame(1);
        return;
      }
      const raw = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - raw, 3);
      animProgressRef.current = eased;
      drawFrame(eased);
      if (raw < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    const observer = new ResizeObserver(() => drawFrame(animProgressRef.current));
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [activePointIndex, chartMode, granularity, hoveredPointIndex, points, selectedMetrics]);

  const handleTrendPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotLeft = 26;
    const plotRight = Math.max(plotLeft + 1, bounds.width - 22);
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left - plotLeft) / (plotRight - plotLeft)));
    setHoveredPointIndex(Math.round(progress * (points.length - 1)));
  };

  const toggleMetric = (metric: TrendMetric) => setSelectedMetrics((current) => current.includes(metric)
    ? current.length === 1 ? current : current.filter((item) => item !== metric)
    : [...current, metric]);
  const activePointMetricValue = (metric: TrendMetric) => {
    if (!activePoint) return "—";
    if (metric === "netSales") return formatCurrencyFromCents(activePoint.netSalesCents);
    if (metric === "netQuantity") return `${formatCount(activePoint.netQuantity)} 件`;
    return formatRate(activePoint.grossMarginRate);
  };

  const hoverXPercent = hoveredPointIndex !== null && points.length > 0
    ? points.length === 1 ? 50 : (hoveredPointIndex / (points.length - 1)) * 100
    : 50;
  const flipTipLeft = hoverXPercent > 62;

  return <section className="panel product-sales-trend-panel">
    <div className="product-trend-toolbar"><div><span className="eyebrow">PRODUCT SITUATION</span><h2>货品情况</h2><p>{selectedProductCount > 0 ? `已按 ${formatCount(selectedProductCount)} 个货品汇总` : "当前统计周期内全部货品的经营趋势"} · 净销售额、净销量与大毛利率可单独或组合查看。</p></div><div className="product-trend-controls"><div className="trend-metric-toggle" role="group" aria-label="趋势指标选择">{(Object.keys(trendMetricMeta) as TrendMetric[]).map((metric) => <button type="button" key={metric} className={selectedMetrics.includes(metric) ? "active" : ""} aria-pressed={selectedMetrics.includes(metric)} onClick={() => toggleMetric(metric)}><i style={{ background: trendMetricMeta[metric].color }} />{trendMetricMeta[metric].label}</button>)}</div><div className="trend-mode-toggle" role="group" aria-label="图表样式切换"><button type="button" className={chartMode === "combo" ? "active" : ""} aria-pressed={chartMode === "combo"} onClick={() => setChartMode("combo")}>柱折组合</button><button type="button" className={chartMode === "smooth" ? "active" : ""} aria-pressed={chartMode === "smooth"} onClick={() => setChartMode("smooth")}>平滑曲线</button></div><div className="segmented trend-granularity" role="group" aria-label="趋势时间维度"><button type="button" className={granularity === "day" ? "active" : ""} onClick={() => setGranularity("day")}>日维度</button><button type="button" className={granularity === "week" ? "active" : ""} onClick={() => setGranularity("week")}>周维度</button><button type="button" className={granularity === "month" ? "active" : ""} onClick={() => setGranularity("month")}>月维度</button></div></div></div>
    <div className="product-trend-summary"><div className={selectedMetrics.includes("netSales") ? "active" : ""}><span>净销售额</span><strong>{formatCurrencyFromCents(totals.netSalesCents)}</strong></div><div className={selectedMetrics.includes("netQuantity") ? "active" : ""}><span>净销量</span><strong>{formatCount(totals.netQuantity)} 件</strong></div><div className={selectedMetrics.includes("grossMargin") ? "active" : ""}><span>大毛利率</span><strong>{formatRate(totals.grossMarginRate)}</strong></div><small>{granularity === "day" ? "按日" : granularity === "week" ? "按自然周" : "按自然月"}汇总 · {formatCount(points.length)} 个数据点</small></div>
    <div className="product-trend-canvas ui-chart-stage"><canvas ref={canvasRef} role="img" aria-label={`货品销售趋势，当前显示${selectedMetrics.map((metric) => trendMetricMeta[metric].label).join("、")}`} onPointerMove={handleTrendPointerMove} onPointerLeave={() => setHoveredPointIndex(null)} />{hoveredPoint && <div className="ui-chart-tip" style={flipTipLeft ? { left: `calc(${hoverXPercent.toFixed(2)}% - 14px)`, transform: "translateX(-100%)", top: 14 } : { left: `calc(${hoverXPercent.toFixed(2)}% + 14px)`, top: 14 }}><span className="ui-chart-tip-title">{hoveredPoint.label}</span>{(["netSales", "netQuantity", "grossMargin"] as TrendMetric[]).map((metric) => <div className="ui-chart-tip-row" key={metric}><span className="ui-chart-tip-label"><i className="ui-chart-tip-dot" style={{ background: trendMetricMeta[metric].color }} />{trendMetricMeta[metric].label}</span><span className="ui-chart-tip-value">{metric === "netSales" ? formatCurrencyFromCents(hoveredPoint.netSalesCents) : metric === "netQuantity" ? `${formatCount(hoveredPoint.netQuantity)} 件` : formatRate(hoveredPoint.grossMarginRate)}</span></div>)}</div>}{points.length === 0 && <div className="trend-empty">当前统计周期没有可绘制的货品销售数据。</div>}</div>
    {activePoint && <div className="product-trend-detail-area"><div className="product-trend-data-card" aria-live="polite"><small>{activePoint.label} 对应数据</small><div>{(["netSales", "netQuantity", "grossMargin"] as TrendMetric[]).map((metric) => <span key={metric}><i className="trend-data-dot" style={{ background: trendMetricMeta[metric].color }} />{trendMetricMeta[metric].label}<strong>{activePointMetricValue(metric)}</strong></span>)}</div></div></div>}
    {points.length > 0 && <p className="trend-data-hint">移动至每个趋势节点，可查看当前日期的净销售额、净销量和大毛利率。</p>}
  </section>;
}

type SalesDistributionDimension = "shop" | "platform";
type SalesDistributionRow = { name: string; platform: string; shopCount: number; grossSalesCents: number; netSalesCents: number; grossProfitCents: number; refundAmountCents: number; netQuantity: number; refundRate: number };

export function ShopSalesDistribution({ shops }: { shops: SalesChannel[] }) {
  const [dimension, setDimension] = useState<SalesDistributionDimension>("shop");
  const distributionRows = useMemo<SalesDistributionRow[]>(() => {
    if (dimension === "shop") return shops.map((shop) => ({ name: shop.name || "未分类", platform: shop.platform || "未分类平台", shopCount: 1, grossSalesCents: shop.grossSalesCents, netSalesCents: shop.netSalesCents, grossProfitCents: shop.grossProfitCents, refundAmountCents: shop.refundAmountCents, netQuantity: shop.netQuantity, refundRate: shop.refundRate }));
    const grouped = new Map<string, SalesDistributionRow>();
    shops.forEach((shop) => {
      const platform = shop.platform || "未分类平台";
      const row = grouped.get(platform) ?? { name: platform, platform, shopCount: 0, grossSalesCents: 0, netSalesCents: 0, grossProfitCents: 0, refundAmountCents: 0, netQuantity: 0, refundRate: 0 };
      row.shopCount += 1;
      row.grossSalesCents += shop.grossSalesCents;
      row.netSalesCents += shop.netSalesCents;
      row.grossProfitCents += shop.grossProfitCents;
      row.refundAmountCents += shop.refundAmountCents;
      row.netQuantity += shop.netQuantity;
      row.refundRate = row.grossSalesCents === 0 ? 0 : row.refundAmountCents / row.grossSalesCents;
      grouped.set(platform, row);
    });
    return [...grouped.values()];
  }, [dimension, shops]);
  const sortedRows = useMemo(() => [...distributionRows].sort((left, right) => right.netSalesCents - left.netSalesCents), [distributionRows]);
  const maxNetSales = Math.max(1, ...sortedRows.map((item) => Math.max(0, item.netSalesCents)));
  const label = dimension === "shop" ? "店铺" : "平台";
  const countLabel = dimension === "shop" ? "家店铺" : "个平台";
  return <section className="panel shop-sales-distribution"><div className="shop-distribution-header"><div><span className="eyebrow">SALES DISTRIBUTION</span><h2>销售分布</h2><p>可切换店铺或平台维度；净销量已按退货后的销量计算。</p></div><div className="shop-distribution-actions"><div className="segmented shop-distribution-dimension" role="group" aria-label="销售分布维度"><button type="button" className={dimension === "shop" ? "active" : ""} onClick={() => setDimension("shop")}>店铺维度</button><button type="button" className={dimension === "platform" ? "active" : ""} onClick={() => setDimension("platform")}>平台维度</button></div><span className="soft-tag">{formatCount(sortedRows.length)} {countLabel}</span></div></div><div className="shop-distribution-columns"><span>{label}</span><span>净销售额</span><span>净销量</span><span>退货率</span></div><div className="shop-distribution-list">{sortedRows.map((row) => <article key={`${dimension}-${row.platform}-${row.name}`}><div className="shop-distribution-name"><strong title={row.name}>{row.name}</strong><small>{dimension === "shop" ? row.platform : `${formatCount(row.shopCount)} 家店铺`}<i><b style={{ width: `${Math.max(2, Math.max(0, row.netSalesCents) / maxNetSales * 100)}%` }} /></i></small></div><strong>{formatCurrencyFromCents(row.netSalesCents)}</strong><span>{formatCount(row.netQuantity)}</span><em className={row.refundRate > .1 ? "orange-text" : ""}>{formatRate(row.refundRate)}</em></article>)}{sortedRows.length === 0 && <div className="shop-distribution-empty">当前筛选条件没有{label}销售记录。</div>}</div></section>;
}

export function ProductPlatformSalesShare({ platforms }: { platforms: SalesChannel[] }) {
  const rows = useMemo(
    () => [...platforms].sort((left, right) => right.grossSalesCents - left.grossSalesCents),
    [platforms],
  );
  const totalSalesCents = rows.reduce((sum, item) => sum + item.grossSalesCents, 0);

  return <section className="panel product-platform-sales-share">
    <div className="product-platform-share-header"><div><span className="eyebrow">PLATFORM MIX</span><h2>平台销售占比</h2><p>按正向销售额计算；退货额在下方店铺销售分布中单独展示。</p></div><span className="soft-tag">{formatCount(rows.length)} 个平台</span></div>
    <div className="product-platform-share-columns"><span>平台</span><span>销售额</span><span>占比</span></div>
    <div className="product-platform-share-list">{rows.map((row) => {
      const shareRate = totalSalesCents > 0 ? row.grossSalesCents / totalSalesCents : 0;
      return <article key={`${row.platform}-${row.groupKey}`}><div><strong title={row.name}>{row.name || "未分类"}</strong><i><b style={{ width: `${Math.max(2, Math.min(100, shareRate * 100))}%` }} /></i></div><strong>{formatCurrencyFromCents(row.grossSalesCents)}</strong><span>{formatRate(shareRate)}</span></article>;
    })}{rows.length === 0 && <div className="product-platform-share-empty">当前规格在所选周期内没有平台销售记录。</div>}</div>
  </section>;
}

