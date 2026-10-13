import { isDeepStrictEqual } from "node:util";
import { readJsonDurableOr, writeJsonDurable } from "./json-file";
import { inspectPreflightZeroEffects, preflightClosurePath, jackyunWorkflowId, type PreflightEvidence } from "./preflight-recovery";
import { controlDigest } from "./recovery-control";
import type { ReplacementExecution } from "./n8n-preflight-evidence";
import type { BoundHumanAuthority } from "./human-retry";

export async function inspectPlanOnlyRecovery(root: string, previousId: string, evidence: PreflightEvidence, at: string) {
  const allowed = new Set(["手动运行", "每天本机时间 00:10", "失败后每小时安全重试入口", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？", "等待前序流程释放 helper", "A·固定采集日和销售日期"]);
  if (evidence.executionId !== previousId || evidence.workflowId !== jackyunWorkflowId || evidence.status !== "error" || evidence.retrySuccessId !== null
    || evidence.activeExecutions !== 0 || evidence.lastNode !== "A·固定采集日和销售日期"
    || evidence.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/plan-api" || evidence.httpCode !== "500"
    || !evidence.runNodes.includes("固定原执行计划时间") || evidence.runNodes.some(n => !allowed.has(n))) {
    throw new Error("A 前置失败缺少完整入口或零动作证据，需要人工核查；禁止关闭未知结果。");
  }
  const proof = await inspectPreflightZeroEffects(root, previousId, at);
  if (Date.parse(evidence.startedAt) > Date.parse(at) || Date.parse(evidence.stoppedAt) > Date.parse(at)) throw new Error("A 前置失败时间无法确认。");
  const reference = { executionId: evidence.executionId, workflowId: evidence.workflowId, status: evidence.status, retrySuccessId: evidence.retrySuccessId,
    activeExecutions: evidence.activeExecutions, lastNode: evidence.lastNode, requestUrl: evidence.requestUrl, httpCode: evidence.httpCode,
    runNodes: evidence.runNodes, executionDataSha256: evidence.executionDataSha256, startedAt: evidence.startedAt, stoppedAt: evidence.stoppedAt };
  return { proof, evidenceReference: reference };
}

export async function publishPlanOnlyClosure(root: string, previousId: string, replacement: ReplacementExecution,
  inspected: Awaited<ReturnType<typeof inspectPlanOnlyRecovery>>, humanAuthority?: BoundHumanAuthority) {
  if (replacement.mode !== "manual" && !humanAuthority) throw new Error("A 身份或服务前置障碍需要处理后人工完整重试。");
  if (humanAuthority && (humanAuthority.executionId !== replacement.executionId || humanAuthority.authority.kind !== "retry"
    || humanAuthority.authority.failedExecutionId !== previousId)) throw new Error("A 前置恢复授权与本次执行不一致。");
  await writeJsonDurable(preflightClosurePath(root, previousId), { version: 6, reason: "verified_plan_only_before_business",
    replacement, ...inspected, humanAuthority: humanAuthority ?? null }, true);
}

export async function assertPlanOnlyClosure(root: string, previousId: string, replacementId?: string) {
  const value = await readJsonDurableOr<{ version: number; reason: string; replacement: ReplacementExecution;
    proof: Awaited<ReturnType<typeof inspectPreflightZeroEffects>>; evidenceReference: Omit<PreflightEvidence, "error">;
    humanAuthority: BoundHumanAuthority | null } | null>(preflightClosurePath(root, previousId), null);
  if (!value || value.version !== 6 || value.reason !== "verified_plan_only_before_business" || !replacementId
    || value.replacement.executionId !== replacementId || value.proof.executionId !== previousId
    || !isDeepStrictEqual(value.proof, await inspectPreflightZeroEffects(root, previousId, value.proof.closedAt))) throw new Error("A 前置闭合记录或唯一消费者已变化。");
  if (Object.keys(value).sort().join() !== ["version", "reason", "replacement", "proof", "evidenceReference", "humanAuthority"].sort().join()
    || !["manual", "webhook"].includes(value.replacement.mode)
    || value.replacement.mode === "webhook" && (!value.humanAuthority || value.humanAuthority.executionId !== replacementId
      || value.humanAuthority.authority.kind !== "retry" || value.humanAuthority.authority.failedExecutionId !== previousId
      || value.humanAuthority.proofDigest !== controlDigest(value.humanAuthority.authority))) throw new Error("A 前置闭合授权或协议字段无效。");
}
