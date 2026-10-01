import assert from "node:assert/strict";
import test from "node:test";
import { validateComparisonQuery, decodeComparisonInsights, comparisonMetricKeys, ComparisonResponseError } from "../app/netshop/comparison/contract";
import { loadComparisonInsights } from "../app/netshop/comparison/data";
import { ScopedReadGate, InsightReadError } from "../app/netshop/shared/request-state";

const query = () => new URLSearchParams({ platform: "京东", dimension: "sku", startDate: "2026-09-01", endDate: "2026-09-30", periodKind: "custom" });
function fetchResponse(response: Response) { return (async () => response) as typeof fetch; }

test("comparison keeps F query plus closed independent scope and baseline", () => {
  const p = query(), spec = validateComparisonQuery(p);
  assert.equal(spec.metricKey, "payment"); assert.equal(spec.scope.mode, "shop"); assert.equal(spec.baseline.kind, "previous"); assert.equal(comparisonMetricKeys.length, 20);
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

test("success requires full dual envelopes and all six sections, even with empty candidates", () => {
  assert.throws(() => decodeComparisonInsights({ schemaVersion: "netshop-comparison-v1", sections: {} }, query(), "8:aabbccddeeff"), ComparisonResponseError);
  assert.throws(() => decodeComparisonInsights({ schemaVersion: "netshop-comparison-v1", sections: { scale: { items: [] } }, currentContext: {} }, query(), "8:aabbccddeeff"), ComparisonResponseError);
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

test("rapid scope replacement rejects a late response even when upstream ignores abort", () => {
  const gate = new ScopedReadGate(), old = gate.begin("京东/shop-A/custom-A"), next = gate.begin("天猫/shop-B/custom-B");
  assert.equal(old.current(), false); assert.equal(old.signal.aborted, true); assert.equal(next.current(), true);
  gate.cancel(); assert.equal(next.current(), false);
});
