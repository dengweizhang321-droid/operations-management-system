import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/jd-multi-store-daily.workflow.json", import.meta.url);
const silentWorkflowPaths = [
  new URL("../automation/n8n/jd-multi-store-daily.chromium-silent-copy.workflow.json", import.meta.url),
  new URL("../automation/n8n/jd-market-ranking-daily.chromium-silent-copy.workflow.json", import.meta.url),
];

test("JD n8n copy is inactive, uses 10:00 Shanghai loopback A/B/C stages, and contains no credentials", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    active: boolean; settings: { timezone?: string }; nodes: Array<{ name: string; type: string; parameters?: { url?: string; options?: { timeout?: number }; rule?: { interval?: Array<{ expression?: string }> }; sendHeaders?: boolean; headerParameters?: { parameters?: Array<{ name?: string; value?: string }> } } }>;
  };
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  const schedule = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedule?.parameters?.rule?.interval?.[0]?.expression, "0 10 * * *");
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

test("JD Chromium silent-download copies stay inactive and preserve loopback orchestration", async () => {
  for (const copyPath of silentWorkflowPaths) {
    const raw = await readFile(copyPath, "utf8");
    const workflow = JSON.parse(raw) as {
      name: string;
      active: boolean;
      settings: { timezone?: string };
      nodes: Array<{ type: string; parameters?: { url?: string } }>;
    };
    assert.match(workflow.name, /Chromium静默下载副本/);
    assert.equal(workflow.active, false);
    assert.equal(workflow.settings.timezone, "Asia/Shanghai");
    assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
    const urls = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest").map((node) => node.parameters?.url);
    assert.equal(urls.length, 3);
    assert.equal(urls.every((url) => /^http:\/\/127\.0\.0\.1:5791\/jd(?:-market)?\/(?:plan|run|verify)$/.test(url ?? "")), true);
    assert.match(raw, /窗口在后台隐藏并最小化/);
    assert.match(raw, /不弹系统保存窗口/);
    assert.doesNotMatch(raw, /(?:password|cookie|token|session|profileDir)\s*[:=]/i);
  }
});
