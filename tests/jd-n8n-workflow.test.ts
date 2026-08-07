import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/jd-multi-store-daily.workflow.json", import.meta.url);

test("JD n8n copy is inactive, uses 09:30 Shanghai loopback A/B/C stages, and contains no credentials", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    active: boolean; settings: { timezone?: string }; nodes: Array<{ name: string; type: string; parameters?: { url?: string; options?: { timeout?: number }; rule?: { interval?: Array<{ expression?: string }> }; sendHeaders?: boolean; headerParameters?: { parameters?: Array<{ name?: string; value?: string }> } } }>;
  };
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  const schedule = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedule?.parameters?.rule?.interval?.[0]?.expression, "30 9 * * *");
  const requests = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requests.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jd/plan", "http://127.0.0.1:5791/jd/run", "http://127.0.0.1:5791/jd/verify",
  ]);
  for (const request of requests) {
    assert.equal(request.parameters?.sendHeaders, true);
    assert.deepEqual(request.parameters?.headerParameters?.parameters, [{ name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" }]);
  }
  assert.equal(requests[1]?.parameters?.options?.timeout, 21_600_000);
  assert.match(raw, /昨天所在月 1 日至昨天/);
  assert.match(raw, /旧执行、跨执行接管、乱序和并发/);
  assert.doesNotMatch(raw, /(?:password|cookie|token|session|profileDir)\s*[:=]/i);
});
