import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

test("build emits the operations console", async () => {
  const assetRoot = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetRoot);
  const pageAsset = assetNames.find((name) => /^page-.*\.js$/.test(name));
  assert.ok(pageAsset, "client page bundle is missing");

  const [server, page] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readFile(new URL(pageAsset, assetRoot), "utf8"),
  ]);
  assert.match(server, /api\/imports\/sales/);
  assert.match(server, /api\/sales\/summary/);
  assert.match(server, /api\/imports\/inventory/);
  assert.match(server, /api\/imports\/inventory\/chunks/);
  assert.match(server, /api\/imports\/erp/);
  assert.match(server, /api\/imports\/erp\/chunks/);
  assert.match(server, /api\/inventory\/overview/);
  assert.match(server, /api\/inventory\/replenishment/);
  assert.match(server, /api\/inventory\/age-analysis/);
  assert.match(server, /api\/products\/summary/);
  assert.match(server, /api\/settings/);
  assert.match(server, /api\/auth\/me/);
  assert.match(server, /api\/search/);
  assert.match(page, /TERUISI/);
  assert.match(page, /销售分析/);
  assert.match(page, /渠道经营诊断/);
  assert.match(page, /channel-detail-panel/);
  assert.match(page, /数据导入/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape/i);
});

test("searches all allowlisted system data through the grouped authenticated search", async () => {
  const [page, route, search] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/search/global-search.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/search\?q=/);
  assert.match(page, /搜索系统全部数据/);
  assert.match(page, /搜索商品、订单、库存、市场、客服、财务或批次/);
  assert.match(page, /globalSearchResult\.groups/);
  assert.match(page, /按字段白名单搜索/);
  assert.match(route, /requireAppPrincipal/);
  assert.match(route, /searchAllBusinessData/);
  assert.match(route, /principal/);
  for (const domain of [
    "erp_product_master", "sales_order_lines", "netshop_rows", "inventory_stock_lines",
    "erp_inventory_age_lines", "inventory_age_metrics", "erp_combo_items", "replenishment_plan_items",
    "market_ranking_entries", "market_sku_annotations", "customer_service_conversations",
    "finance_lines", "finance_targets", "workflow_tasks",
  ]) assert.match(search, new RegExp(domain));
  assert.match(search, /scopeSql\(principal/);
  assert.match(search, /GLOBAL_SEARCH_SCHEMA_TABLE_AUDIT/);
  assert.doesNotMatch(route, /SELECT\s|LIKE\s|sqlite_master/i);
});

test("wires the sales import and analytics capabilities", async () => {
  const [page, layout, schema, importRoute, chunkRoute, chunkService, summaryRoute, summaryService, packageJson, hosting, og] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/sales/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/sales/chunks/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/sales/chunked-upload.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/sales/summary/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/sales/summary.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      stat(new URL("../public/og.png", import.meta.url)),
    ]);

  assert.match(page, /\/api\/imports\/sales/);
  assert.match(page, /\/api\/sales\/summary/);
  assert.match(page, /setActiveTab/);
  assert.match(page, /平台汇总/);
  assert.match(page, /网店总览/);
  assert.match(page, /outlets/);
  assert.match(page, /近15天/);
  assert.match(page, /昨天/);
  assert.match(page, /function SearchableSelect/);
  assert.match(page, /function SearchableMultiSelect/);
  assert.match(page, /searchable-select-search/);
  assert.match(page, /搜索店铺或平台/);
  assert.match(page, /columnPickerSearch/);
  assert.doesNotMatch(page, /<select\b/);
  assert.doesNotMatch(page, /本季度/);
  assert.doesNotMatch(page, /DateRangeSlider/);
  assert.match(page, /选择统计月份/);
  assert.match(page, /productPeriodPickerOpen/);
  assert.match(page, /货品情况/);
  assert.match(page, /销售分布/);
  assert.match(page, /平台维度/);
  assert.match(page, /净销量已按退货后的销量计算/);
  assert.match(page, /多个货品编码/);
  assert.match(page, /MultiFilterSelect/);
  assert.match(page, /aria-multiselectable/);
  assert.match(page, /platformFilters/);
  assert.match(page, /shopFilters/);
  assert.match(page, /stat-period-picker/);
  assert.match(page, /趋势指标选择/);
  assert.match(page, /对应数据/);
  assert.match(page, /当前日期的净销售额、净销量和大毛利率/);
  assert.match(page, /product-trend-detail-area/);
  assert.match(page, /valueLabel/);
  assert.match(page, /trend-data-hint/);
  assert.match(page, /setStatPeriodPickerOpen\(false\)/);
  assert.match(page, /日维度/);
  assert.match(page, /周维度/);
  assert.match(page, /月维度/);
  assert.match(page, /<canvas/);
  assert.match(page, /销售同比/);
  assert.match(page, /净销售同比/);
  assert.match(page, /formatNetSalesYearOverYear/);
  assert.match(page, /netSalesYearOverYearTone/);
  assert.match(page, /inventory-multi-query/);
  assert.match(page, /输入或粘贴多个货品编码/);
  assert.match(page, /multi-filter-search/);
  assert.match(page, /多个货品编码/);
  assert.match(page, /正在同步 BI 经营看板/);
  assert.match(page, /数据同步状态/);
  assert.match(page, /库存快照/);
  assert.match(page, /summary\?\.shops/);
  assert.match(page, /SalesOverviewFilterBar/);
  assert.match(page, /销售总览店铺/);
  assert.match(page, /销售总览品类/);
  assert.match(page, /selectedShopKeys/);
  assert.match(page, /selectedCategories/);
  assert.match(page, /selectedOutletKeys/);
  assert.match(page, /selectedShops/);
  assert.match(page, /marginFilters/);
  assert.match(page, /taskStatuses/);
  assert.match(page, /type="file"/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /\/og\.png/);
  assert.match(schema, /sales_import_batches/);
  assert.match(schema, /sales_order_lines/);
  assert.match(schema, /sales_import_uploads/);
  assert.match(importRoute, /importSalesLedgerBytes/);
  assert.match(chunkRoute, /assembleSalesUpload/);
  assert.match(chunkService, /SALES_UPLOAD_CHUNK_BYTES/);
  assert.match(summaryRoute, /getSalesSummary/);
  assert.match(summaryRoute, /categories/);
  assert.match(summaryRoute, /getAll\("outlet"\)/);
  assert.match(summaryRoute, /parseShopFilterKey/);
  assert.match(summaryService, /gross_sales_cents/);
  assert.match(summaryService, /net_sales_excluding_accessories_cents/);
  assert.match(summaryService, /赠品配件/);
  assert.match(summaryService, /salesYearOverYearRate/);
  assert.match(summaryService, /filterOptions/);
  assert.match(summaryService, /categoryClause/);
  assert.match(summaryService, /filterOptionsData/);
  assert.match(summaryService, /outletBindings/);
  assert.match(summaryService, /normalizeOutlets/);
  assert.match(summaryService, /last15/);
  assert.match(summaryService, /dailyResult/);
  assert.match(summaryService, /product_code IN/);
  assert.match(summaryRoute, /productCodes/);
  assert.match(summaryService, /shop_name/);
  assert.match(packageJson, /"fflate"/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(hosting).r2, "SALES_IMPORT_FILES");
  assert.ok(og.size > 10_000);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});

test("keeps shop analysis isolated by platform and matches year-over-year by the same shop key", async () => {
  const [page, summaryService] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/summary.ts", import.meta.url), "utf8"),
  ]);

  // A shop name can legitimately occur on several marketplaces.  Its platform
  // is therefore part of both the aggregation key and the year-over-year key.
  assert.match(summaryService, /const groupKey = dimension === "shop"/);
  assert.match(summaryService, /COALESCE\(NULLIF\(platform, ''\), '未分类'\) \|\| char\(31\)/);
  assert.match(summaryService, /GROUP BY \$\{groupKey\}/);
  assert.match(summaryService, /yearAgoByGroupKey/);
  assert.doesNotMatch(summaryService, /yearAgoByName/);

  // Stable, platform-qualified keys prevent React from reusing a 拼多多 row
  // while the user has filtered the table to 京东.
  assert.match(page, /key=\{`\$\{activeTab\}-\$\{item\.platform\}-\$\{item\.name\}`\}/);
  assert.match(page, /label: "网店分析"/);
  assert.match(page, /aria-label="网店分析子版块"/);
});

test("wires inventory health, synchronization, and replenishment", async () => {
  const [page, schema, parser, importRoute, chunkRoute, chunkService, overview, overviewRoute, replenishmentRoute, database, migration, uploadMigration, completionMigration] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/imports/inventory-stock.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/inventory/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/inventory/chunks/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/inventory/chunked-upload.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/inventory/overview.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/inventory/overview/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/inventory/replenishment/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/inventory/database.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0002_broken_kid_colt.sql", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0003_strange_energizer.sql", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0004_purple_runaways.sql", import.meta.url), "utf8"),
    ]);

  assert.match(page, /\/api\/inventory\/overview/);
  assert.match(page, /\/api\/imports\/inventory/);
  assert.match(page, /\/api\/imports\/inventory\/chunks/);
  assert.match(page, /\/api\/inventory\/replenishment/);
  assert.match(page, /库存与销售数据已联动/);
  assert.match(page, /备货计划/);
  assert.match(page, /payload\?\.errors/);
  assert.doesNotMatch(page, /2,684,700/);
  assert.match(schema, /inventory_import_batches/);
  assert.match(schema, /inventory_stock_lines/);
  assert.match(schema, /replenishment_plan_items/);
  assert.match(parser, /实盘数量/);
  assert.match(parser, /固定成本价/);
  assert.match(parser, /吉客云库龄/);
  assert.match(importRoute, /importInventoryStockBytes/);
  assert.match(chunkRoute, /assembleInventoryUpload/);
  assert.match(chunkRoute, /claimInventoryUpload/);
  assert.match(chunkService, /inventory_import_upload_results/);
  assert.match(chunkService, /chunk\.sha256/);
  assert.match(overview, /normalizedWarehouseKey/);
  assert.match(overview, /pendingCurrentSnapshot/);
  assert.match(overviewRoute, /getInventoryOverview/);
  assert.match(replenishmentRoute, /upsertReplenishmentPlan/);
  assert.match(replenishmentRoute, /acknowledgeStale/);
  assert.match(database, /ensureInventorySchema/);
  assert.match(migration, /CREATE TABLE `inventory_stock_lines`/);
  assert.match(migration, /sales_order_lines_inventory_demand_idx/);
  assert.match(uploadMigration, /CREATE TABLE `inventory_import_uploads`/);
  assert.match(completionMigration, /inventory_import_upload_results/);
  assert.match(completionMigration, /replenishment_plan_items_draft_key_uq/);
});

test("wires product profitability to synchronized sales and inventory facts", async () => {
  const [page, route, summary, parser, inventoryDatabase, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/products/summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/imports/inventory-stock.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_young_sunspot.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/products\/summary/);
  assert.match(page, /毛利测算/);
  assert.match(page, /近30天/);
  assert.match(page, /近90天/);
  assert.match(page, /近半年/);
  assert.match(page, /自定义时间/);
  assert.match(page, /ariaLabel="销售平台"/);
  assert.match(page, /ariaLabel="销售店铺"/);
  assert.match(page, /<th>品牌<\/th><th>供应商<\/th>/);
  assert.match(page, /实际大毛利率低于35%/);
  assert.match(page, /实际大毛利率35%/);
  assert.match(page, /规格代码：/);
  assert.match(page, /<th>退货率<\/th><th>操作<\/th>/);
  assert.match(page, /ProductDetailView/);
  assert.match(page, /ProductPlatformSalesShare/);
  assert.match(page, /shopOptions\.some\(\(option\) => option\.value === item\)/);
  assert.match(page, /next\.length === current\.length \? current : next/);
  assert.match(page, /\/api\/sales\/summary/);
  assert.doesNotMatch(page, /TRS-SM-1182/);
  assert.match(route, /getProductSummary/);
  assert.match(route, /startDate/);
  assert.match(route, /endDate/);
  assert.match(summary, /sales_order_lines/);
  assert.match(summary, /inventory_stock_lines/);
  assert.match(summary, /gross_profit_cents/);
  assert.match(summary, /refund_amount_cents/);
  assert.match(summary, /marginBuckets/);
  assert.match(summary, /supplier/);
  assert.match(summary, /shop_name/);
  assert.match(summary, /MAX\(NULLIF\(brand/);
  assert.match(parser, /品牌名称/);
  assert.match(inventoryDatabase, /syncInventoryStockDimensions/);
  assert.match(migration, /ADD `brand`/);
});

test("wires inventory age analysis and stale cleanup", async () => {
  const [page, parser, route, analysis, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/imports/inventory-stock.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/age-analysis/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/age-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_quiet_forgotten_one.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /库龄分析/);
  assert.match(page, /滞销清理/);
  assert.match(page, /snapshotDate/);
  assert.match(parser, /前30天销量/);
  assert.match(route, /getInventoryAgeAnalysis/);
  assert.match(analysis, /inventory_age_metrics/);
  assert.match(analysis, /滞销清理/);
  assert.match(migration, /inventory_age_metrics/);
});

test("wires all five ERP imports and excludes 刷刷仓 from operating analysis", async () => {
  const [page, schema, parser, service, route, chunkRoute, salesService, inventoryService, salesSummary, inventoryOverview, productSummary, ageAnalysis, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/imports/erp-reference.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/erp-reference/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/erp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/erp/chunks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/products/summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/inventory/age-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0009_wonderful_blindfold.sql", import.meta.url), "utf8"),
  ]);

  for (const label of ["销售明细", "分仓库存", "货品主数据", "库龄", "组合装"]) assert.match(page, new RegExp(label));
  assert.match(page, /\/api\/imports\/erp/);
  assert.match(page, /inventory_age/);
  assert.match(schema, /erp_reference_import_batches/);
  assert.match(schema, /erp_product_master/);
  assert.match(schema, /erp_inventory_age_lines/);
  assert.match(schema, /erp_combo_items/);
  assert.match(parser, /货品编号/);
  assert.match(parser, /库存天数/);
  assert.match(parser, /子件编号/);
  assert.match(service, /EXCLUDED_BRUSH_WAREHOUSE/);
  assert.match(route, /importErpReferenceBytes/);
  assert.match(chunkRoute, /assembleInventoryUpload/);
  assert.match(salesService, /EXCLUDED_BRUSH_WAREHOUSE/);
  assert.match(inventoryService, /EXCLUDED_BRUSH_WAREHOUSE/);
  for (const analysis of [salesSummary, inventoryOverview, productSummary, ageAnalysis]) assert.match(analysis, /刷刷仓/);
  assert.match(ageAnalysis, /erp_inventory_age_lines/);
  assert.match(productSummary, /erp_product_master/);
  assert.match(migration, /CREATE TABLE `erp_product_master`/);
  assert.match(migration, /CREATE TABLE `erp_inventory_age_lines`/);
  assert.match(migration, /CREATE TABLE `erp_combo_items`/);
});

test("imports dynamic monthly financial reports and exposes target-linked analysis", async () => {
  const [page, schema, parser, database, analysis, importRoute, analysisRoute, targetRoute, migration, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/finance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/analysis/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/targets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_finance_reporting.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const label of ["财报分析", "目标设置", "月度财报", "费用同环比与异常点", "大毛利率", "退货率", "费用率", "全部月份", "8系列"]) assert.match(page, new RegExp(label));
  assert.match(page, /\.xls/);
  assert.match(page, /\/api\/finance\/analysis/);
  assert.match(page, /\/api\/finance\/targets/);
  assert.match(schema, /financeImportBatches/);
  assert.match(schema, /financeMonths/);
  assert.match(schema, /financeLines/);
  assert.match(schema, /financeTargets/);
  assert.match(parser, /aggregateLines/);
  assert.match(parser, /sourceRowCount/);
  assert.match(parser, /销售费用/);
  assert.match(database, /existingMonth\?\.status === "completed"/);
  assert.match(database, /ON CONFLICT\(month, section, scope_key, subject_name\)/);
  assert.match(analysis, /promotionFeeRatioBps/);
  assert.match(analysis, /returnRateBps/);
  assert.match(analysis, /feeRateBps/);
  assert.match(analysis, /yearAgoFeeRateBps/);
  assert.match(analysis, /platformFilter/);
  assert.match(analysis, /isSelectableShopName/);
  assert.match(analysis, /momRate/);
  assert.match(page, /formatFinanceWan/);
  assert.match(page, /FinanceSortButton/);
  assert.match(page, /expenseSearch/);
  assert.match(page, /yearAgoFeeRateBps/);
  assert.match(importRoute, /application\/octet-stream/);
  assert.match(importRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(analysisRoute, /getAll\("platform"\)/);
  assert.match(analysisRoute, /getAll\("shop"\)/);
  assert.match(targetRoute, /periodType === "project"/);
  assert.match(targetRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(migration, /CREATE TABLE `finance_lines`/);
  assert.match(migration, /CREATE TABLE `finance_targets`/);
  assert.match(packageJson, /"xlsx": "0\.18\.5"/);
});

test("connects JD SPU daily workbooks to the netshop import API", async () => {
  const [page, route, service, database, dailyContract] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/daily-contract.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /jd_spu_daily/);
  assert.match(page, /京东商品 SPU 日数据/);
  assert.match(page, /formSource: "jd_sku_daily"/);
  assert.match(page, /dataset === "spu_daily"/);
  assert.match(route, /importNetshopBytes/);
  assert.match(route, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(service, /source === "jd_sku_daily"/);
  assert.match(dailyContract, /return "spu_daily"/);
  assert.match(service, /isDailyAggregateRow/);
  assert.match(service, /=== "合计"/);
  assert.match(database, /spu_id/);
  assert.match(database, /business_date/);
});

test("links imported JD SKU and SPU daily data to shop product analysis", async () => {
  const [page, database, route, access] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/product-performance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/access.ts", import.meta.url), "utf8"),
  ]);

  for (const label of [
    "SKU（京东）",
    "SPU",
    "平台",
    "店铺",
    "显示对比数据",
    "显示对比值",
    "环比",
    "同比",
    "商品浏览量",
    "访客数",
    "成交人数",
    "加购人数",
    "UV价值",
    "总转化率",
    "搜索曝光次数",
    "推广ROI",
    "企业购出库金额",
    "列设置",
    "打开商品",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /product-performance-kpi-grid/);
  assert.match(page, /商品数据 KPI/);
  assert.match(page, /成交金额，不等同销售净额/);
  assert.match(page, /导入并同步/);
  assert.match(page, /\/api\/netshop\/product-performance/);
  assert.match(page, /SearchableMultiSelect/);
  assert.match(page, /productComparisonPeriod/);
  assert.match(page, /netshopProductUrl/);
  assert.match(page, /当前筛选周期暂无\{dimensionLabel\}商品日数据/);
  assert.match(page, /系统数据覆盖 \{availableCoverageLabel\}/);
  assert.match(page, /availableDateMin/);
  assert.match(page, /setPeriodPreset\("custom"\); setCustomPeriodStart/);
  assert.match(page, /setPeriodPreset\("custom"\); setCustomPeriodEnd/);
  assert.match(database, /getNetshopProductPerformance/);
  assert.match(database, /dataset = input\.dimension === "sku" \? "sku_daily" : "spu_daily"/);
  assert.match(database, /商品浏览量/);
  assert.match(database, /搜索曝光次数/);
  assert.match(database, /加购客户数/);
  assert.match(database, /成交金额/);
  assert.match(database, /GROUP_CONCAT\(DISTINCT NULLIF\(r\.shop_name/);
  assert.match(database, /availableCoverageWhereParts/);
  assert.match(database, /availableDateMin/);
  assert.match(route, /readDimension/);
  assert.match(route, /getAll\("platform"\)/);
  assert.match(route, /getAll\("shop"\)/);
  assert.match(route, /netshopPlatformOptionsForPrincipal/);
  assert.match(access, /NETSHOP_SUPPORTED_PLATFORMS = \["京东", "天猫"\]/);
  assert.match(access, /principal\.scope\.platforms/);
});

test("maps scoped SPU traffic and promotion metrics into store analysis without hiding their aggregation semantics", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /dimension: "spu"/);
  assert.match(page, /mergeStoreNetshopPeriods/);
  assert.match(page, /productPerformance\.summary\.transactionAmountCents \/ productPerformance\.summary\.visitors/);
  assert.match(page, /promotionClickThroughRate/);
  assert.match(page, /label="推广点击率"/);
  assert.match(page, /label="付费访客"/);
  assert.match(page, /推广点击访问次数口径，非去重访客人数/);
  assert.doesNotMatch(page, /Math\.round\(sourceVisitors \* 0\.9\)/);
  assert.match(page, /商品×日累计，非店铺去重 UV/);
  assert.match(page, /当前店铺\/周期暂无 SPU 商品日数据/);
  assert.match(page, /dimension === "sku" \? "jd_sku_daily" : "tmall_product_daily"/);
});

test("sales overview exposes polished additive shop and category multi-select filters", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /店铺与品类多选/);
  assert.match(page, /ariaLabel="销售总览店铺多选"/);
  assert.match(page, /ariaLabel="销售总览品类多选"/);
  assert.match(page, /sales-overview-filter-chips/);
  assert.match(page, /onShopChange\(selectedShopKeys\.filter/);
  assert.match(page, /onCategoryChange\(selectedCategories\.filter/);
  assert.match(styles, /\.sales-overview-filter-field/);
  assert.match(styles, /\.sales-overview-filter-chips/);
});

test("guards JD daily SKU and SPU imports with stable identity and full date coverage", async () => {
  const [page, service, database, dailyContract, dailyMigration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/daily-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/daily-row-migration.ts", import.meta.url), "utf8"),
  ]);

  // A filename containing SPU must not override a SKU workbook's exact header contract.
  assert.match(dailyContract, /hasTime && hasSku && hasSkuName && !hasSpu && !hasSpuName/);
  assert.match(service, /DATASET_HEADER_MISMATCH/);
  assert.match(service, /MISSING_SKU_ID/);
  assert.match(service, /MISSING_SPU_ID/);
  assert.match(service, /MISSING_EXPECTED_DATES/);
  assert.match(service, /OUT_OF_RANGE_DATES/);
  assert.match(service, /dailyRowKey\(dataset, platform, shopName, businessDate/);
  assert.match(database, /ensureDailyRowNaturalKeys/);
  assert.match(dailyMigration, /DAILY_ROW_NATURAL_KEY_MIGRATION/);
  assert.match(dailyMigration, /DELETE FROM netshop_rows WHERE id =/);
  assert.match(dailyMigration, /row\.source_row_key !== naturalKey/);
  // Both independent upload entries carry their expected dimension and range.
  assert.match(page, /jd_sku_daily/);
  assert.match(page, /expectedDataset: "sku_daily"/);
  assert.match(page, /expectedDataset: "spu_daily"/);
  assert.match(page, /expectedStartDate/);
  assert.match(page, /dataset === "sku_daily"/);
});

test("connects Tmall product, BI daily, and promotion data with scoped APIs", async () => {
  const [page, service, database, importRoute, productRoute, performanceRoute, promotionRoute, registry, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/products/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/product-performance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/netshop/promotion-performance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0052_tmall_netshop_query_indexes.sql", import.meta.url), "utf8"),
  ]);

  for (const token of ["tmall_product_master", "tmall_product_daily", "tmall_promotion", "天猫-志高亿玖专卖店"]) {
    assert.match(page, new RegExp(token));
    assert.match(service, new RegExp(token));
  }
  assert.match(service, /TextDecoder\("gb18030", \{ fatal: true \}\)/);
  assert.match(service, /天猫推广 ZIP 必须且只能包含一个 CSV/);
  assert.match(service, /READBACK_VERIFICATION_FAILED/);
  assert.match(service, /DUPLICATE_MERCHANT_CODE/);
  assert.match(database, /replaceScope/);
  assert.match(database, /getNetshopPromotionPerformance/);
  assert.match(database, /spendCents/);
  assert.match(database, /platformPaymentAmountCents/);
  assert.match(importRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(importRoute, /netshopPlatformsForPrincipal/);
  for (const route of [importRoute, productRoute, performanceRoute, promotionRoute]) {
    assert.match(route, /cache-control/i);
    assert.match(route, /no-store/);
  }
  for (const route of [productRoute, performanceRoute, promotionRoute]) {
    assert.match(route, /netshopPlatformsForPrincipal/);
  }
  assert.match(registry, /get_netshop_performance/);
  assert.match(registry, /scopePolicy: "principal_scope"/);
  assert.match(migration, /dataset`?,`?platform`?,`?shop_name`?,`?business_date`?,`?spu_id/);
  assert.match(page, /推广费率/);
  assert.match(page, /推广成交占比/);
  assert.match(page, /ROAS/);
  assert.match(page, /detail\.tmall\.com\/item\.htm\?id=/);
});

test("exposes the four operational collaboration workspaces", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const label of ["工作计划", "巡店查询", "评价维护", "新品上架"]) assert.match(page, new RegExp(label));
  assert.match(page, /运营事务子版块/);
  assert.match(page, /搜索工作计划/);
  assert.match(page, /搜索巡店记录/);
  assert.match(page, /搜索评价内容/);
  assert.match(page, /搜索新品项目/);
  assert.match(page, /workflow-plan-table/);
  for (const label of ["工作事项", "工作内容", "紧急程度", "跟进人", "截止时间", "录入时间"]) assert.match(page, new RegExp(label));
  assert.match(page, /formatWorkflowRecordedAt/);
  assert.match(page, /taskPriorities/);
  assert.match(page, /workflow-due-input/);
  assert.match(page, /workflow-status-field/);
  assert.match(page, /workflowStatusLabel/);
  assert.match(page, /全部紧急程度/);
  for (const action of ["标记工作中", "标记完成", "退回待开始", "返还待开始", "返还工作中"]) assert.match(page, new RegExp(action));
  assert.match(page, /WorkflowTransitionActions/);
  assert.match(page, /WorkflowAttachmentList/);
  assert.match(page, /添加附件/);
  assert.match(page, /支持图片 \/ 文件/);
  for (const field of ["工作事项", "工作内容", "跟进人", "店铺名称", "开始时间", "截止时间", "紧急程度"]) assert.match(page, new RegExp(field));
  assert.match(page, /WorkflowDeleteConfirm/);
  assert.match(page, /确认删除工作项/);
  assert.match(page, /确认删除/);
  assert.match(page, /未命名工作项/);
  assert.match(page, /未命名新品项目/);
  assert.doesNotMatch(page, /请先补充：/);
  assert.doesNotMatch(page, /先登录，再继续自动导出/);
  assert.doesNotMatch(page, /openJackyunLogin/);
});

test("persists work-plan creation, editable deadline, status changes, and deletion", async () => {
  const [page, route, tasks, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workflow/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_workflow_tasks.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /fetch\("\/api\/workflow\/tasks"/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /taskMutationPending/);
  assert.match(route, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /type UpdateWorkflowTaskInput/);
  assert.match(route, /updateWorkflowTask\(id, payload/);
  assert.match(tasks, /workflow_task_bootstrap/);
  assert.match(tasks, /DELETE FROM workflow_tasks/);
  assert.match(tasks, /created_by, created_at/);
  assert.match(tasks, /source: row\.created_by === "system"/);
  assert.match(tasks, /updateWorkflowTask/);
  assert.match(tasks, /截止时间不能早于开始时间/);
  assert.match(tasks, /SET status = \?, due_date = \?/);
  assert.match(tasks, /SET due_date = \?/);
  assert.doesNotMatch(page, /workflow-plan-actions/);
  assert.match(migration, /CREATE TABLE `workflow_tasks`/);
});

test("opens read-only data while keeping operational writes administrator-only", async () => {
  const readRouteUrls = [
    "../app/api/sales/summary/route.ts",
    "../app/api/inventory/overview/route.ts",
    "../app/api/inventory/replenishment/route.ts",
    "../app/api/products/summary/route.ts",
    "../app/api/imports/sales/route.ts",
    "../app/api/imports/inventory/route.ts",
    "../app/api/imports/erp/route.ts",
    "../app/api/imports/finance/route.ts",
    "../app/api/finance/analysis/route.ts",
    "../app/api/finance/targets/route.ts",
  ];
  const writeRouteUrls = [
    "../app/api/imports/sales/route.ts",
    "../app/api/imports/sales/chunks/route.ts",
    "../app/api/imports/inventory/route.ts",
    "../app/api/imports/inventory/chunks/route.ts",
    "../app/api/imports/erp/route.ts",
    "../app/api/imports/erp/chunks/route.ts",
    "../app/api/imports/finance/route.ts",
    "../app/api/finance/targets/route.ts",
    "../app/api/inventory/replenishment/route.ts",
  ];
  const [page, schema, authorization, authRoute, migration, ...routes] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/auth/authorization.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0005_slow_tyrannus.sql", import.meta.url), "utf8"),
      ...[...readRouteUrls, ...writeRouteUrls].map((url) => readFile(new URL(url, import.meta.url), "utf8")),
    ]);

  assert.match(page, /\/api\/auth\/me/);
  assert.match(page, /signin-with-chatgpt/);
  assert.match(page, /只读查看者/);
  assert.doesNotMatch(page, /IdentityGate/);
  assert.doesNotMatch(page, /林晓 · 管理员/);
  assert.match(schema, /app_users/);
  assert.match(schema, /ai_tool_audit_logs/);
  assert.match(authorization, /dengweizhang321@gmail\.com/);
  assert.match(authorization, /getChatGPTUser/);
  assert.match(authorization, /WHERE email = \? COLLATE NOCASE/);
  assert.match(authRoute, /requireAppPrincipal/);
  assert.match(migration, /INSERT INTO `app_users`/);
  assert.match(migration, /dengweizhang321@gmail\.com/);

  const readRoutes = routes.slice(0, readRouteUrls.length);
  const writeRoutes = routes.slice(readRouteUrls.length);
  for (const route of readRoutes) {
    assert.doesNotMatch(route, /requireAppPrincipal\(\)/);
  }
  for (const route of writeRoutes) {
    assert.match(route, /requireAppPrincipal\(\["admin"\]\)/);
    assert.match(route, /authorizationErrorResponse/);
  }
});

test("exposes the centrally registered, fail-closed Codex MCP connection", async () => {
  const [mcpRoute, registry, contract, budget, audit, config, agents] = await Promise.all([
    readFile(new URL("../app/mcp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/mcp-execution-budget.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
  ]);

  assert.match(mcpRoute, /CODEX_MCP_TOKEN/);
  assert.match(mcpRoute, /tools\/list/);
  assert.match(mcpRoute, /tools\/call/);
  assert.match(mcpRoute, /Bearer/);
  assert.match(mcpRoute, /getVisibleToolCatalog/);
  assert.match(mcpRoute, /createRegisteredToolExecutionRuntime/);
  assert.match(mcpRoute, /MAX_BATCH_REQUESTS = 20/);
  assert.match(mcpRoute, /mcp-\$\{digest\.slice/);
  assert.doesNotMatch(mcpRoute, /BOOTSTRAP_ADMIN_EMAIL/);
  assert.match(budget, /still waits for the[\s\S]*underlying operation to settle/);
  assert.match(budget, /runSequentialBatchWithinBudget/);
  for (const toolName of ["search_system_knowledge", "get_data_freshness", "get_sales_summary", "get_inventory_health", "get_product_performance", "list_replenishment_plans", "get_customer_service_conversations", "search_system_data"]) {
    assert.match(registry, new RegExp(`name: "${toolName}"`));
  }
  assert.match(registry, /readOnlyHint: true/);
  assert.match(registry, /validateToolRegistry\(aiToolRegistry\)/);
  assert.match(contract, /status: "started"/);
  assert.match(contract, /if \(!preflightAudited\).*audit_unavailable/);
  assert.match(contract, /if \(!audited\)/);
  assert.match(contract, /工具执行未返回数据/);
  assert.match(audit, /ai_tool_audit_logs/);
  assert.match(audit, /input\.actorEmail/);
  assert.match(audit, /input\.actorRole/);
  assert.match(config, /mcp_servers\.teruisi_operations/);
  assert.match(config, /TERUISI_CODEX_MCP_TOKEN/);
  assert.match(agents, /get_data_freshness/);
  assert.match(agents, /read-only/i);
  assert.match(agents, /lib\/ai\/tool-registry\.ts/);
});
