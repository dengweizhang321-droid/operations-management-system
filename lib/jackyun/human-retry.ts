import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { readJsonDurableOr as readJsonFileOr, writeJsonDurable } from "./json-file";
import { readRecoveryControl, controlDigest, recoveryProtocol, type RecoveryRequest } from "./recovery-control";
import { readN8nJackyunOwnerState, readN8nJackyunPlanContext, readN8nJackyunOriginalPlanContext, readAcceptedJackyunHumanDispatch } from "./n8n-preflight-evidence";
import { withJackyunRunLock } from "./run-lock";
import { jackyunWorkflowId } from "./preflight-recovery";
import { hourlyRetryWebhookPath } from "../../tools/n8n-hourly-retry-policy.mjs";

export type HumanRetryAuthority = { ok: true; version: "jackyun-human-retry-authority-v1"; authorizationId: string;
  workflowId: typeof jackyunWorkflowId; createdAt: string; expiresAt: string }
  & ({ kind: "new" } | { kind: "retry"; logicalExecutionId: string; failedExecutionId: string });
export type BoundHumanAuthority = { authority: HumanRetryAuthority; executionId: string; proofDigest: string };
type RecoveryTarget = { ok: true; state: string; newCollectionAllowed: boolean; logicalExecutionId?: string; failedExecutionId?: string;
  sourceExecutionId?: string; snapshotDate?: string; salesStartDate?: string; salesEndDate?: string; originalScheduledAt?: string | null; sourceDigest?: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);

export async function readHumanRetryAuthority(authorizationId: string, request: typeof fetch = fetch): Promise<HumanRetryAuthority> {
  if (!uuid(authorizationId)) throw new Error("人工恢复授权身份无效。");
  const response = await request(`http://localhost:3000/api/imports/recovery/run?${new URLSearchParams({ authorizationId })}`,
    { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > 8192) throw new Error("人工恢复授权无法确认或已过期，请重新从系统页面完整重试。");
  const value = JSON.parse(raw) as HumanRetryAuthority;
  const keys = ["ok", "version", "authorizationId", "workflowId", "kind", "createdAt", "expiresAt", ...(value?.kind === "retry" ? ["logicalExecutionId", "failedExecutionId"] : [])];
  if (!value || Object.keys(value).sort().join() !== keys.sort().join() || value.ok !== true || value.version !== "jackyun-human-retry-authority-v1"
    || value.authorizationId !== authorizationId || value.workflowId !== jackyunWorkflowId || !["new", "retry"].includes(value.kind)
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.createdAt) > Date.now()
    || Date.parse(value.expiresAt) <= Date.now() || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || value.kind === "retry" && (!/^[1-9]\d{0,19}$/.test(value.logicalExecutionId) || !/^[1-9]\d{0,19}$/.test(value.failedExecutionId)
      || BigInt(value.failedExecutionId) < BigInt(value.logicalExecutionId))) throw new Error("人工恢复授权范围或回执无效。");
  return value;
}

export async function claimHumanRetryAuthority(root: string, authority: HumanRetryAuthority, executionId: string, request: RecoveryRequest): Promise<BoundHumanAuthority> {
  const expected: RecoveryRequest = authority.kind === "new" ? { version: recoveryProtocol, kind: "new" }
    : { version: recoveryProtocol, kind: "retry", logicalExecutionId: authority.logicalExecutionId, failedExecutionId: authority.failedExecutionId };
  if (!isDeepStrictEqual(expected, request) || !/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("人工授权与本次完整执行或目标运行不一致。");
  const file = path.join(root, "outputs/jackyun-export-first/human-authorizations", `${authority.authorizationId}.json`);
  const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw new Error("人工授权领取记录身份异常。");
  const bound = { authority, executionId, proofDigest: controlDigest(authority) };
  const previous = await readJsonFileOr<BoundHumanAuthority | null>(file, null);
  if (previous) {
    if (!isDeepStrictEqual(previous, bound)) throw new Error("人工授权已被另一完整 execution 领取；请协调原派发结果，禁止再次执行。");
    return previous;
  }
  await writeJsonDurable(file, bound, true); return bound;
}

export async function readJackyunRecoveryTarget(root: string, explicitLogicalId?: string): Promise<RecoveryTarget> {
  const base = path.join(root, "outputs/jackyun-export-first");
  const active = await readJsonFileOr<{ runId: string; executionId: string } | null>(path.join(base, "active.json"), null);
  if (!active && !explicitLogicalId) {
    const entries = await readdir(base).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    if (entries.length) throw new Error("JACKYUN_TARGET_MANUAL_ACTION：活动索引缺失但原运行证据仍在，请核查原索引和执行；禁止猜测为空并重新采集。");
    return { ok: true, state: "empty", newCollectionAllowed: true };
  }
  let logicalExecutionId = explicitLogicalId ?? active!.executionId;
  if (!/^[1-9]\d{0,19}$/.test(logicalExecutionId)) throw new Error("活动或目标运行身份无效。");
  let control = await readRecoveryControl(root, logicalExecutionId);
  if (!explicitLogicalId && !control) {
    const names = await readdir(path.join(base, "recovery-control")).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    if (names.length > 4096 || names.some(n => !/^[1-9]\d{0,19}$/.test(n))) throw new Error("恢复索引无法安全核验。");
    const matches = [];
    for (const name of names) {
      const candidate = await readRecoveryControl(root, name);
      if (candidate?.record.sourceExecutionId === active?.executionId) matches.push(candidate);
    }
    if (matches.length > 1) throw new Error("活动运行存在多个逻辑归属，需要人工核查。");
    if (matches[0]) { control = matches[0]; logicalExecutionId = control.record.logicalExecutionId; }
  }
  const sourceExecutionId = control?.record.sourceExecutionId ?? logicalExecutionId;
  const plan = await readJsonFileOr<{ executionId: string; runId: string; phase: string; runDate: string; asOfDate: string; salesStartDate?: string } | null>(path.join(base, `n8n-export-first-${sourceExecutionId}.json`), null);
  if (!plan || plan.executionId !== sourceExecutionId || plan.runId !== `n8n-export-first-${sourceExecutionId}`) throw new Error("原运行计划或逻辑归属无法确认。");
  const failedExecutionId = control?.record.attemptExecutionId ?? sourceExecutionId;
  const ownerState = readN8nJackyunOwnerState(failedExecutionId);
  const state = plan.phase === "completed" ? "completed" : ["running", "waiting"].includes(ownerState) ? "waiting" : ownerState === "error" ? "failed" : "blocked";
  const context = ["error", "success"].includes(ownerState) ? readN8nJackyunPlanContext(failedExecutionId) : null;
  if (context && context.originalExecutionId !== logicalExecutionId) throw new Error("原计划锚点与逻辑运行不一致。");
  const original = readN8nJackyunOriginalPlanContext(logicalExecutionId);
  return { ok: true, state, logicalExecutionId, failedExecutionId, sourceExecutionId, snapshotDate: plan.runDate,
    salesStartDate: plan.salesStartDate, salesEndDate: plan.asOfDate, originalScheduledAt: original.originalScheduledAt,
    newCollectionAllowed: state === "completed", sourceDigest: controlDigest(plan) };
}

export async function dispatchHumanJackyunRetry(root: string, authorizationId: string, options: { request?: typeof fetch; lockDirectory?: string } = {}) {
  const request = options.request ?? fetch;
  const authority = await readHumanRetryAuthority(authorizationId, request);
  const file = path.join(root, "outputs/jackyun-export-first/human-dispatch", `${authorizationId}.json`);
  const existing = await readJsonFileOr<{ authorityDigest: string; createdAt: string } | null>(file, null);
  if (existing) {
    if (existing.authorityDigest !== controlDigest(authority)) throw new Error("原人工派发授权已变化。");
    const accepted = readAcceptedJackyunHumanDispatch(authorizationId, existing.createdAt);
    if (!accepted) throw new Error("原派发 Webhook 结果无法确认，保留同一请求编号；禁止再次 POST。");
    return { ok: true, dispatchStatus: "accepted", ...accepted, authorizationId };
  }
  const prepared = await withJackyunRunLock({ runId: `human-${authorizationId}`, purpose: "human_retry_dispatch",
    ...(options.lockDirectory ? { lockDirectory: options.lockDirectory } : {}) }, async lock => {
    const target = await readJackyunRecoveryTarget(root, authority.kind === "retry" ? authority.logicalExecutionId : undefined);
    if (authority.kind === "new" ? !target.newCollectionAllowed : target.failedExecutionId !== authority.failedExecutionId || !["failed", "completed"].includes(target.state)) {
      throw new Error("原运行仍有 owner 或目标已变化；请刷新并重试对应逻辑运行，新采集须先协调旧运行。");
    }
    if (authority.kind === "retry" && !target.originalScheduledAt) throw new Error("原计划锚点缺失，请核查精确执行；禁止重新计算原范围。");
    const recovery: RecoveryRequest = authority.kind === "new" ? { version: recoveryProtocol, kind: "new" }
      : { version: recoveryProtocol, kind: "retry", logicalExecutionId: authority.logicalExecutionId, failedExecutionId: authority.failedExecutionId };
    const createdAt = new Date().toISOString();
    await lock.assertOwned();
    await writeJsonDurable(file, { version: "jackyun-human-dispatch-intent-v1", authorizationId,
      authorityDigest: controlDigest(authority), targetDigest: controlDigest(target), createdAt }, true);
    return { version: "jackyun-human-retry-authority-v1", authorizationId, jackyunRecovery: recovery,
      ...(authority.kind === "retry" ? { originalExecutionId: authority.logicalExecutionId, failedExecutionId: authority.failedExecutionId,
        originalScheduledAt: target.originalScheduledAt } : {}) };
  });
  // The send intent is durable before releasing the profile lock. Do not hold
  // that lock across onReceived: the newly admitted A must acquire it itself.
  const response = await request(`http://127.0.0.1:5678/webhook/${hourlyRetryWebhookPath(jackyunWorkflowId)}`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(prepared), redirect: "error", signal: AbortSignal.timeout(10000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error("人工派发结果尚未确认，请核查原请求，禁止重新 POST。");
  return { ok: true, dispatchStatus: "accepted_pending_execution", authorizationId };
}
