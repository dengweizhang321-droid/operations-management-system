import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JD logistics inactive workflow owns the full manual/scheduled claim A B C D release chain", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jd-logistics-daily.workflow.json", import.meta.url), "utf8"));
  const nodes = workflow.nodes as Array<{ name: string; type: string; onError?: string; parameters: Record<string, unknown> }>;
  const routes = new Map(nodes.filter(node => node.type === "n8n-nodes-base.httpRequest").map(node => [String(node.parameters.url).replace("http://127.0.0.1:5791", ""), node]));
  assert.equal(workflow.active, false); assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.equal(nodes.filter(node => node.type === "n8n-nodes-base.manualTrigger").length, 1);
  assert.equal(nodes.filter(node => node.type === "n8n-nodes-base.scheduleTrigger").length, 1);
  const claim = routes.get("/coordination/claim")!;
  for (const node of nodes.filter(n => n.type === "n8n-nodes-base.manualTrigger" || n.type === "n8n-nodes-base.scheduleTrigger")) {
    assert.equal(workflow.connections[node.name].main[0][0].node, claim.name);
  }
  const releases = nodes.filter(node => node.parameters.url === "http://127.0.0.1:5791/jd-logistics/release");
  assert.equal(releases.length, 2);
  for (const route of ["plan", "run", "verify", "notify"]) {
    const node = routes.get(`/jd-logistics/${route}`)!;
    assert.equal(node.onError, "continueErrorOutput");
    assert.equal(workflow.connections[node.name].main[1][0].node, "失败后释放原执行 helper");
  }
  assert.equal(workflow.connections[routes.get("/jd-logistics/plan")!.name].main[0][0].node, routes.get("/jd-logistics/run")!.name);
  assert.equal(workflow.connections[routes.get("/jd-logistics/run")!.name].main[0][0].node, routes.get("/jd-logistics/verify")!.name);
  assert.equal(workflow.connections[routes.get("/jd-logistics/verify")!.name].main[0][0].node, routes.get("/jd-logistics/notify")!.name);
  assert.equal(workflow.connections[routes.get("/jd-logistics/notify")!.name].main[0][0].node, "成功后释放 helper");
  assert.equal(workflow.connections["失败后释放原执行 helper"].main[0][0].node, "保留证据并明确失败");
  assert.equal(workflow.connections["等待5分钟后重新领取"].main[0][0].node, claim.name);
  for (const node of nodes.filter(node => node.type === "n8n-nodes-base.httpRequest")) {
    assert.equal(node.parameters.method, "POST");
    const headers = (node.parameters.headerParameters as { parameters: Array<{ name: string; value: string }> }).parameters;
    assert.equal(headers.find(header => header.name === "X-TERUISI-N8N-EXECUTION-ID")?.value, "={{ $execution.id }}");
    assert.equal(headers.find(header => header.name === "X-TERUISI-WORKFLOW-KEY")?.value, "jd-logistics");
    assert.equal(node.parameters.sendBody, undefined); assert.equal(node.parameters.retryOnFail, undefined);
  }
  assert.equal(workflow.settings.errorWorkflow, undefined); assert.deepEqual(workflow.pinData, {});
});
