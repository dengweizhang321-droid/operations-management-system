import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { validateToolArguments, validateToolRegistry } from "../lib/ai/tool-registry-contract";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry, getOpenAiTools, getAnthropicTools, getToolsForPrincipal, executeRegisteredToolCall } = await import("../lib/ai/tool-registry");
const { requireAnalysisPrincipal } = await import("../lib/netshop/analysis-tool");
const admin = { email: "analysis@example.test", displayName: "Fixture", role: "admin" as const, scope: null };
const entry = aiToolRegistry.find(e => e.name === "get_netshop_analysis_records")!;
const args = { platform: "京东", shop: "样例店A", dataset: "promotion", startDate: "2026-09-01", endDate: "2026-09-03" };

test("ERP analysis tool uses the owning signed reader and retains exact three-field identity", async t => {
  const sales = aiToolRegistry.find(e => e.name === "get_sales_analysis_records")!;
  const oldFetch = globalThis.fetch;
  const priorUrl = process.env.TERUISI_DJANGO_SALES_READER_BASE_URL;
  const priorSecret = process.env.TERUISI_DJANGO_INTERNAL_SECRET;
  process.env.TERUISI_DJANGO_SALES_READER_BASE_URL = "http://127.0.0.1:18011";
  process.env.TERUISI_DJANGO_INTERNAL_SECRET = "analysis-fixture-internal-secret-at-least-32-bytes";
  t.after(() => { globalThis.fetch = oldFetch;
    if (priorUrl === undefined) delete process.env.TERUISI_DJANGO_SALES_READER_BASE_URL; else process.env.TERUISI_DJANGO_SALES_READER_BASE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.TERUISI_DJANGO_INTERNAL_SECRET; else process.env.TERUISI_DJANGO_INTERNAL_SECRET = priorSecret;
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:18011/api/sales/consumers/query");
    const body = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array));
    assert.equal(body.operation, "analysis_records");
    assert.equal(body.channel, "京东-样例店A");
    assert.equal(body.shop, "样例店A");
    assert.equal(body.platform, "京东");
    assert.equal(body.limit, 10);
    assert.ok(new Headers(init?.headers).get("X-Teruisi-Signature"));
    return Response.json({ operation: "analysis_records", data: { schemaVersion: "business-analysis-v1" } },
      { headers: { "x-sales-data-revision": "7:3", "x-sales-source-revision": "7:3" } });
  };
  const query = { platform: args.platform, shop: args.shop, channel: "京东-样例店A", startDate: args.startDate, endDate: args.endDate };
  validateToolArguments(query, sales.inputSchema);
  await sales.handler(query, { principal: admin, surface: "ai_agent", requestId: "erp-test" });
  assert.ok(!getToolsForPrincipal(admin, "dingtalk_chat").some(e => e.name === sales.name));
});

test("evidence paths remain finite and use separate reader/writer routes", async () => {
  const { isPublicAiPath, requestDjangoAi } = await import("../lib/django/ai-service");
  for (const suffix of ["", "/run", "/run/collect", "/run/finish", "/run/mapping", "/run/chunks/sales"]) assert.ok(isPublicAiPath("/api/ai/business-evidence" + suffix));
  assert.equal(isPublicAiPath("/api/ai/business-evidence/run/exec"), false);
  for (const [method, suffix, port] of [["GET", "/run", "18001"], ["POST", "/run/collect", "18002"]] as const) {
    await requestDjangoAi(admin, { path: "/api/ai/business-evidence" + suffix, method }, {
      environment: { TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18001", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18002", TERUISI_DJANGO_INTERNAL_SECRET: "analysis-fixture-internal-secret-at-least-32-bytes" },
      fetchImpl: async url => { assert.equal(new URL(String(url)).port, port); return Response.json({}, { headers: { "x-ai-revision": "1" } }); },
    });
  }
});

test("shared evidence tool is read-only, bounded and cannot accept a partial chunk locator", async () => {
  const shared = aiToolRegistry.find(e => e.name === "get_business_analysis_evidence")!;
  assert.equal(shared.risk, "read_only");
  validateToolArguments({ runId: "evidence-example", sourceKey: "sales", sequence: 1 }, shared.inputSchema);
  assert.throws(() => validateToolArguments({ runId: "../secret" }, shared.inputSchema));
  await assert.rejects(() => shared.handler({ runId: "example", sourceKey: "sales" }, { principal: admin, surface: "ai_agent", requestId: "partial" }), /同时指定/);
  assert.ok(!getToolsForPrincipal({ ...admin, role: "viewer" }, "ai_chat").some(e => e.name === shared.name));
});

test("analysis tool has a single schema, two provider projections and bounded surfaces", () => {
  validateToolRegistry(aiToolRegistry);
  assert.equal(aiToolRegistry.filter(e => e.name === entry.name).length, 1);
  assert.ok(getOpenAiTools(admin, "ai_agent").some(e => e.function.name === entry.name));
  assert.ok(getAnthropicTools(admin, "ai_chat").some(e => e.name === entry.name));
  assert.ok(!getToolsForPrincipal(admin, "dingtalk_chat").some(e => e.name === entry.name));
  for (const role of ["viewer", "analyst", "operator"] as const) {
    assert.ok(!getToolsForPrincipal({ ...admin, role }, "ai_chat").some(e => e.name === entry.name));
    assert.throws(() => requireAnalysisPrincipal({ ...admin, role }));
  }
  assert.throws(() => requireAnalysisPrincipal({ ...admin, scope: { platforms: ["京东"], warehouses: [], channels: [] } }));
  assert.doesNotThrow(() => validateToolArguments(args, entry.inputSchema));
  for (const bad of [{ ...args, sql: "select *" }, { ...args, limit: 21 }, { ...args, dataset: "private" }, { ...args, window: "latest" }]) {
    assert.throws(() => validateToolArguments(bad, entry.inputSchema));
  }
});

test("analysis handler preserves exact identity, date and cursor on the signed reader", async t => {
  const oldFetch = globalThis.fetch;
  const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "http://127.0.0.1:18021",
    TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "http://127.0.0.1:18022",
    TERUISI_DJANGO_INTERNAL_SECRET: "analysis-fixture-internal-secret-at-least-32-bytes" };
  const saved = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { globalThis.fetch = oldFetch; for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "http://127.0.0.1:18021");
    assert.equal(u.pathname, "/api/netshop/analysis-records");
    assert.equal(u.searchParams.get("shop"), args.shop);
    assert.equal(u.searchParams.get("window"), "yearAgo");
    assert.equal(u.searchParams.get("cursor"), "bound-cursor");
    assert.equal(u.searchParams.get("limit"), "10");
    assert.equal(init?.method, "GET");
    assert.ok(new Headers(init?.headers).has("X-Teruisi-Signature"));
    return Response.json({ schemaVersion: "business-analysis-v1", items: [], pagination: { hasMore: false, nextCursor: null } },
      { headers: { "X-Netshop-Data-Revision": "7:aaaaaaaaaaaa" } });
  };
  const result = await entry.handler({ ...args, window: "yearAgo", cursor: "bound-cursor" },
    { principal: admin, surface: "ai_agent", requestId: "analysis-fixture" });
  assert.equal((result as Record<string, unknown>).schemaVersion, "business-analysis-v1");
  globalThis.fetch = async () => Response.json({ items: [{ productName: "长".repeat(38_001) }] },
    { headers: { "X-Netshop-Data-Revision": "7:aaaaaaaaaaaa" } });
  await assert.rejects(() => entry.handler(args,
    { principal: admin, surface: "ai_agent", requestId: "analysis-overflow" }), /不得截断/);
});

test("audit failure prevents analysis data access", async () => {
  let calls = 0;
  const result = await executeRegisteredToolCall(entry.name, args,
    { principal: admin, surface: "ai_agent", requestId: "analysis-fixture" },
    { entries: [{ ...entry, handler: async () => { calls++; return {}; } }],
      audit: async () => { throw new Error("audit unavailable"); } });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});
