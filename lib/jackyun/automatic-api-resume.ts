import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { inspectJackyunApiResumePermit, type JackyunApiResumePermit } from "./api-execution-resume";
import { isBoundDownloadResumeFailure } from "./download-failure";
import type { JackyunExportTaskBinding } from "./export-task";
import { readN8nReplacementEvidence } from "./n8n-preflight-evidence";
import { recoverySha } from "./preflight-recovery";
import { jackyunCaptureDate } from "./run-contract";

type Context = ReturnType<typeof readN8nReplacementEvidence>;
type Claim = { version: 1; replacement: Context["replacement"]; permit: JackyunApiResumePermit; permitSha256: string };
export type AutomaticApiResumeDependencies = {
  readEvidence?: (previousId: string, replacementId: string) => Context;
  inspectTask: (binding: JackyunExportTaskBinding) => Promise<JackyunExportTaskBinding>;
  now?: () => string;
};

async function readRegular(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536) throw new Error("恢复证据文件身份异常");
  return readFile(file, "utf8");
}

// Called only under the existing global run lock, after helper ownership has
// been acquired. No export POST, file download or import takes place here.
export async function claimAutomaticJackyunApiResume(root: string, previousId: string, replacementId: string,
  action: string, now: string, deps: AutomaticApiResumeDependencies): Promise<JackyunExportTaskBinding | null> {
  try {
    if (![previousId, replacementId].every(id => /^[1-9]\d{0,19}$/.test(id)) || BigInt(replacementId) <= BigInt(previousId)
      || !Number.isFinite(Date.parse(now))) throw new Error("恢复身份无效");
    const base = path.join(root, "outputs/jackyun-export-first");
    const runId = `n8n-export-first-${previousId}`;
    const claimPath = path.join(base, "api-automatic-resumptions", `${runId}.json`);
    const existing = await readRegular(claimPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    // Preserve previously reviewed operator permits and their 30-minute expiry.
    if (!existing && await lstat(path.join(base, "api-resume-permits", `${runId}.json`)).then(() => true, error => {
      if (error.code === "ENOENT") return false; throw error;
    })) return null;
    const readEvidence = deps.readEvidence ?? readN8nReplacementEvidence;
    const context = readEvidence(previousId, replacementId);
    if (context.replacement.executionId !== replacementId || context.evidence.executionId !== previousId
      || context.evidence.activeExecutions !== 0 || Date.parse(context.replacement.startedAt) > Date.parse(now)) throw new Error("恢复执行不一致");
    if (existing) {
      const claim = JSON.parse(existing) as Claim;
      if (claim.version !== 1 || claim.permit.root !== path.resolve(root) || claim.permit.executionId !== previousId
        || claim.permit.runId !== runId || !isDeepStrictEqual(claim.replacement, context.replacement)
        || !isDeepStrictEqual(claim.permit.evidence, context.evidence)
        || claim.permitSha256 !== recoverySha(JSON.stringify(claim.permit))
        || !Number.isFinite(Date.parse(claim.permit.createdAt)) || Date.parse(now) < Date.parse(claim.permit.createdAt)
        || jackyunCaptureDate(claim.permit.createdAt) !== jackyunCaptureDate(now)) throw new Error("恢复绑定已变化或跨日");
      // The same owner must be able to proceed after its own controller writes.
      return claim.permit.task;
    }
    if (action !== "plan-api") throw new Error("只允许完整计划入口领取恢复");
    if (context.evidence.error !== "fetch failed" && !isBoundDownloadResumeFailure(context.evidence.error)) return null;
    const controller = JSON.parse(await readRegular(path.join(root, "outputs/jackyun-import-runs", runId, "api-controller-state.json")));
    const binding = controller.modules?.inventory?.binding as JackyunExportTaskBinding | undefined;
    if (!binding || controller.modules.inventory.pendingTaskId !== binding.taskId) throw new Error("缺少已绑定原任务");
    // Inspect locally before opening the controlled read-only platform session.
    const permit = await inspectJackyunApiResumePermit(root, previousId, context.evidence, binding, now);
    const task = await deps.inspectTask(binding);
    const inspectedAt = deps.now?.() ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(inspectedAt)) || Date.parse(inspectedAt) < Date.parse(now)
      || Date.parse(inspectedAt) - Date.parse(now) > 30 * 60_000
      || jackyunCaptureDate(inspectedAt) !== jackyunCaptureDate(now)) throw new Error("恢复核验过期或跨日");
    if (!isDeepStrictEqual(task, binding) || !isDeepStrictEqual(readEvidence(previousId, replacementId), context)) throw new Error("原任务或执行证据已变化");
    const fresh = await inspectJackyunApiResumePermit(root, previousId, context.evidence, task, now);
    if (!isDeepStrictEqual(fresh, permit)) throw new Error("恢复期间原文件变化");
    const claim: Claim = { version: 1, replacement: context.replacement, permit, permitSha256: recoverySha(JSON.stringify(permit)) };
    await mkdir(path.dirname(claimPath), { recursive: true });
    // One atomic record is both the proof and its sole consumer. No unclaimed
    // permit is published an hour before use; interruptions never free it.
    await writeFile(claimPath, JSON.stringify(claim) + "\n", { flag: "wx" });
    return task;
  } catch {
    throw new Error("JACKYUN_API_RESUME_MANUAL_ACTION：原库存任务恢复核验未通过或已有续跑执行；保留原任务，需要人工核查。");
  }
}
