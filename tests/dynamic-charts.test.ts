import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHART_PALETTE,
  buildSmoothAreaPath,
  buildSmoothPath,
  chartColorAt,
  splitPointSegments,
} from "../app/ui/charts/chart-utils";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("smooth Bezier helpers clamp overshoot and preserve missing-data gaps", () => {
  assert.equal(buildSmoothPath([]), "");
  assert.equal(buildSmoothPath([{ x: 10, y: 20 }]), "M10.00,20.00");
  assert.equal(buildSmoothPath([{ x: 0, y: 10 }, { x: 20, y: 30 }]), "M0.00,10.00 L20.00,30.00");

  // Flat zero segment must never dip below baseline y=100
  const curve = buildSmoothPath([
    { x: 0, y: 20 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
    { x: 150, y: 40 },
  ]);
  assert.match(curve, /^M0\.00,20\.00 C/);
  assert.match(curve, /C[\d.]+,100\.00 [\d.]+,100\.00 100\.00,100\.00/);

  const area = buildSmoothAreaPath([{ x: 0, y: 40 }, { x: 100, y: 20 }], 100);
  assert.match(area, /L100\.00,100\.00 L0\.00,100\.00 Z$/);

  const segments = splitPointSegments([
    { x: 0, y: 10 },
    { x: 10, y: 20 },
    null,
    { x: 30, y: 15 },
    null,
    null,
    { x: 60, y: 5 },
    { x: 70, y: 12 },
  ]);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => s.length), [2, 1, 2]);
  assert.equal(chartColorAt(0), CHART_PALETTE[0]);
  assert.equal(chartColorAt(CHART_PALETTE.length), CHART_PALETTE[0]);
});

test("forest-green dynamic charts use only defined tokens, reduced-motion guard, and zero third-party chart libraries", async () => {
  const [tokens, chartsCss, pkg, bi, sales, businessUi, finance, inventory, operations, metricTrend] = await Promise.all([
    source("../app/styles/tokens.css"),
    source("../app/ui/charts/charts.css"),
    source("../package.json"),
    source("../app/bi-cockpit-view.tsx"),
    source("../app/sales-module-view.tsx"),
    source("../app/module-view-business-ui.tsx"),
    source("../app/sales-finance-views.tsx"),
    source("../app/inventory-module-view.tsx"),
    source("../app/operations-view.tsx"),
    source("../app/netshop/promotion/MetricTrend.tsx"),
  ]);

  const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const used = new Set([...chartsCss.matchAll(/var\(--([a-z0-9-]+)/gi)].map((m) => m[1]));
  assert.deepEqual([...used].filter((name) => !defined.has(name)).sort(), []);
  assert.match(chartsCss, /@media \(prefers-reduced-motion: reduce\)/);

  // Zero external chart packages added
  assert.doesNotMatch(pkg, /"echarts"|"chart\.js"|"recharts"|"apexcharts"|"highcharts"/i);

  // All 4 business battlefields wired to unified forest-green dynamic charts
  assert.match(bi, /<AnimatedBarTrendChart\b/);
  assert.match(sales, /<InteractiveDonutChart\b/);
  assert.match(businessUi, /trend-mode-toggle/);
  assert.match(businessUi, /<canvas\b/);
  assert.match(businessUi, /#396149/);
  assert.match(finance, /buildSmoothPath/);
  assert.match(inventory, /<AgeDualAxisChart\b/);
  assert.match(inventory, /hoveredHealthStatus/);
  assert.match(operations, /<InteractiveDonutChart\b/);
  assert.doesNotMatch(operations, /#2f72ef/i);
  assert.match(metricTrend, /splitPointSegments/);
  assert.match(metricTrend, /仅绘制完整可用点；缺数处断开/);
});
