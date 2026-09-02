import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BI 首页显式请求库存 dashboard 轻量投影", async () => {
  const [dashboardView, route, overview] = await Promise.all([
    readFile(new URL("../app/dashboard-module-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/inventory/query.py", import.meta.url), "utf8"),
  ]);

  assert.match(dashboardView, /new URLSearchParams\(\{ view: "dashboard", startDate: customStartDate, endDate: customEndDate \}\)/);
  assert.match(dashboardView, /requestJson<InventoryDashboardResponse>/);
  assert.match(route, /parseInventoryOverviewView\(params\)/);
  assert.match(route, /createDjangoInventoryService/);
  assert.match(route, /INVENTORY_OVERVIEW_PATH/);
  assert.match(route, /rawQuery: params\.toString\(\)/);
  assert.doesNotMatch(route, /getInventoryDatabase|getD1Database|env\.DB/);
  assert.match(overview, /if view == "dashboard":/);
  assert.match(overview, /return \{key: response\[key\] for key in \("hasInventory", "sync", "metrics", "health"\)\}/);
  assert.match(overview, /if view == "plan":[\s\S]*?query_plans/);
  assert.match(overview, /"operation": "freshness"/);
  assert.match(overview, /freshness\.get\("dataStartDate"\)[\s\S]*freshness\.get\("dataCutoffDate"\)/);
  assert.doesNotMatch(overview, /sales_order_lines|sales_import_batches/);
});
