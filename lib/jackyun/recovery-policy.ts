import path from "node:path";
import { readJsonDurableOr } from "./json-file";

const defaults = { version: "jackyun-recovery-policy-v1", failureDelaysMinutes: [60, 120, 240], taskWaitPolls: 72, taskWaitMinutes: 360 };
export async function readJackyunRecoveryPolicy(root: string) {
  const value = await readJsonDurableOr<typeof defaults>(path.join(root, "config/jackyun-recovery-policy.json"), defaults);
  if (value.version !== defaults.version || !Array.isArray(value.failureDelaysMinutes) || value.failureDelaysMinutes.length !== 3
    || value.failureDelaysMinutes.some((v, i) => !Number.isInteger(v) || v < 1 || v > 1440 || i > 0 && v < value.failureDelaysMinutes[i - 1])
    || !Number.isInteger(value.taskWaitPolls) || value.taskWaitPolls < 1 || value.taskWaitPolls > 72
    || !Number.isInteger(value.taskWaitMinutes) || value.taskWaitMinutes < 5 || value.taskWaitMinutes > 1440) throw new Error("恢复预算配置无效，需要人工核查；禁止重置或无限重试。");
  return value;
}
