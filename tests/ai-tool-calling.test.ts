import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AppPrincipal } from "../lib/auth/authorization";
import {
  executeToolCallWithRegistry,
  getAnthropicTools,
  getOpenAiTools,
  getVisibleToolCatalog,
  parseToolArguments,
  validateToolRegistry,
  type AiToolEntry,
} from "../lib/ai/tool-registry-contract";
import {
  AI_TOOL_SYSTEM_PROMPT,
  ToolLoopLimitError,
  runAnthropicToolLoop,
  runOpenAiCompatibleToolLoop,
} from "../lib/ai/tool-loop";
import { runSequentialBatchWithinBudget } from "../lib/ai/mcp-execution-budget";
import { BoundedFetchError, fetchBoundedJson } from "../lib/ai/bounded-fetch";

const viewer: AppPrincipal = {
  email: "viewer@example.com",
  displayName: "Viewer",
  role: "viewer",
  scope: null,
};
const admin: AppPrincipal = { ...viewer, email: "admin@example.com", role: "admin" };
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const schema = { type: "object", properties: {}, additionalProperties: false } as const;
const fakeEntries = [
  {
    name: "public_lookup",
    title: "Public lookup",
    description: "Returns a bounded public result with returned and truncated fields.",
    inputSchema: schema,
    annotations,
  risk: "read_only",
  allowedRoles: ["viewer", "admin"],
  supportsScopedPrincipal: true,
    handler: async () => ({ returned: 1, truncated: false }),
  },
  {
    name: "admin_lookup",
    title: "Admin lookup",
    description: "Returns a bounded admin result with returned and truncated fields.",
    inputSchema: schema,
    annotations,
  risk: "read_only",
  allowedRoles: ["admin"],
  supportsScopedPrincipal: true,
    handler: async () => ({ returned: 1, truncated: false }),
  },
] satisfies readonly AiToolEntry[];

test("registry validation rejects duplicates and incomplete schema contracts", () => {
  validateToolRegistry(fakeEntries);
  assert.throws(
    () => validateToolRegistry([fakeEntries[0], { ...fakeEntries[1], name: "public_lookup" }]),
    /重复/,
  );
  assert.throws(
    () => validateToolRegistry([{ ...fakeEntries[0], inputSchema: { ...schema, additionalProperties: true } } as unknown as AiToolEntry]),
    /额外参数/,
  );
  assert.throws(
    () => validateToolRegistry([{ ...fakeEntries[0], handler: undefined } as unknown as AiToolEntry]),
    /handler/,
  );
});

test("one registry entry set derives role-filtered provider schemas and catalog", () => {
  assert.deepEqual(getOpenAiTools(viewer, fakeEntries).map((item) => item.function.name), ["public_lookup"]);
  assert.deepEqual(getAnthropicTools(viewer, fakeEntries).map((item) => item.name), ["public_lookup"]);
  assert.deepEqual(getVisibleToolCatalog(viewer, fakeEntries).map((item) => item.name), ["public_lookup"]);
  assert.deepEqual(getOpenAiTools(admin, fakeEntries).map((item) => item.function.name), ["public_lookup", "admin_lookup"]);
  assert.equal(getOpenAiTools(viewer, fakeEntries)[0].function.parameters, fakeEntries[0].inputSchema);
  assert.equal(getAnthropicTools(viewer, fakeEntries)[0].input_schema, fakeEntries[0].inputSchema);
  const scopedViewer = { ...viewer, scope: { warehouses: ["华东仓"], channels: [], platforms: [] } };
  const unsafeForScope: AiToolEntry = { ...fakeEntries[0], name: "broad_lookup", supportsScopedPrincipal: false };
  assert.deepEqual(getOpenAiTools(scopedViewer, [unsafeForScope, fakeEntries[0]]).map((item) => item.function.name), ["public_lookup"]);
});

test("execution rejects model-claimed privilege and malformed arguments", async () => {
  const context = { principal: viewer, surface: "test", requestId: "request-role" } as const;
  const audits: Array<Record<string, unknown>> = [];
  const forbidden = await executeToolCallWithRegistry("admin_lookup", {}, context, {
    entries: fakeEntries,
    audit: async (input) => { audits.push(input); },
  });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.error.code, "forbidden");
  assert.equal(audits[0].actorEmail, viewer.email);
  assert.equal(audits[0].actorRole, "viewer");

  const malformed = await executeToolCallWithRegistry("public_lookup", "{bad json", context, {
    entries: fakeEntries,
    audit: async () => undefined,
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error.code, "invalid_arguments");
  assert.throws(() => parseToolArguments("[]"), /JSON 对象/);
});

test("every tool fails closed before its handler when audit storage is unavailable", async () => {
  let called = false;
  const entry: AiToolEntry = {
    ...fakeEntries[0],
    handler: async () => { called = true; return { returned: 1, truncated: false }; },
  };
  const result = await executeToolCallWithRegistry("public_lookup", {}, {
    principal: viewer,
    surface: "test",
    requestId: "request-audit-failure",
  }, {
    entries: [entry],
    audit: async () => { throw new Error("audit unavailable"); },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "audit_unavailable");
    assert.equal(result.auditStatus, "unavailable");
  }
  assert.equal(called, false);
});

test("a missing completion audit never returns handler data", async () => {
  let auditCalls = 0;
  const result = await executeToolCallWithRegistry("public_lookup", {}, {
    principal: viewer,
    surface: "test",
    requestId: "request-completion-audit-failure",
  }, {
    entries: fakeEntries,
    audit: async () => {
      auditCalls += 1;
      if (auditCalls > 1) throw new Error("completion audit unavailable");
    },
  });
  assert.equal(auditCalls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "audit_unavailable");
    assert.equal(Object.hasOwn(result, "data"), false);
  }
});

test("runtime validates the complete registered JSON schema before invoking a handler", async () => {
  let called = false;
  const entry: AiToolEntry = {
    ...fakeEntries[0],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 5 },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async () => { called = true; return {}; },
  };
  const result = await executeToolCallWithRegistry("public_lookup", { query: "x", limit: 99 }, {
    principal: viewer, surface: "test", requestId: "schema-runtime",
  }, { entries: [entry], audit: async () => undefined });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_arguments");
  assert.equal(called, false);
});

test("write and dangerous tools fail closed when audit preflight is unavailable", async () => {
  let called = false;
  const entry: AiToolEntry = {
    ...fakeEntries[1],
    name: "sensitive_action",
    risk: "write",
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    handler: async () => { called = true; return {}; },
  };
  const result = await executeToolCallWithRegistry(entry.name, {}, {
    principal: admin, surface: "test", requestId: "audit-preflight",
  }, { entries: [entry], audit: async () => { throw new Error("down"); } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "audit_unavailable");
  assert.equal(called, false);
});

test("MCP timeout waits for settlement and never starts later batch tools", async () => {
  let active = 0;
  let peakActive = 0;
  const started: string[] = [];
  const results = await runSequentialBatchWithinBudget({
    items: ["slow", "must-not-start", "also-not-start"],
    totalBudgetMs: 100,
    perItemTimeoutMs: 5,
    operation: async (item, signal) => {
      started.push(item);
      active += 1;
      peakActive = Math.max(peakActive, active);
      assert.equal(signal.aborted, false);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(signal.aborted, true);
      active -= 1;
      return `completed:${item}`;
    },
    notStarted: (item, reason) => `${reason}:${item}`,
  });
  assert.deepEqual(started, ["slow"]);
  assert.equal(active, 0);
  assert.equal(peakActive, 1);
  assert.deepEqual(results, [
    "item_timeout:slow",
    "prior_timeout:must-not-start",
    "prior_timeout:also-not-start",
  ]);
});

test("registry propagates cooperative abort state before handler execution", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const entry: AiToolEntry = { ...fakeEntries[0], handler: async () => { called = true; return {}; } };
  const result = await executeToolCallWithRegistry(entry.name, {}, {
    principal: viewer, surface: "test", requestId: "already-aborted", signal: controller.signal,
  }, { entries: [entry], audit: async () => undefined });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "tool_cancelled");
  assert.equal(called, false);
});

test("model JSON fetch limits declared and streamed response bytes", async () => {
  await assert.rejects(
    fetchBoundedJson({
      url: "https://model.example/v1/chat/completions",
      init: {}, timeoutMs: 100, maxBytes: 8,
      fetcher: async () => new Response("123456789", { headers: { "content-length": "9" } }),
    }),
    (error: unknown) => error instanceof BoundedFetchError && error.code === "response_too_large",
  );
  await assert.rejects(
    fetchBoundedJson({
      url: "https://model.example/v1/chat/completions",
      init: {}, timeoutMs: 100, maxBytes: 8,
      fetcher: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("1234"));
          controller.enqueue(new TextEncoder().encode("56789"));
          controller.close();
        },
      })),
    }),
    (error: unknown) => error instanceof BoundedFetchError && error.code === "response_too_large",
  );
});

test("model timeout remains active while the response body is pending", async () => {
  await assert.rejects(
    fetchBoundedJson({
      url: "https://model.example/v1/chat/completions",
      init: {}, timeoutMs: 5, maxBytes: 100,
      fetcher: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      })),
    }),
    (error: unknown) => error instanceof BoundedFetchError && error.code === "timeout",
  );
});

test("OpenAI-compatible loop preserves tool call id and feeds role=tool result back", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let executed = 0;
  const reply = await runOpenAiCompatibleToolLoop({
    messages: [{ role: "user", content: "查库存" }],
    tools: [{ type: "function", function: { name: "public_lookup" } }],
    request: async (body) => {
      requests.push(structuredClone(body));
      return requests.length === 1
        ? { choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "public_lookup", arguments: "{}" } }] } }] }
        : { choices: [{ message: { content: "已完成" } }] };
    },
    executeTool: async (name, rawArguments) => {
      executed += 1;
      assert.equal(name, "public_lookup");
      assert.deepEqual(parseToolArguments(rawArguments), {});
      return { ok: true, toolName: name, data: { returned: 1 } };
    },
  });
  assert.equal(reply, "已完成");
  assert.equal(executed, 1);
  const secondMessages = requests[1].messages as Array<Record<string, unknown>>;
  const toolMessage = secondMessages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.tool_call_id, "call-1");
  assert.match(String(toolMessage?.content), /"returned":1/);
});

test("Anthropic loop preserves tool_use id and feeds a user tool_result block back", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const reply = await runAnthropicToolLoop({
    messages: [{ role: "user", content: "查商品" }],
    tools: [{ name: "public_lookup", input_schema: schema }],
    request: async (body) => {
      requests.push(structuredClone(body));
      return requests.length === 1
        ? { content: [{ type: "tool_use", id: "use-1", name: "public_lookup", input: {} }], stop_reason: "tool_use" }
        : { content: [{ type: "text", text: "查询完成" }], stop_reason: "end_turn" };
    },
    executeTool: async (name) => ({ ok: true, toolName: name, data: { returned: 2 } }),
  });
  assert.equal(reply, "查询完成");
  const secondMessages = requests[1].messages as Array<Record<string, unknown>>;
  const resultMessage = secondMessages.at(-1);
  const blocks = resultMessage?.content as Array<Record<string, unknown>>;
  assert.equal(resultMessage?.role, "user");
  assert.equal(blocks[0].type, "tool_result");
  assert.equal(blocks[0].tool_use_id, "use-1");
});

test("tool loop enforces per-round limits and keeps no-tool legacy answers", async () => {
  await assert.rejects(
    runOpenAiCompatibleToolLoop({
      messages: [{ role: "user", content: "loop" }],
      tools: [{ type: "function" }],
      request: async () => ({
        choices: [{
          message: {
            tool_calls: Array.from({ length: 5 }, (_, index) => ({
              id: `call-${index}`,
              function: { name: "public_lookup", arguments: "{}" },
            })),
          },
        }],
      }),
      executeTool: async (name) => ({ ok: true, toolName: name, data: {} }),
    }),
    ToolLoopLimitError,
  );

  let requests = 0;
  const plain = await runOpenAiCompatibleToolLoop({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    request: async (body) => {
      requests += 1;
      assert.equal(Object.hasOwn(body, "tools"), false);
      return { choices: [{ message: { content: "普通回答" } }] };
    },
    executeTool: async () => { throw new Error("must not execute"); },
  });
  assert.equal(plain, "普通回答");
  assert.equal(requests, 1);
});

test("production registry keeps all existing operations tools plus global system search", async () => {
  const [registry, apiRoute, assistant, operations, searchHandler, mcp] = await Promise.all([
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/tools/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/assistant-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/operations-tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/search/ai-tool.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mcp/route.ts", import.meta.url), "utf8"),
  ]);
  for (const name of [
    "get_data_freshness",
    "get_sales_summary",
    "get_inventory_health",
    "get_product_performance",
    "list_replenishment_plans",
    "get_customer_service_conversations",
    "search_system_data",
  ]) assert.match(registry, new RegExp(`name: "${name}"`));
  assert.match(registry, /validateToolRegistry\(aiToolRegistry\)/);
  assert.match(apiRoute, /getVisibleToolCatalog/);
  assert.match(mcp, /getVisibleToolCatalog/);
  assert.match(mcp, /executeRegisteredToolCall/);
  assert.match(mcp, /MAX_BATCH_REQUESTS = 20/);
  assert.match(mcp, /MAX_BATCH_DURATION_MS/);
  assert.match(mcp, /mcp-\$\{digest\.slice/);
  assert.doesNotMatch(mcp, /BOOTSTRAP_ADMIN_EMAIL/);
  assert.match(assistant, /getOpenAiTools/);
  assert.match(assistant, /getAnthropicTools/);
  assert.doesNotMatch(operations, /operationsToolNames/);
  assert.doesNotMatch(searchHandler, /ToolDefinition|inputSchema/);
  assert.match(AI_TOOL_SYSTEM_PROMPT, /get_data_freshness/);
  assert.match(AI_TOOL_SYSTEM_PROMPT, /filtersApplied/);
  assert.match(AI_TOOL_SYSTEM_PROMPT, /人民币分/);
  assert.match(AI_TOOL_SYSTEM_PROMPT, /truncated/);
});
