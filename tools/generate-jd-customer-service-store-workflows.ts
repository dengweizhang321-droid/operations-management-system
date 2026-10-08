import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";

// Clone the adopted equipment-store definition without rewriting its ID or
// definition. All scheduling, wait loops, timeouts and retry rules are shared.
const baseline = JSON.parse(await readFile(new URL("../automation/n8n/jd-customer-service-daily.workflow.json", import.meta.url), "utf8"));
for (const store of jdCustomerServiceStores.slice(1)) {
  const workflow = structuredClone(baseline);
  workflow.id = store.workflowId;
  workflow.name = `京东${store.shopName}客服聊天记录下载导入（09:00，30天）`;
  workflow.active = false;
  workflow.meta = {
    candidate: true,
    storeKey: store.storeKey,
    activationBlockers: ["controlled_helper_and_bound_import_adoption", "dedicated_browser_end_to_end", "store_scoped_failure_ai_and_owner_notification"],
    releaseProcedure: baseline.meta.releaseProcedure,
  };
  for (const node of workflow.nodes) {
    node.id = createHash("sha256").update(`${store.workflowId}:${node.name}`).digest("hex").slice(0, 32);
    if (node.type === "n8n-nodes-base.httpRequest") {
      node.parameters.headerParameters.parameters.push({ name: "X-TERUISI-JD-CUSTOMER-SERVICE-STORE-KEY", value: store.storeKey });
    }
    if (node.type === "n8n-nodes-base.stickyNote") {
      node.name = "店铺绑定与采用规则";
      node.parameters.content = `## ${store.shopName}客服聊天记录（待采用）\n每天上海09:00，截至昨天滚动30天；共享helper等待5分钟、双视图导出、按日完整业务值等价、串行导入、精确批次复验均与设备店一致。\n\n固定店铺 ${store.storeKey} / ${store.shopId}；使用原注册Profile、独立下载与恢复状态。禁止跨店接管或重放未决提交。\n\n须先受控采用新版helper及显式店铺导入，逐店完整验收，再启用；第4次独立失败AI介入和本人单聊通知须将新增workflow ID纳入原监控。现有设备店ai-2并未自动扩容，不能直接启用。`;
    }
  }
  await writeFile(new URL(`../automation/n8n/${store.fileStem}.candidate.workflow.json`, import.meta.url), JSON.stringify(workflow, null, 2) + "\n");
}
