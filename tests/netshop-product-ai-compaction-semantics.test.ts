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
const { NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME: name, NETSHOP_PRODUCT_INSIGHTS_AI_DEFAULT_PAGE_SIZE, netshopProductInsightsInputSchema } = await import("../lib/ai/netshop-product-insights-tool");
const { compactProductInsightsForAi, productCompactionLadder } = await import("../lib/ai/netshop-product-compaction");
const { syntheticInsightsContext } = await import("../lib/netshop/insights-fixtures");
const { compareMetrics } = await import("../lib/netshop/insights-contract");
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

test("product growth and watchlist: first N of the owner's ranked page in order, labelled with their real ordering", () => {
  const p = build(6);
  const out = direct(p, 2);
  assert.deepEqual(out.sections.growth.data.items.map((r: Plain) => r.identity.id), p.sections.growth.data.items.slice(0, 3).map((r: Plain) => r.identity.id));
  assert.deepEqual(out.sections.efficiency.watchlist.map((r: Plain) => r.identity.id), p.sections.efficiency.watchlist.slice(0, 3).map((r: Plain) => r.identity.id));
  const growth = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.growth.data.items");
  const watch = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.efficiency.watchlist");
  assert.equal(growth.originalCount, 6); assert.equal(growth.keptCount, 3); assert.match(growth.rule, /first_3_of_ranked_page_by_payment_delta/);
  assert.equal(watch.originalCount, 6); assert.equal(watch.keptCount, 3); assert.match(watch.rule, /first_3_of_ranked_page_by_visitors_desc/);
  // pagination still carries the source total so the kept rows cannot pass as the whole page/set
  assert.equal(out.sections.growth.data.pagination.returned, 6);
  assert.equal(out.sections.efficiency.pagination.returned, 6);
});

test("product metrics keep basis and aggregation; current page rows are never reduced", () => {
  const p = build(5);
  for (let level = 0; level < productCompactionLadder.length; level++) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.items, level === 0 ? p.sections.items : withoutSourceRefs(p.sections.items), `items level ${level}`);
    if (level === 0) continue;
    const metrics = [...metricObjects(out.sections.summary), ...metricObjects(out.sections.items), ...metricObjects(out.sections.growth), ...metricObjects(out.sections.efficiency), ...metricObjects(out.sections.structure)];
    assert.ok(metrics.length > 50);
    for (const m of metrics) { assert.equal(typeof m.basis, "string"); assert.equal(typeof m.aggregation, "string"); assert.equal(Object.hasOwn(m, "sourceIds"), false); assert.equal(Object.hasOwn(m, "coverageRef"), false); }
  }
});

test("product default pageSize: schema default 1 (max 20) and an omitted pageSize with real-structure non-zero rows stays under 40000 with margin", async () => {
  assert.equal(NETSHOP_PRODUCT_INSIGHTS_AI_DEFAULT_PAGE_SIZE, 1);
  const schema = netshopProductInsightsInputSchema.properties.pageSize as { default: number; maximum: number };
  assert.equal(schema.default, 1); assert.equal(schema.maximum, 20);
  payload = build(1);
  assert.ok(envelope(payload) > BUDGET - 8000, `source ${envelope(payload)}`);
  let requested = "";
  globalThis.fetch = async input => { requested = new URL(String(input)).searchParams.get("pageSize")!; return Response.json(payload, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }); };
  const data = await entry.handler({ platforms: ["京东"], shops: [{ platform: "京东", shopName: "合成店A" }], startDate: "2026-09-01", endDate: "2026-09-01" }, execution);
  assert.equal(requested, "1");
  assert.ok(envelope(data) <= BUDGET - 1500, `envelope ${envelope(data)}`);
});
