import path from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import { withJackyunRunLock } from "./run-lock";
import { readJsonDurableOr, writeJsonDurable } from "./json-file";
import { readRecoveryControl, controlDigest } from "./recovery-control";
import { jackyunWorkflowId } from "./preflight-recovery";
import { readJackyunRecoveryPolicy } from "./recovery-policy";

type RetryContext = { workflowId: string; failedExecutionId: string; originalExecutionId: string; originalScheduledAt: string };
type Intent = { version: "jackyun-retry-budget-v1"; context: RetryContext; dispatcherExecutionId: string;
  attempt: number; createdAt: string; failedStoppedAt: string; policyDigest: string; digest: string };

/** One send intent per terminal failure. It survives process/dispatcher restarts.
 * No uncertain Webhook outcome is released or automatically POSTed again. */
export async function reserveJackyunFailureRetry(root: string, context: RetryContext, dispatcherExecutionId: string, options: {
  failedStoppedAt: string; now?: string; lockDirectory?: string;
  acceptance?: (intent: Intent) => Promise<string | null>;
}) {
  if (context.workflowId !== jackyunWorkflowId || ![context.failedExecutionId, context.originalExecutionId, dispatcherExecutionId].every(v => /^[1-9]\d{0,19}$/.test(v))
    || BigInt(context.failedExecutionId) < BigInt(context.originalExecutionId) || BigInt(dispatcherExecutionId) <= BigInt(context.failedExecutionId)
    || !Number.isFinite(Date.parse(options.failedStoppedAt)) || !Number.isFinite(Date.parse(context.originalScheduledAt))) throw new Error("重试预算身份无效。");
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(options.failedStoppedAt)) throw new Error("重试预算时间无效。");
  return withJackyunRunLock({ runId: `n8n-export-first-${context.originalExecutionId}`, purpose: "retry_dispatch",
    ...(options.lockDirectory ? { lockDirectory: options.lockDirectory } : {}) }, async lock => {
    const control = await readRecoveryControl(root, context.originalExecutionId);
    const policy = await readJackyunRecoveryPolicy(root), policyDigest = controlDigest(policy);
    if (control?.record.decision === "completed") return { ok: true, reservationStatus: "completed", failedExecutionId: context.failedExecutionId, retryExecutionId: dispatcherExecutionId };
    const dir = path.join(root, "outputs/jackyun-export-first/retry-budget", context.originalExecutionId);
    const names = await readdir(dir).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    if (names.length > 3 || names.some(n => !/^000[1-3]\.json$/.test(n))) throw new Error("重试预算记录损坏或存在未决临时文件，请人工核查。");
    const intents: Intent[] = [];
    for (const [index, name] of names.sort().entries()) {
      if (name !== `000${index + 1}.json`) throw new Error("重试预算序列缺失。");
      const file = path.join(dir, name), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192) throw new Error("重试预算文件身份异常。");
      const intent = JSON.parse(await readFile(file, "utf8")) as Intent;
      const { digest, ...payload } = intent;
      if (intent.version !== "jackyun-retry-budget-v1" || intent.attempt !== index + 1 || intent.context.originalExecutionId !== context.originalExecutionId
        || intent.context.workflowId !== context.workflowId || intent.context.originalScheduledAt !== context.originalScheduledAt || intent.policyDigest !== policyDigest
        || digest !== controlDigest(payload)) throw new Error("重试预算摘要、策略或逻辑运行变化，需人工核查；不能用新策略重置次数。");
      intents.push(intent);
    }
    const existing = intents.find(i => i.context.failedExecutionId === context.failedExecutionId);
    if (existing) {
      const accepted = await options.acceptance?.(existing);
      if (accepted) return { ok: true, reservationStatus: "accepted", acceptedExecutionId: accepted,
        failedExecutionId: context.failedExecutionId, retryExecutionId: dispatcherExecutionId };
      throw new Error("原 Webhook 已保留发送意图，结果尚未确认；请核查原派发 execution，禁止再次 POST。");
    }
    if (intents.length >= 3) throw new Error("完整失败恢复已达三次上限，请处理具体障碍后手动完整重试。");
    if (control && control.record.attemptExecutionId !== context.failedExecutionId) throw new Error("迟到的失败通知不属于当前逻辑运行 owner，禁止派发。");
    const oldIntent = path.join(root, "outputs/n8n-retry-dispatch", `${context.workflowId}-${context.failedExecutionId}.json`);
    if (await lstat(oldIntent).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("原版本已有重试派发记录，需协调旧结果；不得扩大旧许可。");
    const delayMinutes = policy.failureDelaysMinutes[intents.length];
    const nextAllowedAt = new Date(Date.parse(options.failedStoppedAt) + delayMinutes * 60_000).toISOString();
    if (Date.parse(now) < Date.parse(nextAllowedAt)) return { ok: true, reservationStatus: "waiting", failedExecutionId: context.failedExecutionId,
      retryExecutionId: dispatcherExecutionId, nextAllowedAt, nextRetryDelayMinutes: Math.max(1, Math.ceil((Date.parse(nextAllowedAt) - Date.parse(now)) / 60_000)) };
    const payload = { version: "jackyun-retry-budget-v1" as const, context, dispatcherExecutionId, attempt: intents.length + 1,
      createdAt: now, failedStoppedAt: options.failedStoppedAt, policyDigest };
    await lock.assertOwned(); await writeJsonDurable(path.join(dir, `000${payload.attempt}.json`), { ...payload, digest: controlDigest(payload) }, true);
    await lock.assertOwned();
    return { ok: true, reservationStatus: "reserved", failedExecutionId: context.failedExecutionId, retryExecutionId: dispatcherExecutionId };
  });
}

/** Admission is bound to the actual persisted entry and original send intent.
 * One authorized consumer per failure; duplicate Webhooks never get a second
 * business attempt. Manual authority is a separate explicit permission path. */
export async function claimJackyunAutomaticDispatch(root: string, context: RetryContext, dispatcherExecutionId: string,
  executionId: string, options: { lockDirectory?: string } = {}) {
  if (context.workflowId !== jackyunWorkflowId || ![context.originalExecutionId, context.failedExecutionId, dispatcherExecutionId, executionId].every(v => /^[1-9]\d{0,19}$/.test(v))
    || BigInt(context.originalExecutionId) > BigInt(context.failedExecutionId) || BigInt(dispatcherExecutionId) <= BigInt(context.failedExecutionId)
    || BigInt(executionId) <= BigInt(dispatcherExecutionId)) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发消费者身份无效。");
  return withJackyunRunLock({ runId: `dispatch-${executionId}`, purpose: "automatic_dispatch_admission",
    ...(options.lockDirectory ? { lockDirectory: options.lockDirectory } : {}) }, async lock => {
    const directory = path.join(root, "outputs/jackyun-export-first/retry-budget", context.originalExecutionId);
    const names = await readdir(directory).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    if (!names.length || names.length > 3 || names.some(n => !/^000[1-3]\.json$/.test(n))) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发缺少完整持久预算或存在未决记录；请协调原派发，禁止重放。");
    const matches: Intent[] = [];
    for (const [index, name] of names.sort().entries()) {
      const intent = await readJsonDurableOr<Intent | null>(path.join(directory, name), null);
      if (name !== `000${index + 1}.json` || !intent || intent.version !== "jackyun-retry-budget-v1" || intent.attempt !== index + 1
        || !intent.context || intent.context.workflowId !== context.workflowId || intent.context.originalExecutionId !== context.originalExecutionId
        || intent.context.originalScheduledAt !== context.originalScheduledAt) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发预算序列或逻辑身份无效。");
      const { digest, ...payload } = intent;
      if (digest !== controlDigest(payload)) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发预算摘要已变化。");
      if (intent.context.failedExecutionId === context.failedExecutionId && intent.dispatcherExecutionId === dispatcherExecutionId) matches.push(intent);
    }
    if (matches.length !== 1) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发不属于原持久发送意图，禁止绕过预算。");
    const control = await readRecoveryControl(root, context.originalExecutionId);
    if (control?.record.decision === "completed") return { completed: true, failureAttempts: matches[0].attempt };
    const file = path.join(root, "outputs/jackyun-export-first/retry-dispatch-claims", context.originalExecutionId, `${context.failedExecutionId}.json`);
    const claim = { version: "jackyun-retry-consumer-v1", context, dispatcherExecutionId, executionId, intentDigest: matches[0].digest };
    const prior = await readJsonDurableOr<typeof claim | null>(file, null);
    if (prior) {
      if (controlDigest(prior) !== controlDigest(claim)) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：原自动派发已由另一完整 execution 消费；请协调原执行，禁止重复业务尝试。");
      return { completed: false, failureAttempts: matches[0].attempt };
    }
    await lock.assertOwned(); await writeJsonDurable(file, claim, true); await lock.assertOwned();
    return { completed: false, failureAttempts: matches[0].attempt };
  });
}
