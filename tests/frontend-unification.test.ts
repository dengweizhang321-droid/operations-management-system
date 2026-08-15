import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { normalizeTableCellValue, tableRowMatchesColumnFilters } from "../lib/ui/table-column-filter";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("column filters normalize cells and combine multi-select columns with AND semantics", () => {
  const filters = new Map<number, ReadonlySet<string>>([
    [0, new Set(["京东", "天猫"])],
    [2, new Set(["正常"])],
  ]);
  assert.equal(normalizeTableCellValue("  京东\n 自营  "), "京东 自营");
  assert.equal(tableRowMatchesColumnFilters(["京东", "净水", "正常"], filters), true);
  assert.equal(tableRowMatchesColumnFilters(["抖音", "净水", "正常"], filters), false);
  assert.equal(tableRowMatchesColumnFilters(["天猫", "净水", "异常"], filters), false);

  const dateFilter = new Map<number, ReadonlySet<string>>([[0, new Set(["2026-08-02"])]]);
  assert.equal(tableRowMatchesColumnFilters([["2026-08-01", "2026-08-02"]], dateFilter), true);
  assert.equal(tableRowMatchesColumnFilters([["2026-08-03", "2026-08-04"]], dateFilter), false);
});

test("all rendered tables receive accessible multi-select column filtering", async () => {
  const [page, component, styles, netshopDatabase] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/ui/table-column-filters.tsx"),
    source("../app/globals.css"),
    source("../lib/netshop/database.ts"),
  ]);
  assert.match(page, /<TableColumnFilters \/>/);
  assert.match(component, /querySelectorAll<HTMLTableElement>\("table"\)/);
  assert.match(component, /querySelectorAll<HTMLTableCellElement>\("thead th"\)/);
  assert.match(component, /aria-multiselectable="true"/);
  assert.match(component, /tableRowMatchesColumnFilters/);
  assert.match(component, /dataset\.columnFilterValues/);
  assert.match(component, /closeOnExternalScroll/);
  assert.match(component, /popoverRef\.current\?\.contains\(source\)/);
  assert.match(page, /data-column-filter-values=\{item\.dates\?\.join\("\\u001f"\)\}/);
  assert.match(netshopDatabase, /GROUP_CONCAT\(DISTINCT r\.business_date\) AS coverage_dates/);
  assert.match(netshopDatabase, /dates: \[\.\.\.new Set\(\(row\.coverage_dates/);
  assert.match(styles, /\.column-filter-popover/);
  assert.match(styles, /overscroll-behavior: contain/);
  assert.match(styles, /\.column-filter-row-hidden/);
});

test("left navigation follows the requested management groups and exact order", async () => {
  const page = await source("../app/page.tsx");
  assert.match(page, /\{ label: "经营管理", keys: \["dashboard", "market", "sales", "shop", "customer_service", "product", "inventory", "workflow", "n8n_workflows", "ai"\] \}/);
  assert.match(page, /\{ label: "系统管理", keys: \["import", "settings"\] \}/);
  assert.match(page, /navGroups\.map\(\(group\) => <div className="nav-group"/);
});

test("one global page head owns the shared period and passes it to every module", async () => {
  const [page, market] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/market-view.tsx"),
  ]);
  assert.doesNotMatch(page, /className="page-intro"/);
  assert.match(page, /<h1>\{current\.label\}<\/h1>/);
  assert.match(page, /customStartDate=\{globalPeriod\.startDate\} customEndDate=\{globalPeriod\.endDate\}/);
  assert.match(page, /new URLSearchParams\(\{ startDate: customStartDate, endDate: customEndDate \}\)/);
  assert.match(market, /const marketStartDate = customStartDate/);
  assert.match(market, /const marketEndDate = customEndDate/);
  assert.match(market, /market-overview-period market-global-period/);
});

test("module filters transmit repeated values through their API boundaries", async () => {
  const [page, customerRoute, market, masterRoute, annotation, annotationRoute, inventoryRoute] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/api/customer-service/conversations/route.ts"),
    source("../app/market-view.tsx"),
    source("../app/api/market/master/route.ts"),
    source("../app/market-annotation-view.tsx"),
    source("../app/api/market/annotations/route.ts"),
    source("../app/api/inventory/overview/route.ts"),
  ]);
  assert.match(page, /categories\.forEach\(\(value\) => params\.append\("category", value\)\)/);
  assert.match(page, /shopNames\.forEach\(\(value\) => params\.append\("shopName", value\)\)/);
  assert.match(customerRoute, /searchParams\.getAll\("shopName"\)/);
  assert.match(customerRoute, /searchParams\.getAll\("category"\)/);
  assert.match(market, /pendingPriceSources\.forEach\(\(value\) => params\.append\("pendingPriceSource", value\)\)/);
  assert.match(masterRoute, /pendingPriceSources: params\.getAll\("pendingPriceSource"\)/);
  assert.match(annotation, /itemSegments\.forEach\(\(value\) => params\.append\("itemSegment", value\)\)/);
  assert.match(annotationRoute, /itemSegments: params\.getAll\("itemSegment"\)/);
  assert.match(inventoryRoute, /startDate: params\.get\("startDate"\)/);
  assert.match(inventoryRoute, /endDate: params\.get\("endDate"\)/);
});

test("promotion analysis separates JD and Tmall pages with platform-specific labels and links", async () => {
  const [page, database, query, route] = await Promise.all([
    source("../app/page.tsx"),
    source("../lib/netshop/database.ts"),
    source("../lib/netshop/promotion-query.ts"),
    source("../app/api/netshop/promotion-performance/route.ts"),
  ]);
  assert.match(page, /title: "京东推广"/);
  assert.match(page, />京东推广<\/button>/);
  assert.match(page, />天猫推广<\/button>/);
  assert.match(page, /platform: pageConfig\.platform/);
  assert.match(page, /netshopProductUrl\(item\.platform, item\.id\)/);
  assert.match(page, /京准通总订单金额不是退款后的销售净额/);
  assert.match(database, /netshopPromotionSourceSql/);
  assert.match(database, /netshopPromotionPaymentSourceSql/);
  assert.match(query, /r\.source = 'jd_promotion'/);
  assert.match(query, /r\.source = 'jd_sku_daily'/);
  assert.match(route, /读取网店推广数据失败/);
});
