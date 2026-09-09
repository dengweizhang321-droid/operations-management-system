import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeToolCallWithRegistry, type AiToolEntry } from "../lib/ai/tool-registry-contract";

test("DingTalk opt-in is confined to seven read-only business tools", async () => {
  const source = await readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8");
  const entries = source.split(/\n  \{\n    name: /).slice(1);
  const names = entries.filter(entry => /execution:.*dingTalkReadOnlyExecution/.test(entry)).map(entry => entry.match(/^"([^"]+)"/)![1]).sort();
  assert.deepEqual(names, ["get_data_freshness", "get_sales_summary", "get_sales_category_analysis", "get_inventory_health", "get_inventory_page_data", "get_netshop_performance", "get_netshop_page_data"].sort());
  for (const entry of entries.filter(entry => /execution:.*dingTalkReadOnlyExecution/.test(entry))) {
    assert.match(entry, /risk: "read_only"/);
  }
});

test("a model cannot execute a web-only tool from the DingTalk surface", async () => {
  let executed = false;
  const entry: AiToolEntry = {
    name: "search_personal_memory", title: "Private", description: "Private",
    risk: "read_only", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    allowedRoles: ["admin"], scopePolicy: "unscoped_only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execution: { environment: "worker_inline", mode: "direct", allowedSurfaces: ["ai_chat"], timeoutMs: 1000, maxResultCharacters: 1000, maxCallsPerRequest: 1 },
    handler: async () => { executed = true; return {}; },
  };
  const result = await executeToolCallWithRegistry(entry.name, {}, {
    principal: { email: "fixture@example.invalid", displayName: "Fixture", role: "admin", scope: null },
    surface: "dingtalk_chat", requestId: "ding-fixture",
  }, { entries: [entry], audit: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(executed, false);
});
