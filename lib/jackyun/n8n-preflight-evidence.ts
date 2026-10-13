import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { jackyunWorkflowId } from "./preflight-recovery";
import { decodeN8nPreflightEvidence, isProvenJackyunPreclaimWaiter, n8nEvidenceTime } from "./n8n-preflight-decode";
import { assertRetryContextIdentity, decodeN8nRetryContext, decodeN8nFixedPlanContext } from "./n8n-retry-context";
import { parseRecoveryRequest, type RecoveryRequest } from "./recovery-control";

export type ReplacementExecution = { executionId: string; mode: "manual" | "trigger" | "webhook"; startedAt: string };

// Digest-pinned operational metadata exception: callers cannot choose a path
// or SQL. All business data remains behind its Django/PostgreSQL domain.
export function readN8nReplacementEvidence(executionId: string, replacementExecutionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId) || !/^[1-9]\d{0,19}$/.test(replacementExecutionId)
    || BigInt(replacementExecutionId) <= BigInt(executionId)) throw new Error("恢复 execution 身份无效。");
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const row = db.prepare("SELECT id,workflowId,status,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, jackyunWorkflowId);
    if (!row || row.deletedAt !== null) throw new Error("缺少原 n8n execution。");
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof data !== "string") throw new Error("n8n 运行证据缺失或超限。");
    const current = db.prepare("SELECT id,workflowId,status,mode,startedAt,deletedAt FROM execution_entity WHERE id=?").get(replacementExecutionId);
    if (!current || current.workflowId !== jackyunWorkflowId || current.status !== "running" || current.deletedAt !== null
      || !["manual", "trigger", "webhook"].includes(String(current.mode)) || Date.parse(n8nEvidenceTime(current.startedAt)) < Date.parse(n8nEvidenceTime(row.stoppedAt))) throw new Error("新完整执行未通过 n8n 活动身份核验。");
    const candidates = db.prepare("SELECT id,status FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed') AND id<>? LIMIT 129").all(jackyunWorkflowId, replacementExecutionId);
    if (candidates.length > 128) throw new Error("n8n 活动执行超过核验上限。");
    const active = candidates.filter(candidate => {
      if (candidate.status !== "waiting") return true;
      const raw = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(candidate.id)?.data;
      return typeof raw !== "string" || !isProvenJackyunPreclaimWaiter(raw);
    }).length;
    const replacement: ReplacementExecution = { executionId: String(current.id), mode: String(current.mode) as ReplacementExecution["mode"], startedAt: n8nEvidenceTime(current.startedAt) };
    return { evidence: decodeN8nPreflightEvidence(row, data, active), replacement };
  } finally { db.close(); }
}

function openN8nMetadata() {
  const databasePath = path.join(homedir(), ".n8n", "database.sqlite");
  let currentPath = databasePath;
  while (true) {
    const info = lstatSync(currentPath);
    if (info.isSymbolicLink() || realpathSync(currentPath).toLowerCase() !== path.resolve(currentPath).toLowerCase()
      || (currentPath === databasePath ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) throw new Error("n8n 元数据路径身份异常。");
    const parent = path.dirname(currentPath); if (parent === currentPath) break; currentPath = parent;
  }
  return new DatabaseSync(databasePath, { readOnly: true });
}

/** The new request is read from the persisted fixed entry node, not inferred
 * from active or trusted merely because a caller supplied an execution header. */
export function readN8nJackyunRecoveryEntry(executionId: string, historical?: { allowTerminal?: boolean; humanAuthorizationId?: string;
  dispatch?: { logicalExecutionId: string; failedExecutionId: string; dispatcherExecutionId: string };
  captureDispatch?: { mode?: string; dispatcherExecutionId?: string; humanAuthorizationId?: string; originalScheduledAt?: string } }): RecoveryRequest {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("完整恢复 execution 无效。");
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const current = db.prepare("SELECT workflowId,status,mode,deletedAt FROM execution_entity WHERE id=?").get(executionId);
    if (!current || current.workflowId !== jackyunWorkflowId || (historical?.allowTerminal !== true && current.status !== "running") || current.deletedAt !== null
      || !["manual", "trigger", "webhook"].includes(String(current.mode))) throw new Error("完整恢复执行身份不可核实。");
    const raw = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof raw !== "string") throw new Error("完整恢复入口证据缺失，请核查执行进度持久化配置。");
    const values: unknown[] = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 10000) throw new Error("完整恢复入口格式无效。");
    const deref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const object = (v: unknown): Record<string, unknown> => {
      const x = deref(v); if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("完整恢复入口对象无效。"); return x as Record<string, unknown>;
    };
    const one = (v: unknown) => { const x = deref(v); if (!Array.isArray(x) || x.length !== 1) throw new Error("完整恢复入口不唯一。"); return x[0]; };
    const run = object(object(object(values[0]).resultData).runData);
    const anchor = object(one(run["固定原执行计划时间"]));
    if (deref(anchor.executionStatus) !== "success" || anchor.error !== undefined) throw new Error("完整恢复入口未成功。");
    const json = object(object(one(one(object(anchor.data).main))).json);
    if (deref(json.executionId) !== executionId || deref(json.workflowId) !== jackyunWorkflowId) throw new Error("完整恢复入口绑定不一致。");
    const request = object(json.jackyunRecovery);
    const plain = Object.fromEntries(Object.entries(request).map(([k, v]) => [k, deref(v)]));
    const parsed = parseRecoveryRequest(JSON.stringify(plain));
    if (parsed.kind === "retry" && BigInt(parsed.failedExecutionId) >= BigInt(executionId)) throw new Error("重试不能绑定当前或未来执行。");
    const humanId = deref(json.humanAuthorizationId), dispatcherId = deref(json.retryDispatchExecutionId);
    if (current.mode === "webhook") {
      if (humanId !== null && humanId !== undefined && humanId !== "") {
        if (typeof humanId !== "string" || !/^[a-f0-9-]{36}$/.test(humanId)) throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：人工派发入口授权身份无效。");
      } else if (parsed.kind !== "retry" || typeof dispatcherId !== "string" || !/^[1-9]\d{0,19}$/.test(dispatcherId)
        || BigInt(dispatcherId) <= BigInt(parsed.failedExecutionId) || BigInt(dispatcherId) >= BigInt(executionId)) {
        throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发缺少精确 dispatcher 绑定，禁止绕过持久重试预算。");
      }
    }
    if (historical?.captureDispatch) Object.assign(historical.captureDispatch, { mode: String(current.mode),
      ...(typeof dispatcherId === "string" ? { dispatcherExecutionId: dispatcherId } : {}),
      ...(typeof humanId === "string" && humanId ? { humanAuthorizationId: humanId } : {}), originalScheduledAt: deref(json.scheduledAt) });
    if (historical?.dispatch && (parsed.kind !== "retry" || parsed.logicalExecutionId !== historical.dispatch.logicalExecutionId
      || current.mode !== "webhook" || parsed.failedExecutionId !== historical.dispatch.failedExecutionId || deref(json.retryDispatchExecutionId) !== historical.dispatch.dispatcherExecutionId)) throw new Error("派发执行绑定不一致。");
    if (historical?.humanAuthorizationId && (current.mode !== "webhook" || deref(json.humanAuthorizationId) !== historical.humanAuthorizationId)) throw new Error("人工授权与完整 execution 未绑定。");
    return parsed;
  } finally { db.close(); }
}

export function readN8nJackyunAutomaticDispatch(executionId: string) {
  const captured: { mode?: string; dispatcherExecutionId?: string; humanAuthorizationId?: string; originalScheduledAt?: string } = {};
  const request = readN8nJackyunRecoveryEntry(executionId, { captureDispatch: captured });
  if (captured.mode !== "webhook" || captured.humanAuthorizationId) return null;
  if (request.kind !== "retry" || !captured.dispatcherExecutionId || typeof captured.originalScheduledAt !== "string") throw new Error("JACKYUN_DISPATCH_MANUAL_ACTION：自动派发入口无法确认。");
  return { request, dispatcherExecutionId: captured.dispatcherExecutionId, originalScheduledAt: captured.originalScheduledAt };
}

/** A current modern definition cannot be invoked through legacy headers.
 * Old persisted definitions retain their original protocol, never an inferred
 * fallback from a corrupt/missing modern anchor. */
export function n8nJackyunRequiresRecoveryHeader(executionId: string, allowTerminal = false) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("JACKYUN_ENTRY_MANUAL_ACTION：完整工作流定义身份无效。");
  const db = openN8nMetadata();
  try {
    const row = db.prepare("SELECT workflowId,status,deletedAt FROM execution_entity WHERE id=?").get(executionId);
    if (!row || row.workflowId !== jackyunWorkflowId || row.deletedAt !== null || !allowTerminal && row.status !== "running") throw new Error("JACKYUN_ENTRY_MANUAL_ACTION：完整工作流执行身份无法确认。");
    const raw = db.prepare("SELECT workflowData FROM execution_data WHERE executionId=? AND length(workflowData)<=2097152").get(executionId)?.workflowData;
    if (typeof raw !== "string") throw new Error("JACKYUN_ENTRY_MANUAL_ACTION：原工作流定义缺失或超限，禁止降级为旧入口。");
    const definition = JSON.parse(raw) as { id?: string; meta?: { jackyunRecovery?: string } };
    if (!definition || definition.id !== jackyunWorkflowId || definition.meta?.jackyunRecovery !== undefined
      && definition.meta.jackyunRecovery !== "jackyun-recovery-control-v1") throw new Error("JACKYUN_ENTRY_MANUAL_ACTION：原工作流定义或恢复协议身份异常。");
    return definition.meta?.jackyunRecovery === "jackyun-recovery-control-v1";
  } finally { db.close(); }
}

export function readAcceptedJackyunDispatch(logicalExecutionId: string, failedExecutionId: string, dispatcherExecutionId: string) {
  if (![logicalExecutionId, failedExecutionId, dispatcherExecutionId].every(v => /^[1-9]\d{0,19}$/.test(v))) throw new Error("派发回查身份无效。");
  const db = openN8nMetadata();
  try {
    const rows = db.prepare("SELECT id FROM execution_entity WHERE workflowId=? AND id>? AND deletedAt IS NULL ORDER BY id LIMIT 129").all(jackyunWorkflowId, failedExecutionId);
    if (rows.length > 128) throw new Error("派发回查超过有界窗口，请核查原 dispatcher execution。");
    const matches = rows.filter(row => {
      try { readN8nJackyunRecoveryEntry(String(row.id), { allowTerminal: true, dispatch: { logicalExecutionId, failedExecutionId, dispatcherExecutionId } }); return true; }
      catch { return false; }
    });
    if (matches.length > 1) throw new Error("派发存在多个精确候选，需要人工核查。");
    return matches.length === 1 ? String(matches[0].id) : null;
  } finally { db.close(); }
}

export function readN8nJackyunPlanContext(executionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("计划锚点 execution 无效。");
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const row = db.prepare("SELECT id,workflowId,status,mode,stoppedAt,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, jackyunWorkflowId);
    if (!row || row.deletedAt !== null || !["error", "success"].includes(String(row.status)) || !["manual", "trigger", "webhook"].includes(String(row.mode))) throw new Error("原执行不是可核实的完整终态，请等待或核查。");
    const raw = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof raw !== "string") throw new Error("原计划锚点证据缺失。");
    return decodeN8nFixedPlanContext(row, raw);
  } finally { db.close(); }
}

/** Reads the first fixed anchor while an owner is active without changing or
 * inferring its terminal status. Recovery never recomputes the logical date. */
export function readN8nJackyunOriginalPlanContext(logicalExecutionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(logicalExecutionId)) throw new Error("原逻辑运行身份无效。");
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const row = db.prepare("SELECT id,workflowId,status,mode,stoppedAt,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(logicalExecutionId, jackyunWorkflowId);
    if (!row || row.deletedAt !== null || !["running", "waiting", "error", "success", "canceled", "crashed"].includes(String(row.status))
      || !["manual", "trigger", "webhook"].includes(String(row.mode))) throw new Error("原逻辑运行锚点无法确认。");
    const raw = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(logicalExecutionId)?.data;
    if (typeof raw !== "string") throw new Error("原逻辑运行锚点缺失。");
    const context = decodeN8nFixedPlanContext({ ...row, stoppedAt: row.stoppedAt ?? new Date().toISOString() }, raw);
    if (context.originalExecutionId !== logicalExecutionId) throw new Error("原逻辑运行锚点指向其他运行。");
    return context;
  } finally { db.close(); }
}

export function readAcceptedJackyunHumanDispatch(authorizationId: string, createdAt: string) {
  if (!/^[a-f0-9-]{36}$/.test(authorizationId)) throw new Error("人工派发授权 UUID 无效。");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("人工派发回查时间无效。");
  const since = new Date(Date.parse(createdAt) - 1000).toISOString().replace("T", " ").replace("Z", "");
  const db = openN8nMetadata();
  try {
    const rows = db.prepare("SELECT id,status FROM execution_entity WHERE workflowId=? AND mode='webhook' AND startedAt>=? AND deletedAt IS NULL ORDER BY id DESC LIMIT 129").all(jackyunWorkflowId, since);
    if (rows.length > 128) throw new Error("人工派发回查超过有界窗口，请核对精确授权和 execution。");
    const matches = rows.filter(row => {
      try { readN8nJackyunRecoveryEntry(String(row.id), { allowTerminal: true, humanAuthorizationId: authorizationId }); return true; }
      catch { return false; }
    });
    if (matches.length > 1) throw new Error("同一人工授权出现多个执行尝试，请核查；禁止再次派发。");
    return matches.length === 1 ? { executionId: String(matches[0].id), status: String(matches[0].status) } : null;
  } finally { db.close(); }
}

export function readJackyunFailedStoppedAt(executionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("失败预算 execution 无效。");
  const db = openN8nMetadata();
  try {
    const row = db.prepare("SELECT status,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, jackyunWorkflowId);
    if (!row || row.status !== "error" || row.retrySuccessId !== null || row.deletedAt !== null) throw new Error("失败预算不属于未恢复的终止执行。");
    return n8nEvidenceTime(row.stoppedAt);
  } finally { db.close(); }
}

export function readN8nJackyunOwnerState(executionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("业务 owner execution 无效。");
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000;");
    const row = db.prepare("SELECT status,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, jackyunWorkflowId);
    if (!row || row.deletedAt !== null || !["running", "waiting", "error", "success", "canceled", "crashed"].includes(String(row.status))) throw new Error("原业务 owner 状态无法确认，请核查精确 execution。");
    return String(row.status);
  } finally { db.close(); }
}

export function assertN8nJackyunAAdmission(executionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("完整 A 领取身份无效。");
  const db = openN8nMetadata();
  try {
    const raw = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof raw !== "string") throw new Error("完整 A 执行证据缺失。");
    const values: unknown[] = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 10000) throw new Error("完整 A 格式无效。");
    const ref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const object = (v: unknown): Record<string, unknown> => { const x = ref(v); if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("完整 A 对象无效。"); return x as Record<string, unknown>; };
    const result = object(object(values[0]).resultData), run = object(result.runData), entries = ref(run["A·固定采集日和销售日期"]);
    if (!Array.isArray(entries) || !entries.length || entries.length > 73) throw new Error("未经过当前完整 A，禁止单节点恢复。");
    const latest = object(entries[entries.length - 1]);
    if (ref(latest.executionStatus) !== "success" || latest.error !== undefined) throw new Error("当前 A 尚未成功，禁止业务动作。");
    const main = ref(object(latest.data).main);
    if (!Array.isArray(main) || main.length !== 1) throw new Error("A 结果不唯一。");
    const branch = ref(main[0]); if (!Array.isArray(branch) || branch.length !== 1) throw new Error("A 结果不唯一。");
    const json = object(object(branch[0]).json);
    if (ref(json.ok) !== true || !/^n8n-export-first-[1-9]\d{0,19}$/.test(String(ref(json.runId)))) throw new Error("A 业务领取回执无效。");
  } finally { db.close(); }
}

export function readN8nRetryContext(workflowId: string, executionId: string, retryExecutionId?: string) {
  assertRetryContextIdentity(workflowId, executionId);
  const db = openN8nMetadata();
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const row = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(executionId, workflowId);
    if (!row) throw new Error("retry_context_missing_manual_action");
    if (retryExecutionId !== undefined) {
      if (!/^[1-9]\d{0,19}$/.test(retryExecutionId) || BigInt(retryExecutionId) <= BigInt(executionId)) throw new Error("retry_dispatch_owner_manual_action");
      const owner = db.prepare("SELECT workflowId,status,mode,startedAt,deletedAt FROM execution_entity WHERE id=?").get(retryExecutionId);
      if (!owner || owner.workflowId !== "TeruisiHourlyRetry2026" || owner.status !== "running" || owner.mode !== "error" || owner.deletedAt !== null
        || n8nEvidenceTime(owner.startedAt) < n8nEvidenceTime(row.stoppedAt)) throw new Error("retry_dispatch_owner_manual_action");
    }
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(executionId)?.data;
    if (typeof data !== "string") throw new Error("retry_context_missing_manual_action");
    return decodeN8nRetryContext(row, data);
  } finally { db.close(); }
}
