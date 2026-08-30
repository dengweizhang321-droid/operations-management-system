import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BI 首页显式请求库存 dashboard 轻量投影", async () => {
  const [dashboardView, route, overview] = await Promise.all([
    readFile(new URL("../app/dashboard-module-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/overview.ts", import.meta.url), "utf8"),
  ]);
  const dashboardProjection = overview.slice(
    overview.indexOf("export async function getInventoryDashboardOverview"),
    overview.indexOf("export async function getInventoryOverview"),
  );
  const planProjection = overview.slice(overview.indexOf("export async function getInventoryPlanOverview"));
  const rowJsonBase = overview.slice(
    overview.indexOf("const INVENTORY_OVERVIEW_ROW_JSON_BASE_SQL"),
    overview.indexOf("const INVENTORY_OVERVIEW_ROW_JSON_EXTENSION_SQL"),
  );
  const rowJsonExtension = overview.slice(
    overview.indexOf("const INVENTORY_OVERVIEW_ROW_JSON_EXTENSION_SQL"),
    overview.indexOf("const INVENTORY_OVERVIEW_ROW_JSON_SQL ="),
  );

  assert.match(dashboardView, /new URLSearchParams\(\{ view: "dashboard", startDate: customStartDate, endDate: customEndDate \}\)/);
  assert.match(dashboardView, /requestJson<InventoryDashboardResponse>/);
  assert.match(route, /parseInventoryOverviewView\(params\)/);
  assert.match(route, /requestedView === "dashboard"[\s\S]*?getInventoryDashboardOverview/);
  assert.match(route, /requestedView === "plan"[\s\S]*?getInventoryPlanOverview/);
  assert.match(route, /getInventoryOverview\(db/);
  assert.match(dashboardProjection, /readInventoryOverviewMetrics/);
  assert.doesNotMatch(dashboardProjection, /queryReplenishmentPlans|getReplenishmentPlanSummary|recommendationsResult|warehouseResult/);
  assert.match(planProjection, /queryReplenishmentPlans|getReplenishmentPlanSummary/);
  assert.doesNotMatch(planProjection, /buildInventoryCte|readInventoryOverviewMetrics|readInventoryOverviewProjection/);
  assert.match(overview, /operation: "freshness"/);
  assert.match(overview, /freshness\.data\.dataStartDate[\s\S]*freshness\.data\.dataCutoffDate/);
  assert.doesNotMatch(overview, /sales_order_lines|sales_import_batches/);
  assert.equal((rowJsonBase.match(/^\s*'[^']+',/gm) ?? []).length, 15);
  assert.equal((rowJsonExtension.match(/^\s*'[^']+',/gm) ?? []).length, 7);
  assert.ok((rowJsonBase.match(/^\s*'[^']+',/gm) ?? []).length * 2 <= 32);
  assert.ok((rowJsonExtension.match(/^\s*'[^']+',/gm) ?? []).length * 2 <= 32);
  assert.match(overview, /json_patch\([\s\S]*INVENTORY_OVERVIEW_ROW_JSON_BASE_SQL[\s\S]*INVENTORY_OVERVIEW_ROW_JSON_EXTENSION_SQL/);
  assert.match(overview, /'metrics' AS section[\s\S]*UNION ALL[\s\S]*'page' AS section[\s\S]*UNION ALL[\s\S]*'recommendation' AS section/);
  assert.doesNotMatch(overview, /json_group_array/);
  assert.match(overview, /INSTR\(LOWER\(product_code\), \?\) > 0/);
  assert.doesNotMatch(overview, /\bLIKE\s+\?/);
});
