import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { tmallN8nWorkflowDefinitions, type WorkflowTemplate } from "./generate-tmall-n8n-workflows";
import { tmallDailyLookbackDays } from "./tmall-daily-gap-plan";
import {
  tmallDirectPmProtocolForStore, tmallDirectPmProtocolHeader,
  tmallDirectPromotionRoute, tmallDirectProductMasterRoute,
} from "./tmall-yijiu-direct-pm-contract";

/** Adapt the actual published graph; never import an unrelated generated loop. */
export function adaptTmallUniformDirectWorkflow(source: WorkflowTemplate, storeKey: string): WorkflowTemplate {
  const definition = tmallN8nWorkflowDefinitions.find(item => item.storeKey === storeKey);
  const protocol = tmallDirectPmProtocolForStore(storeKey);
  if (!definition || !protocol || source.id !== definition.workflowId) {
    throw new Error("天猫直连适配的工作流与店铺不匹配");
  }
  const workflow = structuredClone(source);
  const origins = "http://127.0.0.1:5791";
  for (const node of workflow.nodes.filter(item => item.type === "n8n-nodes-base.httpRequest")) {
    const headers = node.parameters?.headerParameters?.parameters ?? [];
    const stores = headers.filter(header => header.name?.toLowerCase() === "x-teruisi-tmall-store-key");
    const executions = headers.filter(header => header.name?.toLowerCase() === "x-teruisi-n8n-execution-id");
    if (stores.length !== 1 || stores[0]?.value !== storeKey
      || executions.length !== 1 || executions[0]?.value !== "={{ $execution.id }}") {
      throw new Error("天猫直连适配拒绝缺失、重复或跨店的执行身份头");
    }
  }
  const renames = new Map<string, string>();
  for (const [prefix, legacyRoute, directRoute, name] of [
    ["P·", "/promotion", tmallDirectPromotionRoute, "P·直连创建商品报表、下载、汇总导入并回查"],
    ["M·", "/product-master", tmallDirectProductMasterRoute, "M·MTOP 分批导出、合并校验并导入"],
  ]) {
    const nodes = workflow.nodes.filter(node => node.name.startsWith(prefix!));
    const node = nodes[0];
    if (nodes.length !== 1 || !node || node.type !== "n8n-nodes-base.httpRequest"
      || node.parameters?.method !== "POST"
      || ![origins + legacyRoute, origins + directRoute].includes(String(node.parameters?.url))) {
      throw new Error("天猫直连适配要求唯一受控 P/M POST 节点");
    }
    const headers = node.parameters.headerParameters?.parameters ?? [];
    node.parameters.headerParameters = { parameters: [
      ...headers.filter(header => header.name?.toLowerCase() !== tmallDirectPmProtocolHeader),
      { name: "X-TERUISI-TMALL-CANDIDATE-PROTOCOL", value: protocol },
    ] };
    node.parameters.sendHeaders = true;
    node.parameters.url = origins + directRoute;
    renames.set(node.name, name!);
    node.name = name!;
  }
  function renameEdges(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "node" && typeof child === "string" && renames.has(child)) {
        (value as Record<string, unknown>)[key] = renames.get(child);
      } else renameEdges(child);
    }
  }
  workflow.connections = Object.fromEntries(Object.entries(workflow.connections)
    .map(([key, value]) => [renames.get(key) ?? key, value]));
  renameEdges(workflow.connections);
  const loop = workflow.nodes.some(node => node.parameters?.url === origins + "/next-day");
  const note = workflow.nodes.find(node => node.name === "流程说明" && node.type === "n8n-nodes-base.stickyNote");
  if (note?.parameters) note.parameters.content = [
    `## ${definition.shortName}：近七日查缺、P/M 直连、货品每日更新`,
    "A 核验登录与店铺身份，分别查询截止上海昨天的最近七个完整日期的商品日和推广日覆盖，优先选择最早缺失日；只补缺失的数据集。注册不足七天时从注册日开始。",
    loop ? "保留原有逐日循环和预算，重新核验同一固定范围后继续。" : "保留原 A→B→C→P→M，每轮最多补一个日期；没有缺口时商品日和推广无新增动作。",
    "P 使用同日商品+计划、四场景的受控直连接口，按唯一 taskId 续接；M 使用 MTOP 每20个商品分批串行导出、完整校验、合并后单次导入与回查。M 每日到期，成功才推进节奏，同日已完成不重复自动导出。",
    "保留独立浏览器、execution与店铺绑定、共享协调门禁、原小时安全重试及资源收尾。旧页面任务保留原日期、任务和文件，不跨协议接管；未决提交、验证码、身份或完整性不符停止。",
  ].join("\n\n");
  workflow.meta = { ...(workflow.meta ?? {}), uniformDirectDaily: {
    version: 1, storeKey, protocol, lookbackDays: tmallDailyLookbackDays, intervalDays: 1,
  } };
  return workflow;
}

export function buildTmallUniformDirectCandidate(source: WorkflowTemplate, storeKey: string) {
  const candidate = adaptTmallUniformDirectWorkflow(source, storeKey);
  candidate.active = false;
  const bytes = Buffer.from(createHash("sha256").update(JSON.stringify({
    id: candidate.id, nodes: candidate.nodes, connections: candidate.connections, settings: candidate.settings,
  })).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  candidate.versionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return candidate;
}

// Offline preparation only. Inputs must be snapshots of each original published ID.
async function main(argv: string[]) {
  if (argv.length !== 4 || argv[0] !== "--source-dir" || argv[2] !== "--output-dir") {
    throw new Error("需要 --source-dir <已发布定义快照目录> --output-dir <候选目录>");
  }
  const sourceDirectory = path.resolve(argv[1]!);
  const outputDirectory = path.resolve(argv[3]!);
  if (sourceDirectory === outputDirectory) throw new Error("候选目录不能覆盖来源快照");
  const candidates = await Promise.all(tmallN8nWorkflowDefinitions.map(async definition => {
    const source = JSON.parse(await readFile(path.join(sourceDirectory, `${definition.storeKey}.json`), "utf8")) as WorkflowTemplate;
    return { storeKey: definition.storeKey, candidate: buildTmallUniformDirectCandidate(source, definition.storeKey) };
  }));
  await mkdir(outputDirectory, { recursive: true });
  for (const { storeKey, candidate } of candidates) {
    await writeFile(path.join(outputDirectory, `${storeKey}-seven-day-direct.workflow.json`), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, generated: candidates.length, active: false })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "天猫候选准备失败"}\n`);
    process.exitCode = 1;
  });
}
