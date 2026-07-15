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

test("searches synchronized products, specifications, and orders", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/search\?q=/);
  assert.match(page, /搜索货品名称、编码、规格或订单号/);
  assert.match(page, /货品结果/);
  assert.match(page, /订单结果/);
  assert.match(route, /product_name LIKE/);
  assert.match(route, /product_code LIKE/);
  assert.match(route, /specification LIKE/);
  assert.match(route, /online_order_no LIKE/);
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
  assert.match(page, /<option>月度<\/option>/);
  assert.doesNotMatch(page, /<option>本季度<\/option>/);
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
  assert.match(summaryService, /gross_sales_cents/);
  assert.match(summaryService, /net_sales_excluding_accessories_cents/);
  assert.match(summaryService, /赠品配件/);
  assert.match(summaryService, /salesYearOverYearRate/);
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
  assert.doesNotMatch(page, /TRS-SM-1182/);
  assert.match(route, /getProductSummary/);
  assert.match(route, /startDate/);
  assert.match(route, /endDate/);
  assert.match(summary, /sales_order_lines/);
  assert.match(summary, /inventory_stock_lines/);
  assert.match(summary, /gross_profit_cents/);
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
  const [page, schema, parser, database, analysis, importRoute, targetRoute, migration, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/finance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/targets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_finance_reporting.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const label of ["财报分析", "目标设置", "月度财报", "费用同环比与异常点", "8系列"]) assert.match(page, new RegExp(label));
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
  assert.match(analysis, /momRate/);
  assert.match(importRoute, /application\/octet-stream/);
  assert.match(importRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(targetRoute, /periodType === "project"/);
  assert.match(targetRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(migration, /CREATE TABLE `finance_lines`/);
  assert.match(migration, /CREATE TABLE `finance_targets`/);
  assert.match(packageJson, /"xlsx": "0\.18\.5"/);
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

test("exposes the audited read-only Codex MCP connection", async () => {
  const [mcpRoute, tools, audit, config, agents] = await Promise.all([
    readFile(new URL("../app/mcp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/operations-tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
  ]);

  assert.match(mcpRoute, /CODEX_MCP_TOKEN/);
  assert.match(mcpRoute, /tools\/list/);
  assert.match(mcpRoute, /tools\/call/);
  assert.match(mcpRoute, /Bearer/);
  for (const toolName of ["get_data_freshness", "get_sales_summary", "get_inventory_health", "get_product_performance", "list_replenishment_plans"]) {
    assert.match(tools, new RegExp(toolName));
  }
  assert.match(tools, /readOnlyHint: true/);
  assert.match(audit, /ai_tool_audit_logs/);
  assert.match(config, /mcp_servers\.teruisi_operations/);
  assert.match(config, /TERUISI_CODEX_MCP_TOKEN/);
  assert.match(agents, /get_data_freshness/);
  assert.match(agents, /read-only/i);
});
