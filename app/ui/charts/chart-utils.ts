export type ChartPoint = { x: number; y: number };

/** Unified 8-color chart palette aligned with tokens.css (--chart-1..8). */
export const CHART_PALETTE = [
  "#396149",
  "#2d8a7e",
  "#d48a29",
  "#7c6bb8",
  "#4b7399",
  "#6c9a5e",
  "#c4714b",
  "#c84b58",
] as const;

export function chartColorAt(index: number): string {
  return CHART_PALETTE[((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}

/**
 * Monotone-clamped Catmull-Rom cubic Bezier path for crisp, overshoot-free curves.
 * Clamping control-point Y between adjacent endpoints ensures zero-value segments stay flat.
 */
export function buildSmoothPath(points: readonly ChartPoint[], tension = 0.2): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
  }

  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = clampY(p1.y + (p2.y - p0.y) * tension);
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = clampY(p2.y - (p3.y - p1.y) * tension);

    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Build closed area SVG path from a smooth curve down to baselineY. */
export function buildSmoothAreaPath(points: readonly ChartPoint[], baselineY: number, tension = 0.2): string {
  if (points.length < 2) return "";
  const curve = buildSmoothPath(points, tension);
  const first = points[0];
  const last = points[points.length - 1];
  return `${curve} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
}

/**
 * Split a nullable point series into contiguous valid segments so missing values break cleanly.
 */
export function splitPointSegments(points: readonly (ChartPoint | null)[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const point of points) {
    if (point === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
