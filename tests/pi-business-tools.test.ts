import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { validateToolArguments, validateToolRegistry } from "../lib/ai/tool-registry-contract";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry, getToolsForPrincipal, getOpenAiTools, getAnthropicTools } = await import("../lib/ai/tool-registry");
const actor = { email: "business@example.invalid", displayName: "合成操作员", role: "operator" as const, scope: null };
const names = ["prepare_pi_work_plan", "prepare_pi_replenishment_draft", "prepare_pi_gap_execution", "prepare_pi_report_delivery"];

test("business tools have matching provider schemas, one explicit surface and no authority in ordinary chat", () => {
  validateToolRegistry(aiToolRegistry);
  const available = getToolsForPrincipal(actor, "pi_business").map(item => item.name);
  for (const name of names) {
    assert.ok(available.includes(name));
    const entry = aiToolRegistry.find(item => item.name === name)!;
    assert.equal(entry.risk, "write");
    assert.equal(entry.execution.mode, "background_job");
    assert.deepEqual(entry.execution.allowedSurfaces, ["pi_business"]);
    assert.deepEqual(getOpenAiTools(actor, "pi_business").find(item => item.function.name === name)?.function.parameters,
      getAnthropicTools(actor, "pi_business").find(item => item.name === name)?.input_schema);
    for (const surface of ["ai_chat", "pi_agent", "dingtalk_chat"] as const)
      assert.ok(!getToolsForPrincipal(actor, surface).some(item => item.name === name));
    assert.ok(!getToolsForPrincipal({ ...actor, role: "analyst" }, "pi_business").some(item => item.name === name));
    assert.throws(() => validateToolArguments({ userIntentId: "i", url: "https://example.invalid", ownerEmail: "forged" }, entry.inputSchema));
  }
});

test("business prepare refuses a model-only or ephemeral gateway context before transport", async () => {
  for (const name of names) {
    const entry = aiToolRegistry.find(item => item.name === name)!;
    for (const extra of [{ surface: "ai_chat" }, { persistentPiGateway: false }, { providerCallId: undefined }]) {
      await assert.rejects(entry.handler({}, { principal: actor, surface: "pi_business", requestId: "parent-op",
        providerCallId: "stable-invoke", persistentPiGateway: true, ...extra } as never),
      (error: unknown) => (error as { code?: string }).code === "forbidden");
    }
  }
});
