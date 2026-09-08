import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { aiConsumer, isPublicAiPath, requestDjangoAi } from "../lib/django/ai-service";
import { validateToolArguments, validateToolRegistry } from "../lib/ai/tool-registry-contract";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });

const { aiToolRegistry, getOpenAiTools, getAnthropicTools, getToolsForPrincipal, executeRegisteredToolCall } = await import("../lib/ai/tool-registry");
const principal = { email: "dataset@example.invalid", displayName: "测试", role: "viewer" as const, scope: null };
const environment = {
  TERUISI_DJANGO_INTERNAL_SECRET: "isolated-dataset-transport-secret-abcdefghijklmnopqrstuvwxyz",
  TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111",
  TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112",
};

test("every explicit dataset resolves to a bounded, callable, read-only central entry", async () => {
  validateToolRegistry(aiToolRegistry);
  const source = await readFile(new URL("../backend/ai_assistant/datasets.py", import.meta.url), "utf8");
  const specs = [...source.matchAll(/^    "([a-z_]+)": \("([a-z_]+)", "([a-z_]+)", (\{[^\n]*\})\),$/gm)];
  assert.equal(specs.length, 24);
  assert.equal(new Set(specs.map(v => v[1])).size, 24);
  for (const [, id, name, , selectors] of specs) {
    const entry = aiToolRegistry.find(v => v.name === name);
    assert.ok(entry, id);
    assert.equal(entry.risk, "read_only");
    assert.equal(typeof entry.handler, "function");
    assert.ok(entry.execution.timeoutMs <= 30_000);
    assert.ok(entry.execution.maxResultCharacters <= 40_000);
    assert.ok(!["describe_system_datasets", "query_system_dataset"].includes(name));
    const properties = entry.inputSchema.properties as Record<string, { enum?: string[] }>;
    for (const [key, value] of Object.entries(JSON.parse(selectors))) {
      assert.ok(properties[key]?.enum?.includes(value as string), `${id}.${key}`);
    }
  }
});

test("dataset tools share provider schemas, principal filtering and strict input limits", () => {
  for (const role of ["viewer", "analyst", "operator", "admin"] as const) {
    const actor = { ...principal, role };
    for (const scope of [null, { warehouses: [], channels: ["京东-测试"], platforms: ["京东"] }]) {
      const scoped = { ...actor, scope };
      const openai = getOpenAiTools(scoped, "ai_chat");
      const anthropic = getAnthropicTools(scoped, "ai_chat");
      for (const name of ["describe_system_datasets", "query_system_dataset"]) {
        const a = openai.find(v => v.function.name === name)!;
        const b = anthropic.find(v => v.name === name)!;
        assert.deepEqual(a.function.parameters, b.input_schema);
        assert.equal(a.function.parameters.additionalProperties, false);
      }
    }
  }
  assert.ok(!getToolsForPrincipal(principal, "market_ai").some(v => v.name === "query_system_dataset"));
  const entry = aiToolRegistry.find(v => v.name === "query_system_dataset")!;
  for (const args of [{ dataset: "sales_summary", queryJson: "{}", role: "admin" },
    { dataset: "../consumer", queryJson: "{}" }, { dataset: "sales_summary", queryJson: "x".repeat(8001) }]) {
    assert.throws(() => validateToolArguments(args, entry.inputSchema));
  }
});

test("public and AI dataset calls select reader, bind identity and support cancellation", async () => {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return Response.json({ items: [] }, { headers: { "x-ai-revision": "7" } });
  };
  for (const path of ["/api/ai/datasets", "/api/ai/datasets/sales_summary", "/api/ai/datasets/sales_summary/query"]) {
    assert.equal(isPublicAiPath(path), true);
    await requestDjangoAi(principal, { path, ...(path.endsWith("/query") ? { method: "POST" as const, payload: { query: {} } } : {}) }, { environment, fetchImpl });
  }
  for (const operation of ["datasets-describe", "datasets-query"]) {
    await aiConsumer(principal, { operation }, { environment, fetchImpl });
  }
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(new URL(call.url).port, "18111");
    assert.deepEqual(JSON.parse(Buffer.from(call.headers.get("x-teruisi-principal")!, "base64url").toString()), principal);
  }
  for (const path of ["/api/ai/datasets/a/query/extra", "/api/ai/datasets/a/delete", "/api/ai/datasets/../consumer"]) {
    assert.equal(isPublicAiPath(path), false);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/datasets" }, { environment, fetchImpl, signal: controller.signal }));
  assert.equal(calls.length, 5);
});

test("dataset execution refuses unavailable audit and invalid arguments before calling the handler", async () => {
  const context = { principal, surface: "ai_chat" as const, requestId: "dataset-audit" };
  const result = await executeRegisteredToolCall("query_system_dataset", { dataset: "sales_summary", queryJson: "{}" }, context, {
    audit: async () => { throw new Error("fixture audit offline"); },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.auditStatus, "unavailable");
  const invalid = await executeRegisteredToolCall("query_system_dataset", { dataset: "sales_summary", queryJson: "{}", role: "admin" }, context, { audit: async () => {} });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "invalid_arguments");
});

test("registered dataset handlers forward validated input to Django with real identity and audited results", async (t) => {
  const oldEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls: Request[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return Response.json({ dataset: "sales_summary", data: { total: 100, returned: 1, truncated: true } }, { headers: { "x-ai-revision": "8" } });
  };
  const audited: string[] = [];
  const context = { principal, surface: "ai_chat" as const, requestId: "dataset-handler-test" };
  const result = await executeRegisteredToolCall("query_system_dataset", { dataset: "sales_summary", queryJson: "{}" }, context, {
    audit: async input => { audited.push(input.status); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(audited, ["started", "succeeded"]);
  assert.deepEqual(await calls[0].json(), { operation: "datasets-query", dataset: "sales_summary", queryJson: "{}" });
  assert.equal(calls[0].headers.get("x-teruisi-request-id"), context.requestId);
  assert.equal(new URL(calls[0].url).port, "18111");
  if (result.ok) assert.deepEqual(result.data.data, { total: 100, returned: 1, truncated: true });
  await executeRegisteredToolCall("describe_system_datasets", { dataset: "sales_summary" }, context, { audit: async () => {} });
  assert.deepEqual(await calls[1].json(), { operation: "datasets-describe", dataset: "sales_summary" });
});
