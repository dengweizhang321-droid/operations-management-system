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
  assert.match(page, /TERUISI/);
  assert.match(page, /销售分析/);
  assert.match(page, /数据导入/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape/i);
});

test("wires the sales import and analytics capabilities", async () => {
  const [page, layout, schema, importRoute, summaryRoute, packageJson, hosting, og] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/imports/sales/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/sales/summary/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      stat(new URL("../public/og.png", import.meta.url)),
    ]);

  assert.match(page, /\/api\/imports\/sales/);
  assert.match(page, /\/api\/sales\/summary/);
  assert.match(page, /type="file"/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /\/og\.png/);
  assert.match(schema, /sales_import_batches/);
  assert.match(schema, /sales_order_lines/);
  assert.match(importRoute, /parseSalesLedgerXlsx/);
  assert.match(summaryRoute, /gross_sales_cents/);
  assert.match(packageJson, /"fflate"/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.ok(og.size > 10_000);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});
