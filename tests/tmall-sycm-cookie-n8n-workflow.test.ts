import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json", import.meta.url);

test("Cookie 直连 n8n 副本保持三段式、上海时区和凭证隔离", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    id: string;
    active: boolean;
    settings: { timezone?: string };
    nodes: Array<{ name: string; type: string; parameters?: { command?: string; rule?: unknown } }>;
  };
  assert.equal(workflow.id, "M4xY8kQ2vR6sT9pC");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.manualTrigger"));
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const requestNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requestNodes.map((node) => (node.parameters as { url?: string }).url), [
    "http://127.0.0.1:5791/plan",
    "http://127.0.0.1:5791/fetch",
    "http://127.0.0.1:5791/import",
  ]);
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  assert.doesNotMatch(raw, /--(?:username|password|cookie)\b|TMALL_(?:USERNAME|PASSWORD)\b|Cookie:\s*[^`\n]/i);
  assert.doesNotMatch(raw, /localhost:8000|teruisi123|_tb_token_=|cookie2=/i);
});
