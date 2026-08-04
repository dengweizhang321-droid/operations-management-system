import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/jackyun-five-dataset-daily.workflow.json", import.meta.url);

test("Jackyun n8n copy uses inactive loopback HTTP stages and the fixed five-module contract", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    id: string;
    name: string;
    active: boolean;
    settings: { timezone?: string };
    nodes: Array<{
      name: string;
      type: string;
      parameters?: { url?: string; options?: { timeout?: number }; rule?: unknown };
    }>;
    connections: Record<string, { main?: Array<Array<{ node?: string }>> }>;
  };

  assert.equal(workflow.id, "J8kY2mQ5vR7sT4pN");
  assert.equal(workflow.name, "吉客云五类数据每日导入");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.manualTrigger"));
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  const requestNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requestNodes.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jackyun/plan",
    "http://127.0.0.1:5791/jackyun/run",
    "http://127.0.0.1:5791/jackyun/verify",
  ]);
  assert.equal(requestNodes[1]?.parameters?.options?.timeout, 5_400_000);
  assert.equal(workflow.connections["手动运行"]?.main?.[0]?.[0]?.node, "A·生成今日安全计划");
  assert.equal(workflow.connections["A·生成今日安全计划"]?.main?.[0]?.[0]?.node, "B·五类串行下载、导入并回查");
  assert.equal(workflow.connections["B·五类串行下载、导入并回查"]?.main?.[0]?.[0]?.node, "C·核验五类清单与精确批次");
  assert.match(raw, /products → inventory → inventory_age → sales → combos/);
  assert.doesNotMatch(raw, /localhost:8000|\/Users\/hubo|executeCommand|--(?:username|password|cookie|token)\b/i);
});
