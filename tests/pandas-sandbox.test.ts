import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { validateToolArguments, validateToolRegistry, type AiToolEntry } from "../lib/ai/tool-registry-contract";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry, getOpenAiTools, getAnthropicTools, getToolsForPrincipal, executeRegisteredToolCall } = await import("../lib/ai/tool-registry");
const { summarizeToolArguments } = await import("../lib/ai/tool-audit");
const { canonicalAiEdge, handleAiEdge } = await import("../lib/ai/django-edge");
const { aiHeaders } = await import("../lib/django/ai-service");
const admin = { email: "pandas@example.invalid", displayName: "Fixture", role: "admin" as const, scope: null };
const entry: AiToolEntry = aiToolRegistry.find(e => e.name === "run_pandas_analysis")!;

test("pandas tool is declared once, visible in both protocols, hidden from viewer and generic MCP", () => {
  validateToolRegistry(aiToolRegistry);
  assert.equal(aiToolRegistry.filter(e => e.name === entry.name).length, 1);
  assert.equal(entry.execution.environment, "isolated_container");
  assert.equal(entry.execution.maxCallsPerRequest, 1);
  assert.equal(entry.annotations.idempotentHint, false);
  assert.ok(getOpenAiTools(admin, "ai_chat").some(t => t.function.name === entry.name));
  assert.ok(getAnthropicTools(admin, "dingtalk_chat").some(t => t.name === entry.name));
  assert.ok(!getToolsForPrincipal({ ...admin, role: "viewer" }, "ai_chat").some(t => t.name === entry.name));
  assert.ok(!getToolsForPrincipal(admin, "codex_mcp").some(t => t.name === entry.name));
  const args = { inputsJson: "[]", code: "result = frames['sales']" };
  assert.doesNotThrow(() => validateToolArguments(args, entry.inputSchema));
  assert.throws(() => validateToolArguments({ ...args, dockerHost: "tcp://host" }, entry.inputSchema));
  assert.throws(() => validateToolArguments({ ...args, code: "x".repeat(16001) }, entry.inputSchema));
});

test("central handler uses writer, server invocation identity and fixed surface; audit does not reveal code", async t => {
  const originalFetch = globalThis.fetch;
  const env = { TERUISI_DJANGO_INTERNAL_SECRET: "isolated-pandas-transport-secret-abcdefghijklmnopqrstuvwxyz",
    TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112" };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { globalThis.fetch = originalFetch; for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  let dispatched = 0;
  let auditedInvocation: string | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:18112/api/ai/consumer");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.operation, "pandas-analysis");
    assert.equal(payload.surface, "dingtalk_chat");
    assert.equal(payload.parentRequestRef, createHash("sha256").update("fixture-request").digest("hex"));
    assert.ok(!String(init?.body).includes("fixture-request"));
    assert.ok(auditedInvocation);
    assert.equal(new Headers(init?.headers).get("x-teruisi-request-id"), auditedInvocation);
    dispatched++;
    return Response.json({ items: [{ amount: 800 }], returned: 1, truncated: false }, { headers: { "x-ai-revision": "1" } });
  };
  const result = await executeRegisteredToolCall(entry.name, { inputsJson: "[]", code: "result = frames['sales']" },
    { principal: admin, surface: "dingtalk_chat", requestId: "fixture-request" }, { audit: async event => {
      assert.equal(event.requestId, "fixture-request");
      if (event.status === "started") auditedInvocation = event.invocationId;
      else assert.equal(event.invocationId, auditedInvocation);
    } });
  assert.equal(dispatched, 1);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal((result.data as { returned: number }).returned, 1);
  const summary = JSON.stringify(summarizeToolArguments({ code: "sensitive literal", inputsJson: "query literal" }));
  assert.ok(!summary.includes("sensitive literal"));
  assert.ok(!summary.includes("query literal"));
});

test("audit failure blocks isolated container dispatch", async () => {
  let calls = 0;
  const result = await executeRegisteredToolCall(entry.name, { inputsJson: "[]", code: "result = frames['sales']" },
    { principal: admin, surface: "ai_chat", requestId: "fixture-audit" },
    { entries: [{ ...entry, handler: async () => { calls++; return {}; } }], audit: async () => { throw new Error("unavailable"); } });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test("signed pandas pages preserve surface and source fences without opening the normal tool schema", async t => {
  const secret = "isolated-pandas-page-secret-abcdefghijklmnopqrstuvwxyz";
  const environment = { TERUISI_DJANGO_INTERNAL_SECRET: secret,
    TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112",
    TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "http://127.0.0.1:18113", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "http://127.0.0.1:18114" };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, environment);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  const name = "get_netshop_performance";
  const ordinary = aiToolRegistry.find(tool => tool.name === name)!;
  const revision = "3:0123456789ab", token = "a".repeat(64);
  const scoped = { ...admin, role: "analyst" as const, scope: { platforms: ["京东"], channels: [], warehouses: [] } };
  const argumentsFor = (page: number) => ({ dataset: "product_daily", page, limit: 1, platform: "京东", shop: "合成店",
    startDate: "2026-09-10", endDate: "2026-09-11", ...(page === 1 ? {} : { snapshotToken: token }) });
  assert.throws(() => validateToolArguments(argumentsFor(1), ordinary.inputSchema));

  const reads: URLSearchParams[] = [];
  const audits: Array<{ requestId: string; surface: string; status: string; arguments: Record<string, unknown> }> = [];
  let stale = false, allowAudit = true;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname === "/api/ai/consumer") {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.operation, "tool-audit");
      audits.push(request.entry);
      return Response.json({ ok: allowAudit }, { status: allowAudit ? 200 : 503, headers: { "x-ai-revision": "1" } });
    }
    assert.equal(target.pathname, "/api/netshop/product-performance");
    assert.equal(target.port, "18113");
    reads.push(target.searchParams);
    if (stale) return Response.json({ code: "service_unavailable", reasonCode: "product_snapshot_changed" }, { status: 503 });
    const page = Number(target.searchParams.get("page"));
    return Response.json({ sourceRevision: revision, snapshotToken: token, items: [{ id: `synthetic-${page}` }],
      pagination: { page, pageSize: 1, total: 2, returned: 1, truncated: page === 1 } }, { headers: { "x-netshop-data-revision": revision } });
  };

  const pathname = "/api/ai/internal/edge";
  async function edge(body: Record<string, unknown>, principal: typeof admin | typeof scoped = scoped, sign = true) {
    const raw = JSON.stringify(body);
    const headers = sign ? await aiHeaders({ secret, principal, method: "POST", path: pathname, query: "", body: raw,
      requestId: "synthetic-pandas-page" }) : undefined;
    return handleAiEdge(new Request("https://synthetic.invalid" + pathname, { method: "POST", headers, body: raw }));
  }
  async function executeBody(surface: string, page: number, principal: typeof admin | typeof scoped = scoped) {
    const catalog = await (await edge({ action: "catalog", surface }, principal)).json() as { entries: unknown[] };
    return { action: "execute", name, surface, requestId: `synthetic-page-${page}`, arguments: argumentsFor(page),
      policyDigest: createHash("sha256").update(canonicalAiEdge(catalog.entries)).digest("hex"), pandasProductPage: true };
  }

  const first = await executeBody("dingtalk_chat", 1);
  const next = await executeBody("dingtalk_chat", 2);
  for (const body of [first, next]) {
    const result = await (await edge(body)).json() as { ok: boolean; data: { sourceRevision: string; snapshotToken: string } };
    assert.equal(result.ok, true);
    assert.equal(result.data.sourceRevision, revision);
    assert.equal(result.data.snapshotToken, token);
  }
  assert.deepEqual(reads.map(query => [query.get("view"), query.get("page"), query.get("snapshotToken")]),
    [["full", "1", null], ["page", "2", token]]);
  for (const query of reads) {
    assert.equal(query.get("dimension"), "spu");
    assert.deepEqual(query.getAll("platform"), ["京东"]);
    assert.equal(query.get("outlet"), "京东\x1f合成店");
    assert.equal(query.get("startDate"), "2026-09-10");
    assert.equal(query.get("endDate"), "2026-09-11");
  }
  assert.deepEqual(audits.map(event => [event.requestId, event.surface, event.status]), [
    ["synthetic-page-1", "dingtalk_chat", "started"], ["synthetic-page-1", "dingtalk_chat", "succeeded"],
    ["synthetic-page-2", "dingtalk_chat", "started"], ["synthetic-page-2", "dingtalk_chat", "succeeded"],
  ]);
  assert.equal(audits.at(-1)!.arguments.snapshotToken, "[redacted]");

  for (const rejected of [{ ...first, policyDigest: "0".repeat(64) }, { ...first, pandasProductPage: "true" },
    { ...first, name: "get_data_freshness" }, await executeBody("pi_agent", 1)]) {
    assert.equal((await edge(rejected)).status, 403);
  }
  assert.equal((await edge(first, scoped, false)).status, 403);
  const ordinaryCall = { ...first, pandasProductPage: undefined };
  const crossPlatform = { ...first, arguments: { ...first.arguments, platform: "天猫" } };
  const absentToken = { ...next, arguments: { ...next.arguments, snapshotToken: undefined } };
  for (const [request, code] of [[ordinaryCall, "invalid_arguments"], [crossPlatform, "access_denied"], [absentToken, "invalid_arguments"]] as const) {
    const result = await (await edge(request)).json() as { error: { code: string } };
    assert.equal(result.error.code, code);
  }
  allowAudit = false;
  const unavailable = await (await edge(first)).json() as { auditStatus: string };
  assert.equal(unavailable.auditStatus, "unavailable");
  assert.equal(reads.length, 2);
  allowAudit = true;
  stale = true;
  const drift = await (await edge(next)).json() as { error: { code: string } };
  assert.equal(drift.error.code, "source_revision_changed");
});

test("signed sales category pages use a slim paged variant without opening the model-visible schema", async t => {
  const secret = "isolated-pandas-sales-secret-abcdefghijklmnopqrstuvwxyz";
  const environment = { TERUISI_DJANGO_INTERNAL_SECRET: secret,
    TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112",
    TERUISI_DJANGO_SALES_READER_BASE_URL: "http://127.0.0.1:18115" };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, environment);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  const name = "get_sales_category_analysis";
  const { pandasSalesCategoryPageTool } = await import("../lib/ai/tool-registry");
  const ordinary = aiToolRegistry.find(tool => tool.name === name)!;
  const argumentsFor = (page: number) => ({ startDate: "2026-11-01", endDate: "2026-11-07", limit: 2, page });
  // The model-visible schemas never carry page; the export variant does.
  assert.equal(Object.hasOwn(ordinary.inputSchema.properties, "page"), false);
  assert.throws(() => validateToolArguments(argumentsFor(1), ordinary.inputSchema));
  for (const tools of [getOpenAiTools(admin, "ai_chat"), getAnthropicTools(admin, "dingtalk_chat")]) {
    const listed = JSON.stringify(tools.find(tool => ("function" in tool ? tool.function.name : tool.name) === name));
    assert.ok(listed && !listed.includes('"page"'));
  }
  const variant = pandasSalesCategoryPageTool(aiToolRegistry)!;
  assert.deepEqual(variant.inputSchema.required, ["startDate", "endDate", "page"]);
  assert.doesNotThrow(() => validateToolArguments(argumentsFor(20), variant.inputSchema));
  for (const page of [0, 21, 1.5]) assert.throws(() => validateToolArguments(argumentsFor(page), variant.inputSchema));
  assert.throws(() => validateToolArguments({ ...argumentsFor(1), snapshotToken: "x" }, variant.inputSchema));
  assert.equal(pandasSalesCategoryPageTool([]), undefined);

  const reads: URLSearchParams[] = [];
  const audits: Array<{ surface: string; status: string }> = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname === "/api/ai/consumer") {
      audits.push(JSON.parse(String(init?.body)).entry);
      return Response.json({ ok: true }, { headers: { "x-ai-revision": "1" } });
    }
    assert.equal(target.pathname, "/api/sales/category-analysis");
    assert.equal(target.port, "18115");
    reads.push(target.searchParams);
    const page = Number(target.searchParams.get("page"));
    const categories = Array.from({ length: 200 }, (_, index) => `品类${index}`);
    return Response.json({ range: { startDate: "2026-11-01", endDate: "2026-11-07" }, dataCutoffDate: "2026-11-07",
      filtersApplied: { categories: [] }, ranking: [{ rank: 1 }], trend: { items: [], returned: 0, truncated: false },
      filterOptions: { categories, totals: { categories: 300 } }, summary: { big: "x".repeat(5000) },
      details: { items: [{ category: `品类${page}` }, { category: `品类${page + 100}` }],
        pagination: { page, pageSize: 2, total: 4, returned: 2, truncated: page < 2 } } }, { headers: { "x-sales-data-revision": "1", "x-sales-source-revision": "1" } });
  };

  const pathname = "/api/ai/internal/edge";
  async function edge(body: Record<string, unknown>, sign = true) {
    const raw = JSON.stringify(body);
    const headers = sign ? await aiHeaders({ secret, principal: admin, method: "POST", path: pathname, query: "", body: raw,
      requestId: "synthetic-sales-page" }) : undefined;
    return handleAiEdge(new Request("https://synthetic.invalid" + pathname, { method: "POST", headers, body: raw }));
  }
  async function executeBody(surface: string, page: number) {
    const catalog = await (await edge({ action: "catalog", surface })).json() as { entries: unknown[] };
    return { action: "execute", name, surface, requestId: `synthetic-sales-${page}`, arguments: argumentsFor(page),
      policyDigest: createHash("sha256").update(canonicalAiEdge(catalog.entries)).digest("hex"), pandasSalesCategoryPage: true };
  }

  const first = await executeBody("dingtalk_chat", 1), second = await executeBody("dingtalk_chat", 2);
  for (const [body, page] of [[first, 1], [second, 2]] as const) {
    const result = await (await edge(body)).json() as { ok: boolean; data: Record<string, unknown> };
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.data).sort(), ["dataCutoffDate", "filtersApplied", "items", "pagination", "range"]);
    assert.deepEqual(result.data.pagination, { page, pageSize: 2, total: 4, returned: 2, truncated: page < 2 });
  }
  assert.deepEqual(reads.map(query => [query.get("page"), query.get("pageSize")]), [["1", "2"], ["2", "2"]]);
  assert.ok(audits.length >= 4 && audits.every(event => event.surface === "dingtalk_chat"));

  for (const rejected of [{ ...first, policyDigest: "0".repeat(64) }, { ...first, pandasSalesCategoryPage: "true" },
    { ...first, name: "get_sales_summary" }, { ...first, pandasProductPage: true }, { ...first, extraKey: 1 },
    await executeBody("pi_agent", 1)]) {
    assert.equal((await edge(rejected)).status, 403);
  }
  assert.equal((await edge(first, false)).status, 403);
  // An ordinary call with page is still refused by the ordinary schema.
  const ordinaryCall = await (await edge({ ...first, pandasSalesCategoryPage: undefined })).json() as { error: { code: string } };
  assert.equal(ordinaryCall.error.code, "invalid_arguments");
  assert.equal(reads.length, 2);
});
