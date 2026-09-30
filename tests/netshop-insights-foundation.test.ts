import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeInsightsContext, decodeInsightsContextForQuery, decodeMetric, compareMetrics, formatMetric, compactInsightsContext, sameRevisionVector, pairExactProducts, encodeProductIdentity, validateContextQuery, decodeInsightPagination, type InsightsContext } from "../lib/netshop/insights-contract";
import { syntheticInsightsContext, syntheticMetrics } from "../lib/netshop/insights-fixtures";
import { exactProductQuery, loadInsightsContext, syntheticRoleConsumption } from "../lib/netshop/insights-consumers";
import { ScopedReadGate } from "../app/netshop/shared/request-state";
import { NetshopModuleSlot, NetshopNavigation } from "../app/netshop/shared/navigation";
import { parseShellLocation, serializeShellLocation, updateModuleViewLocation, shopContextFromLocation, updateShopContextLocation, drillShopLocation, returnShopLocation } from "../app/shell/navigation-contract";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { productSummaryForDisplay } from "../lib/netshop/product-display";
import { mergePromotionDisplayRows } from "../lib/netshop/promotion-display";

test("complete synthetic owning context and all four callable consumer examples", async () => {
  const fixture = syntheticInsightsContext(); assert.equal(decodeInsightsContext(fixture), fixture);
  const query = new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: "2026-09-01", endDate: "2026-09-01" });
  const context = await loadInsightsContext(query, new AbortController().signal, async (url, options) => {
    assert.match(String(url), /^\/api\/netshop\/insights-context\?/); assert.equal(options?.cache, "no-store"); assert.ok(options?.signal);
    return Response.json(fixture, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
  });
  for (const role of ["P", "A", "S", "C"] as const) {
    const example = syntheticRoleConsumption(role, context); assert.equal(example.synthetic, true); assert.deepEqual(example.periods, fixture.periods); assert.equal(example.role, role);
  }
});

const badContexts: Array<[string, (p: InsightsContext) => void]> = [
  ["missing source coverage", p => { delete p.coverageBySource[Object.keys(p.coverageBySource)[0]]; }],
  ["missing field capability", p => { p.capabilities.pop(); }],
  ["missing owning revision", p => { p.sourceRevisions.shift(); }],
  ["missing platform manifest", p => { p.sourceRevisions.splice(1, 1); }],
  ["missing product revision member", p => { p.sourceRevisions.splice(2, 1); }],
  ["sales revision cannot replace owning source", p => { p.sourceRevisions[0].domain = "sales"; }],
  ["wrong member kind", p => { p.sourceRevisions[2].kind = "京东:product:京东\u001f其他店"; }],
  ["unknown typed revision", p => { p.sourceRevisions[2].revision = "opaque-different-kind"; }],
  ["cross scope revision", p => { p.sourceRevisions[0].scopeKey = "f".repeat(64); }],
  ["duplicate revision", p => { p.sourceRevisions[2] = structuredClone(p.sourceRevisions[1]); }],
  ["foreign effective shop", p => { p.effectiveScope.shopKeys = ["京东\u001f其他店"]; }],
  ["mixed dimension", p => { p.effectiveScope.dimension = "sku"; }],
  ["duplicate shops", p => { p.effectiveScope.shopKeys.push(p.effectiveScope.shopKeys[0]); }],
  ["duplicate calendar day", p => { p.calendar[0].date = "2026-08-31"; }],
  ["baseline day beyond actual window", p => { p.calendar[0].previous = "2026-08-30"; }],
  ["partial coverage falsely complete", p => { p.coverageBySource["jd_promotion:ad:京东:current"].complete = true; }],
  ["wrong expected pair count", p => { p.coverageBySource["jd_promotion:ad:京东:current"].expectedShopDatePairs = 2; }],
  ["unaccounted missing date", p => { p.coverageBySource["jd_promotion:ad:京东:current"].missingByShop = []; }],
  ["foreign missing shop", p => { p.coverageBySource["jd_promotion:ad:京东:current"].missingByShop[0].shopKey = "天猫\u001f合成店A"; }],
  ["invalid natural date", p => { p.coverageBySource["jd_promotion:ad:京东:current"].missingByShop[0].dates = ["2026-02-30"]; }],
  ["unknown product field", p => { p.capabilities[0].field = "spend"; }],
  ["availability with no field", p => { p.capabilities[0].presentShopDatePairs = 0; }],
  ["false absent-field availability", p => { p.capabilities[5].status = "available"; p.capabilities[5].reasonCode = null; }],
  ["missing freshness source", p => { p.freshness.pop(); }],
];
for (const [name, mutate] of badContexts) test(`context rejects ${name}`, () => {
  const fixture = syntheticInsightsContext(); decodeInsightsContext(fixture); mutate(fixture); assert.throws(() => decodeInsightsContext(fixture));
});

test("all four states distinguish true zero, missing field, partial, unmapped and invalid", () => {
  for (const metric of Object.values(syntheticMetrics)) decodeMetric(metric);
  assert.equal(formatMetric(syntheticMetrics.trueZero), "0 元");
  assert.equal(formatMetric(syntheticMetrics.missingField), "—");
  for (const bad of [{ value: Infinity }, { value: NaN }, { value: Number.MAX_SAFE_INTEGER+1 }, { unit: "COUNT", value: .5 }, { status: "unavailable" }, { status: "available", sourceIds: [] }, { basis: "invented" }, { coverageRef: "" }, { status: "partial", unit: "RATIO", reasonCode: "incomplete_coverage" }]) assert.throws(() => decodeMetric({ ...syntheticMetrics.trueZero, ...bad }));
  assert.equal(compareMetrics(syntheticMetrics.trueZero, syntheticMetrics.trueZero).reasonCode, "zero_denominator");
  assert.equal(compareMetrics(syntheticMetrics.trueZero, { ...syntheticMetrics.trueZero, value: -1 }).reasonCode, "negative_baseline");
  assert.equal(compareMetrics(syntheticMetrics.trueZero, syntheticMetrics.partial).reasonCode, "incomplete_baseline");
  assert.equal(compareMetrics(syntheticMetrics.trueZero, { ...syntheticMetrics.trueZero, sourceIds: ["tmall_product_daily"] }).reasonCode, "not_applicable");
  assert.throws(() => decodeMetric({ ...syntheticMetrics.trueZero, sourceIds: ["jd_sku_daily", "jd_sku_daily"] }));
  assert.equal(compareMetrics({ ...syntheticMetrics.trueZero, value: .2, unit: "RATIO" }, { ...syntheticMetrics.trueZero, value: .1, unit: "RATIO" }).value, 10);
  assert.equal(formatMetric({ ...syntheticMetrics.trueZero, unit: "MULTIPLE", value: 2 }), "2 倍");
  assert.equal(formatMetric({ ...syntheticMetrics.trueZero, unit: "RATIO", value: 1.5 }), "150%");
});
test("ratio inputs and comparison overflow fail closed while a real zero numerator remains valid", () => {
  const metric = { ...syntheticMetrics.trueZero, value: 0, unit: "RATIO" as const, aggregation: "ratio_of_sums" as const, numerator: 0, denominator: 10 };
  assert.equal(decodeMetric(metric).value, 0);
  for (const bad of [{ denominator: 0 }, { denominator: -10 }, { denominator: Infinity }, { numerator: NaN }, { value: .2 }, { denominator: undefined }]) assert.throws(() => decodeMetric({ ...metric, ...bad }));
  const comparison = compareMetrics({ ...syntheticMetrics.trueZero, unit: "SECONDS", value: 1e308 }, { ...syntheticMetrics.trueZero, unit: "SECONDS", value: 1e-308 });
  assert.equal(comparison.value, null); assert.equal(comparison.reasonCode, "unsafe_integer");
});

test("a valid response must also belong to the exact query and owning revision header", () => {
  const query = new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: "2026-09-01", endDate: "2026-09-01", dimension: "spu", periodKind: "custom" }), context = syntheticInsightsContext();
  assert.equal(decodeInsightsContextForQuery(context, query, "1:aaaaaaaaaaaa"), context);
  for (const patch of [{ outlet: "京东\u001f另一个店" }, { startDate: "2026-08-01", endDate: "2026-08-01" }, { dimension: "sku" }, { periodKind: "rolling" }, { snapshotToken: "c".repeat(64) }]) {
    const wrong = new URLSearchParams(query); for (const [k, v] of Object.entries(patch)) wrong.set(k, v); assert.throws(() => decodeInsightsContextForQuery(context, wrong, "1:aaaaaaaaaaaa"));
  }
  assert.throws(() => decodeInsightsContextForQuery(context, query, "2:bbbbbbbbbbbb")); assert.throws(() => decodeInsightsContextForQuery(context, query, null));
});

test("missing legacy summary fields are hidden and complete true zero remains visible", () => {
  const scalar = { summary: { visitors: 0, transactionAmount: 0, transactionCustomers: 0, uvValue: null, conversionRate: null } };
  assert.equal(productSummaryForDisplay(scalar).visitors, null);
  const complete = { ...scalar, summaryFieldAvailability: { visitors: { complete: true, reasonCode: null }, transactionAmountCents: { complete: true, reasonCode: null } } };
  assert.equal(productSummaryForDisplay(complete).visitors, 0); assert.equal(productSummaryForDisplay(complete).transactionAmount, 0);
});

test("legacy promotion buckets never recreate null rate; complete zero fee is zero", () => {
  const day = { date: "2026-09-01", spendCents: 0, netTransactionAmountCents: 0, platformPaymentAmountCents: 100, clicks: 0, spendRate: 0, promotionTransactionShare: 0 };
  const complete = mergePromotionDisplayRows([{ key: day.date }], [day], d => d, true)[0]; assert.equal("promotionSpendRate" in complete ? complete.promotionSpendRate : undefined, 0);
  for (const [daily, completeScope] of [[[{ ...day, spendRate: null }], true], [[{ ...day, platformPaymentAmountCents: null }], true], [[day], false]] as const) {
    const result = mergePromotionDisplayRows([{ key: day.date }], [...daily], d => d, completeScope)[0]; assert.equal("promotionSpendRate" in result ? result.promotionSpendRate : undefined, null);
  }
});

test("exact identity pairing survives different ranks, stores, dimensions and absent rows", () => {
  const current = [{ platform: "京东" as const, shopName: "A", dimension: "spu" as const, id: "same" }, { platform: "京东" as const, shopName: "B", dimension: "spu" as const, id: "same" }];
  assert.notEqual(encodeProductIdentity(current[0]), encodeProductIdentity(current[1]));
  const pairs = pairExactProducts(current, [current[1], { ...current[0], id: "other" }, current[0]]);
  assert.deepEqual(pairs.map(p => p.baseline?.shopName), ["A", "B"]);
  assert.equal(pairExactProducts(current, [current[0]])[1].baseline, null);
  assert.throws(() => pairExactProducts(current, [current[0], current[0]]));
  assert.throws(() => encodeProductIdentity({ ...current[0], platform: "天猫", dimension: "sku" }));
  const q = exactProductQuery(current, { startDate: "2026-08-31", endDate: "2026-08-31" }, "1:aaaaaaaaaaaa");
  assert.equal(q.get("view"), "identities"); assert.equal(q.getAll("identity").length, 2); assert.equal(q.has("q"), false);
});

test("typed revision vectors compare within each kind and scope, never cross token strings", () => {
  const context = syntheticInsightsContext(), vector = context.sourceRevisions;
  assert.equal(sameRevisionVector(vector, [...vector].reverse()), true);
  assert.equal(sameRevisionVector(vector, vector.map(r => r.kind.endsWith("promotionManifest") ? { ...r, revision: "1:True" } : r)), false);
  assert.equal(sameRevisionVector(vector, vector.map(r => ({ ...r, scopeKey: "c".repeat(64) }))), false);
  assert.equal(sameRevisionVector([vector[0], vector[0]], [vector[0], vector[0]]), false);
});

test("shared request whitelist, date intent, 366-day/50-shop budget and legacy 730 unchanged", () => {
  const base = "platform=京东&dimension=spu&startDate=2026-09-01&endDate=2026-09-01";
  validateContextQuery(new URLSearchParams(base));
  for (const suffix of ["&q=x", "&platform=京东", "&periodKind=custom&periodKind=rolling", "&dimension=sku", "&outlet=京东%1FA&outlet=京东%1FA", "&snapshotToken=bad", "&periodKind=last7"]) assert.throws(() => validateContextQuery(new URLSearchParams(base+suffix)));
  const big = new URLSearchParams(base); big.set("startDate", "2025-01-01"); assert.throws(() => validateContextQuery(big));
  const shops = new URLSearchParams(base); for (let i=0; i<51; i++) shops.append("outlet", `京东\u001f${i}`); assert.throws(() => validateContextQuery(shops));
});

test("shared navigation roundtrip and browser transitions preserve dates, category and exact list context", () => {
  const base = serializeShellLocation({ module: "shop", view: "products", period: { kind: "custom", from: "2026-09-24", to: "2026-09-30", intent: "rolling" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001fA"], q: "same", category: "厨具", page: 3 } });
  const state = parseShellLocation(base); assert.equal(state.shop?.page, 3);
  const pageThree = updateShopContextLocation(base, { page: 3 }); assert.equal(parseShellLocation(pageThree).shop?.page, 3);
  assert.deepEqual(parseShellLocation(serializeShellLocation(parseShellLocation(pageThree), pageThree)), parseShellLocation(pageThree));
  const product = { platform: "京东" as const, shopName: "A", dimension: "spu" as const, id: "same" };
  const detail = drillShopLocation(pageThree, "products", product, "daily");
  assert.deepEqual(parseShellLocation(detail).shop?.product, product);
  assert.equal(returnShopLocation(detail), pageThree);
  assert.equal(parseShellLocation(updateModuleViewLocation(pageThree, "shop", "promotion")).shop?.q, "same");
  const changed = updateShopContextLocation(pageThree, { outlets: ["京东\u001fB"] }); assert.equal(parseShellLocation(changed).shop?.page, 1);
  assert.equal(parseShellLocation(updateShopContextLocation(pageThree, { q: " same " })).shop?.page, 3);
  assert.equal(parseShellLocation(updateShopContextLocation(pageThree, { pageSize: 50 })).shop?.page, 1);
  const differentDate = serializeShellLocation({ ...parseShellLocation(pageThree), period: { kind: "yesterday" } }, pageThree); assert.equal(parseShellLocation(differentDate).shop?.page, 1);
  assert.equal(shopContextFromLocation(pageThree).period.kind, "custom");
  assert.equal(parseShellLocation(updateModuleViewLocation(pageThree, "sales", "overview")).shop, undefined);
});

test("invalid cross-shop bookmarks and external/nested return links cannot select identities", () => {
  for (const value of ["https://evil.example/", "//evil.example/", "/?module=sales", "/?module=shop&shopReturn=x"]) {
    const q = new URLSearchParams({ module: "shop", view: "products", shopReturn: value }); assert.equal(parseShellLocation("/?"+q).shop?.returnTo, null);
  }
  const q = new URLSearchParams({ module: "shop", view: "products", shopPlatform: "京东", shopOutlet: "京东\u001fA", shopProduct: JSON.stringify(["京东", "B", "spu", "same"]) });
  assert.equal(parseShellLocation("/?"+q).shop?.product, null);
});

test("generation and cancellation reject late data even if transport ignores AbortSignal", () => {
  const gate = new ScopedReadGate(), first = gate.begin("A"), second = gate.begin("B");
  assert.equal(first.signal.aborted, true); assert.equal(first.current(), false); assert.equal(second.current(), true);
  gate.cancel(); assert.equal(second.current(), false);
});

test("only active module renderer mounts; shared navigation keeps existing five views", () => {
  const calls: string[] = [];
  const html = renderToStaticMarkup(createElement(NetshopModuleSlot, { active: "products", renderers: { products: () => { calls.push("P"); return "商品"; }, promotion: () => { calls.push("A"); return "推广"; } } }));
  assert.equal(html, "商品"); assert.deepEqual(calls, ["P"]);
  assert.match(renderToStaticMarkup(createElement(NetshopNavigation, { active: "outlets", onChange: () => {} })), /网店总览/);
});

test("pagination counts/hasMore remain authoritative and no client full-table fetch is implied", () => {
  decodeInsightPagination({ page: 1, pageSize: 20, total: 120, returned: 20, hasMore: true, truncated: false });
  for (const changes of [{ pageSize: 101 }, { returned: 21 }, { hasMore: false }, { total: -1 }, { page: 0 }]) assert.throws(() => decodeInsightPagination({ page: 1, pageSize: 20, total: 120, returned: 20, hasMore: true, truncated: false, ...changes }));
});

test("AI range projection is explicit, lossless in coverage, and rejects rather than truncates", () => {
  const context = syntheticInsightsContext(), result = compactInsightsContext(context);
  assert.equal(result.projection, "complete_coverage_ranges_v1"); assert.equal("calendar" in result, false);
  const missing = result.coverageBySource["jd_promotion:ad:京东:current"].missingByShop[0];
  assert.deepEqual(missing.missingRanges, [{ startDate: "2026-09-01", endDate: "2026-09-01", days: 1 }]);
  assert.throws(() => compactInsightsContext(context, 100));
});

test("legacy scope fallbacks and identical-rank comparison have been removed", async () => {
  const source = await readFile("app/shop-module-view.tsx", "utf8");
  assert.doesNotMatch(source, /scopedCurrentPerformance \?\? currentPerformanceResponse|scopedCatalog \?\? catalogResponse|scopedComparisonPerformance \?\? comparisonPerformanceResponse/);
  assert.match(source, /view: "identities"/); assert.match(source, /comparisonResult\.payload\.items = paired\.items/);
  assert.match(source, /promotionDisplayPair\?\.scopeKey === promotionScopeKey/);
});
