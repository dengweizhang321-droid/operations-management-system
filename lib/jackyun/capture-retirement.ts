import path from "node:path";
import { readFile, readdir, lstat } from "node:fs/promises";
import { controlDigest } from "./recovery-control";
import { readJsonDurableOr, writeJsonDurable } from "./json-file";
import { preflightClosurePath } from "./preflight-recovery";
import { jackyunCaptureDate, jackyunExportOrder } from "./run-contract";

export type CaptureRetirement = { version: "jackyun-capture-retirement-v1"; executionId: string; runId: string;
  oldCaptureDate: string; nextCaptureDate: string; planSha256: string; controllerSha256: string;
  reason: "incomplete_collection_cross_day_without_pending_operations" };

/** Only native-durable v2 checkpoints can prove an interrupted prepared
 * module never reached submit_intent. Legacy/unknown submissions remain held. */
export async function inspectCaptureRetirement(root: string, plan: { executionId: string; runId: string; runDate: string; phase: string }, at: string): Promise<CaptureRetirement | null> {
  if (plan.phase !== "exporting" || plan.runDate === jackyunCaptureDate(at)) return null;
  const dir = path.join(root, "outputs/jackyun-import-runs", plan.runId), file = path.join(dir, "api-controller-state.json");
  const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) return null;
  const state = await readJsonDurableOr<{ version: number; runId: string; runDate: string; modules: Record<string, { status: string; exportIntentAt?: string }> } | null>(file, null);
  if (!state || state.version !== 2 || state.runId !== plan.runId || state.runDate !== plan.runDate) return null;
  if ((await readdir(dir)).sort().join() !== "api-controller-state.json") throw new Error("旧采集存在其他请求、临时文件或导入效果，必须先核查；禁止新建采集代次。");
  if (Object.keys(state.modules).some(key => !jackyunExportOrder.includes(key as typeof jackyunExportOrder[number]))) throw new Error("旧控制器模块身份不明。");
  const entries = Object.values(state.modules);
  if (entries.some(entry => !["handed_off", "prepared"].includes(entry.status) || entry.status === "prepared" && entry.exportIntentAt)) return null;
  if (jackyunExportOrder.every(key => state.modules[key]?.status === "handed_off")) return null;
  const validation = path.join(root, "outputs/jackyun-export-first-validation", plan.runId);
  if (await lstat(validation).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("旧采集存在校验或导入准备，须协调原结果后再判断新采集。");
  return { version: "jackyun-capture-retirement-v1", executionId: plan.executionId, runId: plan.runId,
    oldCaptureDate: plan.runDate, nextCaptureDate: jackyunCaptureDate(at), planSha256: controlDigest(JSON.parse((await readFile(path.join(root, "outputs/jackyun-export-first", `${plan.runId}.json`))).toString("utf8"))),
    controllerSha256: controlDigest(state), reason: "incomplete_collection_cross_day_without_pending_operations" };
}

export async function publishCaptureRetirement(root: string, proof: CaptureRetirement, replacementExecutionId: string) {
  const plan = await readJsonDurableOr<Parameters<typeof inspectCaptureRetirement>[1] | null>(path.join(root, "outputs/jackyun-export-first", `${proof.runId}.json`), null);
  if (!plan || controlDigest(await inspectCaptureRetirement(root, plan, `${proof.nextCaptureDate}T04:00:00.000Z`)) !== controlDigest(proof)) throw new Error("旧采集退休证据已变化，禁止放行。");
  await writeJsonDurable(preflightClosurePath(root, proof.executionId), { version: 7, reason: "verified_incomplete_collection_retirement", proof, replacementExecutionId }, true);
}

export async function assertCaptureRetired(root: string, executionId: string, replacementExecutionId?: string) {
  const receipt = await readJsonDurableOr<{ version: number; reason: string; proof: CaptureRetirement; replacementExecutionId: string } | null>(preflightClosurePath(root, executionId), null);
  if (!receipt || receipt.version !== 7 || receipt.reason !== "verified_incomplete_collection_retirement" || receipt.proof.executionId !== executionId
    || receipt.replacementExecutionId !== replacementExecutionId) throw new Error("旧采集退休记录不是本次唯一消费者。");
  const plan = await readJsonDurableOr<Parameters<typeof inspectCaptureRetirement>[1] | null>(path.join(root, "outputs/jackyun-export-first", `${receipt.proof.runId}.json`), null);
  if (!plan || controlDigest(await inspectCaptureRetirement(root, plan, `${receipt.proof.nextCaptureDate}T04:00:00.000Z`)) !== controlDigest(receipt.proof)) throw new Error("旧采集退休证明不完整。");
}
