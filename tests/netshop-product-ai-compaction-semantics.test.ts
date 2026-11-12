import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { MetricValue } from "../lib/netshop/insights-contract";
import { completeProductSectionsFixture } from "./netshop-products-test-fixture";

const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://product-semantics.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://product-semantics-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-product-semantics-secret-0123456789", TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000" };
(globalThis as typeof globalThis & { __productSemanticsEnv?: typeof environment }).__productSemanticsEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__productSemanticsEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME: name } = await import("../lib/ai/netshop-product-insights-tool");
const { compactProductInsightsForAi, productCompactionLadder } = await import("../lib/ai/netshop-product-compaction");
const { syntheticInsightsContext } = await import("../lib/netshop/insights-fixtures");
const { compareMetrics } = await import("../lib/netshop/insights-contract");
const { restoreCoverageGaps } = await import("../lib/ai/netshop-ai-compaction");
const { productMetricKeys } = await import("../app/netshop/products/contract");
const entry = aiToolRegistry.find(e => e.name === name)!;
const principal: AppPrincipal = { email: "synthetic-product-semantics@example.test", displayName: "Synthetic", role: "analyst", scope: null };
const execution = { principal, surface: "test" as const, requestId: "synthetic-product-semantics" };
const originalFetch = globalThis.fetch;
const BUDGET = 40000;
type Plain = Record<string, any>;
let payload: Plain;
const envelope = (data: unknown) => JSON.stringify({ ok: true, toolName: name, data }).length;

/** Realistic non-zero metrics (ratios stay consistent with numerator/denominator). */
function metricsWith(scale = 1) {
  return Object.fromEntries(productMetricKeys.map(key => {
    const ratio = key === "conversion" || key === "addCartRate";
    return [key, { value: ratio ? 0.0125 : 123456789 * scale, unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : ratio ? "RATIO" : "COUNT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"], aggregation: ratio ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current", ...(ratio ? { numerator: 125, denominator: 10000 } : {}) }];
  })) as Record<typeof productMetricKeys[number], MetricValue>;
}
function row(id: string, metrics = metricsWith()) {
  const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
  return { identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id }, title: `合成商品名称较长较长较长${id}`, category: "合成类目", imageUrl: "https://img.example.test/a/b/c/d.jpg", imageStatus: "available", metrics, comparisons, baselineMetrics: { previous: metrics, yearAgo: metrics } };
}
/** pageSize rows on the current page, growth page and watchlist; 12 categories; 5 price bands. */
function build(pageSize: number, categoryCount = 12): Plain {
  const context = syntheticInsightsContext();
  const metrics = metricsWith();
  const rows = Array.from({ length: pageSize }, (_, i) => row(`P${i}`));
  const pagination = { page: 1, pageSize, total: pageSize, returned: pageSize, hasMore: false, truncated: false };
  const sections = completeProductSectionsFixture(metrics) as Plain;
  const bucket = (label: string, payment: number) => ({ ...structuredClone(sections.structure.categories[0] ?? { label, payment: metrics.payment, share: { ...metrics.conversion, unit: "RATIO" }, products: sections.counts.dataProducts }), label, payment: { ...metrics.payment, value: payment } });
  // Labels are alphabetical like the owner's `ORDER BY label`, but payment RISES with the label,
  // so "first N in source order" and "top N by payment" are different sets.
  sections.structure.categories = Array.from({ length: categoryCount }, (_, i) => bucket(`京东 / 类目${String(i).padStart(2, "0")}`, 1_000_000 + i * 10_000));
  sections.structure.priceBands = ["成交均价 <500元", "成交均价 500–1999元", "成交均价 2000–4999元", "成交均价 ≥5000元", "价格未知"].map((label, i) => bucket(label, 500_000 - i * 1000));
  sections.efficiency.watchlist = structuredClone(rows); sections.efficiency.pagination = { ...pagination };
  return { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { ...sections, summary: metrics, comparisons: Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }])), items: rows, pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: structuredClone(rows), pagination } } } };
}
const direct = (p: Plain, level: number) => compactProductInsightsForAi(p, productCompactionLadder[level]) as Plain;
function metricObjects(value: unknown, found: Plain[] = []): Plain[] {
  if (Array.isArray(value)) value.forEach(v => metricObjects(v, found));
  else if (value !== null && typeof value === "object") { if ("status" in (value as Plain) && "unit" in (value as Plain)) found.push(value as Plain); Object.values(value as Plain).forEach(v => metricObjects(v, found)); }
  return found;
}
function withoutSourceRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutSourceRefs) as T;
  if (value === null || typeof value !== "object") return value;
  const metric = "status" in (value as Plain), out: Plain = {};
  for (const [key, child] of Object.entries(value as Plain)) { if (metric && (key === "sourceIds" || key === "coverageRef")) continue; out[key] = withoutSourceRefs(child); }
  return out as T;
}

beforeEach(() => { globalThis.fetch = async () => Response.json(payload, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }); });
afterEach(() => { globalThis.fetch = originalFetch; });

test("product categories: whole when they fit; otherwise top N by payment (not alphabetical first N) and labelled", () => {
  const p = build(5);
  for (const level of [0, 1]) assert.deepEqual(direct(p, level).sections.structure.categories.map((b: Plain) => b.label), p.sections.structure.categories.map((b: Plain) => b.label));
  const byPayment = [...p.sections.structure.categories].sort((a: Plain, b: Plain) => b.payment.value - a.payment.value);
  for (const [level, n] of [[2, 10], [3, 5]] as const) {
    const out = direct(p, level);
    const labels = out.sections.structure.categories.map((b: Plain) => b.label);
    assert.deepEqual(labels, byPayment.slice(0, n).map((b: Plain) => b.label));
    assert.notDeepEqual(labels, p.sections.structure.categories.slice(0, n).map((b: Plain) => b.label)); // a "first N" implementation goes red here
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.structure.categories");
    assert.equal(mark.originalCount, 12); assert.equal(mark.keptCount, n); assert.match(mark.rule, new RegExp(`top_${n}_by_payment_desc`));
    assert.match(out.aiCompaction.note, /重排/);
  }
});

test("product categories: null payment ranks last; ties keep source order", () => {
  const p = build(1, 12);
  p.sections.structure.categories[11].payment = { ...p.sections.structure.categories[11].payment, value: null, status: "unavailable", reasonCode: "missing_field" };
  p.sections.structure.categories[0].payment.value = p.sections.structure.categories[1].payment.value;
  const labels = direct(p, 2).sections.structure.categories.map((b: Plain) => b.label);
  assert.equal(labels.includes(p.sections.structure.categories[11].label), false);
  assert.equal(labels.includes(p.sections.structure.categories[0].label), true); // tie with category 1 at the cut: source order wins
  assert.equal(labels.includes(p.sections.structure.categories[1].label), false);
});

test("product price bands are never reduced (always whole, same order) at every level", () => {
  const p = build(5);
  for (let level = 0; level < productCompactionLadder.length; level++) {
    const bands = direct(p, level).sections.structure.priceBands;
    assert.deepEqual(bands.map((b: Plain) => b.label), p.sections.structure.priceBands.map((b: Plain) => b.label));
    assert.equal(bands.length, 5);
    assert.equal(direct(p, level).aiCompaction.sections.some((s: Plain) => s.path === "sections.structure.priceBands"), false);
  }
});

test("product growth and watchlist: first N of the owner's ranked page as ranking rows, labelled with their real ordering", () => {
  const p = build(6);
  for (const [level, n] of [[4, 5], [5, 3]] as const) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.growth.data.items.map((r: Plain) => r.identity.id), p.sections.growth.data.items.slice(0, n).map((r: Plain) => r.identity.id));
    assert.deepEqual(out.sections.efficiency.watchlist.map((r: Plain) => r.identity.id), p.sections.efficiency.watchlist.slice(0, n).map((r: Plain) => r.identity.id));
    const growth = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.growth.data.items");
    const watch = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.efficiency.watchlist");
    assert.equal(growth.originalCount, 6); assert.equal(growth.keptCount, n); assert.match(growth.rule, new RegExp(`first_${n}_of_ranked_page_by_payment_delta`)); assert.match(growth.rule, /ranking_rows/);
    assert.equal(watch.originalCount, 6); assert.equal(watch.keptCount, n); assert.match(watch.rule, new RegExp(`first_${n}_of_ranked_page_by_visitors_desc`));
    // pagination still carries the source counts so kept rows cannot pass as the whole page/set
    assert.equal(out.sections.growth.data.pagination.returned, 6);
    assert.equal(out.sections.efficiency.pagination.returned, 6);
  }
});

test("product ranking rows: exact fields (identity, title, rankBasis) with the ranking metrics in value/unit/status/basis form", () => {
  const p = build(5);
  const out = direct(p, 1);
  out.sections.growth.data.items.forEach((r: Plain, i: number) => {
    const src = p.sections.growth.data.items[i];
    assert.deepEqual(Object.keys(r).sort(), ["identity", "rankBasis", "title"]);
    assert.deepEqual(r.identity, src.identity); assert.equal(r.title, src.title);
    assert.deepEqual(r.rankBasis, { payment: { value: src.metrics.payment.value, unit: src.metrics.payment.unit, status: src.metrics.payment.status, basis: src.metrics.payment.basis, aggregation: src.metrics.payment.aggregation } });
    assert.ok(JSON.stringify(r).length <= 600, `growth rank row ${JSON.stringify(r).length}`);
  });
  out.sections.efficiency.watchlist.forEach((r: Plain, i: number) => {
    const src = p.sections.efficiency.watchlist[i];
    assert.deepEqual(Object.keys(r).sort(), ["identity", "rankBasis", "title"]);
    assert.deepEqual(Object.keys(r.rankBasis).sort(), ["conversion", "visitors"]);
    assert.equal(r.rankBasis.visitors.value, src.metrics.visitors.value); assert.equal(r.rankBasis.conversion.value, src.metrics.conversion.value);
    assert.ok(JSON.stringify(r).length <= 600);
  });
  const withDelta = build(2);
  withDelta.sections.growth.data.items.forEach((r: Plain) => { r.paymentDelta = { ...r.metrics.payment, value: -4321 }; });
  assert.deepEqual(Object.keys(direct(withDelta, 1).sections.growth.data.items[0].rankBasis), ["paymentDelta"]);
  assert.equal(direct(withDelta, 1).sections.growth.data.items[0].rankBasis.paymentDelta.value, -4321);
});

const PRODUCT_METRIC_FIELDS = ["value", "unit", "status", "reasonCode", "basis", "aggregation", "numerator", "denominator", "metricSchemaVersion", "denominatorKind"];
test("product page rows: only baselineMetrics, image/link fields, categoryEvidence and metric refs may go; every metric and comparison stays", () => {
  const p = build(5);
  p.sections.items.forEach((r: Plain) => { r.productUrl = "https://shop.example.test/p"; r.categoryEvidence = { status: "label_only" }; r.paymentDelta = { ...r.metrics.payment, value: 55 }; });
  assert.equal(JSON.stringify(direct(p, 0).sections.items), JSON.stringify(p.sections.items));
  for (let level = 1; level < productCompactionLadder.length; level++) {
    const out = direct(p, level);
    out.sections.items.forEach((row: Plain, i: number) => {
      const src = p.sections.items[i];
      assert.deepEqual(row.identity, src.identity); assert.equal(row.title, src.title);
      for (const gone of ["baselineMetrics", "imageUrl", "productUrl", "categoryEvidence"]) assert.equal(Object.hasOwn(row, gone), false, gone);
      for (const kept of ["category", "imageStatus", "paymentDelta", "metrics", "comparisons"]) assert.equal(kept in row, true, kept);
      assert.deepEqual(Object.keys(row.metrics), Object.keys(src.metrics), "no metric dropped");
      for (const [key, m] of Object.entries<Plain>(src.metrics)) {
        for (const f of PRODUCT_METRIC_FIELDS) if (f in m) assert.deepEqual(row.metrics[key][f], m[f], `${level}.${key}.${f}`);
        assert.equal(Object.hasOwn(row.metrics[key], "sourceIds"), false); assert.equal(Object.hasOwn(row.metrics[key], "coverageRef"), false);
      }
      assert.deepEqual(row.comparisons, src.comparisons);
      assert.equal(row.paymentDelta.value, 55);
    });
    assert.match(out.aiCompaction.sections.find((s: Plain) => s.path === "sections.items[]").rule, /page_rows_slimmed\(-baselineMetrics,-imageUrl,-productUrl,-categoryEvidence,-metric\.sourceIds,-metric\.coverageRef\)/);
  }
});

test("product metrics keep basis and aggregation outside the page rows too", () => {
  const p = build(5);
  const out = direct(p, 3);
  const metrics = [...metricObjects(out.sections.summary), ...metricObjects(out.sections.efficiency), ...metricObjects(out.sections.structure)];
  assert.ok(metrics.length > 30);
  for (const m of metrics) { assert.equal(typeof m.basis, "string", JSON.stringify(m)); assert.equal(typeof m.aggregation, "string", JSON.stringify(m)); assert.equal(Object.hasOwn(m, "sourceIds"), false); assert.equal(Object.hasOwn(m, "coverageRef"), false); }
});

test("product coverage gap dates become lossless ranges and no gap entry is lost", () => {
  const p = build(3);
  const dates = ["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06", "2026-09-30", "2026-10-01"];
  p.context.coverageBySource["extra-gap"] = { expectedShopDatePairs: 9, coveredShopDatePairs: 2, complete: false, truncated: false, missingByShop: [{ shopKey: "京东\u001f合成店A", dates }] };
  const gapKeys = Object.entries<Plain>(p.context.coverageBySource).filter(([, c]) => c.complete === false).map(([k]) => k);
  const out = direct(p, 1);
  const restored = restoreCoverageGaps(out.context.coverageBySource);
  assert.deepEqual(Object.keys(restored).sort(), [...gapKeys].sort());
  for (const k of gapKeys) assert.deepEqual(restored[k], p.context.coverageBySource[k], `${k} lossless`);
  const extra = out.context.coverageBySource["extra-gap"] ?? out.context.coverageBySource._groupedByValue.find((g: Plain) => g.refs.includes("extra-gap")).value;
  assert.deepEqual(extra.missingByShop[0].missingRanges, ["2026-08-01~2026-08-02", "2026-08-04~2026-08-06", "2026-09-30~2026-10-01"]);
  assert.match(out.aiCompaction.note, /missingRanges/);
});

test("product pageSize 5 heavy scene (measured): fits 40000 only at level 5, where growth is cut to 3 rows (target 5 rows within 36000 not met)", () => {
  const p = build(5, 14);
  const ladder = productCompactionLadder.map((_, l) => envelope(direct(p, l)));
  console.log("product heavy pageSize=5 ladder", ladder.join("/"));
  const fit = ladder.findIndex(n => n <= BUDGET);
  assert.equal(fit, 5);
  assert.ok(ladder.every(n => n > 36000));
  const out = direct(p, fit);
  assert.equal(out.sections.growth.data.items.length, 3);
  assert.match(out.aiCompaction.sections.map((s: Plain) => s.rule).join("|"), /first_3_of_ranked_page_by_payment_delta/);
});

// ---- views (overview / rankings / list) ----
const baseArgs = { platforms: ["京东"], shops: [{ platform: "京东", shopName: "合成店A" }], startDate: "2026-09-01", endDate: "2026-09-01" };
async function runView(view: string | undefined, pageSize: number | undefined, source: Plain) {
  payload = source;
  const requests: URLSearchParams[] = [];
  globalThis.fetch = async input => { requests.push(new URL(String(input)).searchParams); return Response.json(payload, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }); };
  const data = await entry.handler({ ...baseArgs, ...(view ? { view } : {}), ...(pageSize ? { pageSize } : {}) }, execution) as Plain;
  return { data, requests };
}
const schemaProps = (entry.inputSchema as Plain).properties as Plain;

test("product view schema: enum + default overview; pageSize has no single default (per-view defaults are in the description) and max 20", () => {
  assert.deepEqual(schemaProps.view.enum, ["overview", "rankings", "list"]);
  assert.equal(schemaProps.view.default, "overview");
  assert.equal("default" in schemaProps.pageSize, false);
  assert.equal(schemaProps.pageSize.maximum, 20);
});

test("product views (heavy scene, 14 categories, non-zero metrics): rankings (17231) and list at default 4 (32945) within 36000; overview (38641) measured under 40000 but NOT within 36000; omitted pageSize follows the view default", async () => {
  const sizes: Record<string, number> = {};
  for (const [view, defaultSize] of [["overview", 1], ["rankings", 10], ["list", 4]] as const) {
    const { data, requests } = await runView(view, undefined, build(defaultSize, 14));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].get("pageSize"), String(defaultSize));
    assert.equal(requests[0].has("view"), false, "view must not be sent to Django");
    sizes[view] = envelope(data);
    // overview (38641) is above the 36000 target: nothing is compacted while the envelope fits 40000, and no metric/gap may be dropped to reach 36000
    assert.ok(sizes[view] <= (view === "overview" ? 40000 : 36000), `${view} ${sizes[view]}`);
    assert.equal(data.aiView.view, view);
    console.log("product view", view, sizes[view], JSON.stringify(data.aiCompaction?.sections.map((m: Plain) => `${m.path}:${m.rule}`)));
    if (view === "overview") assert.equal(data.aiCompaction, undefined, "overview needs no further compaction");
  }
  console.log("product view sizes (heavy, defaults)", JSON.stringify(sizes));
  // omitted view = overview
  const { data } = await runView(undefined, undefined, build(1, 14));
  assert.equal(data.aiView.view, "overview");
});

test("product views carry exactly their sections; rankings depth = pageSize; omitted paths point to the right view", async () => {
  const over = (await runView("overview", undefined, build(1, 14))).data;
  assert.deepEqual(Object.keys(over.sections).sort(), ["baselineReads", "comparisons", "counts", "dataQuality", "efficiency", "metadata", "structure", "summary"].sort());
  assert.equal("watchlist" in over.sections.efficiency, false);
  for (const path of ["sections.items", "sections.growth", "sections.efficiency.watchlist"]) assert.ok(over.aiView.omitted.some((o: Plain) => o.path === path), path);
  assert.match(over.aiView.omitted.find((o: Plain) => o.path === "sections.growth").howToGet, /rankings/);
  assert.match(over.aiView.omitted.find((o: Plain) => o.path === "sections.items").howToGet, /list/);

  const rank = (await runView("rankings", 10, build(10, 14))).data;
  assert.deepEqual(Object.keys(rank.sections).sort(), ["dataQuality", "efficiency", "growth", "metadata"]);
  assert.equal(rank.sections.growth.data.items.length, 10);
  assert.equal(rank.sections.efficiency.watchlist.length, 10);
  assert.equal(rank.context.capabilities, undefined);
  for (const r of [...rank.sections.growth.data.items, ...rank.sections.efficiency.watchlist]) for (const f of ["platform", "shopName", "dimension", "id"]) assert.ok(r.identity?.[f] !== undefined, `identity.${f}`);
  assert.ok(rank.aiView.omitted.some((o: Plain) => o.path === "sections.structure"));

  const list = (await runView("list", 4, build(4, 14))).data;
  assert.deepEqual(Object.keys(list.sections).sort(), ["dataQuality", "items", "metadata", "pagination"]);
  assert.equal(list.sections.items.length, 4);
  for (const path of ["sections.growth", "sections.efficiency", "sections.structure"]) assert.ok(list.aiView.omitted.some((o: Plain) => o.path === path), path);
});

test("product views keep tokens, dates, scope, quality and limitations and the coverage gaps in every view (lossless as ranges)", async () => {
  for (const [view, size] of [["overview", 1], ["rankings", 10], ["list", 4]] as const) {
    const src = build(size, 14);
    const { data } = await runView(view, size, src);
    assert.equal(data.sectionToken, src.sectionToken);
    assert.equal(data.context.snapshotToken, src.context.snapshotToken);
    assert.equal(data.context.columnVersion, src.context.columnVersion);
    assert.deepEqual(data.context.periods, src.context.periods);
    assert.deepEqual(data.context.effectiveScope, src.context.effectiveScope);
    assert.deepEqual(data.sections.dataQuality, src.sections.dataQuality);
    assert.ok(data.sections.metadata.limitations);
    const gaps = Object.entries<Plain>(src.context.coverageBySource ?? {}).filter(([, c]) => c.complete === false);
    // An uncompacted (fitting) view still carries complete entries; only the gap entries are compared.
    const keptGaps = Object.entries(restoreCoverageGaps(data.context.coverageBySource) as Record<string, Plain>).filter(([, c]) => c.complete === false);
    assert.deepEqual(Object.fromEntries(keptGaps), Object.fromEntries(gaps), `${view} gaps lossless`);
  }
});

test("product invalid view: invalid_arguments and no Django request; decode failure rejects in all three views", async () => {
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return Response.json(build(1), { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }); };
  for (const view of ["detail", "ALL", "", null, 1]) await assert.rejects(entry.handler({ ...baseArgs, view } as never, execution), (e: Plain) => e.code === "invalid_arguments");
  assert.equal(fetched, 0);
  for (const view of ["overview", "rankings", "list"]) {
    const bad = build(1); bad.sectionToken = "not-a-token"; payload = bad;
    globalThis.fetch = async () => Response.json(payload, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
    await assert.rejects(entry.handler({ ...baseArgs, view } as never, execution), (e: Plain) => e.code === "invalid_tool_result" || e.code === "invalid_arguments" || /invalid/.test(String(e.code)), view);
  }
});
