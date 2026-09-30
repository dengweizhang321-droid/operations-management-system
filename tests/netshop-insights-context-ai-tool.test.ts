import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { afterEach, beforeEach } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { AiToolEntry } from "../lib/ai/tool-registry-contract";
import type { InsightsContext } from "../lib/netshop/insights-contract";

const environment = {
  TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://reader.example.test",
  TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://writer.example.test",
  TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-insights-ai-test-secret-0123456789",
  TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000",
};
(globalThis as typeof globalThis & { __insightsAiEnv?: typeof environment }).__insightsAiEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__insightsAiEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { getNetshopInsightsContextForAi, NETSHOP_INSIGHTS_CONTEXT_TOOL_NAME: name } = await import("../lib/ai/netshop-insights-context-tool");
const { syntheticInsightsContext } = await import("../lib/netshop/insights-fixtures");
const { decodeInsightsContext } = await import("../lib/netshop/insights-contract");
const { executeToolCallWithRegistry, getAnthropicTools, getOpenAiTools, getVisibleToolCatalog, validateToolRegistry, RegistryToolError } = await import("../lib/ai/tool-registry-contract");
const { createAiToolExecutionRuntime } = await import("../lib/ai/tool-execution-runtime");
const entry: AiToolEntry = aiToolRegistry.find(e => e.name === name)!;
const principal: AppPrincipal = { email: "synthetic-analyst@example.test", displayName: "Synthetic", role: "analyst", scope: null };
const args = { platforms: ["京东"], shops: [{ platform: "京东", shopName: "合成店A" }], startDate: "2026-09-01", endDate: "2026-09-01" };
const context = { principal, surface: "test" as const, requestId: "synthetic-insights-ai" };
const originalFetch = globalThis.fetch;
let calls: Array<{ url: URL; init?: RequestInit }> = [];
let payload: InsightsContext;
let revision: string | null;

function response(data: unknown = payload, status = 200, header: string | null = revision) {
  return Response.json(data, { status, headers: header === null ? {} : { "X-Netshop-Data-Revision": header } });
}
beforeEach(() => {
  calls = []; payload = syntheticInsightsContext(); revision = "1:aaaaaaaaaaaa";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, environment.TERUISI_DJANGO_NETSHOP_READER_BASE_URL);
    assert.equal(url.pathname, "/api/netshop/insights-context");
    calls.push({ url, init }); return response();
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("actual central entry uniquely derives schemas, scope and explicit surfaces", () => {
  validateToolRegistry(aiToolRegistry);
  assert.equal(aiToolRegistry.filter(e => e.name === name).length, 1);
  assert.equal(entry.handler, getNetshopInsightsContextForAi);
  assert.equal(entry.risk, "read_only"); assert.equal(entry.scopePolicy, "principal_scope");
  assert.deepEqual(entry.execution, { environment: "worker_inline", mode: "direct", allowedSurfaces: ["ai_chat", "ai_agent", "codex_mcp", "test"], timeoutMs: 30000, maxResultCharacters: 40000, maxCallsPerRequest: 2 });
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const actor = { ...principal, role };
    for (const surface of entry.execution.allowedSurfaces) {
      assert.equal(getOpenAiTools(actor, surface, aiToolRegistry).find(t => t.function.name === name)?.function.parameters, entry.inputSchema);
      assert.equal(getAnthropicTools(actor, surface, aiToolRegistry).find(t => t.name === name)?.input_schema, entry.inputSchema);
      assert.equal(getVisibleToolCatalog(actor, surface, aiToolRegistry).find(t => t.name === name)?.inputSchema, entry.inputSchema);
    }
    for (const surface of ["dingtalk_chat", "ai_sandbox", "market_ai", "customer_service_ai", "business_collection"] as const) {
      assert.equal(getOpenAiTools(actor, surface, aiToolRegistry).some(t => t.function.name === name), false);
    }
  }
});

test("all declared roles use the signed owning GET and preserve the full DTO", async () => {
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const data = await entry.handler(args, { ...context, principal: { ...principal, role } });
    assert.deepEqual(data, payload);
    const request = calls.at(-1)!;
    assert.equal(request.init?.method, "GET"); assert.equal(request.init?.body, undefined);
    const headers = new Headers(request.init?.headers);
    assert.match(headers.get("X-Teruisi-Signature")!, /^v1=[a-f0-9]{64}$/);
    assert.equal(JSON.parse(Buffer.from(headers.get("X-Teruisi-Principal")!, "base64url").toString()).role, role);
    assert.deepEqual(request.url.searchParams.getAll("outlet"), ["京东\u001f合成店A"]);
    assert.deepEqual(data.calendar, payload.calendar);
    assert.equal((data.coverageBySource as InsightsContext["coverageBySource"])["jd_promotion:ad:京东:current"].coveredShopDatePairs, 0);
  }
});

test("platform scope works while unsupported or cross-platform scope closes before transport", async () => {
  await entry.handler(args, { ...context, principal: { ...principal, scope: { warehouses: [], channels: [], platforms: ["京东"] } } });
  assert.equal(calls.length, 1);
  for (const scope of [
    { warehouses: ["合成仓"], channels: [], platforms: ["京东"] },
    { warehouses: [], channels: ["合成渠道"], platforms: ["京东"] },
    { warehouses: [], channels: [], platforms: ["天猫"] },
    { warehouses: [], channels: [], platforms: [] },
  ]) await assert.rejects(entry.handler(args, { ...context, principal: { ...principal, scope } }), e => e instanceof RegistryToolError && e.code === "forbidden");
  assert.equal(calls.length, 1);
});

test("closed schemas, identity and date limits reject malformed arguments without I/O", async () => {
  const invalid = [
    { ...args, principal }, { ...args, path: "/api/netshop/imports" },
    { ...args, shops: [{ ...args.shops[0], role: "admin" }] },
    { ...args, shops: [args.shops[0], args.shops[0]] },
    { ...args, shops: [args.shops[0], { ...args.shops[0], shopName: " 合成店A " }] },
    { ...args, platforms: ["京东", "京东"] },
    { ...args, platforms: ["天猫"], dimension: "sku" },
    { ...args, shops: [{ platform: "天猫", shopName: "合成店A" }] },
    { ...args, shops: Array.from({ length: 51 }, (_, i) => ({ platform: "京东", shopName: `合成店${i}` })) },
    { ...args, startDate: "2026-02-30" }, { ...args, startDate: "2025-08-31" },
    { ...args, endDate: "2026-08-31" }, { ...args, periodKind: "last7" },
    { ...args, snapshotToken: "caller-token" }, { ...args, dimension: "all" },
  ];
  for (const value of invalid) await assert.rejects(entry.handler(value, context), e => e instanceof RegistryToolError && e.code === "invalid_arguments");
  assert.equal(calls.length, 0);
});

test("missing field and missing day stay distinct without dropping calendar or revisions", async () => {
  const field = payload.capabilities.find(c => c.period === "current" && c.field === "visitors")!;
  field.status = "unavailable"; field.reasonCode = "missing_field"; field.presentShopDatePairs = 0;
  const data = await entry.handler({ ...args, snapshotToken: payload.snapshotToken }, context);
  assert.deepEqual(data, payload);
  assert.equal((data.capabilities as InsightsContext["capabilities"]).find(c => c.period === "current" && c.field === "visitors")?.reasonCode, "missing_field");
  assert.equal((data.capabilities as InsightsContext["capabilities"]).find(c => c.period === "previous" && c.field === "visitors")?.reasonCode, "no_records");
  assert.equal((data.sourceRevisions as unknown[]).length, payload.sourceRevisions.length);
});

test("valid-format wrong headers, wrong request scope, missing vector and malformed DTO fail closed", async () => {
  const original = syntheticInsightsContext();
  for (const mutation of [
    () => { revision = "2:aaaaaaaaaaaa"; },
    () => { payload.sourceRevisions.pop(); },
    () => { payload.calendar = []; },
    () => { payload.requestedScope.dimension = payload.effectiveScope.dimension = "sku"; },
    () => { payload.requestedScope.periodKind = payload.effectiveScope.periodKind = "rolling"; },
  ]) {
    payload = structuredClone(original); revision = "1:aaaaaaaaaaaa"; mutation();
    await assert.rejects(entry.handler(args, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  }
  payload = original;
  await assert.rejects(entry.handler({ ...args, snapshotToken: "c".repeat(64) }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  await assert.rejects(entry.handler({ ...args, shops: [{ platform: "京东", shopName: "合成店B" }] }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  await assert.rejects(entry.handler({ ...args, startDate: "2026-08-01", endDate: "2026-08-01" }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
});

test("reader errors retain safe meaning and are never retried or replaced by old APIs", async () => {
  for (const [status, code, expected] of [[403, "access_denied", "forbidden"], [409, "insights_revision_changed", "version_conflict"], [422, "quality_incomplete", "tool_result_too_large"], [503, "source_not_ready", "service_unavailable"]] as const) {
    let count = 0;
    globalThis.fetch = async () => { count++; return response({ code, error: "synthetic-private-detail" }, status, null); };
    await assert.rejects(entry.handler(args, context), e => e instanceof RegistryToolError && e.code === expected && !e.message.includes("synthetic-private-detail"));
    assert.equal(count, 1);
  }
  revision = null;
  globalThis.fetch = async () => response();
  await assert.rejects(entry.handler(args, context), e => e instanceof RegistryToolError && e.code === "service_unavailable");
});

test("cancellation reaches fetch and a late successful response cannot escape", async () => {
  const controller = new AbortController(); let fetchSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    fetchSignal = init?.signal; controller.abort();
    await new Promise(resolve => setTimeout(resolve, 5)); return response();
  };
  await assert.rejects(entry.handler(args, { ...context, signal: controller.signal }), e => e instanceof RegistryToolError && e.code === "tool_cancelled");
  assert.equal(fetchSignal?.aborted, true);
  let count = 0; globalThis.fetch = async () => { count++; return response(); };
  await assert.rejects(entry.handler(args, { ...context, signal: controller.signal }), e => e instanceof RegistryToolError && e.code === "tool_cancelled");
  assert.equal(count, 0);
});

function largeValidContext() {
  const p = syntheticInsightsContext();
  const dates = (start: string) => Array.from({ length: 30 }, (_, i) => new Date(Date.parse(start + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
  const windows = { current: ["2026-09-01", "2026-09-30", "2026-10-01"], previous: ["2026-08-02", "2026-08-31", "2026-09-01"], yearAgo: ["2025-09-01", "2025-09-30", "2025-10-01"] };
  const keys = Array.from({ length: 50 }, (_, i) => `京东\u001f合成店${i}`);
  p.requestedScope.shopKeys = keys; p.effectiveScope.shopKeys = keys;
  for (const kind of ["current", "previous", "yearAgo"] as const) {
    const [startDate, endDate, endExclusive] = windows[kind]; p.periods[kind] = { startDate, endDate, endExclusive, days: 30 };
  }
  p.periods.rule = "合成前等长30天";
  p.calendar = dates(windows.current[0]).map((date, i) => ({ date, previous: dates(windows.previous[0])[i], yearAgo: dates(windows.yearAgo[0])[i] }));
  for (const [ref, coverage] of Object.entries(p.coverageBySource)) {
    const kind = ref.split(":").at(-1) as "current" | "previous" | "yearAgo";
    Object.assign(coverage, { expectedShopDatePairs: 1500, coveredShopDatePairs: 0, complete: false, missingByShop: keys.map(shopKey => ({ shopKey, dates: dates(windows[kind][0]) })) });
  }
  for (const c of p.capabilities) Object.assign(c, { presentShopDatePairs: 0, status: "unavailable", reasonCode: "no_records" });
  p.sourceRevisions = p.sourceRevisions.slice(0, 2);
  for (const key of keys) for (const kind of ["product", "promotion"]) p.sourceRevisions.push({ domain: "netshop", kind: `京东:${kind}:${key}`, scopeKey: p.scopeKey, revision: "absent" });
  return p;
}

test("a complete valid DTO over the 40000-character envelope is refused, never truncated", async () => {
  payload = largeValidContext(); decodeInsightsContext(payload);
  const value = { ...args, endDate: "2026-09-30", shops: payload.requestedScope.shopKeys.map(k => ({ platform: "京东", shopName: k.split("\u001f")[1] })) };
  assert.ok(JSON.stringify({ ok: true, toolName: name, data: payload }).length > 40000);
  await assert.rejects(entry.handler(value, context), e => e instanceof RegistryToolError && e.code === "tool_result_too_large");
  assert.equal(calls.length, 1); assert.equal(payload.effectiveScope.shopKeys.length, 50);
});

test("mandatory audit and two-call invocation budget suppress data on failure", async () => {
  const unavailable = await executeToolCallWithRegistry(name, args, context, { entries: aiToolRegistry, audit: async () => { throw new Error("synthetic-audit-offline"); } });
  assert.equal(unavailable.ok, false); assert.equal(calls.length, 0);
  if (!unavailable.ok) assert.equal(unavailable.error.code, "audit_unavailable");
  const terminal = await executeToolCallWithRegistry(name, args, context, { entries: aiToolRegistry, audit: async input => { if (input.status === "succeeded") throw new Error("synthetic-terminal-failure"); } });
  assert.equal(terminal.ok, false); if (!terminal.ok) assert.equal(terminal.error.code, "audit_unavailable");
  calls = [];
  const audits: string[] = [];
  const runtime = createAiToolExecutionRuntime({ context, entries: aiToolRegistry, audit: async input => { audits.push(input.status); } });
  assert.equal((await runtime.execute(name, args)).ok, true);
  assert.equal((await runtime.execute(name, args)).ok, true);
  const third = await runtime.execute(name, args);
  assert.equal(third.ok, false); if (!third.ok) assert.equal(third.error.code, "tool_call_budget_exceeded");
  assert.equal(calls.length, 2); assert.equal(audits.filter(v => v === "succeeded").length, 2);
});

test("the executor deadline aborts transport and late completion terminates subsequent calls", async () => {
  let count = 0; let transportSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    count++; transportSignal = init?.signal;
    await new Promise(resolve => setTimeout(resolve, 150)); return response();
  };
  const shortDeadline = { ...entry, execution: { ...entry.execution, timeoutMs: 100 } };
  const runtime = createAiToolExecutionRuntime({ context, entries: [shortDeadline], audit: async () => undefined });
  const late = await runtime.execute(name, args);
  assert.equal(late.ok, false); if (!late.ok) assert.equal(late.error.code, "tool_timeout");
  assert.equal(transportSignal?.aborted, true);
  const next = await runtime.execute(name, args);
  assert.equal(next.ok, false); if (!next.ok) assert.equal(next.error.code, "tool_runtime_terminated");
  assert.equal(count, 1);
});
