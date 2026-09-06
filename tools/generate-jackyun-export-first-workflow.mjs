import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const original = JSON.parse(await readFile(new URL("automation/n8n/jd-multi-store-daily.workflow.json", root), "utf8"));
const id = name => createHash("sha256").update(`jackyun-export-first:${name}`).digest("hex").slice(0, 32);
const cloneNode = name => {
  const node = structuredClone(original.nodes.find(item => item.name === name));
  node.id = id(name);
  return node;
};
const manual = cloneNode("手动运行"); manual.position = [-760, 0];
const claim = cloneNode("领取共享 helper"); claim.position = [-540, 0];
claim.parameters.headerParameters.parameters.find(item => item.name === "X-TERUISI-WORKFLOW-KEY").value = "jackyun";
const claimed = cloneNode("helper 领取成功？"); claimed.position = [-300, 0];
const wait = cloneNode("等待前序流程释放 helper"); wait.position = [-540, 220];
const steps = [
  ["plan", "A·固定采集日和销售日期", [-60, 0], 120000],
  ["export/inventory", "1·分仓库存：筛选并导出所有页", [280, 0], 900000],
  ["export/combos", "2·组合装及子件：导出所有页", [620, 0], 900000],
  ["export/sales", "3·销售明细：发货时间、本月至昨天", [960, 0], 900000],
  ["export/inventory_age", "4·库龄分析：筛选并导出所有页", [1300, 0], 900000],
  ["export/products", "5·货品查询：SKU 模式导出所有页", [1640, 0], 900000],
  ["validate", "6·五表完整校验和导入演练", [1640, 280], 1800000],
  ["import", "7·统一导入运营管理系统", [1300, 280], 5400000],
  ["verify", "8·独立核验五类精确批次", [960, 280], 300000],
];
const nodes = [manual, claim, claimed, wait, ...steps.map(([action, name, position, timeout]) => ({
  id: id(action), name, position, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
  parameters: { method: "POST", url: `http://127.0.0.1:5791/jackyun/export-first/${action}`,
    sendHeaders: true, headerParameters: { parameters: [{ name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" }] },
    options: { timeout } },
}))];
const edge = name => ({ node: name, type: "main", index: 0 });
const connections = {
  [manual.name]: { main: [[edge(claim.name)]] },
  [claim.name]: { main: [[edge(claimed.name)]] },
  [claimed.name]: { main: [[edge(steps[0][1])], [edge(wait.name)]] },
  [wait.name]: { main: [[edge(claim.name)]] },
};
for (let index = 0; index < steps.length - 1; index++) connections[steps[index][1]] = { main: [[edge(steps[index + 1][1])]] };
for (const [name, content, position, width] of [
  ["五表操作说明", "## 先导出五张表，再导入\n导出顺序：分仓库存 → 组合装及子件 → 销售单明细账 → 库龄分析 → 货品 SKU。每张表先筛选、等查询完成，再右键导出所有页。销售按发货时间，本月 1 日至昨天；每月 1 日按已有业务规则处理上月整月。销售使用截图中的普通“导出”，组合装使用“导出组合装及子件”。\n库存与库龄记录实际采集日；当前查询不会标成昨天的历史快照。分仓库存继续使用公司全仓范围，导入时按现有规则过滤刷刷仓等无效行。", [280, -300], 1050],
  ["导入与运行说明", "## 导入门槛\n5 张本轮文件全部落地后，核验表头、页面总数、SHA-256、组合装母子关系和销售日期，并进行无业务写入的导入演练。全部通过才依次导入：货品 → 分仓库存 → 库龄 → 销售 → 组合装；最后独立回查 PostgreSQL 权威 API 的批次与事实归属。\n同一 execution 全程绑定；导出点击未决时保留原运行，禁止重复生成。仅共享 helper 的领取允许自动重试，业务节点失败后停止。默认手动、未激活，无定时器。账号密码及浏览器会话均不保存在 n8n。需要配套 helper 版本支持 /jackyun/export-first/ 路由。", [0, 280], 820],
]) nodes.push({ id: id(name), name, type: "n8n-nodes-base.stickyNote", typeVersion: 1, position,
  parameters: { content, width, height: 245, color: 4 } });
const workflow = { id: "J8kY2mQ5vR7sT4pN", name: "吉客云导入系统", nodes, connections, pinData: {}, active: false,
  settings: { executionOrder: "v1", timezone: "Asia/Shanghai" }, tags: [] };
await writeFile(new URL("automation/n8n/jackyun-five-dataset-daily.workflow.json", root), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
