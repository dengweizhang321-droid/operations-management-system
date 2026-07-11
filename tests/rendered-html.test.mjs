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
