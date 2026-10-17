import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { validateToolArguments, validateToolRegistry } from "../lib/ai/tool-registry-contract";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry, getToolsForPrincipal, getOpenAiTools, getAnthropicTools, executeRegisteredToolCall } = await import("../lib/ai/tool-registry");
const actor = { email: "pi-fixture@example.invalid", displayName: "Fixture", role: "analyst" as const, scope: null };

test("Pi explicitly admits its reviewed read tools without inheriting legacy agent or future entries", () => {
  validateToolRegistry(aiToolRegistry);
  const names = getToolsForPrincipal(actor, "pi_agent").map(item => item.name);
  for (const name of ["start_pi_dataset_export", "get_pi_dataset_export", "describe_system_datasets", "query_system_dataset", "get_data_freshness", "get_sales_summary", "get_inventory_health", "get_netshop_performance"]) assert.ok(names.includes(name), name);
  for (const name of ["run_pandas_analysis", "search_personal_memory", "get_customer_service_conversations", "get_workflow_page_data", "get_automation_run_status"]) assert.ok(!names.includes(name), name);
  const existing = aiToolRegistry.find(item => item.name === "get_sales_summary")!;
  const future = { ...existing, name: "future_tool", execution: { ...existing.execution, allowedSurfaces: ["ai_agent" as const] } };
  assert.deepEqual(getToolsForPrincipal(actor, "pi_agent", [future]), []);
  assert.ok(!getToolsForPrincipal({ ...actor, role: "viewer" }, "pi_agent").some(item => item.name === "start_pi_dataset_export"));
  assert.ok(!getToolsForPrincipal({ ...actor, role: "admin", scope: { warehouses: [], channels: ["fixture"], platforms: [] } }, "pi_agent").some(item => item.name === "get_system_dataset_records"));
  for (const entry of getToolsForPrincipal(actor, "pi_agent")) {
    assert.equal(entry.risk, "read_only");
    assert.deepEqual(getOpenAiTools(actor, "pi_agent").find(item => item.function.name === entry.name)?.function.parameters,
      getAnthropicTools(actor, "pi_agent").find(item => item.name === entry.name)?.input_schema);
  }
});

test("Pi export rejects paths, identity injection and unavailable audit before dispatch", async () => {
  const entry = aiToolRegistry.find(item => item.name === "start_pi_dataset_export")!;
  const args = { dataset: "inventory_health", queryJson: "{}" };
  validateToolArguments(args, entry.inputSchema);
  for (const extra of [{ path: "/etc/passwd" }, { ownerEmail: "other@example.invalid" }, { surface: "ai_chat" }, { sql: "SELECT 1" }, { sessionId: "other" }, { operationId: "other" }]) assert.throws(() => validateToolArguments({ ...args, ...extra }, entry.inputSchema));
  let called = 0;
  const result = await executeRegisteredToolCall(entry.name, args, { principal: actor, surface: "pi_agent", requestId: "pi-audit-fixture" }, {
    entries: [{ ...entry, handler: async () => { called++; return {}; } }], audit: async () => { throw Error("audit down"); },
  });
  assert.equal(result.ok, false);
  assert.equal(called, 0);
});

test("nested Pi dataset discovery, query and export preserve surface and true principal over signed transport", async t => {
  const savedFetch = globalThis.fetch;
  const env = { TERUISI_DJANGO_INTERNAL_SECRET: "isolated-pi-transport-secret-abcdefghijklmnopqrstuvwxyz", TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112" };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { globalThis.fetch = savedFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const operations: string[] = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(String(url), `http://127.0.0.1:${payload.operation.startsWith("datasets-") ? "18111" : "18112"}/api/ai/consumer`);
    assert.equal(payload.surface, "pi_agent");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("x-teruisi-signature")!, /^v1=[a-f0-9]{64}$/);
    const encoded = headers.get("x-teruisi-principal")!.replaceAll("-", "+").replaceAll("_", "/");
    assert.equal(JSON.parse(Buffer.from(encoded, "base64").toString()).email, actor.email);
    operations.push(payload.operation);
    if (payload.operation === "pi-export-start") assert.equal(payload.operationId, "pi-start_pi_dataset_export");
    return Response.json({ exportId: "fixture" }, { headers: { "x-ai-revision": "1" } });
  };
  for (const [name, args] of [["describe_system_datasets", {}], ["query_system_dataset", { dataset: "inventory_health", queryJson: "{}" }], ["start_pi_dataset_export", { dataset: "inventory_health", queryJson: "{}" }], ["get_pi_dataset_export", { exportId: "fixture" }]] as const) {
    const entry = aiToolRegistry.find(item => item.name === name)!;
    await entry.handler(args, { principal: actor, surface: "pi_agent", requestId: `pi-${name}` });
  }
  assert.deepEqual(operations, ["datasets-describe", "datasets-query", "pi-export-start", "pi-export-status"]);
});

test("Pi paged netshop reader preserves domain pagination and rejects unsupported scope before transport", async t => {
  const savedFetch = globalThis.fetch;
  const env = { TERUISI_DJANGO_INTERNAL_SECRET: "isolated-pi-netshop-secret-abcdefghijklmnopqrstuvwxyz", TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "http://127.0.0.1:18021", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "http://127.0.0.1:18022" };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { globalThis.fetch = savedFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let calls = 0;
  const entry = aiToolRegistry.find(item => item.name === "get_pi_netshop_performance_page")!;
  const pagination = { page: 2, pageSize: 20, total: 45, truncated: true };
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, env.TERUISI_DJANGO_NETSHOP_READER_BASE_URL);
    assert.equal(url.pathname, "/api/netshop/promotion-performance");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("pageSize"), "20");
    assert.equal(url.searchParams.get("outlet"), "京东\u001f测试店");
    assert.match(new Headers(init?.headers).get("x-teruisi-signature")!, /^v1=[a-f0-9]{64}$/);
    return Response.json({ items: [{ sku: "fixture", spend: 1234 }], pagination, monetaryUnit: "CNY_CENT", dataCutoffDate: "2026-10-16" }, { headers: { "x-netshop-data-revision": "7:aaaaaaaaaaaa" } });
  };
  const args = { dataset: "promotion", platform: "京东", shop: "测试店", page: 2, limit: 20 };
  const result = await entry.handler(args, { principal: actor, surface: "pi_agent", requestId: "page-fixture" });
  assert.deepEqual(result.pagination, pagination);
  assert.equal(result.consistency, "live_per_page");
  assert.equal(result.dataCutoffDate, "2026-10-16");
  assert.equal(result.sourceRevision, "7:aaaaaaaaaaaa");
  const scoped = { ...actor, scope: { warehouses: ["no-attribution"], channels: [], platforms: ["京东"] } };
  await assert.rejects(entry.handler(args, { principal: scoped, surface: "pi_agent", requestId: "deny-fixture" }));
  assert.equal(calls, 1);
});
