import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const baseline = JSON.parse(await readFile(new URL("../automation/n8n/jd-promotion-daily.workflow.json", import.meta.url), "utf8"));
const renamed = new Map([
  ["手动补跑8月20日", "手动执行客服30天"], ["每天 10:40 执行", "每天 09:00 执行"],
  ["A·固化京准通目标日期与店铺", "A·固定客服店铺与30天范围"],
  ["B·生成下载校验导入并回查", "B·双视图导出按日导入"],
  ["C·独立复验文件与精确批次", "C·独立复验全部日批次"],
]);
const nodes = baseline.nodes.filter(node => !["手动补跑日期", "店铺与凭证边界", "流程与恢复说明", "失败后每小时安全重试入口"].includes(node.name));
for (const node of nodes) {
  node.name = renamed.get(node.name) ?? node.name;
  node.id = createHash("sha256").update(`jd-customer-service:${node.name}`).digest("hex").slice(0, 32);
  if (node.type === "n8n-nodes-base.scheduleTrigger") node.parameters.rule.interval = [{ field: "cronExpression", expression: "0 9 * * *" }];
  if (node.parameters.url) {
    node.parameters.url = node.parameters.url.replace("/jd-promotion/", "/jd/customer-service/");
    node.parameters.headerParameters.parameters = node.parameters.headerParameters.parameters.filter(header => !header.name.startsWith("X-TERUISI-JD-PROMOTION-"));
    for (const header of node.parameters.headerParameters.parameters) if (header.name === "X-TERUISI-WORKFLOW-KEY") header.value = "jd";
    node.parameters.headerParameters.parameters.push({ name: "X-TERUISI-SCHEDULED-AT", value: "={{ $('固定本轮时间').first().json.scheduledAt }}" });
    if (node.parameters.url.endsWith("/verify")) node.parameters.options.timeout = 600000;
  }
  delete node.webhookId;
  node.retryOnFail = false;
}
nodes.push({ id: "jd-cs-anchor", name: "固定本轮时间", type: "n8n-nodes-base.code", typeVersion: 2,
  position: [-510, 0], parameters: { jsCode: "return [{ json: { scheduledAt: new Date().toISOString() } }];" } });
nodes.push({ id: "jd-cs-boundaries", name: "采用前检查", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [-760, 340],
  parameters: { width: 700, height: 260, content: "## 开发候选，禁止直接启用\n每天上海09:00，截止昨天滚动30天。只绑定志高商用设备旗舰店。复用京东共享helper与Chromium锁；双视图先导出，再按日验证完整业务值等价、串行导入和回查。\n\n需先采用helper与客服解析修复、验证专用Profile和真实完整execution，并接通失败累计第4次的AI修复及本人单聊通知。当前未接通AI执行/投递，不设置无条件自动重试，不把未知提交重放。详见docs/JD_CUSTOMER_SERVICE_WORKFLOW.md。" } });
const connections = {};
for (const [name, edges] of Object.entries(baseline.connections)) {
  if (!nodes.some(node => node.name === (renamed.get(name) ?? name))) continue;
  connections[renamed.get(name) ?? name] = JSON.parse(JSON.stringify(edges), (key, value) => key === "node" ? renamed.get(value) ?? value : value);
}
const edge = target => ({ main: [[{ node: target, type: "main", index: 0 }]] });
connections["手动执行客服30天"] = edge("固定本轮时间");
connections["每天 09:00 执行"] = edge("固定本轮时间");
connections["固定本轮时间"] = edge("领取共享 helper");
const candidate = { id: "JdCustomerService2026", name: "京东志高商用设备客服聊天记录下载导入（09:00，30天）", nodes, connections,
  active: false, settings: { executionOrder: "v1", timezone: "Asia/Shanghai" },
  meta: { candidate: true, activationBlockers: ["dedicated_browser_end_to_end", "controlled_helper_and_parser_adoption", "failure_ai_and_owner_notification"] }, tags: [] };
await writeFile(new URL("../automation/n8n/jd-customer-service-daily.candidate.workflow.json", import.meta.url), JSON.stringify(candidate, null, 2) + "\n");
