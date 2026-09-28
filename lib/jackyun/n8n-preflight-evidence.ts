import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { jackyunWorkflowId } from "./preflight-recovery";
import { decodeN8nPreflightEvidence, n8nEvidenceTime } from "./n8n-preflight-decode";
import { assertRetryContextIdentity, decodeN8nRetryContext } from "./n8n-retry-context";

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
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed') AND id<>?").get(jackyunWorkflowId, replacementExecutionId);
    const replacement: ReplacementExecution = { executionId: String(current.id), mode: String(current.mode) as ReplacementExecution["mode"], startedAt: n8nEvidenceTime(current.startedAt) };
    return { evidence: decodeN8nPreflightEvidence(row, data, Number(active?.count)), replacement };
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
