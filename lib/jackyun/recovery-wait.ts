import path from "node:path";
import { lstat } from "node:fs/promises";
import { readJsonDurableOr as readJsonFileOr, writeJsonDurable } from "./json-file";
import { readJackyunRecoveryPolicy } from "./recovery-policy";

export async function recordJackyunSafeWait(options: { root: string; runId: string; reason: string; at: string; assertOwned: () => Promise<void>;
  maxPolls?: number; maxWaitMs?: number }) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(options.runId) || !/^[a-z_]{1,64}$/.test(options.reason)
    || !Number.isFinite(Date.parse(options.at))) throw new Error("等待控制身份无效。");
  const file = path.join(options.root, "outputs/jackyun-export-first/recovery-waits", `${options.runId}-${options.reason}.json`);
  const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192)) throw new Error("等待控制记录身份异常。");
  const prior = await readJsonFileOr<{ version: string; runId: string; reason: string; firstAt: string; lastAt: string; polls: number } | null>(file, null);
  if (prior && (prior.version !== "jackyun-recovery-wait-v1" || prior.runId !== options.runId || prior.reason !== options.reason
    || !Number.isSafeInteger(prior.polls) || prior.polls < 1 || !Number.isFinite(Date.parse(prior.firstAt))
    || !Number.isFinite(Date.parse(prior.lastAt)) || Date.parse(options.at) < Date.parse(prior.lastAt))) throw new Error("等待控制记录损坏或时间回退。");
  const polls = (prior?.polls ?? 0) + 1, firstAt = prior?.firstAt ?? options.at;
  const policy = await readJackyunRecoveryPolicy(options.root);
  // Matches the existing 72 five-minute coordination polls; this is a separate
  // task wait budget, never a total recovery deadline or a failure retry count.
  if (polls > (options.maxPolls ?? policy.taskWaitPolls) || Date.parse(options.at) - Date.parse(firstAt) > (options.maxWaitMs ?? policy.taskWaitMinutes * 60_000)) {
    throw new Error(`原任务等待预算已用尽，需要人工核查${options.reason.startsWith("import_products") ? "原货品上传处理、新品关联服务和原批次" : options.reason.startsWith("import_inventory") ? "原库存上传处理、投影服务和原批次" : "唯一 taskId 或上传处理 owner"}；禁止重发导出或导入。`);
  }
  await options.assertOwned();
  await writeJsonDurable(file, { version: "jackyun-recovery-wait-v1", runId: options.runId, reason: options.reason, firstAt, lastAt: options.at, polls });
  await options.assertOwned();
  return { recoveryDecision: "wait" as const, waitMinutes: 5, waitReason: options.reason };
}
