import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import { datesToRanges } from "../lib/ai/netshop-ai-compaction";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { PromotionInsightsResponse, PromotionObjectRow } from "../lib/netshop/promotion-insights-contract";

const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://promotion-compact.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://promotion-compact-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-promotion-compact-secret-0123456789", TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000" };
(globalThis as typeof globalThis & { __promotionCompactEnv?: typeof environment }).__promotionCompactEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__promotionCompactEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { NETSHOP_PROMOTION_INSIGHTS_TOOL_NAME: listName, NETSHOP_PROMOTION_DETAIL_TOOL_NAME: detailName } = await import("../lib/ai/netshop-promotion-insights-tool");
const { compactPromotionInsightsForAi, promotionCompactionLadder } = await import("../lib/ai/netshop-promotion-compaction");
const { decodePromotionInsightsForQuery, validatePromotionQuery } = await import("../lib/netshop/promotion-insights-contract");
const { RegistryToolError } = await import("../lib/ai/tool-registry-contract");
const listEntry = aiToolRegistry.find(e => e.name === listName)!;
const detailEntry = aiToolRegistry.find(e => e.name === detailName)!;
const principal: AppPrincipal = { email: "synthetic-promotion-compact@example.test", displayName: "Synthetic", role: "admin", scope: null };
const context = { principal, surface: "test" as const, requestId: "synthetic-promotion-compact" };
const originalFetch = globalThis.fetch;
const BUDGET = 40000;
let payload: PromotionInsightsResponse;
let owningRevision: string;

async function fixture(name: string) { return JSON.parse(await readFile(`tests/fixtures/netshop-promotion/response-${name}.json`, "utf8")) as PromotionInsightsResponse; }
function argsFor(p: PromotionInsightsResponse): Record<string, unknown> {
  const c = p.context;
  const shared: Record<string, unknown> = { platform: c.requestedScope.platforms[0], startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind, trendGrain: p.sections.trend.grain };
  if (c.requestedScope.shopKeys.length) shared.outlets = c.requestedScope.shopKeys;
  return { ...shared, objectKind: p.sections.listScope.objectKind, q: p.sections.listScope.q, page: p.sections.pagination.page, pageSize: p.sections.pagination.pageSize };
}
function queryFor(args: Record<string, unknown>) {
  const q = new URLSearchParams({ platform: String(args.platform), dimension: args.platform === "京东" ? "sku" : "spu", startDate: String(args.startDate), endDate: String(args.endDate), periodKind: String(args.periodKind ?? "custom"), trendGrain: String(args.trendGrain ?? "day"), objectKind: String(args.objectKind ?? "product") });
  ((args.outlets ?? []) as string[]).forEach(o => q.append("outlet", o));
  for (const key of ["q", "page", "pageSize", "sort", "sectionToken", "snapshotToken"]) if (args[key] !== undefined) q.set(key, String(args[key]));
  return q;
}
function response(data: unknown = payload) { return Response.json(data, { headers: { "X-Netshop-Data-Revision": owningRevision } }); }
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const envelopeLength = (data: unknown) => JSON.stringify({ ok: true, toolName: listName, data }).length;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Scale the smallest real owning fixture up to production-like proportions. Only data
 * the real decoder accepts is generated: ranked contribution lists (34 rows, ~217KB),
 * ~90 extra complete coverage entries plus one gapped entry, and a gapped baseline in
 * the fixture itself. Rows are structural clones of the real fixture row.
 */
async function productionScale(): Promise<PromotionInsightsResponse> {
  const base = await fixture("product");
  const row = base.sections.items[0];
  const makeRow = (index: number, sign: 1 | -1): PromotionObjectRow => {
    const r = structuredClone(row);
    const id = `SKU-C${sign > 0 ? "U" : "D"}${index}`;
    r.rowKey = hex(id); r.id = id; r.title = `合成推广商品${id}·大型厚重导航序列`;
    r.mapping = { ...r.mapping, followSkuId: id, linkIdentity: r.mapping.linkIdentity ? { ...r.mapping.linkIdentity, id } : null };
    for (const key of ["spend", "attributedPayment"] as const) {
      r.changes[key].previous = { ...r.changes[key].previous, value: sign * (100000 - index * 1000), status: "available", reasonCode: null };
    }
    return r;
  };
  const lists = (kind: string, sign: 1 | -1, count: number) => Array.from({ length: count }, (_, i) => makeRow(i, sign)).map(r => ({ ...r, title: `${kind}:${r.title}` }));
  base.sections.contributions = { collection: "comparable_full_set_before_search_pagination", comparedObjectCount: 120, excludedObjectCount: 3, previous: {
    spendIncrease: lists("si", 1, 10), spendDecrease: lists("sd", -1, 10), attributedPaymentIncrease: lists("pi", 1, 7), attributedPaymentDecrease: lists("pd", -1, 7),
  } };
  const complete = { expectedShopDatePairs: 1, coveredShopDatePairs: 1, complete: true, missingByShop: [] as Array<{ shopKey: string; dates: string[] }>, truncated: false as const };
  for (let i = 0; i < 90; i++) base.sections.coverage[`promotion:object:${hex("cov" + i).slice(0, 16)}:current`] = { ...complete };
  const shopKey = base.context.effectiveScope.shopKeys[0], date = base.context.periods.current.startDate;
  base.sections.coverage["promotion:trend:synthetic-gap"] = { expectedShopDatePairs: 1, coveredShopDatePairs: 0, complete: false, missingByShop: [{ shopKey, dates: [date] }], truncated: false };
  return base;
}
// AI view stores missing dates losslessly as missingRanges; compare in that form.
function asRanges(c: any) { return { ...c, missingByShop: (c.missingByShop ?? []).map(({ dates, ...rest }: any) => (dates ? { ...rest, missingRanges: datesToRanges(dates) } : rest)) }; }
function gapped(p: PromotionInsightsResponse) {
  return {
    section: Object.entries(p.sections.coverage).filter(([, c]) => !c.complete),
    context: Object.entries(p.context.coverageBySource).filter(([, c]) => !c.complete),
  };
}
beforeEach(async () => {
  payload = await productionScale();
  owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  globalThis.fetch = async () => response();
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("the generated production-scale response is real: decoder-valid, over 250KB, with production section proportions", () => {
  const args = argsFor(payload);
  decodePromotionInsightsForQuery(payload, queryFor(args), owningRevision);
  assert.ok(bytes(payload) > 250_000, `total ${bytes(payload)}`);
  assert.ok(bytes(payload) < 2 * 1024 * 1024);
  assert.ok(bytes(payload.sections.contributions) > 190_000 && bytes(payload.sections.contributions) < 240_000, `contributions ${bytes(payload.sections.contributions)}`);
  assert.ok(bytes(payload.sections.coverage) > 11_000, `coverage ${bytes(payload.sections.coverage)}`);
  assert.ok(envelopeLength(payload) > BUDGET * 5);
});

test("oversized valid response is compacted under 40000 with originals, tokens and current page intact", async () => {
  const args = argsFor(payload), before = structuredClone(payload);
  const data = await listEntry.handler(args, context) as unknown as PromotionInsightsResponse & { aiCompaction: { applied: true; sections: Array<{ path: string; originalCount: number; keptCount: number; rule: string }>; note: string } };
  assert.deepEqual(payload, before, "source object must not be mutated");
  assert.ok(envelopeLength(data) < BUDGET, `envelope ${envelopeLength(data)}`);
  assert.equal(data.columnVersion, payload.columnVersion); assert.equal(data.sectionToken, payload.sectionToken); assert.equal(data.context.snapshotToken, payload.context.snapshotToken);
  assert.deepEqual(data.sections.comparisons, payload.sections.comparisons); assert.deepEqual(data.sections.pagination, payload.sections.pagination);
  assert.deepEqual(data.sections.listScope, payload.sections.listScope); assert.deepEqual((data.sections as any).dataQuality, (payload.sections as any).dataQuality); assert.deepEqual(data.sections.diagnostic, payload.sections.diagnostic);
  assert.deepEqual(data.sections.objectCapabilities, payload.sections.objectCapabilities); assert.deepEqual(data.sections.limitations, payload.sections.limitations);
  assert.equal(data.sections.summary.spend.value, payload.sections.summary.spend.value); assert.equal(data.sections.summary.roas.numerator, payload.sections.summary.roas.numerator);
  assert.equal(data.sections.contributions.comparedObjectCount, 120); assert.equal(data.sections.contributions.excludedObjectCount, 3);
  assert.deepEqual(data.sections.items.map(i => i.rowKey), payload.sections.items.map(i => i.rowKey));
  assert.equal(data.sections.items[0].metrics.spend.value, payload.sections.items[0].metrics.spend.value);
  // aiCompaction names exactly the reduced paths with original/kept counts.
  assert.equal(data.aiCompaction.applied, true); assert.match(data.aiCompaction.note, /完整集合见网店页面/);
  const byPath = new Map(data.aiCompaction.sections.map(s => [s.path, s]));
  const kept = data.sections.contributions.previous;
  for (const key of ["spendIncrease", "spendDecrease", "attributedPaymentIncrease", "attributedPaymentDecrease"] as const) {
    const entry = byPath.get(`sections.contributions.previous.${key}`)!;
    assert.ok(entry, key); assert.equal(entry.originalCount, payload.sections.contributions.previous[key].length);
    assert.equal(entry.keptCount, kept[key].length); assert.ok(entry.keptCount < entry.originalCount);
    // Top N are the owning reader's first N, in order.
    assert.deepEqual(kept[key].map(r => r.rowKey), payload.sections.contributions.previous[key].slice(0, entry.keptCount).map(r => r.rowKey));
  }
  const folded = byPath.get("sections.coverage")!; assert.equal(folded.originalCount, Object.keys(payload.sections.coverage).length); assert.equal(folded.keptCount, Object.keys(data.sections.coverage).length);
  assert.match(folded.rule, /gaps_kept/);
  // No silent reduction: any list shorter than the source is declared.
  assert.ok(Object.keys(data.sections.coverage).length < Object.keys(payload.sections.coverage).length);
});

test("compaction never loses a coverage gap: every incomplete entry survives whole, only complete ones are folded", async () => {
  const data = await listEntry.handler(argsFor(payload), context) as unknown as PromotionInsightsResponse;
  const before = gapped(payload);
  assert.ok(before.section.length >= 1 && before.context.length >= 1);
  for (const [ref, gap] of before.section) assert.deepEqual(data.sections.coverage[ref], asRanges(gap));
  for (const [ref, gap] of before.context) assert.deepEqual(data.context.coverageBySource[ref], asRanges(gap));
  assert.deepEqual(gapped(data), { section: before.section.map(([k, c]) => [k, asRanges(c)]), context: before.context.map(([k, c]) => [k, asRanges(c)]) });
  for (const value of Object.values(data.sections.coverage)) assert.ok(!value.complete);
});

test("an incomplete entry is never folded even when it looks otherwise normal (missing dates, truncated shape)", async () => {
  const shopKey = payload.context.effectiveScope.shopKeys[0], date = payload.context.periods.current.startDate;
  payload.sections.coverage["promotion:object:aaaaaaaaaaaaaaaa:current"] = { expectedShopDatePairs: 2, coveredShopDatePairs: 1, complete: false, missingByShop: [{ shopKey, dates: [date] }], truncated: false };
  const data = await listEntry.handler(argsFor(payload), context) as unknown as PromotionInsightsResponse;
  assert.deepEqual(data.sections.coverage["promotion:object:aaaaaaaaaaaaaaaa:current"], asRanges(payload.sections.coverage["promotion:object:aaaaaaaaaaaaaaaa:current"]));
});

test("decoder rejection still wins: a corrupted oversized response is refused with the original error code, never compacted", async () => {
  const good = await productionScale(); const args = argsFor(good);
  for (const mutate of [
    (p: PromotionInsightsResponse) => { p.sections.listScope.q = "other"; },
    (p: PromotionInsightsResponse) => { p.context.sourceRevisions.pop(); },
    (p: PromotionInsightsResponse) => { p.sections.contributions.previous.spendIncrease.reverse(); },
    (p: PromotionInsightsResponse) => { p.sections.contributions.previous.spendIncrease[0].shopKey = "京东\u001f未授权店"; },
  ]) {
    payload = structuredClone(good); mutate(payload);
    await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  }
  payload = structuredClone(good); owningRevision = "99:aaaaaaaaaaaa";
  await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
});

test("when even the heaviest level cannot fit, it still refuses with tool_result_too_large (no text truncation)", async () => {
  const args = argsFor(payload);
  // Decoder-valid but oversized in sections no compaction level touches (titles <=500, notes <=50x1500).
  payload = await productionScale();
  payload.sections.items[0].title = "巨".repeat(500);
  payload.sections.limitations = Array.from({ length: 50 }, () => "限".repeat(1500));
  decodePromotionInsightsForQuery(payload, queryFor(args), owningRevision);
  const last = compactPromotionInsightsForAi(payload as unknown as Record<string, unknown>, promotionCompactionLadder.at(-1)!);
  assert.ok(envelopeLength(last) > BUDGET);
  await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "tool_result_too_large");
});

test("a response that already fits is returned byte-for-byte unchanged with no aiCompaction", async () => {
  const small = await fixture("product"); payload = small; owningRevision = small.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  const data = await listEntry.handler(argsFor(small), context);
  assert.deepEqual(data, small); assert.equal(Object.hasOwn(data, "aiCompaction"), false);
});

test("ladder reports its levels and picks the lightest one that fits", async () => {
  const lengths = promotionCompactionLadder.map(level => envelopeLength(compactPromotionInsightsForAi(payload as unknown as Record<string, unknown>, level)));
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] <= lengths[i - 1], `level ${i} should not be larger: ${lengths}`);
  const data = await listEntry.handler(argsFor(payload), context);
  const chosen = lengths.findIndex(length => length <= BUDGET);
  assert.ok(chosen >= 0, `no ladder level fits: ${lengths}`);
  assert.equal(envelopeLength(data), lengths[chosen]);
  console.log(`promotion production-scale: source envelope ${envelopeLength(payload)}, ladder ${lengths.join("/")}, chosen level ${chosen}`);
});

test("promotion object detail keeps complete-or-refuse and is never compacted", () => {
  assert.match(detailEntry.description, /详情|明细|detail/i);
  assert.doesNotMatch(detailEntry.description, /aiCompaction/);
});
