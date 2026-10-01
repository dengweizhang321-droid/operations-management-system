import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateComparisonQuery, decodeComparisonInsights, comparisonMetricKeys, ComparisonResponseError, decodeErpNativeQuantity, type ComparisonResponse } from "../app/netshop/comparison/contract";
import type { SourceRevision } from "../lib/netshop/insights-contract";
import { loadComparisonInsights } from "../app/netshop/comparison/data";
import { ScopedReadGate, InsightReadError } from "../app/netshop/shared/request-state";

const query = () => new URLSearchParams({ platform: "京东", dimension: "sku", startDate: "2026-09-01", endDate: "2026-09-30", periodKind: "custom" });
const owningFixtures = JSON.parse(readFileSync(new URL("./fixtures/netshop-comparison-owning.json", import.meta.url), "utf8"));
const erpFixtures = JSON.parse(readFileSync(new URL("./fixtures/netshop-comparison-erp-owned.json", import.meta.url), "utf8"));
const erpTemporalFixtures = JSON.parse(readFileSync(new URL("./fixtures/netshop-comparison-erp-temporal.json", import.meta.url), "utf8"));
const erpPlatformFixtures = JSON.parse(readFileSync(new URL("./fixtures/netshop-comparison-erp-platform.json", import.meta.url), "utf8"));
function fetchResponse(response: Response) { return (async () => response) as typeof fetch; }

test("comparison keeps F query plus closed independent scope and baseline", () => {
  const p = query(), spec = validateComparisonQuery(p);
  assert.equal(spec.metricKey, "payment"); assert.equal(spec.scope.mode, "shop"); assert.equal(spec.baseline.kind, "previous"); assert.equal(comparisonMetricKeys.length, 22);
  p.set("selectedBaseline", JSON.stringify({ kind: "custom", startDate: "2024-01-01", endDate: "2024-12-31" }));
  assert.equal(validateComparisonQuery(p).baseline.kind, "custom");
  p.set("selectedBaseline", JSON.stringify({ kind: "custom", startDate: "2024-01-01", endDate: "2025-01-01" }));
  assert.throws(() => validateComparisonQuery(p), /366/);
  p.set("selectedBaseline", JSON.stringify({ kind: "custom", startDate: "2026-02-29", endDate: "2026-03-01" }));
  assert.throws(() => validateComparisonQuery(p));
});

test("category labels require original source/version and cannot claim verified ID", () => {
  const p = query();
  const scope = { schemaVersion: "comparison-scope-v1", mode: "shop", metricSource: "platform", category: { mode: "label_only", platform: "京东", sourceId: "jd_sku_daily:sku_daily:京东", label: "未知以外的来源标签", evidenceVersion: "8:aabbccddeeff" }, coverageFilter: "all" };
  p.set("comparisonScope", JSON.stringify(scope)); assert.equal(validateComparisonQuery(p).scope.category.mode, "label_only");
  p.set("comparisonScope", JSON.stringify({ ...scope, category: { ...scope.category, platform: "天猫" } })); assert.throws(() => validateComparisonQuery(p), /平台/);
  p.set("comparisonScope", JSON.stringify({ ...scope, category: { mode: "verified_id", id: "guessed" } })); assert.throws(() => validateComparisonQuery(p), /类目ID/);
});

test("JSON scope enums never accept array or object coercion", () => {
  const scope = { schemaVersion: "comparison-scope-v1", mode: "shop", metricSource: "platform", category: { mode: "all" }, coverageFilter: "all" };
  for (const [key, value] of [["mode", ["shop"]], ["metricSource", ["platform"]], ["coverageFilter", ["all"]]]) { const p = query(); p.set("comparisonScope", JSON.stringify({ ...scope, [String(key)]: value })); assert.throws(() => validateComparisonQuery(p)); }
  const p = query(); p.set("comparisonScope", JSON.stringify({ ...scope, category: { mode: "label_only", platform: ["京东"], sourceId: "jd_sku_daily", label: "标签", evidenceVersion: "1:aabbccddeeff" } })); assert.throws(() => validateComparisonQuery(p));
});

test("ERP source and exact chart identities are bounded and do not replace population", () => {
  const p = query(); p.set("chartObjectKeys", JSON.stringify(["shop:京东\u001f同名店", "platform:京东"])); assert.equal(validateComparisonQuery(p).chartObjectKeys.length, 2);
  p.set("chartObjectKeys", JSON.stringify(["shop:京东\u001f同名店", "shop:京东\u001f同名店"])); assert.throws(() => validateComparisonQuery(p), /重复/);
  p.delete("chartObjectKeys"); p.set("metricKey", "erpNetSales"); assert.throws(() => validateComparisonQuery(p), /来源/);
  p.set("comparisonScope", JSON.stringify({ schemaVersion: "comparison-scope-v1", mode: "platform", metricSource: "erp", category: { mode: "all" }, coverageFilter: "partial" }));
  assert.equal(validateComparisonQuery(p).metricKey, "erpNetSales");
});

test("comparison rejects duplicate unknown parameters, query search and loose sort", () => {
  for (const [key, value] of [["q", "same name"], ["sort", "roas_total"], ["metricKey", "score"]]) { const p = query(); p.set(key, value); assert.throws(() => validateComparisonQuery(p)); }
  const p = query(); p.append("page", "1"); p.append("page", "2"); assert.throws(() => validateComparisonQuery(p));
});

test("success requires full dual envelopes and all six sections, even with empty candidates", async () => {
  await assert.rejects(() => decodeComparisonInsights({ schemaVersion: "netshop-comparison-v1", sections: {} }, query(), "8:aabbccddeeff"), ComparisonResponseError);
  await assert.rejects(() => decodeComparisonInsights({ schemaVersion: "netshop-comparison-v1", sections: { scale: { items: [] } }, currentContext: {} }, query(), "8:aabbccddeeff"), ComparisonResponseError);
});

for (const status of [401, 403, 409]) test(`authoritative ${status} fences empty/HTML/malformed upstream`, async () => {
  for (const body of ["", "<html>proxy</html>", "{broken"]) {
    await assert.rejects(loadComparisonInsights(query(), new AbortController().signal, fetchResponse(new Response(body, { status }))), (error: unknown) => error instanceof InsightReadError && error.code === (status === 409 ? "comparison_revision_changed" : "access_denied"));
  }
});

test("body cap and fatal UTF8 prevent partial or replacement-character success", async () => {
  await assert.rejects(loadComparisonInsights(query(), new AbortController().signal, fetchResponse(new Response("x".repeat(2 * 1024 * 1024 + 1)))), (e: unknown) => e instanceof InsightReadError && e.code === "response_too_large");
  await assert.rejects(loadComparisonInsights(query(), new AbortController().signal, fetchResponse(new Response(new Uint8Array([0xff, 0xfe])))));
});

test("cancellation outranks late access-denied or late fetch errors", async () => {
  for (const lateError of [false, true]) {
    const controller = new AbortController(), reason = new Error("scope replaced");
    const fetcher = (async () => { controller.abort(reason); if (lateError) throw new Error("proxy failure"); return new Response("<html>", { status: 403 }); }) as typeof fetch;
    await assert.rejects(loadComparisonInsights(query(), controller.signal, fetcher), (e: unknown) => e === reason);
  }
});

test("aborting a pending fetch or stalled stream completes even if upstream ignores its signal", async () => {
  for (const stream of [false, true]) {
    const controller = new AbortController(), reason = new Error("changed scope");
    const fetcher = (stream ? async () => new Response(new ReadableStream({ start() { /* Deliberately never sends bytes. */ } })) : async () => new Promise<Response>(() => {})) as typeof fetch;
    const pending = loadComparisonInsights(query(), controller.signal, fetcher);
    await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(reason);
    await assert.rejects(pending, (error: unknown) => error === reason);
  }
});

test("rapid scope replacement rejects a late response even when upstream ignores abort", () => {
  const gate = new ScopedReadGate(), old = gate.begin("京东/shop-A/custom-A"), next = gate.begin("天猫/shop-B/custom-B");
  assert.equal(old.current(), false); assert.equal(old.signal.aborted, true); assert.equal(next.current(), true);
  gate.cancel(); assert.equal(next.current(), false);
});

for (const fixture of owningFixtures.cases) test(`actual private PostgreSQL successful full envelope: ${fixture.name}`, async () => {
  assert.equal(owningFixtures.synthetic, true); assert.equal(fixture.request.synthetic, true);
  const dto = await decodeComparisonInsights(fixture.response, new URLSearchParams(fixture.request.query), fixture.request.headerRevision);
  assert.equal(dto.sections.comparability.counts.candidates, fixture.name.endsWith("mixed") ? 3 : 2);
  assert.deepEqual(dto.sections.efficiency.items, dto.sections.scale.items.map(row => row.objectKey));
  assert.deepEqual(dto.sections.promotion.items, dto.sections.scale.items.map(row => row.objectKey));
});

const successful = owningFixtures.cases[0], aSuccessful = owningFixtures.cases[1];
async function rejectsMutation(mutate: (value: ComparisonResponse) => void, fixture = successful) {
  const value = structuredClone(fixture.response) as ComparisonResponse; mutate(value);
  await assert.rejects(() => decodeComparisonInsights(value, new URLSearchParams(fixture.request.query), fixture.request.headerRevision), ComparisonResponseError);
}
test("complete vectors cannot omit a member, change kind/version or add a domain", async () => {
  await rejectsMutation(value => { value.joinedSourceRevisions = []; });
  await rejectsMutation(value => { value.joinedSourceRevisions.pop(); });
  await rejectsMutation(value => { value.joinedSourceRevisions[0].revision = "999:aaaaaaaaaaaa"; });
  await rejectsMutation(value => { value.joinedSourceRevisions.push({ domain: "sales", kind: "invented", scopeKey: "unknown", revision: "999" }); });
  await rejectsMutation(value => { value.sections.promotion.sourceScopes[0].sourceRevisions = [null as unknown as SourceRevision]; }, aSuccessful);
});
test("metric source, amount/count delta and share semantics cannot be relabelled", async () => {
  await rejectsMutation(value => { value.sections.scale.summary.current.payment.basis = "erp_net_sales"; });
  await rejectsMutation(value => { value.sections.scale.summary.delta.unit = "COUNT"; });
  await rejectsMutation(value => { value.sections.scale.items[0].share.current.unit = "MULTIPLE"; });
  await rejectsMutation(value => { value.sections.scale.summary.current.payment.sourceIds = ["invented-product-source"]; });
});
test("coverage may not reference an unauthorized shop or a date outside its period", async () => {
  await rejectsMutation(value => { const coverage = Object.values(value.sections.comparability.coverage).find(c => c.missingByShop.length)!; coverage.missingByShop[0].shopKey = "京东\u001f未授权店"; });
  await rejectsMutation(value => { const coverage = Object.values(value.sections.comparability.coverage).find(c => c.missingByShop.length)!; coverage.missingByShop[0].dates[0] = "1999-01-01"; });
  await rejectsMutation(value => { const selected = value.sections.scale.summary.current.payment, coverage = value.sections.comparability.coverage[selected.coverageRef]; selected.status = "available"; selected.reasonCode = null; coverage.complete = false; });
});
test("candidate union and rank pagination cannot silently become an empty or partial page", async () => {
  await rejectsMutation(value => { value.sections.comparability.items.pop(); value.sections.comparability.counts.candidates--; });
  await rejectsMutation(value => { value.sections.scale.items = []; value.sections.efficiency.items = []; value.sections.promotion.items = []; value.sections.scale.pagination = { page: 1, pageSize: 20, total: 0, returned: 0, hasMore: false, truncated: false }; });
  await rejectsMutation(value => { value.sections.scale.pagination.total = 10; value.sections.scale.pagination.hasMore = true; });
  await rejectsMutation(value => { value.sections.promotion.items.reverse(); });
});
test("trends must retain selected metric and full natural calendar buckets", async () => {
  await rejectsMutation(value => { for (const period of ["current", "baseline"] as const) { value.sections.trends.items[0][period][0].metric.unit = "COUNT"; value.sections.trends.items[0].indexBasis[period].unit = "COUNT"; } });
  await rejectsMutation(value => { value.sections.trends.items[0].current.pop(); });
});
test("nested auth or revision failures cannot be downgraded to a successful source section", async () => {
  for (const code of ["access_denied", "authentication_required", "promotion_revision_changed", "insights_revision_changed"]) await rejectsMutation(value => { value.sections.promotion.sourceStates[0] = { ...value.sections.promotion.sourceStates[0], state: "error", code }; });
});

test("one front-end deadline includes JSON parsing and strict envelope validation CPU", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance")!, parse = JSON.parse;
  let clock = 0;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
  try {
    const body = JSON.stringify(successful.response);
    JSON.parse = ((text: string) => { const value = parse(text); if (value?.schemaVersion === "netshop-comparison-v1") clock = 90_001; return value; }) as typeof JSON.parse;
    await assert.rejects(loadComparisonInsights(new URLSearchParams(successful.request.query), new AbortController().signal, fetchResponse(new Response(body, { headers: { "X-Netshop-Data-Revision": successful.request.headerRevision } }))), (e: unknown) => e instanceof InsightReadError && e.code === "source_not_ready");
  } finally { JSON.parse = parse; Object.defineProperty(globalThis, "performance", descriptor); }
});

test("complete coverage refs cannot be borrowed from another period or object", async () => {
  await rejectsMutation(value => { value.sections.scale.summary.baseline.spend.coverageRef = value.sections.scale.summary.current.spend.coverageRef; }, aSuccessful);
  await rejectsMutation(value => { value.sections.scale.items[0].current.payment.coverageRef = value.sections.scale.items[1].current.payment.coverageRef; }, aSuccessful);
  await rejectsMutation(value => { value.sections.structure.items[0].current.denominator.coverageRef = value.sections.structure.items[0].baseline.denominator.coverageRef; }, aSuccessful);
});
test("distribution and structure fields retain their selected ratio/money/count units", async () => {
  await rejectsMutation(value => { value.sections.efficiency.distribution[0].metric.unit = "COUNT"; }, aSuccessful);
  await rejectsMutation(value => { value.sections.structure.items[0].current.top5Payment.unit = "COUNT"; }, aSuccessful);
});

test("both complete F envelopes retain primitive windows and capability enums", async () => {
  for (const name of ["currentContext", "baselineContext"] as const) {
    await rejectsMutation(value => { value[name].periods.previous.startDate = [value[name].periods.previous.startDate] as unknown as string; });
    await rejectsMutation(value => { value[name].periods.yearAgo.endDate = [value[name].periods.yearAgo.endDate] as unknown as string; });
    await rejectsMutation(value => { value[name].capabilities[0].period = ["current"] as unknown as "current"; });
  }
});

for (const fixture of erpFixtures.cases) test(`actual registered-owner ERP captured response ${fixture.name} preserves unknown coverage and native units`, async () => {
  const dto = await decodeComparisonInsights(fixture.response, new URLSearchParams(fixture.request.query), fixture.request.headerRevision);
  assert.equal(dto.sections.comparability.erpEvidence.state, "ready");
  assert.equal(dto.sections.scale.summary.current.erpNetQuantity.unit, "NATIVE_INTEGER_QUANTITY");
  assert.equal(dto.sections.scale.summary.current.erpNetQuantity.status, "partial");
  assert.equal(dto.sections.scale.summary.current.largeMarginAmount.status, "partial");
  assert.equal(dto.sections.scale.summary.current.largeMarginAmount.reasonCode, "unverified_source");
  assert.equal(dto.sections.scale.summary.current.averageOrderValue.value, null);
  assert.equal(dto.sections.comparability.counts.comparable, 0);
  assert.equal(dto.sections.comparability.erpEvidence.source?.periodTotals.current.observations.completeness, "unknown");
});
test("native quantity cannot become a physical COUNT, fractional quantity or complete coverage", async () => {
  const value = erpFixtures.cases[0].response.sections.scale.summary.current.erpNetQuantity;
  assert.equal(decodeErpNativeQuantity(value).value, 2);
  assert.throws(() => decodeErpNativeQuantity({ ...value, value: 1.5 }), ComparisonResponseError);
  assert.throws(() => decodeErpNativeQuantity({ ...value, status: "available", reasonCode: null }), ComparisonResponseError);
  await rejectsMutation(dto => { dto.sections.scale.summary.current.erpNetQuantity.unit = "COUNT"; }, erpFixtures.cases[0]);
});
test("ERP imported dates and zero stored cost may not become verified source closure or profit", async () => {
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.source!.periodTotals.current.observations.completeness = "complete" as unknown as "unknown"; }, erpFixtures.cases[0]);
  await rejectsMutation(dto => { (dto.sections.comparability.erpEvidence.source!.metricMetadata.cost as unknown as { verification: string }).verification = "verified"; }, erpFixtures.cases[1]);
  await rejectsMutation(dto => { dto.sections.scale.summary.current.largeMarginAmount.status = "available"; dto.sections.scale.summary.current.largeMarginAmount.reasonCode = null; }, erpFixtures.cases[1]);
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.observations[dto.sections.scale.items[0].current.erpNetSales.coverageRef].shopKeys = ["京东\u001f未经授权"]; }, erpFixtures.cases[0]);
});
test("ERP full-source evidence cannot borrow a foreign window, RAW channel or domain revision", async () => {
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.request!.current.startDate = "2026-08-01"; }, erpFixtures.cases[0]);
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.mappings[0].rawIdentity!.rawChannel = "guessed-all-store"; }, erpFixtures.cases[0]);
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.source!.sourceRevisions[0].revision = "1:ffffffffffff"; }, erpFixtures.cases[0]);
});

test("ERP C values and cost reasons must remain exact owning projections", async () => {
  const fixture = erpFixtures.cases[0];
  await rejectsMutation(dto => { dto.sections.scale.summary.current.erpNetSales.value = 990000; }, fixture);
  await rejectsMutation(dto => { dto.sections.scale.items[0].current.erpNetQuantity.value = 990000; }, fixture);
  await rejectsMutation(dto => { dto.sections.scale.summary.current.orderMargin.value = 990000; }, fixture);
  await rejectsMutation(dto => { dto.sections.scale.items[0].current.largeMarginAmount.reasonCode = "incomplete_coverage"; }, fixture);
});
test("ERP observation dates and object identities cannot differ from the owning record collection", async () => {
  const fixture = erpFixtures.cases[0];
  await rejectsMutation(dto => { const ref = dto.sections.scale.summary.current.erpNetSales.coverageRef, observation = dto.sections.comparability.erpEvidence.observations[ref]; observation.observedByShop.forEach(item => { item.dates = []; }); observation.observedShopDatePairs = 0; }, fixture);
  await rejectsMutation(dto => { const ref = dto.sections.scale.items[0].current.erpNetSales.coverageRef; dto.sections.comparability.erpEvidence.observations[ref].objectKey = "shop:京东\u001f外店"; }, fixture);
  await rejectsMutation(dto => { Object.assign(dto.sections.comparability.erpEvidence.request!, { expiresAtEpochMs: 0 }); }, fixture);
});

for (const fixture of erpTemporalFixtures.cases) test(`actual owning ERP temporal response ${fixture.name} preserves both native calendars`, async () => {
  const dto = await decodeComparisonInsights(fixture.response, new URLSearchParams(fixture.request.query), fixture.request.headerRevision);
  assert.equal(dto.sections.comparability.erpEvidence.temporalState.state, "ready");
  assert.equal(dto.sections.comparability.erpEvidence.source?.series?.intent.grain, dto.trendGrain);
  assert.equal(dto.sections.scale.summary.current.erpNetSales.value, 680);
  for (const row of dto.sections.trends.items) {
    assert.equal(row.indexBasis.status, "unavailable");
    for (const point of [...row.current, ...row.baseline]) {
      assert.ok(point.metric.value === null || point.metric.status === "partial");
      assert.match(point.metric.coverageRef, /:trend:\d{4}-\d{2}-\d{2}$/);
      assert.equal(dto.sections.comparability.erpEvidence.observations[point.metric.coverageRef].completeness, "unknown");
    }
  }
});

test("ERP temporal values cannot be borrowed from whole-period amounts or another native bucket", async () => {
  const fixture = erpTemporalFixtures.cases[0];
  await rejectsMutation(dto => { dto.sections.trends.items[0].current[0].metric.value = 999999; }, fixture);
  await rejectsMutation(dto => { dto.sections.trends.items[0].current[0].metric.coverageRef = dto.sections.scale.items[0].current.erpNetSales.coverageRef; }, fixture);
  await rejectsMutation(dto => { dto.sections.trends.items[0].current[0].metric.coverageRef = dto.sections.trends.items[0].current[1].metric.coverageRef; }, fixture);
  await rejectsMutation(dto => { const metric=dto.sections.trends.items[0].current[0].metric; metric.status="available"; metric.reasonCode=null; }, fixture);
});

test("ERP native series intent, grain, tuple values and observed dates remain owning-bound", async () => {
  const fixture = erpTemporalFixtures.cases[1];
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.source!.series!.intent.grain = "day"; }, fixture);
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.source!.series!.items[0].current.pop(); }, fixture);
  await rejectsMutation(dto => { dto.sections.comparability.erpEvidence.temporalState = {state:"unavailable",code:"series_no_records"}; }, fixture);
  await rejectsMutation(dto => { const point=dto.sections.trends.items[0].current[0]; dto.sections.comparability.erpEvidence.observations[point.metric.coverageRef].endDate=dto.currentContext.periods.current.endDate; }, fixture);
});

for (const fixture of erpPlatformFixtures.cases) test(`actual whole-platform response ${fixture.name} binds original period totals and buckets`, async () => {
  const dto=await decodeComparisonInsights(fixture.response,new URLSearchParams(fixture.request.query),fixture.request.headerRevision);
  const evidence=dto.sections.comparability.erpEvidence;
  assert.equal(evidence.temporalState.state,"ready");
  assert.equal(evidence.platformPeriods?.length,2);
  assert.equal(dto.sections.scale.summary.current.erpNetSales.value,680);
  const rows=new Map(dto.sections.scale.items.map(row=>[row.platform,row]));
  assert.equal(rows.get("京东")?.current.erpNetSales.value,580);
  assert.equal(rows.get("天猫")?.current.erpNetSales.value,100);
  assert.equal(evidence.source?.platformSeries?.items[0].rawCandidateCount,5);
  for(const trend of dto.sections.trends.items)assert.equal(trend.indexBasis.status,"unavailable");
  if(dto.metricKey==="erpNetQuantity"){
    assert.equal(rows.get("京东")?.current.erpNetQuantity.value,5);assert.equal(rows.get("天猫")?.current.erpNetQuantity.value,1);
    for(const trend of dto.sections.trends.items)for(const point of [...trend.current,...trend.baseline])assert.equal(point.metric.unit,"NATIVE_INTEGER_QUANTITY");
  }
});

test("platform whole-period carriers cannot borrow parent totals, foreign RAW scope or another pair", async () => {
  const fixture=erpPlatformFixtures.cases[0];
  await rejectsMutation(dto=>{dto.sections.scale.items[0].current.erpNetSales.value=680;},fixture);
  await rejectsMutation(dto=>{dto.sections.comparability.erpEvidence.platformPeriods![0].request.rawOutlets!.pop();},fixture);
  await rejectsMutation(dto=>{dto.sections.comparability.erpEvidence.platformPeriods![0].request.expectedRevision="1:999";},fixture);
  await rejectsMutation(dto=>{dto.sections.comparability.erpEvidence.platformPeriods![0].source.sourceRevisions[0].scopeKey=dto.sections.comparability.erpEvidence.source!.scopeKey;},fixture);
  await rejectsMutation(dto=>{dto.sections.comparability.erpEvidence.platformPeriods![0].source.items.pop();},fixture);
  await rejectsMutation(dto=>{dto.joinedSourceRevisions=dto.joinedSourceRevisions.filter(member=>member.scopeKey!==dto.sections.comparability.erpEvidence.platformPeriods![0].source.scopeKey);},fixture);
});

test("platform member omission, wrong platform, source tuple and false completeness are rejected", async () => {
  const fixture=erpPlatformFixtures.cases[0];
  await rejectsMutation(dto=>{const group=dto.sections.comparability.erpEvidence.source!.platformSeries!.items[0];group.rawMembers.pop();group.rawCandidateCount--;},fixture);
  await rejectsMutation(dto=>{dto.sections.comparability.erpEvidence.source!.platformSeries!.items[0].rawMembers[0].rawChannel="foreign-exact-channel";},fixture);
  await rejectsMutation(dto=>{dto.sections.trends.items[0].current[0].metric.value=999;},fixture);
  await rejectsMutation(dto=>{dto.sections.trends.items[0].current[0].metric.coverageRef=dto.sections.trends.items[1].current[0].metric.coverageRef;},fixture);
  await rejectsMutation(dto=>{const m=dto.sections.trends.items[0].current[0].metric;m.status="available";m.reasonCode=null;},fixture);
});
