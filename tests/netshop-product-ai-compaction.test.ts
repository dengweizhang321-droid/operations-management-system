import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { MetricValue } from "../lib/netshop/insights-contract";
import { completeProductSectionsFixture } from "./netshop-products-test-fixture";

const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://product-compact.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://product-compact-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-product-compact-secret-0123456789", TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000" };
(globalThis as typeof globalThis & { __productCompactEnv?: typeof environment }).__productCompactEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__productCompactEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME: name } = await import("../lib/ai/netshop-product-insights-tool");
const { compactProductInsightsForAi, productCompactionLadder } = await import("../lib/ai/netshop-product-compaction");
const { syntheticInsightsContext } = await import("../lib/netshop/insights-fixtures");
const { compareMetrics } = await import("../lib/netshop/insights-contract");
const { decodeProductInsights, productMetricKeys } = await import("../app/netshop/products/contract");
const { RegistryToolError } = await import("../lib/ai/tool-registry-contract");
const entry = aiToolRegistry.find(e => e.name === name)!;
const principal: AppPrincipal = { email: "synthetic-product-compact@example.test", displayName: "Synthetic", role: "analyst", scope: null };
const args = { platforms: ["京东"], shops: [{ platform: "京东", shopName: "合成店A" }], startDate: "2026-09-01", endDate: "2026-09-01", pageSize: 1 };
const execution = { principal, surface: "test" as const, requestId: "synthetic-product-compact" };
const originalFetch = globalThis.fetch;
const BUDGET = 40000;
const query = () => new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: args.startDate, endDate: args.endDate, pageSize: "1" });
const envelopeLength = (data: unknown) => JSON.stringify({ ok: true, toolName: name, data }).length;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const errorIs = (code: string) => (error: unknown) => error instanceof RegistryToolError && error.code === code;

type Payload = ReturnType<typeof fixture>;
let payload: Payload;
let revision = "1:aaaaaaaaaaaa";

function fixture(rowCount = 1) {
  const context = syntheticInsightsContext();
  const metrics = Object.fromEntries(productMetricKeys.map(key => [key, {
    value: 0,
    unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : key === "conversion" || key === "addCartRate" ? "RATIO" : "COUNT",
    status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"],
    aggregation: key === "conversion" || key === "addCartRate" ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current",
    ...(key === "conversion" || key === "addCartRate" ? { numerator: 0, denominator: 10 } : {}),
  }])) as Record<typeof productMetricKeys[number], MetricValue>;
  const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
  const makeItem = (i: number) => ({ identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id: `P${i}` }, title: `合成商品${i}`, category: null, imageUrl: null, imageStatus: "unverified", metrics, comparisons, baselineMetrics: { previous: metrics, yearAgo: metrics } });
  const item = makeItem(1);
  const pagination = { page: 1, pageSize: 1, total: 1, returned: 1, hasMore: false, truncated: false };
  const rows = Array.from({ length: rowCount }, (_, i) => makeItem(i + 100));
  const sections = completeProductSectionsFixture(metrics) as Record<string, any>;
  return { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize: 1 }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { ...sections, summary: metrics, comparisons, items: [item], pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: rows, pagination: { ...pagination, pageSize: Math.max(rowCount, 1), total: rowCount, returned: rowCount } } } } };
}
function response(data: unknown = payload, status = 200, header: string | null = revision) { return Response.json(data, { status, headers: header === null ? {} : { "X-Netshop-Data-Revision": header } }); }
/** Production-like: growth ranking plus an efficiency watchlist and wide structure buckets. */
function productionScale(): Payload {
  const p = fixture(6);
  const s = p.sections as Record<string, any>;
  const bucket = (i: number, kind: string) => ({ ...structuredClone(s.structure.categories[0] ?? { label: "x", payment: s.summary.payment, share: s.summary.conversion, products: s.counts.dataProducts }), label: `${kind}桶${i}` });
  const base = s.structure.categories[0] ?? { label: "x", payment: s.summary.payment, share: { ...s.summary.conversion, unit: "RATIO" }, products: s.counts.dataProducts };
  s.structure.categories = Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(base), label: `类目${i}` }));
  s.structure.priceBands = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(base), label: `价格带${i}` }));
  void bucket;
  const watch = structuredClone(s.growth.data.items.slice(0, 6));
  s.efficiency.watchlist = watch;
  s.efficiency.pagination = { ...s.growth.data.pagination, total: watch.length, returned: watch.length, pageSize: watch.length };
  s.efficiency.scanned = 40; s.efficiency.qualified = watch.length;
  return p;
}

beforeEach(() => { revision = "1:aaaaaaaaaaaa"; payload = productionScale(); globalThis.fetch = async () => response(); });
afterEach(() => { globalThis.fetch = originalFetch; });

test("generated production-scale product response is decoder-valid and over the 40000 budget (>=~50KB)", () => {
  decodeProductInsights(payload, query(), revision);
  assert.ok(envelopeLength(payload) > 50_000, `envelope ${envelopeLength(payload)}`);
  assert.ok(bytes(payload) < 2 * 1024 * 1024);
});

test("oversized valid product response is compacted under 40000 and every reduction is named", async () => {
  const before = structuredClone(payload);
  const data = await entry.handler(args, execution) as any;
  assert.deepEqual(payload, before, "source object must not be mutated");
  assert.ok(envelopeLength(data) < BUDGET, `envelope ${envelopeLength(data)}`);
  assert.equal(data.sectionToken, payload.sectionToken); assert.equal(data.context.snapshotToken, payload.context.snapshotToken);
  assert.deepEqual(data.tableScope, payload.tableScope); assert.deepEqual(data.sections.pagination, payload.sections.pagination);
  assert.deepEqual(data.sections.comparisons, payload.sections.comparisons);
  assert.deepEqual(data.sections.items.map((i: any) => i.identity), payload.sections.items.map(i => i.identity));
  assert.equal(data.sections.summary.payment.value, payload.sections.summary.payment.value);
  assert.deepEqual(data.sections.efficiency.rules, (payload.sections as any).efficiency.rules);
  assert.equal(data.sections.efficiency.scanned, 40); assert.equal(data.sections.efficiency.qualified, 6);
  assert.deepEqual(data.sections.structure.denominator.value, (payload.sections as any).structure.denominator.value);
  assert.equal(data.aiCompaction.applied, true);
  const byPath = new Map<string, any>(data.aiCompaction.sections.map((s: any) => [s.path, s]));
  for (const [path, list, original] of [
    ["sections.growth.data.items", data.sections.growth.data.items, payload.sections.growth.data.items],
    ["sections.efficiency.watchlist", data.sections.efficiency.watchlist, (payload.sections as any).efficiency.watchlist],
    ["sections.structure.categories", data.sections.structure.categories, (payload.sections as any).structure.categories],
  ] as const) {
    const mark = byPath.get(path)!; assert.ok(mark, path);
    assert.equal(mark.originalCount, original.length); assert.equal(mark.keptCount, list.length); assert.ok(list.length < original.length);
  }
  // Pagination of a trimmed list still reports the source total, so Top N can't pass as the full set.
  assert.equal(data.sections.growth.data.pagination.total, payload.sections.growth.data.pagination.total);
  assert.equal(data.sections.growth.state, "ready");
  console.log(`product production-scale: source envelope ${envelopeLength(payload)}, ladder ${productCompactionLadder.map(l => envelopeLength(compactProductInsightsForAi(payload as any, l))).join("/")}, result ${envelopeLength(data)}`);
});

test("product coverage gaps survive compaction whole; only complete context entries fold", async () => {
  const data = await entry.handler(args, execution) as any;
  const gaps = Object.entries(payload.context.coverageBySource).filter(([, c]) => !c.complete);
  assert.ok(gaps.length >= 1);
  for (const [ref, gap] of gaps) assert.deepEqual(data.context.coverageBySource[ref], gap);
  for (const value of Object.values<any>(data.context.coverageBySource)) assert.equal(value.complete, false);
  assert.deepEqual(data.context.calendar, payload.context.calendar);
  assert.deepEqual(data.context.capabilities, payload.context.capabilities);
});

test("decoder rejection still wins on an oversized product response", async () => {
  const good = productionScale();
  for (const mutate of [
    (p: Payload) => { p.tableScope.q = "other"; },
    (p: Payload) => { p.context.sourceRevisions.pop(); },
    (p: Payload) => { p.sections.pagination.returned = 0; },
    (p: Payload) => { p.sections.items[0].identity.shopName = "其他店"; },
  ]) { payload = structuredClone(good); mutate(payload); await assert.rejects(entry.handler(args, execution), errorIs("invalid_tool_result")); }
  payload = structuredClone(good); revision = "2:aaaaaaaaaaaa";
  await assert.rejects(entry.handler(args, execution), errorIs("invalid_tool_result"));
});

test("product still refuses with tool_result_too_large when the heaviest level cannot fit", async () => {
  payload = fixture(1);
  const items = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(payload.sections.items[0]), identity: { ...payload.sections.items[0].identity, id: `P${i}` }, title: "x".repeat(2000) }));
  payload.sections.items = items; payload.sections.growth.data.items = structuredClone(items);
  Object.assign(payload.tableScope, { pageSize: 20 });
  Object.assign(payload.sections.pagination, { pageSize: 20, total: 20, returned: 20 });
  Object.assign(payload.sections.growth.data.pagination, { pageSize: 20, total: 20, returned: 20 });
  decodeProductInsights(payload, new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: args.startDate, endDate: args.endDate, pageSize: "20" }), revision);
  assert.ok(envelopeLength(compactProductInsightsForAi(payload as any, productCompactionLadder.at(-1)!)) > BUDGET);
  await assert.rejects(entry.handler({ ...args, pageSize: 20 }, execution), errorIs("tool_result_too_large"));
  assert.equal(payload.sections.items.length, 20);
});

test("a product response that already fits is returned unchanged with no aiCompaction", async () => {
  payload = fixture(1); payload.sections.growth.data.items = [];
  Object.assign(payload.sections.growth.data.pagination, { total: 0, returned: 0 });
  assert.ok(envelopeLength(payload) <= BUDGET);
  const data = await entry.handler(args, execution);
  assert.deepEqual(data, payload); assert.equal(Object.hasOwn(data, "aiCompaction"), false);
});
