import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json", import.meta.url);

test("Cookie 直连 n8n 副本保持货品前置四段式、上海时区和凭证隔离", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    id: string;
    active: boolean;
    settings: { timezone?: string };
    nodes: Array<{ name: string; type: string; parameters?: { command?: string; rule?: unknown } }>;
    connections: Record<string, { main?: Array<Array<{ node?: string }>> }>;
  };
  assert.equal(workflow.id, "M4xY8kQ2vR6sT9pC");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.manualTrigger"));
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const requestNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requestNodes.map((node) => (node.parameters as { url?: string }).url), [
    "http://127.0.0.1:5791/product-master",
    "http://127.0.0.1:5791/plan",
    "http://127.0.0.1:5791/fetch",
    "http://127.0.0.1:5791/import",
  ]);
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  assert.match(raw, /导出全部商品/);
  assert.match(raw, /重要通知/);
  assert.match(raw, /商品管家/);
  assert.doesNotMatch(raw, /批量导出表格/);
  assert.equal(workflow.connections["手动运行"]?.main?.[0]?.[0]?.node, "M·商品管家批量导出、校验并导入");
  assert.equal(workflow.connections["每天 08:40-18:40 每小时补跑"]?.main?.[0]?.[0]?.node, "M·商品管家批量导出、校验并导入");
  assert.equal(workflow.connections["M·商品管家批量导出、校验并导入"]?.main?.[0]?.[0]?.node, "A·算缺哪些日期");
  assert.doesNotMatch(raw, /--(?:username|password|cookie)\b|TMALL_(?:USERNAME|PASSWORD)\b|Cookie:\s*[^`\n]/i);
  assert.doesNotMatch(raw, /localhost:8000|teruisi123|_tb_token_=|cookie2=/i);
});
