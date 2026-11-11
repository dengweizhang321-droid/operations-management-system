import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { PromotionInsightsResponse, PromotionObjectRow, PromotionShopRow } from "../lib/netshop/promotion-insights-contract";

const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://promotion-semantics.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://promotion-semantics-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-promotion-semantics-secret-0123456789", TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000" };
(globalThis as typeof globalThis & { __promotionSemanticsEnv?: typeof environment }).__promotionSemanticsEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__promotionSemanticsEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { NETSHOP_PROMOTION_INSIGHTS_TOOL_NAME: listName, NETSHOP_PROMOTION_AI_DEFAULT_PAGE_SIZE, netshopPromotionInsightsInputSchema } = await import("../lib/ai/netshop-promotion-insights-tool");
const { compactPromotionInsightsForAi, promotionCompactionLadder } = await import("../lib/ai/netshop-promotion-compaction");
const { decodePromotionInsightsForQuery } = await import("../lib/netshop/promotion-insights-contract");
const listEntry = aiToolRegistry.find(e => e.name === listName)!;
const principal: AppPrincipal = { email: "synthetic-promotion-semantics@example.test", displayName: "Synthetic", role: "admin", scope: null };
const context = { principal, surface: "test" as const, requestId: "synthetic-promotion-semantics" };
const originalFetch = globalThis.fetch;
const BUDGET = 40000;
let owningRevision: string;
let payload: PromotionInsightsResponse;

async function base() { return JSON.parse(await readFile("tests/fixtures/netshop-promotion/response-product.json", "utf8")) as PromotionInsightsResponse; }
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const envelope = (data: unknown) => JSON.stringify({ ok: true, toolName: listName, data }).length;
type Plain = Record<string, any>;

/** Remove only metric source references (sourceIds / coverageRef inside metric objects). */
function withoutSourceRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutSourceRefs) as T;
  if (value === null || typeof value !== "object") return value;
  const metric = "status" in (value as Plain);
  const out: Plain = {};
  for (const [key, child] of Object.entries(value as Plain)) { if (metric && (key === "sourceIds" || key === "coverageRef")) continue; out[key] = withoutSourceRefs(child); }
  return out as T;
}
function metricObjects(value: unknown, found: Plain[] = []): Plain[] {
  if (Array.isArray(value)) value.forEach(v => metricObjects(v, found));
  else if (value !== null && typeof value === "object") { if ("status" in (value as Plain) && "unit" in (value as Plain)) found.push(value as Plain); Object.values(value as Plain).forEach(v => metricObjects(v, found)); }
  return found;
}

/** Source with distinguishable orders: shops alphabetical but spend ascending; 20 chronological trend points. */
async function semanticsPayload(shopCount = 12): Promise<PromotionInsightsResponse> {
  const p = await base();
  const shop: PromotionShopRow = p.sections.shops.items[0];
  p.sections.shops.items = Array.from({ length: shopCount }, (_, i) => {
    const s = structuredClone(shop);
    s.shopName = `店${String(i).padStart(2, "0")}`; s.shopKey = `京东\u001f${s.shopName}`;
    s.metrics.spend = { ...s.metrics.spend, value: 1000 + i * 100 }; // later names spend MORE
    return s;
  });
  const row = p.sections.items[0];
  const makeRow = (id: string, score: number): PromotionObjectRow => {
    const r = structuredClone(row); r.rowKey = hex(id); r.id = id; r.mapping = { ...r.mapping, followSkuId: id, linkIdentity: r.mapping.linkIdentity ? { ...r.mapping.linkIdentity, id } : null };
    for (const key of ["spend", "attributedPayment"] as const) r.changes[key].previous = { ...r.changes[key].previous, value: score, status: "available", reasonCode: null };
    return r;
  };
  const ranked = (prefix: string, sign: 1 | -1) => Array.from({ length: 10 }, (_, i) => makeRow(`${prefix}${i}`, sign * (90000 - i * 1000)));
  p.sections.contributions = { collection: "comparable_full_set_before_search_pagination", comparedObjectCount: 80, excludedObjectCount: 0, previous: { spendIncrease: ranked("si", 1), spendDecrease: ranked("sd", -1), attributedPaymentIncrease: ranked("pi", 1), attributedPaymentDecrease: ranked("pd", -1) } };
  const point = p.sections.trend.items[0];
  p.sections.trend.items = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(point), startDate: `2026-08-${String(i + 1).padStart(2, "0")}`, endDate: `2026-08-${String(i + 1).padStart(2, "0")}`, days: 1 }));
  return p;
}
const direct = (p: PromotionInsightsResponse, level: number) => compactPromotionInsightsForAi(p as unknown as Plain, promotionCompactionLadder[level]) as Plain;

beforeEach(() => { globalThis.fetch = async () => Response.json(payload, { headers: { "X-Netshop-Data-Revision": owningRevision } }); });
afterEach(() => { globalThis.fetch = originalFetch; });

test("promotion shops: all shops are kept whole when they fit, in source order", async () => {
  const p = await semanticsPayload();
  for (const level of [0, 1]) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.shops.items.map((s: Plain) => s.shopName), p.sections.shops.items.map(s => s.shopName));
    assert.equal(out.aiCompaction.sections.some((s: Plain) => s.path === "sections.shops.items" && /top_\d+_by_spend_desc/.test(s.rule)), false);
  }
});

test("promotion shops: a reduced set is the top N by spend (not the first N by name) and is labelled so", async () => {
  const p = await semanticsPayload();
  const expected = [...p.sections.shops.items].sort((a, b) => Number(b.metrics.spend.value) - Number(a.metrics.spend.value));
  for (const [level, n] of [[2, 10], [3, 5], [4, 3]] as const) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.shops.items.map((s: Plain) => s.shopName), expected.slice(0, n).map(s => s.shopName));
    // the wrong implementation (first N in name order) would keep 店00.. which spend the least
    assert.notDeepEqual(out.sections.shops.items.map((s: Plain) => s.shopName), p.sections.shops.items.slice(0, n).map(s => s.shopName));
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.shops.items");
    assert.equal(mark.originalCount, 12); assert.equal(mark.keptCount, n); assert.match(mark.rule, new RegExp(`top_${n}_by_spend_desc`));
    assert.match(out.aiCompaction.note, /重排/);
  }
});

test("promotion contributions: first N in the owner's ranked order, labelled as source-ranked; full counts stay", async () => {
  const p = await semanticsPayload();
  const out = direct(p, 2);
  for (const key of ["spendIncrease", "spendDecrease", "attributedPaymentIncrease", "attributedPaymentDecrease"] as const) {
    assert.deepEqual(out.sections.contributions.previous[key].map((r: Plain) => r.rowKey), p.sections.contributions.previous[key].slice(0, 3).map(r => r.rowKey));
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === `sections.contributions.previous.${key}`);
    assert.equal(mark.originalCount, 10); assert.equal(mark.keptCount, 3); assert.match(mark.rule, /top_3_source_ranked_by_previous_change/);
    // ranking basis survives on each kept row
    for (const r of out.sections.contributions.previous[key]) assert.equal(typeof r.changes.spend.previous.value, "number");
  }
  assert.equal(out.sections.contributions.comparedObjectCount, 80);
});

test("promotion trend: keeps the latest N points in chronological order and says so", async () => {
  const p = await semanticsPayload();
  const out = direct(p, 2);
  assert.deepEqual(out.sections.trend.items.map((t: Plain) => t.startDate), p.sections.trend.items.slice(-7).map(t => t.startDate));
  const mark = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.trend.items");
  assert.equal(mark.originalCount, 20); assert.equal(mark.keptCount, 7); assert.match(mark.rule, /latest_7_points/);
});

test("promotion metrics keep basis and aggregation everywhere; only sourceIds/coverageRef are omitted", async () => {
  const p = await semanticsPayload();
  for (const level of [1, 4]) {
    const out = direct(p, level);
    const metrics = [...metricObjects(out.sections.summary), ...metricObjects(out.sections.shops), ...metricObjects(out.sections.contributions), ...metricObjects(out.sections.trend), ...metricObjects(out.sections.items), ...metricObjects(out.sections.changes)];
    assert.ok(metrics.length > 30);
    for (const m of metrics) { assert.equal(typeof m.basis, "string"); assert.equal(typeof m.aggregation, "string"); assert.equal(Object.hasOwn(m, "sourceIds"), false); assert.equal(Object.hasOwn(m, "coverageRef"), false); }
    assert.deepEqual(new Set(metricObjects(out.sections.items).map(m => m.basis)), new Set(metricObjects(p.sections.items).map(m => m.basis)));
  }
});

test("promotion current page rows are never reduced at any level: same fields, only metric sourceIds/coverageRef omitted", async () => {
  const p = await semanticsPayload();
  for (let level = 0; level < promotionCompactionLadder.length; level++) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.items, level === 0 ? p.sections.items : withoutSourceRefs(p.sections.items), `level ${level}`);
  }
});

test("promotion note explains that a missing coverage key means complete", async () => {
  const out = direct(await semanticsPayload(), 1);
  assert.match(out.aiCompaction.note, /缺失的键表示该来源完整/);
});

test("promotion default pageSize: schema default and an omitted pageSize stay under 40000 with margin (decoder-valid, full contribution lists)", async () => {
  assert.equal(NETSHOP_PROMOTION_AI_DEFAULT_PAGE_SIZE, 1);
  assert.equal((netshopPromotionInsightsInputSchema.properties.pageSize as { default: number }).default, NETSHOP_PROMOTION_AI_DEFAULT_PAGE_SIZE);
  assert.equal((netshopPromotionInsightsInputSchema.properties.pageSize as { maximum: number }).maximum, 20);
  // Decoder-safe: real fixture shape, 4 x 10 ranked contribution rows (the owner's maximum), one shop, one trend point.
  const full = await semanticsPayload(1);
  payload = await base();
  payload.sections.contributions = full.sections.contributions;
  payload.sections.pagination = { ...payload.sections.pagination, pageSize: NETSHOP_PROMOTION_AI_DEFAULT_PAGE_SIZE };
  owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  const c = payload.context;
  const args = { platform: c.requestedScope.platforms[0], startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind, trendGrain: payload.sections.trend.grain, ...(c.requestedScope.shopKeys.length ? { outlets: c.requestedScope.shopKeys } : {}) };
  let requested = "";
  globalThis.fetch = async input => { requested = new URL(String(input)).searchParams.get("pageSize")!; return Response.json(payload, { headers: { "X-Netshop-Data-Revision": owningRevision } }); };
  assert.ok(envelope(payload) > BUDGET, "uncompacted source must be over budget for this to prove anything");
  const data = await listEntry.handler(args, context);
  assert.equal(requested, "1");
  assert.ok(envelope(data) <= BUDGET - 1500, `envelope ${envelope(data)}`);
  void decodePromotionInsightsForQuery;
});
