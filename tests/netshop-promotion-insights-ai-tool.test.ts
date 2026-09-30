import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { AiToolEntry } from "../lib/ai/tool-registry-contract";
import type { PromotionInsightsResponse, PromotionDetailResponse } from "../lib/netshop/promotion-insights-contract";

const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://promotion-reader.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://promotion-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-promotion-tool-secret-0123456789", TERUISI_DJANGO_NETSHOP_TIMEOUT_MS: "120000" };
(globalThis as typeof globalThis & { __promotionToolEnv?: typeof environment }).__promotionToolEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__promotionToolEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");
const { getNetshopPromotionInsightsForAi, getNetshopPromotionObjectDetailForAi, NETSHOP_PROMOTION_INSIGHTS_TOOL_NAME: listName, NETSHOP_PROMOTION_DETAIL_TOOL_NAME: detailName } = await import("../lib/ai/netshop-promotion-insights-tool");
const { validatePromotionQuery, decodePromotionInsightsForQuery, decodePromotionDetailForQuery, PROMOTION_OBJECT_KINDS, PROMOTION_SORTS } = await import("../lib/netshop/promotion-insights-contract");
const { validateToolRegistry, getOpenAiTools, getAnthropicTools, getVisibleToolCatalog, executeToolCallWithRegistry, RegistryToolError } = await import("../lib/ai/tool-registry-contract");
const { createAiToolExecutionRuntime } = await import("../lib/ai/tool-execution-runtime");
const listEntry: AiToolEntry = aiToolRegistry.find(e => e.name === listName)!;
const detailEntry: AiToolEntry = aiToolRegistry.find(e => e.name === detailName)!;
const principal: AppPrincipal = { email: "synthetic-promotion@example.test", displayName: "Synthetic", role: "admin", scope: null };
const context = { principal, surface: "test" as const, requestId: "synthetic-promotion-ai-tool" };
const originalFetch = globalThis.fetch;
let payload: PromotionInsightsResponse | PromotionDetailResponse;
let owningRevision: string | null;
let calls: Array<{ url: URL; init?: RequestInit }>;

async function fixture(name: string) { return JSON.parse(await readFile(`tests/fixtures/netshop-promotion/response-${name}.json`, "utf8")) as PromotionInsightsResponse & PromotionDetailResponse; }
function argsFor(p: PromotionInsightsResponse | PromotionDetailResponse, detail = false): Record<string, unknown> {
  const c = p.context;
  const shared: Record<string, unknown> = { platform: c.requestedScope.platforms[0], startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind, trendGrain: p.sections.trend.grain };
  if (c.requestedScope.shopKeys.length) shared.outlets = c.requestedScope.shopKeys;
  if (detail) { const d = p as PromotionDetailResponse; return { ...shared, objectKind: d.sections.item.objectKind, objectId: d.sections.item.rowKey, shopKey: d.sections.item.shopKey, sectionToken: d.sectionToken }; }
  const s = (p as PromotionInsightsResponse).sections; return { ...shared, objectKind: s.listScope.objectKind, q: s.listScope.q, page: s.pagination.page, pageSize: s.pagination.pageSize };
}
function queryFor(args: Record<string, unknown>, detail = false) {
  const q = new URLSearchParams({ platform: String(args.platform), dimension: args.platform === "京东" ? "sku" : "spu", startDate: String(args.startDate), endDate: String(args.endDate), periodKind: String(args.periodKind ?? "custom"), trendGrain: String(args.trendGrain ?? "day"), objectKind: String(args.objectKind ?? "product") });
  ((args.outlets ?? []) as string[]).forEach(o => q.append("outlet", o));
  for (const key of detail ? ["objectId", "shopKey", "sectionToken", "snapshotToken"] : ["q", "page", "pageSize", "sort", "sectionToken", "snapshotToken"]) if (args[key] !== undefined) q.set(key, String(args[key]));
  if (args.productIdentity !== undefined) q.set("productIdentity", JSON.stringify(args.productIdentity));
  return q;
}
function response(data: unknown = payload, status = 200, header: string | null = owningRevision) { return Response.json(data, { status, headers: header === null ? {} : { "X-Netshop-Data-Revision": header } }); }
beforeEach(async () => {
  payload = await fixture("product"); owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision; calls = [];
  globalThis.fetch = async (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, environment.TERUISI_DJANGO_NETSHOP_READER_BASE_URL); assert.ok(["/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail"].includes(url.pathname)); calls.push({ url, init }); return response(); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("actual central entries are unique, closed, role/scope aware and limited to explicit surfaces", () => {
  validateToolRegistry(aiToolRegistry);
  assert.equal(aiToolRegistry.filter(e => e.name === listName).length, 1); assert.equal(aiToolRegistry.filter(e => e.name === detailName).length, 1);
  assert.equal(listEntry.handler, getNetshopPromotionInsightsForAi); assert.equal(detailEntry.handler, getNetshopPromotionObjectDetailForAi);
  for (const entry of [listEntry, detailEntry]) {
    assert.equal(entry.risk, "read_only"); assert.equal(entry.scopePolicy, "principal_scope"); assert.equal(entry.inputSchema.additionalProperties, false);
    assert.deepEqual(entry.execution, { environment: "worker_inline", mode: "direct", allowedSurfaces: ["ai_chat", "ai_agent", "codex_mcp", "test"], timeoutMs: 30000, maxResultCharacters: 40000, maxCallsPerRequest: 2 });
    assert.deepEqual(entry.allowedRoles, ["viewer", "analyst", "operator", "admin"]);
    for (const role of entry.allowedRoles) for (const surface of entry.execution.allowedSurfaces) {
      const actor = { ...principal, role }; assert.equal(getOpenAiTools(actor, surface, aiToolRegistry).find(t => t.function.name === entry.name)?.function.parameters, entry.inputSchema); assert.equal(getAnthropicTools(actor, surface, aiToolRegistry).find(t => t.name === entry.name)?.input_schema, entry.inputSchema); assert.equal(getVisibleToolCatalog(actor, surface, aiToolRegistry).find(t => t.name === entry.name)?.inputSchema, entry.inputSchema);
    }
    for (const surface of ["dingtalk_chat", "ai_sandbox", "market_ai", "customer_service_ai", "business_collection"] as const) assert.equal(getOpenAiTools(principal, surface, aiToolRegistry).some(t => t.function.name === entry.name), false);
    assert.equal(Object.hasOwn(entry.inputSchema.properties, "dimension"), false); assert.equal(Object.hasOwn(entry.inputSchema.properties, "focusDate"), false);
  }
  assert.deepEqual((listEntry.inputSchema.properties.objectKind as { enum: string[] }).enum, [...PROMOTION_OBJECT_KINDS]); assert.deepEqual((listEntry.inputSchema.properties.sort as { enum: string[] }).enum, [...PROMOTION_SORTS]);
});
test("actual smallest owning product fixture fits the complete envelope and all roles preserve it", async () => {
  const args = argsFor(payload), chars = JSON.stringify({ ok: true, toolName: listName, data: payload }).length;
  assert.ok(chars <= 40000); decodePromotionInsightsForQuery(payload, queryFor(args), owningRevision);
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const data = await listEntry.handler(args, { ...context, principal: { ...principal, role } }); assert.deepEqual(data, payload);
    const call = calls.at(-1)!; assert.equal(call.init?.method, "GET"); assert.equal(call.init?.body, undefined); assert.equal(call.url.searchParams.get("dimension"), "sku"); assert.equal(call.url.searchParams.get("pageSize"), "20");
    const headers = new Headers(call.init?.headers); assert.match(headers.get("X-Teruisi-Signature")!, /^v1=[a-f0-9]{64}$/); assert.equal(JSON.parse(Buffer.from(headers.get("X-Teruisi-Principal")!, "base64url").toString()).role, role);
  }
});
test("actual detail binds exact row/shop/section/snapshot tokens and same-kind owning header", async () => {
  payload = await fixture("detail"); owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  const args = { ...argsFor(payload, true), snapshotToken: payload.context.snapshotToken };
  decodePromotionDetailForQuery(payload, queryFor(args, true), owningRevision);
  assert.deepEqual(await detailEntry.handler(args, context), payload);
  assert.equal(calls[0]!.url.pathname, "/api/netshop/promotion-insights/detail"); assert.equal(calls[0]!.url.searchParams.has("page"), false); assert.equal(calls[0]!.url.searchParams.get("objectId"), (payload as PromotionDetailResponse).sections.item.rowKey);
  for (const delta of [{ objectId: "f".repeat(64) }, { shopKey: "京东\u001f未授权店" }, { objectKind: "unit" }, { sectionToken: "e".repeat(64) }, { snapshotToken: "d".repeat(64) }]) await assert.rejects(detailEntry.handler({ ...args, ...delta }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
});
test("exact product focus is serialized canonically and stays bound to the actual parent detail", async () => {
  payload = await fixture("product-focus-detail");
  owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  const identity = payload.sections.item.mapping.linkIdentity!;
  const productIdentity = [identity.platform, identity.shopName, identity.dimension, identity.id];
  const args = { ...argsFor(payload, true), productIdentity };
  assert.deepEqual(await detailEntry.handler(args, context), payload);
  assert.equal(calls[0]!.url.searchParams.get("productIdentity"), JSON.stringify(productIdentity));
  for (const productIdentity of [[identity.platform, identity.shopName, "spu", identity.id], ["天猫", identity.shopName, "spu", identity.id], [identity.platform, identity.shopName, identity.dimension], { ...identity }]) {
    await assert.rejects(detailEntry.handler({ ...args, productIdentity }, context), e => e instanceof RegistryToolError && e.code === "invalid_arguments");
  }
  await assert.rejects(detailEntry.handler({ ...args, productIdentity: [identity.platform, identity.shopName, identity.dimension, "different-valid-id"] }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
});

test("closed arguments reject free dimensions, focus, category, q/page in detail and list oversize", async () => {
  const base = argsFor(payload);
  for (const value of [{ ...base, dimension: "spu" }, { ...base, platform: ["京东"] }, { ...base, focusDate: "2026-09-01" }, { ...base, category: "guess" }, { ...base, objectStartDate: "2026-09-01" }, { ...base, pageSize: 21 }, { ...base, page: 10001 }, { ...base, q: "x".repeat(121) }, { ...base, q: "a\u0000b" }, { ...base, sort: "page_total" }, { ...base, startDate: "2026-02-30" }, { ...base, startDate: "2025-01-01" }, { ...base, outlets: ["京东\u001fA", "京东\u001fA"] }, { ...base, outlets: ["京东\u001f A "] }, { ...base, outlets: ["天猫\u001fA"] }, { ...base, snapshotToken: "not-token" }, { ...base, principal }, { ...base, path: "/api/netshop/imports" }]) await assert.rejects(listEntry.handler(value, context), e => e instanceof RegistryToolError && e.code === "invalid_arguments");
  const detail = await fixture("detail"), args = argsFor(detail, true);
  for (const key of ["q", "page", "pageSize", "sort", "focusDate", "objectEndDate", "category"]) await assert.rejects(detailEntry.handler({ ...args, [key]: "extra" }, context), e => e instanceof RegistryToolError && e.code === "invalid_arguments");
  assert.equal(calls.length, 0);
});
test("scope fails before I/O and Tmall derives SPU without accepting a free dimension", async () => {
  const args = argsFor(payload);
  for (const scope of [{ platforms: ["天猫"], warehouses: [], channels: [] }, { platforms: [], warehouses: [], channels: [] }, { platforms: ["京东"], warehouses: ["W"], channels: [] }, { platforms: ["京东"], warehouses: [], channels: ["C"] }]) await assert.rejects(listEntry.handler(args, { ...context, principal: { ...principal, scope } }), e => e instanceof RegistryToolError && e.code === "forbidden");
  assert.equal(calls.length, 0);
  await assert.rejects(listEntry.handler({ ...args, platform: "天猫" }, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  assert.equal(calls[0]!.url.searchParams.get("dimension"), "spu");
});
test("non-product eligibility never enlarges the existing admin/JD/single/1-7-day domain", async () => {
  const args = argsFor(payload);
  for (const kind of ["plan", "unit", "keyword", "search_term"]) {
    await assert.rejects(listEntry.handler({ ...args, objectKind: kind }, { ...context, principal: { ...principal, role: "viewer" } }), e => e instanceof RegistryToolError && e.code === "forbidden");
    await assert.rejects(listEntry.handler({ ...args, objectKind: kind, platform: "天猫" }, context), e => e instanceof RegistryToolError && e.code === "forbidden");
    await assert.rejects(listEntry.handler({ ...args, objectKind: kind, endDate: "2026-09-08" }, context), e => e instanceof RegistryToolError && e.code === "forbidden");
  }
  assert.equal(calls.length, 0);
  payload = await fixture("plan"); owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision;
  assert.deepEqual(await listEntry.handler(argsFor(payload), context), payload);
});
test("valid but mismatched scope/header/token/decoder operands never escape", async () => {
  const good = await fixture("product"), args = argsFor(good);
  for (const change of [() => { owningRevision = "99:aaaaaaaaaaaa"; }, () => { (payload as PromotionInsightsResponse).sections.listScope.q = "other"; }, () => { (payload as PromotionInsightsResponse).sections.summary.cpc.denominatorKind = "visitors" as never; }, () => { payload.context.sourceRevisions.pop(); }]) {
    payload = structuredClone(good); owningRevision = good.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision; change(); await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "invalid_tool_result");
  }
});
test("real misaligned-store fixture remains complete evidence and is refused over 40k without clipping", async () => {
  payload = await fixture("misaligned"); owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision; const args = argsFor(payload);
  decodePromotionInsightsForQuery(payload, queryFor(args), owningRevision); assert.ok(JSON.stringify({ ok: true, toolName: listName, data: payload }).length > 40000);
  const before = structuredClone(payload); await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "tool_result_too_large"); assert.deepEqual(payload, before); assert.equal(calls.length, 1);
});
test("reader status meanings stay safe, never retry or fall back to historical APIs", async () => {
  const args = argsFor(payload);
  for (const [status, code, expected] of [[403, "access_denied", "forbidden"], [409, "promotion_revision_changed", "version_conflict"], [422, "quality_incomplete", "tool_result_too_large"], [503, "source_not_ready", "service_unavailable"]] as const) {
    let count = 0; globalThis.fetch = async () => { count++; return response({ code, error: "private-upstream-detail" }, status, null); }; await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === expected && !e.message.includes("private-upstream-detail")); assert.equal(count, 1);
  }
});
test("central audit availability and two-call budget are mandatory for both registered tools", async () => {
  for (const [name, filename, detail] of [[listName, "product", false], [detailName, "detail", true]] as const) {
    payload = await fixture(filename); owningRevision = payload.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision; calls = []; const args = argsFor(payload, detail);
    const blocked = await executeToolCallWithRegistry(name, args, context, { entries: aiToolRegistry, audit: async () => { throw Error("offline"); } }); assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.error.code, "audit_unavailable"); assert.equal(calls.length, 0);
    const terminal = await executeToolCallWithRegistry(name, args, context, { entries: aiToolRegistry, audit: async input => { if (input.status === "succeeded") throw Error("terminal audit offline"); } }); assert.equal(terminal.ok, false); if (!terminal.ok) assert.equal(terminal.error.code, "audit_unavailable");
    calls = []; const statuses: string[] = []; const runtime = createAiToolExecutionRuntime({ context, entries: aiToolRegistry, audit: async input => { statuses.push(input.status); } });
    assert.equal((await runtime.execute(name, args)).ok, true); assert.equal((await runtime.execute(name, args)).ok, true); const third = await runtime.execute(name, args); assert.equal(third.ok, false); if (!third.ok) assert.equal(third.error.code, "tool_call_budget_exceeded"); assert.equal(calls.length, 2); assert.equal(statuses.filter(s => s === "succeeded").length, 2);
  }
});
test("actual SDK refuses a source body above 2MiB UTF8 even below a smaller character count", async () => {
  const args = argsFor(payload), oversized = { ...payload, syntheticPadding: "合".repeat(710000) };
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).length > 2*1024*1024);
  let count = 0; globalThis.fetch = async () => { count++; return response(oversized); };
  await assert.rejects(listEntry.handler(args, context), e => e instanceof RegistryToolError && e.code === "service_unavailable");
  assert.equal(count, 1); // SDK's bounded-read error is safe unavailable, no data.
});
test("pre-cancelled and late transport success cannot release promotion data", async () => {
  const args = argsFor(payload), controller = new AbortController(); let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { signal = init?.signal; controller.abort(); await new Promise(resolve => setTimeout(resolve, 5)); return response(); };
  await assert.rejects(listEntry.handler(args, { ...context, signal: controller.signal }), e => e instanceof RegistryToolError && e.code === "tool_cancelled"); assert.equal(signal?.aborted, true);
  let count = 0; globalThis.fetch = async () => { count++; return response(); }; await assert.rejects(listEntry.handler(args, { ...context, signal: controller.signal }), e => e instanceof RegistryToolError && e.code === "tool_cancelled"); assert.equal(count, 0);
});
test("actual central deadline aborts I/O and terminates subsequent calls", async () => {
  const args = argsFor(payload); let signal: AbortSignal | null | undefined, count = 0;
  globalThis.fetch = async (_input, init) => { count++; signal = init?.signal; await new Promise(resolve => setTimeout(resolve, 150)); return response(); };
  const runtime = createAiToolExecutionRuntime({ context, entries: [{ ...listEntry, execution: { ...listEntry.execution, timeoutMs: 100 } }], audit: async () => undefined });
  const result = await runtime.execute(listName, args); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "tool_timeout"); assert.equal(signal?.aborted, true); const next = await runtime.execute(listName, args); assert.equal(next.ok, false); if (!next.ok) assert.equal(next.error.code, "tool_runtime_terminated"); assert.equal(count, 1);
});
test("actual schema parameters satisfy A query parser and cannot expose list focus to detail", () => {
  const q = queryFor(argsFor(payload)); assert.equal(validatePromotionQuery(q).context.dimension, "sku");
  for (const key of ["q", "page", "pageSize", "focusDate", "objectStartDate", "objectEndDate"]) assert.equal(Object.hasOwn(detailEntry.inputSchema.properties, key), false);
});
