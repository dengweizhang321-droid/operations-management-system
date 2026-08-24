import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowDirectory = path.join(projectRoot, "automation", "n8n");
const baseWorkflowFile = path.join(workflowDirectory, "tmall-yijiu-sycm-cookie-daily.workflow.json");

export type TmallN8nWorkflowDefinition = {
  storeKey: string;
  shopName: string;
  shortName: string;
  workflowId: string;
  workflowName: string;
  fileName: string;
  cronExpression: string;
  scheduleName: string;
  productMasterExportMode?: "on_sale_pagewise_excel";
  productMasterCadence: {
    intervalDays: 3;
    initialDueDate: string;
  };
};

export const tmallN8nWorkflowDefinitions: readonly TmallN8nWorkflowDefinition[] = [
  {
    storeKey: "tmall-yijiu",
    shopName: "天猫-志高亿玖专卖店",
    shortName: "亿玖",
    workflowId: "M4xY8kQ2vR6sT9pC",
    workflowName: "天猫店铺数据导入",
    fileName: "tmall-yijiu-sycm-cookie-daily.workflow.json",
    cronExpression: "30 13 * * *",
    scheduleName: "每天 13:30 运行",
    productMasterExportMode: "on_sale_pagewise_excel",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-27" },
  },
  {
    storeKey: "tmall-lili",
    shopName: "天猫-志高丽力专卖店",
    shortName: "丽力",
    workflowId: "TmallLiliDaily2026",
    workflowName: "天猫店铺数据导入-丽力",
    fileName: "tmall-lili-sycm-cookie-daily.workflow.json",
    cronExpression: "40 13 * * *",
    scheduleName: "每天 13:40 运行",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-27" },
  },
  {
    storeKey: "tmall-tuofeng",
    shopName: "天猫-志高拓丰专卖店",
    shortName: "拓丰",
    workflowId: "TmallTuofengDaily2026",
    workflowName: "天猫店铺数据导入-拓丰",
    fileName: "tmall-tuofeng-sycm-cookie-daily.workflow.json",
    cronExpression: "50 13 * * *",
    scheduleName: "每天 13:50 运行",
    productMasterExportMode: "on_sale_pagewise_excel",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-25" },
  },
  {
    storeKey: "tmall-cuizhiwang",
    shopName: "天猫-志高炊之王专卖店",
    shortName: "炊之王",
    workflowId: "TmallCuizhiwangDaily2026",
    workflowName: "天猫店铺数据导入-炊之王",
    fileName: "tmall-cuizhiwang-sycm-cookie-daily.workflow.json",
    cronExpression: "0 14 * * *",
    scheduleName: "每天 14:00 运行",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-25" },
  },
  {
    storeKey: "tmall-masitu",
    shopName: "天猫-志高马思图专卖店",
    shortName: "马思图",
    workflowId: "TmallMasituDaily2026",
    workflowName: "天猫店铺数据导入-马思图",
    fileName: "tmall-masitu-sycm-cookie-daily.workflow.json",
    cronExpression: "10 14 * * *",
    scheduleName: "每天 14:10 运行",
    productMasterExportMode: "on_sale_pagewise_excel",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-26" },
  },
  {
    storeKey: "tmall-yiyong",
    shopName: "天猫-志高亿用专卖店",
    shortName: "亿用",
    workflowId: "TmallYiyongDaily2026",
    workflowName: "天猫店铺数据导入-亿用",
    fileName: "tmall-yiyong-sycm-cookie-daily.workflow.json",
    cronExpression: "20 14 * * *",
    scheduleName: "每天 14:20 运行",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-26" },
  },
] as const;

type WorkflowNode = {
  name: string;
  type: string;
  parameters?: {
    content?: string;
    sendHeaders?: boolean;
    headerParameters?: { parameters?: Array<{ name?: string; value?: string }> };
    rule?: { interval: Array<{ field: "cronExpression"; expression: string }> };
    [key: string]: unknown;
  };
};

type WorkflowTemplate = {
  id: string;
  name: string;
  active: boolean;
  versionId?: string;
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

const bindingEndMarker = "<!-- tmall-store-binding:end -->";

function stableUuid(seed: string) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function replaceStoreSpecificText(content: string, definition: TmallN8nWorkflowDefinition) {
  const withoutBinding = content.includes(bindingEndMarker)
    ? content.slice(content.indexOf(bindingEndMarker) + bindingEndMarker.length).replace(/^\s+/, "")
    : content;
  let adapted = withoutBinding
    .replaceAll("tmall-yijiu", definition.storeKey)
    .replaceAll("亿玖店", `${definition.shortName}店`)
    .replaceAll("亿玖", definition.shortName);
  if (definition.storeKey !== "tmall-yijiu") {
    adapted = adapted.replace(
      "浏览器不可连接时才从临时环境变量 `TMALL_SYCM_COOKIE_FILE` 或 Git 已忽略的",
      "浏览器不可连接时才从 Git 已忽略的店铺专属",
    );
  }
  const productMasterStart = adapted.indexOf("最后 M ");
  const productMasterEnd = adapted.indexOf("M 成功或任一阶段失败后", productMasterStart);
  if (productMasterStart >= 0) {
    if (productMasterEnd < 0) throw new Error("天猫 n8n 基础模板的 M 节点说明不完整");
    const productMasterDescription = definition.productMasterExportMode === "on_sale_pagewise_excel"
      ? `最后 M 复用同一${definition.shortName}店独立 Chromium 会话，进入千牛“商品 > 我的商品 > 出售中”，读取“商品总数 + 当前页/总页数”并要求总页数与每页 20 条口径一致；每页严格执行“勾选商品标题全选框 → 精确读回已选数量 → 更多批量操作 → excel商品批量导出 → 确认任务创建成功”。最后一页之前只关闭成功弹窗并点击右上角下一页，最后一页才点击“前往下载”。导出记录只接管本轮提交时间窗内、数量与页数完全一致的全部已完成任务，逐个下载到${definition.shortName}独立目录；全部分页文件分别通过发布模板、店铺和商品数校验后，先合并成一个无跨页重复且唯一商品数等于出售中总数的权威 XLSX，再只提交一次货品主数据导入并回查，禁止逐页导入互相覆盖。点击创建任务结果未决、导出记录多于预期、缺页、任务失败、商品数变化或跨页重复都失败关闭并保留活动清单。`
      : `最后 M 复用同一${definition.shortName}店独立 Chromium 会话，进入千牛“商品 > 出售中”，关闭右下角“重要通知”（若显示），再从右下角打开“商品管家”，在右侧聊天发送“导出全部商品”、确认任务、等待生成并下载 XLSX；随后校验发布模板、店铺、行数和哈希，提交货品主数据导入并回查。`;
    adapted = [adapted.slice(0, productMasterStart), productMasterDescription, adapted.slice(productMasterEnd)].join("");
  }
  return [
    "## 店铺绑定",
    `本模板固定绑定 \`${definition.shopName}\`（\`${definition.storeKey}\`）。工作流与店铺键不匹配时，helper 会在业务节点前失败关闭。`,
    `定时执行仍每日完成 A→B→C→P；M 货品主数据按上海日期每 ${definition.productMasterCadence.intervalDays} 天到期一次，初始到期日为 \`${definition.productMasterCadence.initialDueDate}\`。未到期时 M 返回 \`not_due\`，只负责关闭本店浏览器并释放 helper；到期失败不推进下次日期，翌日完整流程继续补跑。手动完整运行明确强制执行 M。`,
    bindingEndMarker,
    "",
    adapted,
  ].join("\n");
}

function setStoreHeader(node: WorkflowNode, storeKey: string) {
  if (node.type !== "n8n-nodes-base.httpRequest") return;
  const parameters = node.parameters ??= {};
  parameters.sendHeaders = true;
  const headerParameters = parameters.headerParameters ??= { parameters: [] };
  const headers = Array.isArray(headerParameters.parameters) ? headerParameters.parameters : [];
  headerParameters.parameters = [
    ...headers.filter((header) => ![
      "x-teruisi-tmall-store-key",
      "x-teruisi-tmall-force-product-master",
    ].includes(String(header.name ?? "").toLowerCase())),
    { name: "X-TERUISI-TMALL-STORE-KEY", value: storeKey },
    ...(String(parameters.url ?? "").endsWith("/product-master")
      ? [{
          name: "X-TERUISI-TMALL-FORCE-PRODUCT-MASTER",
          value: "={{ $execution.mode === 'manual' ? '1' : '0' }}",
        }]
      : []),
  ];
}

function replaceConnectionNode(value: unknown, oldName: string, newName: string): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "node" && child === oldName) (value as Record<string, unknown>)[key] = newName;
    else replaceConnectionNode(child, oldName, newName);
  }
}

function adaptProductMasterNode(workflow: WorkflowTemplate, definition: TmallN8nWorkflowDefinition) {
  const oldName = "M·商品管家批量导出、校验并导入";
  const newName = "M·出售中逐页导出、合并校验并导入";
  const targetName = definition.productMasterExportMode === "on_sale_pagewise_excel" ? newName : oldName;
  const candidates = workflow.nodes.filter((candidate) => candidate.name === oldName || candidate.name === newName);
  if (candidates.length !== 1) throw new Error("天猫 n8n 基础模板必须且只能包含一个货品 M 节点");
  const node = candidates[0]!;
  const sourceName = node.name;
  node.name = targetName;
  if (sourceName !== targetName && workflow.connections[sourceName]) {
    workflow.connections[targetName] = workflow.connections[sourceName];
    delete workflow.connections[sourceName];
  }
  replaceConnectionNode(workflow.connections, sourceName, targetName);
}

function adaptManualTrigger(workflow: WorkflowTemplate) {
  const node = workflow.nodes.find((candidate) => candidate.type === "n8n-nodes-base.manualTrigger");
  if (!node) throw new Error("天猫 n8n 基础模板缺少 manualTrigger");
  const targetName = "手动完整运行（强制 M）";
  const sourceName = node.name;
  node.name = targetName;
  if (sourceName !== targetName && workflow.connections[sourceName]) {
    workflow.connections[targetName] = workflow.connections[sourceName];
    delete workflow.connections[sourceName];
    replaceConnectionNode(workflow.connections, sourceName, targetName);
  }
}

export function buildTmallN8nWorkflow(
  source: WorkflowTemplate,
  definition: TmallN8nWorkflowDefinition,
): WorkflowTemplate {
  const workflow = structuredClone(source);
  workflow.id = definition.workflowId;
  workflow.name = definition.workflowName;
  workflow.active = false;
  workflow.versionId = definition.storeKey === "tmall-yijiu"
    ? source.versionId
    : stableUuid(`teruisi:${definition.storeKey}:tmall-daily:v1`);
  workflow.settings = { ...(workflow.settings ?? {}), executionOrder: "v1", timezone: "Asia/Shanghai" };

  const schedule = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  if (!schedule) throw new Error("天猫 n8n 基础模板缺少 scheduleTrigger");
  const oldScheduleName = schedule.name;
  const scheduleParameters = schedule.parameters ??= {};
  scheduleParameters.rule = { interval: [{ field: "cronExpression", expression: definition.cronExpression }] };
  schedule.name = definition.scheduleName;
  if (oldScheduleName !== definition.scheduleName) {
    workflow.connections[definition.scheduleName] = workflow.connections[oldScheduleName];
    delete workflow.connections[oldScheduleName];
  }

  for (const node of workflow.nodes) {
    setStoreHeader(node, definition.storeKey);
    if (node.type === "n8n-nodes-base.stickyNote" && typeof node.parameters?.content === "string") {
      node.parameters.content = replaceStoreSpecificText(node.parameters.content, definition);
    }
  }
  adaptManualTrigger(workflow);
  adaptProductMasterNode(workflow, definition);
  return workflow;
}

export async function generateTmallN8nWorkflows() {
  const source = JSON.parse(await readFile(baseWorkflowFile, "utf8")) as WorkflowTemplate;
  if (source.active) throw new Error("拒绝从已激活的天猫工作流生成扩店模板");
  const generated: string[] = [];
  for (const definition of tmallN8nWorkflowDefinitions) {
    const outputPath = path.join(workflowDirectory, definition.fileName);
    const workflow = buildTmallN8nWorkflow(source, definition);
    await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    generated.push(outputPath);
  }
  return generated;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const generated = await generateTmallN8nWorkflows();
  console.log(JSON.stringify({ ok: true, generated: generated.map((file) => path.basename(file)) }, null, 2));
}
