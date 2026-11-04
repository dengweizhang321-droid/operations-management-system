// Development artifacts only. This generator never contacts n8n or publishes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "automation/n8n/pi-business");
await mkdir(directory, { recursive: true });
const stores = ["yijiu", "lili", "tuofeng", "cuizhiwang", "masitu", "yiyong"];
for (const name of stores) {
  const storeKey = `tmall-${name}`;
  const original = JSON.parse(await readFile(path.join(root, `automation/n8n/tmall-${name}-seven-day-gap-loop.workflow.json`), "utf8"));
  const workflow = structuredClone(original);
  if (workflow.settings) delete workflow.settings.timezone;
  const anchor = workflow.nodes.find(node => node.name === "固定原执行计划时间");
  if (!anchor || typeof anchor.parameters?.jsCode !== "string" || workflow.nodes.some(node => node.name === "Pi业务执行入口")) throw Error("pi_business_anchor_invalid");
  anchor.parameters.jsCode = `// Pi admission is independently rechecked by the trusted helper before each node.\nconst piBusinessInput = $input.first().json.body?.piBusiness;\nif (piBusinessInput !== undefined) {\n  const keys = ['actionId','targetVersion','dispatchToken','startDate','endDate','scheduledAt'];\n  if (!piBusinessInput || typeof piBusinessInput !== 'object' || Object.keys(piBusinessInput).sort().join() !== keys.sort().join()\n    || !/^pi-action-[A-Za-z0-9_-]+$/.test(piBusinessInput.actionId ?? '') || !/^[a-f0-9]{64}$/.test(piBusinessInput.targetVersion ?? '')\n    || typeof piBusinessInput.dispatchToken !== 'string' || !piBusinessInput.dispatchToken\n    || !/^\\d{4}-\\d{2}-\\d{2}$/.test(piBusinessInput.startDate ?? '') || !/^\\d{4}-\\d{2}-\\d{2}$/.test(piBusinessInput.endDate ?? '')\n    || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(piBusinessInput.scheduledAt ?? '')) throw Error('pi_business_scope_invalid_manual_action');\n  return [{json:{version:'teruisi-retry-context-v1',workflowId:${JSON.stringify(workflow.id)},executionId:String($execution.id),\n    scheduledAt: piBusinessInput.scheduledAt, originalExecutionId:String($execution.id)}}];\n}\n` + anchor.parameters.jsCode;
  workflow.nodes.push({ id: createHash("sha256").update(`pi-business:${storeKey}`).digest("hex").slice(0, 32),
    name: "Pi业务执行入口", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-1000, 600],
    webhookId: `teruisi-pi-business-${storeKey}`, parameters: { httpMethod: "POST", path: `teruisi-pi-business-${storeKey}`, responseMode: "onReceived", options: {} } });
  workflow.connections["Pi业务执行入口"] = { main: [[{ node: anchor.name, type: "main", index: 0 }]] };
  workflow.settings = { ...workflow.settings, saveExecutionProgress: true, saveDataSuccessExecution: "all", saveDataErrorExecution: "all" };
  workflow.meta = { ...workflow.meta, piBusiness: { protocol: "pi-business-n8n-v1", capabilityId: "tmall-seven-day-gap-v1", storeKey,
    dataset: "product_and_promotion", fixedWindowDays: 7, requiresHelperAdmission: true } };
  // Activating/importing is a separate authorized production step.
  workflow.active = false;
  await writeFile(path.join(directory, `${storeKey}-pi-business.candidate.workflow.json`), JSON.stringify(workflow, null, 2) + "\n", "utf8");
}
process.stdout.write(JSON.stringify({ status: "candidate_files_generated", count: stores.length, published: false }) + "\n");
