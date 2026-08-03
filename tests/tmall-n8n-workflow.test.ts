import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/tmall-yijiu-sycm-daily-import.workflow.json", import.meta.url);

test("n8n 工作流固定上海时区、独立店铺目录且不包含登录凭据", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    id: string;
    active: boolean;
    settings: { timezone?: string };
    nodes: Array<{ type: string; parameters?: { path?: string; command?: string } }>;
  };
  assert.equal(workflow.id, "cF7wN8k2pQ5sR1vX");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.localFileTrigger"
    && node.parameters?.path === "D:\\谷歌浏览器\\tmall-yijiu"));
  const commands = workflow.nodes.map((node) => node.parameters?.command ?? "").join("\n");
  assert.match(commands, /tmall:daily:import/);
  assert.match(commands, /tmall-n8n-receipt-import\.ts/);
  assert.doesNotMatch(commands, /sycm:(?:browser|daily)/);
  assert.doesNotMatch(raw, /--(?:username|password)\b|TMALL_(?:USERNAME|PASSWORD)|"credentials"\s*:/i);
});
