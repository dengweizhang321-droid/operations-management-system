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
  assert.match(server, /api\/inventory\/overview/);
  assert.match(server, /api\/inventory\/replenishment/);
  assert.match(server, /api\/products\/summary/);
  assert.match(server, /api\/auth\/me/);
  assert.match(page, /TERUISI/);
  assert.match(page, /销售分析/);
  assert.match(page, /渠道经营诊断/);
  assert.match(page, /channel-detail-panel/);
  assert.match(page, /数据导入/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape/i);
});

test("wires the sales import and analytics capabilities", async () => {
  const [page, layout, schema, importRoute, chunkRoute, chunkService, summaryRoute, packageJson, hosting, og] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/sales/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/sales/chunks/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/sales/chunked-upload.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/sales/summary/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      stat(new URL("../public/og.png", import.meta.url)),
    ]);

  assert.match(page, /\/api\/imports\/sales/);
  assert.match(page, /\/api\/sales\/summary/);
  assert.match(page, /setActiveTab/);
  assert.match(page, /平台汇总/);
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
  assert.match(summaryRoute, /gross_sales_cents/);
  assert.match(summaryRoute, /net_sales_excluding_accessories_cents/);
  assert.match(summaryRoute, /赠品配件/);
  assert.match(packageJson, /"fflate"/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(hosting).r2, "SALES_IMPORT_FILES");
  assert.ok(og.size > 10_000);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
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
  const [page, route, summary] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/products/summary.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/products\/summary/);
  assert.match(page, /毛利测算/);
  assert.match(page, /销售数据截止/);
  assert.doesNotMatch(page, /TRS-SM-1182/);
  assert.match(route, /getProductSummary/);
  assert.match(summary, /sales_order_lines/);
  assert.match(summary, /inventory_stock_lines/);
  assert.match(summary, /gross_profit_cents/);
});

test("enforces authenticated administrator access across operational APIs", async () => {
  const routeUrls = [
    "../app/api/imports/sales/route.ts",
    "../app/api/imports/sales/chunks/route.ts",
    "../app/api/imports/inventory/route.ts",
    "../app/api/imports/inventory/chunks/route.ts",
    "../app/api/sales/summary/route.ts",
    "../app/api/inventory/overview/route.ts",
    "../app/api/inventory/replenishment/route.ts",
    "../app/api/products/summary/route.ts",
  ];
  const [page, schema, authorization, authRoute, migration, ...protectedRoutes] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/auth/authorization.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0005_slow_tyrannus.sql", import.meta.url), "utf8"),
      ...routeUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")),
    ]);

  assert.match(page, /\/api\/auth\/me/);
  assert.match(page, /signin-with-chatgpt/);
  assert.doesNotMatch(page, /林晓 · 管理员/);
  assert.match(schema, /app_users/);
  assert.match(schema, /ai_tool_audit_logs/);
  assert.match(authorization, /dengweizhang321@gmail\.com/);
  assert.match(authorization, /getChatGPTUser/);
  assert.match(authorization, /WHERE email = \? COLLATE NOCASE/);
  assert.match(authRoute, /requireAppPrincipal/);
  assert.match(migration, /INSERT INTO `app_users`/);
  assert.match(migration, /dengweizhang321@gmail\.com/);

  for (const route of protectedRoutes) {
    assert.match(route, /requireAppPrincipal\(\["admin"\]\)/);
    assert.match(route, /authorizationErrorResponse/);
  }
});
