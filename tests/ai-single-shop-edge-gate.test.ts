import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "cloudflare:workers" ? { url: "data:text/javascript,export const env={};", shortCircuit: true } : nextResolve(specifier, context);
} });
const { aiToolRegistry, getToolsForPrincipal } = await import("../lib/ai/tool-registry");
const { canonicalAiEdge, handleAiEdge } = await import("../lib/ai/django-edge");
const { aiHeaders } = await import("../lib/django/ai-service");

const admin: AppPrincipal = { email: "single-shop@example.invalid", displayName: "Synthetic", role: "admin", scope: null };
// search_personal_memory is the only registered tool whose handler reads
// context.singleShop (lib/ai/tool-registry.ts:684, via retrieveAiMemoriesForContext).
// Its allowedSurfaces are ["ai_chat", "ai_agent", "codex_mcp", "test", "pi_agent"] —
// it does not reach dingtalk_chat, so that surface is proven separately below.
const TOOL = "get_data_freshness";
const MEMORY_TOOL = "search_personal_memory";
const secret = "single-shop-edge-gate-isolated-secret-32-bytes";
const environment = { TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18193", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18194", TERUISI_DJANGO_INTERNAL_SECRET: secret };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function isolated(t: TestContext) {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, environment);
  t.after(() => { globalThis.fetch = oldFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
const response = (data: object) => Response.json(data, { headers: { "x-ai-revision": "1" } });

async function edge(body: Record<string, unknown>, actor = admin) {
  const raw = JSON.stringify(body), pathname = "/api/ai/internal/edge";
  const headers = await aiHeaders({ secret, principal: actor, method: "POST", path: pathname, query: "", body: raw, requestId: "fixture-single-shop" });
  return handleAiEdge(new Request("https://synthetic.invalid" + pathname, { method: "POST", headers, body: raw }));
}

async function digestFor(surface: string) {
  const catalog = (await (await edge({ action: "catalog", surface })).json() as { entries: unknown[] }).entries;
  return sha(canonicalAiEdge(catalog));
}

test("sanity: search_personal_memory is reachable on pi_agent and ai_chat, not on dingtalk_chat", () => {
  const entry = aiToolRegistry.find(e => e.name === MEMORY_TOOL)!;
  assert.deepEqual([...entry.execution.allowedSurfaces].sort(), ["ai_agent", "ai_chat", "codex_mcp", "pi_agent", "test"]);
  assert.equal(getToolsForPrincipal(admin, "dingtalk_chat").some(e => e.name === MEMORY_TOOL), false);
});

test("execute body carrying singleShop (sent on every Django-originated call) is accepted, not 403'd", async t => {
  isolated(t);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ ok: true }); };
  const digest = await digestFor("ai_chat");
  const result = await edge({ action: "execute", name: TOOL, arguments: {}, surface: "ai_chat", requestId: "r1", providerCallId: "c1", policyDigest: digest, singleShop: false });
  // Item 1 regression: transport.py:713 sends singleShop unconditionally on every
  // execute call. exact()'s allowlist must include it, or every Django-originated
  // tool execution 403s — not just single-shop ones.
  assert.equal(result.status, 200);
  assert.ok(calls > 0);
});

test("pi_agent surface with singleShop:true reaches the tool with singleShop===true in context", async t => {
  isolated(t);
  const seen: { pathname: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    seen.push({ pathname: target.pathname, body: JSON.parse(String(init?.body ?? "{}")) });
    return response({ ok: true });
  };
  const digest = await digestFor("pi_agent");
  const result = await edge({ action: "execute", name: MEMORY_TOOL, arguments: { query: "preferred-warehouse" }, surface: "pi_agent", requestId: "r2", providerCallId: "c2", policyDigest: digest, singleShop: true });
  assert.equal(result.status, 200);
  const consumerCall = seen.find(call => call.pathname === "/api/ai/consumer" && call.body.operation === "memory-recall");
  assert.ok(consumerCall, "expected a memory-recall call to /api/ai/consumer");
  assert.equal(consumerCall!.body.singleShopRestricted, true);
  assert.equal(Object.hasOwn(consumerCall!.body, "arguments"), false);
});

for (const nonPiSurface of ["ai_chat", "dingtalk_chat"] as const) {
  test(`${nonPiSurface} surface cannot forge singleShop: the flag is dropped, not merely ignored`, async t => {
    isolated(t);
    const seen: { pathname: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      seen.push({ pathname: target.pathname, body: JSON.parse(String(init?.body ?? "{}")) });
      return response({ ok: true });
    };
    // search_personal_memory does not reach dingtalk_chat, so use whichever
    // reachable read-only tool exercises the forwarded request on each surface:
    // ai_chat can call search_personal_memory itself (same tool as the pi_agent
    // case above, giving a direct apples-to-apples comparison); dingtalk_chat
    // uses get_data_freshness, the nearest tool that is reachable there, and we
    // assert on the broader property instead (no singleShopRestricted leaks
    // anywhere in the forwarded traffic for this surface).
    if (nonPiSurface === "ai_chat") {
      const digest = await digestFor("ai_chat");
      const result = await edge({ action: "execute", name: MEMORY_TOOL, arguments: { query: "preferred-warehouse" }, surface: "ai_chat", requestId: "r3", providerCallId: "c3", policyDigest: digest, singleShop: true });
      assert.equal(result.status, 200);
      const consumerCall = seen.find(call => call.pathname === "/api/ai/consumer" && call.body.operation === "memory-recall");
      assert.ok(consumerCall, "expected a memory-recall call to /api/ai/consumer");
      assert.equal(Object.hasOwn(consumerCall!.body, "singleShopRestricted"), false);
    } else {
      const digest = await digestFor("dingtalk_chat");
      const result = await edge({ action: "execute", name: TOOL, arguments: {}, surface: "dingtalk_chat", requestId: "r3b", providerCallId: "c3b", policyDigest: digest, singleShop: true });
      assert.equal(result.status, 200);
      for (const call of seen) assert.equal(Object.hasOwn(call.body, "singleShopRestricted"), false);
    }
  });
}

test("only the literal boolean true on pi_agent counts; omitted/false/string/number all drop the flag", async t => {
  isolated(t);
  const digest = await digestFor("pi_agent");
  for (const candidate of [undefined, false, "true", 1]) {
    const seen: { pathname: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      seen.push({ pathname: target.pathname, body: JSON.parse(String(init?.body ?? "{}")) });
      return response({ ok: true });
    };
    const body: Record<string, unknown> = { action: "execute", name: MEMORY_TOOL, arguments: { query: "preferred-warehouse" }, surface: "pi_agent", requestId: "r4", providerCallId: "c4", policyDigest: digest };
    if (candidate !== undefined) body.singleShop = candidate;
    const result = await edge(body);
    assert.equal(result.status, 200);
    const consumerCall = seen.find(call => call.pathname === "/api/ai/consumer" && call.body.operation === "memory-recall");
    assert.ok(consumerCall, `expected a memory-recall call for candidate ${JSON.stringify(candidate)}`);
    assert.equal(Object.hasOwn(consumerCall!.body, "singleShopRestricted"), false, `candidate ${JSON.stringify(candidate)} must not set the restriction`);
  }
});
