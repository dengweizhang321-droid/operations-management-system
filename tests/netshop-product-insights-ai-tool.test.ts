import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { AiToolEntry, RegistryAuditInput } from "../lib/ai/tool-registry-contract";
import type { MetricValue } from "../lib/netshop/insights-contract";

const environment = {
  TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://product-reader.example.test",
  TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://product-writer.example.test",
  TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-product-ai-test-secret-0123456789",
  TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000",
};
(globalThis as typeof globalThis & { __productInsightsAiEnv?: typeof environment }).__productInsightsAiEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__productInsightsAiEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { getNetshopProductInsightsForAi, NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME: name } = await import("../lib/ai/netshop-product-insights-tool");
const { syntheticInsightsContext } = await import("../lib/netshop/insights-fixtures");
const { compareMetrics } = await import("../lib/netshop/insights-contract");
const { decodeProductInsights, productMetricKeys } = await import("../app/netshop/products/contract");
const { executeToolCallWithRegistry, getAnthropicTools, getOpenAiTools, getVisibleToolCatalog, validateToolRegistry, RegistryToolError } = await import("../lib/ai/tool-registry-contract");
const { createAiToolExecutionRuntime } = await import("../lib/ai/tool-execution-runtime");
const entry: AiToolEntry = aiToolRegistry.find(e => e.name === name)!;
const principal: AppPrincipal = { email: "synthetic-product-analyst@example.test", displayName: "Synthetic", role: "analyst", scope: null };
const args = { platforms: ["京东"], shops: [{ platform: "京东", shopName: "合成店A" }], startDate: "2026-09-01", endDate: "2026-09-01" };
const execution = { principal, surface: "test" as const, requestId: "synthetic-product-ai" };
const originalFetch = globalThis.fetch;
let calls: Array<{ url: URL; init?: RequestInit }> = [];
let revision: string | null;

function fixture() {
  const context = syntheticInsightsContext();
  const metrics = Object.fromEntries(productMetricKeys.map(key => [key, {
    value: 0,
    unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : key === "conversion" || key === "addCartRate" ? "RATIO" : "COUNT",
    status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"],
    aggregation: key === "conversion" || key === "addCartRate" ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current",
    ...(key === "conversion" || key === "addCartRate" ? { numerator: 0, denominator: 10 } : {}),
  }])) as Record<typeof productMetricKeys[number], MetricValue>;
  const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
  const item = { identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id: "P01" }, title: "合成商品", category: null, imageUrl: null, metrics, comparisons, baselineMetrics: { previous: metrics, yearAgo: metrics } };
  const pagination = { page: 1, pageSize: 5, total: 1, returned: 1, hasMore: false, truncated: false };
  return { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize: 5 }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { summary: metrics, comparisons, items: [item], pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: [item], pagination } } } };
}
let payload: ReturnType<typeof fixture>;
function response(data: unknown = payload, status = 200, header: string | null = revision) {
  return Response.json(data, { status, headers: header === null ? {} : { "X-Netshop-Data-Revision": header } });
}
const errorIs = (code: string) => (error: unknown) => error instanceof RegistryToolError && error.code === code;
beforeEach(() => {
  calls = []; payload = fixture(); revision = "1:aaaaaaaaaaaa";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, environment.TERUISI_DJANGO_NETSHOP_READER_BASE_URL);
    assert.equal(url.pathname, "/api/netshop/product-insights");
    calls.push({ url, init }); return response();
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("the actual central list entry uniquely derives closed schemas and explicit policies", () => {
  validateToolRegistry(aiToolRegistry);
  assert.equal(aiToolRegistry.filter(e => e.name === name).length, 1);
  assert.equal(entry.handler, getNetshopProductInsightsForAi);
  assert.equal(entry.risk, "read_only"); assert.equal(entry.scopePolicy, "principal_scope");
  assert.equal(entry.inputSchema.additionalProperties, false);
  assert.deepEqual(entry.execution, { environment: "worker_inline", mode: "direct", allowedSurfaces: ["ai_chat", "ai_agent", "codex_mcp", "test"], timeoutMs: 30000, maxResultCharacters: 40000, maxCallsPerRequest: 2 });
  assert.equal(aiToolRegistry.some(e => /get_netshop_product_insights_detail/.test(e.name)), false);
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const actor = { ...principal, role };
    for (const surface of entry.execution.allowedSurfaces) {
      assert.equal(getOpenAiTools(actor, surface, aiToolRegistry).find(t => t.function.name === name)?.function.parameters, entry.inputSchema);
      assert.equal(getAnthropicTools(actor, surface, aiToolRegistry).find(t => t.name === name)?.input_schema, entry.inputSchema);
      assert.equal(getVisibleToolCatalog(actor, surface, aiToolRegistry).find(t => t.name === name)?.inputSchema, entry.inputSchema);
    }
    for (const surface of ["dingtalk_chat", "ai_sandbox", "market_ai", "customer_service_ai", "business_collection", "business_agent_v2"] as const) {
      assert.equal(getOpenAiTools(actor, surface, aiToolRegistry).some(t => t.function.name === name), false);
    }
  }
});

test("all four roles sign the exact owning GET and retain the complete original DTO", async () => {
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const actor = { ...principal, role };
    const data = await entry.handler(args, { ...execution, principal: actor });
    assert.deepEqual(data, payload); assert.equal(Object.hasOwn(data, "returned"), false);
    const request = calls.at(-1)!;
    assert.equal(request.init?.method, "GET"); assert.equal(request.init?.body, undefined);
    assert.deepEqual(request.url.searchParams.getAll("outlet"), ["京东\u001f合成店A"]);
    assert.equal(request.url.searchParams.get("pageSize"), "5");
    const headers = new Headers(request.init?.headers);
    const envelope = headers.get("X-Teruisi-Principal")!;
    assert.deepEqual(JSON.parse(Buffer.from(envelope, "base64url").toString()), actor);
    const signed = ["v1", headers.get("X-Teruisi-Timestamp"), headers.get("X-Teruisi-Request-Id"), "GET", request.url.pathname, request.url.searchParams.toString(), headers.get("X-Teruisi-Content-SHA256"), envelope].join("\n");
    assert.equal(headers.get("X-Teruisi-Signature"), `v1=${createHmac("sha256", environment.TERUISI_DJANGO_INTERNAL_SECRET).update(signed).digest("hex")}`);
    assert.deepEqual(data.context, payload.context); assert.deepEqual(data.sections, payload.sections);
  }
});

test("platform-scoped actors work; incompatible scopes and forbidden surfaces never fetch", async () => {
  await entry.handler(args, { ...execution, principal: { ...principal, scope: { warehouses: [], channels: [], platforms: ["京东"] } } });
  for (const scope of [
    { warehouses: ["合成仓"], channels: [], platforms: ["京东"] },
    { warehouses: [], channels: ["合成渠道"], platforms: ["京东"] },
    { warehouses: [], channels: [], platforms: ["天猫"] },
    { warehouses: [], channels: [], platforms: [] },
  ]) await assert.rejects(entry.handler(args, { ...execution, principal: { ...principal, scope } }), errorIs("forbidden"));
  const denied = await executeToolCallWithRegistry(name, args, { ...execution, surface: "dingtalk_chat" }, { entries: aiToolRegistry, audit: async () => undefined });
  assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "forbidden");
  assert.equal(calls.length, 1);
});

test("closed parameter schemas, normalized identities, dates and AI page bounds reject before I/O", async () => {
  for (const invalid of [
    { ...args, principal }, { ...args, url: "https://reader.example.test" }, { ...args, sql: "SELECT 1" },
    { ...args, productIdentity: "P01" }, { ...args, section: "daily" }, { ...args, source: "erp" },
    { ...args, shops: [{ ...args.shops[0], role: "admin" }] },
    { ...args, shops: [args.shops[0], args.shops[0]] },
    { ...args, shops: [args.shops[0], { ...args.shops[0], shopName: " 合成店A " }] },
    { ...args, shops: Array.from({ length: 51 }, (_, i) => ({ platform: "京东", shopName: `合成店${i}` })) },
    { ...args, platforms: ["京东", "京东"] }, { ...args, platforms: ["天猫"], dimension: "sku" },
    { ...args, shops: [{ platform: "天猫", shopName: "合成店A" }] },
    { ...args, startDate: "2026-02-30" }, { ...args, startDate: "2025-08-31" },
    { ...args, endDate: "2026-08-31" }, { ...args, periodKind: "last7" },
    { ...args, page: 0 }, { ...args, page: 10001 }, { ...args, pageSize: 21 }, { ...args, pageSize: 1.5 },
    { ...args, q: "x".repeat(121) }, { ...args, category: "x".repeat(121) }, { ...args, q: "x\u0000" },
    { ...args, sort: "unknown" }, { ...args, snapshotToken: "unknown" }, { ...args, sectionToken: "unknown" },
  ]) await assert.rejects(entry.handler(invalid, execution), errorIs("invalid_arguments"));
  assert.equal(calls.length, 0);
});

test("pagination, search, category and both typed tokens use the owning list contract", async () => {
  Object.assign(payload.tableScope, { q: "商品", category: "合成类目", sort: "visitors_asc", page: 2, pageSize: 2 });
  Object.assign(payload.sections.pagination, { page: 2, pageSize: 2, total: 3 });
  await entry.handler({ ...args, q: " 商品 ", category: " 合成类目 ", sort: "visitors_asc", page: 2, pageSize: 2, snapshotToken: payload.context.snapshotToken, sectionToken: payload.sectionToken }, execution);
  assert.equal(calls[0].url.searchParams.get("sectionToken"), payload.sectionToken);
  assert.equal(calls[0].url.searchParams.get("snapshotToken"), payload.context.snapshotToken);
  await assert.rejects(entry.handler({ ...args, sectionToken: payload.context.snapshotToken }, execution), errorIs("invalid_tool_result"));
});

test("true zero, missing fields and missing days remain explicit with full summaries and coverage", async () => {
  const missing: MetricValue = { ...payload.sections.summary.visitors, value: null, status: "unavailable", reasonCode: "missing_field" };
  payload.sections.summary.visitors = missing;
  payload.sections.comparisons.visitors = { previous: compareMetrics(missing, missing), yearAgo: compareMetrics(missing, missing) };
  const data = await entry.handler(args, execution);
  assert.deepEqual(data, payload);
  assert.equal(payload.sections.summary.payment.value, 0);
  assert.equal(payload.sections.summary.visitors.reasonCode, "missing_field");
  assert.deepEqual((data.context as typeof payload.context).calendar, payload.context.calendar);
  assert.equal((data.context as typeof payload.context).capabilities.find(c => c.period === "previous" && c.field === "visitors")?.reasonCode, "no_records");
});

test("malformed 200 responses, cross-page scope and same-kind revision mismatches fail closed", async () => {
  for (const mutate of [
    () => { revision = "2:aaaaaaaaaaaa"; },
    () => { payload.context.sourceRevisions.pop(); },
    () => { payload.joinedSourceRevisions = []; },
    () => { payload.context.calendar = []; },
    () => { payload.sections.items[0].identity.shopName = "其他店"; },
    () => { payload.sections.pagination.returned = 0; },
    () => { payload.tableScope.q = "other"; },
    () => { payload.tableScope.page = 2; },
  ]) {
    payload = fixture(); revision = "1:aaaaaaaaaaaa"; mutate();
    await assert.rejects(entry.handler(args, execution), errorIs("invalid_tool_result"));
  }
  payload = fixture(); revision = "1:aaaaaaaaaaaa";
  await assert.rejects(entry.handler({ ...args, snapshotToken: payload.sectionToken }, execution), errorIs("invalid_tool_result"));
  await assert.rejects(entry.handler({ ...args, sectionToken: payload.context.snapshotToken }, execution), errorIs("invalid_tool_result"));
});

test("embedded baseline permission and revision failures under 200 never release current data", async () => {
  for (const [code, expected] of [["access_denied", "forbidden"], ["insights_revision_changed", "version_conflict"]]) {
    const data = fixture();
    globalThis.fetch = async () => response({ ...data, sections: { ...data.sections, baselineReads: { ...data.sections.baselineReads, previous: { state: "error", data: null, code, message: "synthetic-private-error" } } } });
    await assert.rejects(entry.handler(args, execution), e => errorIs(expected)(e) && !(e as Error).message.includes("synthetic-private-error"));
  }
});

test("reader errors retain safe meaning, never retry, and missing headers refuse data", async () => {
  for (const [status, code, expected] of [[403, "access_denied", "forbidden"], [409, "insights_revision_changed", "version_conflict"], [413, "payload_too_large", "tool_result_too_large"], [422, "quality_incomplete", "tool_result_too_large"], [400, "invalid_request", "invalid_arguments"], [503, "source_not_ready", "service_unavailable"]] as const) {
    let count = 0;
    globalThis.fetch = async () => { count++; return response({ code, error: "synthetic-private-error" }, status, null); };
    await assert.rejects(entry.handler(args, execution), e => errorIs(expected)(e) && !(e as Error).message.includes("synthetic-private-error"));
    assert.equal(count, 1);
  }
  globalThis.fetch = async () => response(payload, 200, null);
  await assert.rejects(entry.handler(args, execution), errorIs("service_unavailable"));
  globalThis.fetch = async () => response(payload, 200, "1:3");
  await assert.rejects(entry.handler(args, execution), errorIs("service_unavailable"));
});

test("complete valid responses above the final envelope budget refuse without compacting", async () => {
  payload.sections.items = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(payload.sections.items[0]), identity: { ...payload.sections.items[0].identity, id: `P${i}` }, title: "x".repeat(2000) }));
  payload.sections.growth.data.items = structuredClone(payload.sections.items);
  Object.assign(payload.tableScope, { pageSize: 20 });
  Object.assign(payload.sections.pagination, { pageSize: 20, total: 20, returned: 20 });
  const query = new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: args.startDate, endDate: args.endDate, pageSize: "20" });
  decodeProductInsights(payload, query, revision);
  assert.ok(JSON.stringify(payload).length < 2 * 1024 * 1024);
  assert.ok(JSON.stringify({ ok: true, toolName: name, data: payload }).length > 40000);
  await assert.rejects(entry.handler({ ...args, pageSize: 20 }, execution), errorIs("tool_result_too_large"));
  assert.equal(payload.sections.items.length, 20); assert.equal(calls.length, 1);
});

test("cancellation reaches fetch and a late success cannot escape", async () => {
  const controller = new AbortController(); let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { signal = init?.signal; controller.abort(); await new Promise(resolve => setTimeout(resolve, 5)); return response(); };
  await assert.rejects(entry.handler(args, { ...execution, signal: controller.signal }), errorIs("tool_cancelled"));
  assert.equal(signal?.aborted, true);
  let count = 0; globalThis.fetch = async () => { count++; return response(); };
  await assert.rejects(entry.handler(args, { ...execution, signal: controller.signal }), errorIs("tool_cancelled"));
  assert.equal(count, 0);
});

test("central mandatory audits and the third-call budget fail closed without data", async () => {
  const startedFailure = await executeToolCallWithRegistry(name, args, execution, { entries: aiToolRegistry, audit: async () => { throw new Error("synthetic-audit-failure"); } });
  assert.equal(startedFailure.ok, false); if (!startedFailure.ok) assert.equal(startedFailure.error.code, "audit_unavailable");
  assert.equal(calls.length, 0);
  const terminalFailure = await executeToolCallWithRegistry(name, args, execution, { entries: aiToolRegistry, audit: async input => { if (input.status === "succeeded") throw new Error("synthetic-terminal-failure"); } });
  assert.equal(terminalFailure.ok, false); if (!terminalFailure.ok) assert.equal(terminalFailure.error.code, "audit_unavailable");
  calls = [];
  const audits: RegistryAuditInput[] = [];
  const runtime = createAiToolExecutionRuntime({ context: execution, entries: aiToolRegistry, audit: async input => { audits.push(input); } });
  assert.equal((await runtime.execute(name, args)).ok, true);
  assert.equal((await runtime.execute(name, args)).ok, true);
  const third = await runtime.execute(name, args);
  assert.equal(third.ok, false); if (!third.ok) assert.equal(third.error.code, "tool_call_budget_exceeded");
  assert.equal(calls.length, 2);
  const succeeded = audits.filter(a => a.status === "succeeded");
  assert.equal(succeeded.length, 2); assert.deepEqual(succeeded[0].result, payload);
  assert.equal(succeeded[0].actorEmail, principal.email); assert.equal(succeeded[0].surface, "test");
  assert.notEqual(succeeded[0].invocationId, succeeded[1].invocationId);
});

test("central timeout aborts transport, suppresses late data and terminates later calls", async () => {
  let count = 0; let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { count++; signal = init?.signal; await new Promise(resolve => setTimeout(resolve, 150)); return response(); };
  const shortEntry = { ...entry, execution: { ...entry.execution, timeoutMs: 100 } };
  const runtime = createAiToolExecutionRuntime({ context: execution, entries: [shortEntry], audit: async () => undefined });
  const first = await runtime.execute(name, args);
  assert.equal(first.ok, false); if (!first.ok) assert.equal(first.error.code, "tool_timeout");
  assert.equal(signal?.aborted, true);
  const second = await runtime.execute(name, args);
  assert.equal(second.ok, false); if (!second.ok) assert.equal(second.error.code, "tool_runtime_terminated");
  assert.equal(count, 1);
});
