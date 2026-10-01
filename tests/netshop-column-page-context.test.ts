import assert from "node:assert/strict";
import test from "node:test";
import { netshopColumnPageDetails } from "../app/netshop/shared/page-context";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { normalizeAiPageContext } from "../lib/ai/page-context";

test("new column page context carries exact shop and product selections without granting authority", () => {
  const context = { ...defaultShopLocationContext, platforms: ["京东" as const], outlets: ["京东\u001f同名店"], product: { platform: "京东" as const, shopName: "同名店", dimension: "sku" as const, id: "P1" }, dimension: "sku" as const, q: "P1" };
  const details = netshopColumnPageDetails("products", context);
  assert.deepEqual(details.filters?.outletKeys, ["京东\u001f同名店"]);
  assert.deepEqual(details.filters?.skus, ["P1"]);
  assert.equal(details.filters?.rankingDimension, "sku");
  assert.equal(details.filters?.dataset, "netshop_product_insights");
  assert.ok(normalizeAiPageContext({ module: "shop", view: "products", filters: details.filters }));
  assert.equal(Object.hasOwn(details.filters!, "role"), false);
});
test("custom comparison baseline and label evidence survive into low-trust AI page selections", () => {
  const details = netshopColumnPageDetails("platforms", { ...defaultShopLocationContext,
    comparisonIntent: { schemaVersion: "comparison-scope-v1", mode: "platform", metricSource: "erp", coverageFilter: "partial", selectedBaseline: { kind: "custom", startDate: "2026-02-01", endDate: "2026-02-28" }, category: { mode: "label_only", platform: "京东", sourceId: "jd_spu_daily", label: "机械", evidenceVersion: "owning-label-v1" } },
  });
  assert.equal(details.filters?.baselineStartDate, "2026-02-01");
  assert.equal(details.filters?.baselineEndDate, "2026-02-28");
  assert.equal(details.filters?.categoryMode, "label_only");
  assert.equal(details.filters?.categoryEvidence, "owning-label-v1");
  assert.equal(details.filters?.metricSource, "erp");
  assert.ok(normalizeAiPageContext({ module: "shop", view: "platforms", filters: details.filters }));
});
test("oversized explicit scope blocks page context instead of silently changing to all shops", () => {
  const details = netshopColumnPageDetails("platforms", { ...defaultShopLocationContext, outlets: Array.from({ length: 21 }, (_, index) => `京东\u001f${index}`) });
  assert.ok(details.blockedReason);
  assert.equal(details.filters, undefined);
  assert.ok(netshopColumnPageDetails("analysis", defaultShopLocationContext).blockedReason);
});
