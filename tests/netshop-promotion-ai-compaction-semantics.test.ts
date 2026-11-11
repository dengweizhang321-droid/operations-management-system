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
const { expandDateRanges } = await import("../lib/ai/netshop-ai-compaction");
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
  for (const [level, n] of [[3, 10], [4, 5], [5, 3]] as const) {
    const out = direct(p, level);
    assert.deepEqual(out.sections.shops.items.map((s: Plain) => s.shopName), expected.slice(0, n).map(s => s.shopName));
    // the wrong implementation (first N in name order) would keep 店00.. which spend the least
    assert.notDeepEqual(out.sections.shops.items.map((s: Plain) => s.shopName), p.sections.shops.items.slice(0, n).map(s => s.shopName));
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.shops.items");
    assert.equal(mark.originalCount, 12); assert.equal(mark.keptCount, n); assert.match(mark.rule, new RegExp(`top_${n}_by_spend_desc`));
    assert.match(out.aiCompaction.note, /重排/);
  }
});

test("promotion contributions: first N in the owner's ranked order as ranking rows; full counts stay", async () => {
  const p = await semanticsPayload();
  const out = direct(p, 2);
  for (const key of ["spendIncrease", "spendDecrease", "attributedPaymentIncrease", "attributedPaymentDecrease"] as const) {
    assert.deepEqual(out.sections.contributions.previous[key].map((r: Plain) => r.rowKey), p.sections.contributions.previous[key].slice(0, 5).map(r => r.rowKey));
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === `sections.contributions.previous.${key}`);
    assert.equal(mark.originalCount, 10); assert.equal(mark.keptCount, 5); assert.match(mark.rule, /top_5_source_ranked_by_previous_change/); assert.match(mark.rule, /ranking_rows/);
    const metric = key.startsWith("spend") ? "spend" : "attributedPayment";
    out.sections.contributions.previous[key].forEach((r: Plain, i: number) => {
      const src = p.sections.contributions.previous[key][i];
      assert.deepEqual(Object.keys(r).sort(), ["id", "metrics", "objectKind", "rankBasis", "rowKey", "shopKey", "title"]);
      for (const f of ["rowKey", "id", "shopKey", "objectKind", "title"] as const) assert.equal(r[f], src[f]);
      assert.deepEqual(Object.keys(r.metrics), ["spend", "attributedPayment", "roas"]);
      for (const m of ["spend", "attributedPayment", "roas"] as const) assert.deepEqual(r.metrics[m], { value: src.metrics[m].value, unit: src.metrics[m].unit });
      assert.equal(r.rankBasis.metric, metric);
      const prev = src.changes[metric].previous;
      assert.equal(r.rankBasis.previous.value, prev.value); assert.equal(r.rankBasis.previous.unit, prev.unit); assert.equal(r.rankBasis.previous.status, prev.status); assert.equal(r.rankBasis.previous.basis, prev.basis);
      assert.ok(JSON.stringify(r).length <= 700, `ranking row ${JSON.stringify(r).length}`);
    });
  }
  assert.equal(out.sections.contributions.comparedObjectCount, 80);
});

test("promotion ranking rows carry what the detail tool needs (rowKey -> objectId, shopKey, objectKind)", async () => {
  const detail = aiToolRegistry.find(e => e.name === "get_netshop_promotion_object_detail")!;
  const props = (detail.inputSchema as Plain).properties as Plain;
  const p = await semanticsPayload();
  for (const level of [2, 6]) for (const rows of Object.values<Plain[]>(direct(p, level).sections.contributions.previous)) for (const r of rows) {
    assert.match(r.rowKey, new RegExp(props.objectId.pattern));
    assert.match(r.shopKey, new RegExp(props.shopKey.pattern));
    assert.ok((props.objectKind.enum as string[]).includes(r.objectKind));
  }
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
    const metrics = [...metricObjects(out.sections.summary), ...metricObjects(out.sections.shops), ...metricObjects(out.sections.trend), ...metricObjects(out.sections.items), ...metricObjects(out.sections.changes)];
    assert.ok(metrics.length > 30);
    for (const m of metrics) { assert.equal(typeof m.basis, "string"); assert.equal(typeof m.aggregation, "string"); assert.equal(Object.hasOwn(m, "sourceIds"), false); assert.equal(Object.hasOwn(m, "coverageRef"), false); }
    assert.deepEqual(new Set(metricObjects(out.sections.items).map(m => m.basis)), new Set(metricObjects(p.sections.items).map(m => m.basis)));
  }
});

const RETAINED_IDENTITY = ["rowKey", "id", "shopKey", "objectKind", "identityKind", "title", "planId", "unitId", "matchType", "drillable"];
const COMPLETE_METRIC_FIELDS = ["value", "unit", "status", "reasonCode", "basis", "aggregation", "numerator", "denominator", "metricSchemaVersion", "denominatorKind"];

test("promotion page rows: only observation, mapping SKU ids and metric refs may go; every metric and comparison stays field by field", async () => {
  const p = await semanticsPayload();
  assert.equal(JSON.stringify(direct(p, 0).sections.items), JSON.stringify(p.sections.items));
  for (let level = 1; level < promotionCompactionLadder.length; level++) {
    const out = direct(p, level);
    out.sections.items.forEach((row: Plain, i: number) => {
      const src: Plain = p.sections.items[i];
      for (const f of RETAINED_IDENTITY) if (f in src) assert.deepEqual(row[f], src[f], `${level}.${f}`);
      assert.equal(Object.hasOwn(row, "observation"), false);
      assert.deepEqual(Object.keys(row.mapping).sort(), Object.keys(src.mapping).filter(k => !["advertisedSkuId", "triggerSkuId", "followSkuId"].includes(k)).sort());
      for (const f of ["status", "evidence", "linkIdentity"]) assert.deepEqual(row.mapping[f], src.mapping[f]);
      assert.deepEqual(Object.keys(row.metrics), Object.keys(src.metrics), "no metric dropped");
      for (const [key, m] of Object.entries<Plain>(src.metrics)) {
        for (const f of COMPLETE_METRIC_FIELDS) if (f in m) assert.deepEqual(row.metrics[key][f], m[f], `${level}.${key}.${f}`);
        assert.equal(Object.hasOwn(row.metrics[key], "sourceIds"), false); assert.equal(Object.hasOwn(row.metrics[key], "coverageRef"), false);
      }
      assert.deepEqual(withoutSourceRefs(row.comparisons), withoutSourceRefs(src.comparisons));
      assert.deepEqual(withoutSourceRefs(row.changes), withoutSourceRefs(src.changes));
      assert.deepEqual(withoutSourceRefs(row.spendShare), withoutSourceRefs(src.spendShare));
    });
    const mark = out.aiCompaction.sections.find((s: Plain) => s.path === "sections.items[]");
    assert.match(mark.rule, /page_rows_slimmed\(-observation,-mapping\.advertisedSkuId\/triggerSkuId\/followSkuId,-metric\.sourceIds,-metric\.coverageRef\)/);
  }
});

test("promotion coverage gap dates become lossless ranges: no entry lost, expansion equals the original dates", async () => {
  const p = await semanticsPayload();
  const dates = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-07", "2026-08-09", "2026-08-10", "2026-09-30", "2026-10-01"];
  const template = { expectedShopDatePairs: 9, coveredShopDatePairs: 1, complete: false, truncated: false, missingByShop: [] as Plain[] };
  const gap = () => ({ ...template, missingByShop: [{ shopKey: "京东\u001fA", dates: [...dates] }, { shopKey: "京东\u001fB", dates: dates.slice(0, 2) }] });
  (p.sections.coverage as Plain)["gap-a"] = gap();
  (p.sections.coverage as Plain)["gap-b"] = gap();
  (p.context.coverageBySource as Plain)["gap-ctx"] = gap();
  const out = direct(p, 1);
  const pairs: Array<[Plain, Plain, string]> = [[out.sections.coverage, p.sections.coverage as Plain, "gap-a"], [out.sections.coverage, p.sections.coverage as Plain, "gap-b"], [out.context.coverageBySource, p.context.coverageBySource as Plain, "gap-ctx"]];
  for (const [keptMap, origMap, key] of pairs) {
    const kept = keptMap[key]; const orig = origMap[key];
    assert.ok(kept, `${key} kept`);
    assert.equal(kept.missingByShop.length, orig.missingByShop.length);
    kept.missingByShop.forEach((entry: Plain, i: number) => {
      assert.equal(entry.shopKey, orig.missingByShop[i].shopKey); assert.equal(Object.hasOwn(entry, "dates"), false);
      assert.deepEqual(expandDateRanges(entry.missingRanges), orig.missingByShop[i].dates);
      assert.equal(entry.missingRanges.reduce((n: number, r: Plain) => n + r.days, 0), orig.missingByShop[i].dates.length);
    });
  }
  assert.deepEqual(out.sections.coverage["gap-a"].missingByShop[0].missingRanges, [
    { startDate: "2026-08-01", endDate: "2026-08-03", days: 3 }, { startDate: "2026-08-07", endDate: "2026-08-07", days: 1 },
    { startDate: "2026-08-09", endDate: "2026-08-10", days: 2 }, { startDate: "2026-09-30", endDate: "2026-10-01", days: 2 },
  ]);
  assert.ok(out.aiCompaction.sections.some((s: Plain) => s.path === "sections.coverage.*.missingByShop[].dates" && s.rule === "missing_dates_as_ranges"));
  assert.match(out.aiCompaction.note, /missingRanges/);
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

/** Heavy scene: real misaligned-fixture shape, 4 shops, non-zero metrics everywhere, 4 x 10 contribution rows, optional extra gap entries. */
async function heavyScene(rows: number, extraGaps: number): Promise<PromotionInsightsResponse> {
  const p = JSON.parse(await readFile("tests/fixtures/netshop-promotion/response-misaligned.json", "utf8")) as PromotionInsightsResponse;
  const nonZero = (r: Plain) => { for (const m of Object.values<Plain>(r.metrics)) if (m.value === 0) m.value = 123456789; return r; };
  const row = p.sections.items[0];
  p.sections.items = Array.from({ length: rows }, (_, i) => nonZero({ ...structuredClone(row), rowKey: hex(`page${i}`), id: `ID${i}`, title: `合成推广商品名称较长${i}` }) as PromotionObjectRow);
  const shop = p.sections.shops.items[0];
  p.sections.shops.items = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(shop), shopKey: `京东\u001f店${i}`, shopName: `店${i}` }));
  const prev = p.sections.contributions.previous as Plain;
  for (const k of Object.keys(prev)) prev[k] = Array.from({ length: 10 }, (_, i) => nonZero({ ...structuredClone(row), rowKey: hex(`${k}${i}`), title: `合成推广商品名称较长${i}` }));
  for (let i = 0; i < extraGaps; i++) (p.sections.coverage as Plain)[`promotion:object:${String(i).padStart(16, "0")}:current`] = { expectedShopDatePairs: 2, coveredShopDatePairs: 1, complete: false, truncated: false, missingByShop: [{ shopKey: "京东\u001fA", dates: ["2026-09-01"] }] };
  return p;
}

test("promotion heavy scene (measured): default pageSize=1 fits 40000 (ranking depth is whatever the ladder can afford, recorded in aiCompaction)", async () => {
  const sizes: Record<string, string> = {};
  for (const gaps of [0, 30]) for (const rows of [1, 2, 5]) {
    const p = await heavyScene(rows, gaps);
    sizes[`gaps=${gaps},rows=${rows}`] = promotionCompactionLadder.map((_, l) => envelope(direct(p, l))).join("/");
  }
  console.log("promotion heavy ladder envelopes", JSON.stringify(sizes));
  const p = await heavyScene(1, 0);
  const fits = promotionCompactionLadder.map((_, l) => direct(p, l)).find(d => envelope(d) <= BUDGET);
  assert.ok(fits, "default pageSize=1 in the heavy scene must fit 40000, else the tool refuses");
  const depth = Object.values<Plain[]>(fits!.sections.contributions.previous).map(rows => rows.length);
  console.log("promotion heavy default-page envelope", envelope(fits!), "ranking rows per direction", depth.join(","));
  for (const n of depth) assert.ok(n >= 1);
  for (const [key, rows] of Object.entries<Plain[]>(fits!.sections.contributions.previous)) assert.equal(fits!.aiCompaction.sections.find((m: Plain) => m.path === `sections.contributions.previous.${key}`).keptCount, rows.length);
  assert.equal(fits!.sections.items.length, 1);
});

test("promotion heavy scene with 30 extra gap entries: every gap entry survives (measured envelope is logged; the tool refuses when nothing fits)", async () => {
  const p = await heavyScene(1, 30);
  const gapKeys = Object.entries<Plain>(p.sections.coverage as Plain).filter(([, c]) => c.complete === false).map(([k]) => k);
  assert.ok(gapKeys.length >= 30);
  const out = direct(p, promotionCompactionLadder.length - 1);
  for (const k of gapKeys) assert.ok(out.sections.coverage[k], `gap ${k} kept`);
  console.log("promotion heavy +30 gaps, heaviest level envelope", envelope(out));
});
