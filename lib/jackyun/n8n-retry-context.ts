import { hourlyRetryTargets } from "../../tools/n8n-hourly-retry-policy.mjs";
import { n8nEvidenceTime } from "./n8n-preflight-decode";

export const retryContextProtocol = "teruisi-retry-context-v1";
export const retryAnchorNode = "固定原执行计划时间";

export function assertRetryContextIdentity(workflowId: string, executionId: string) {
  if (!hourlyRetryTargets.some(target => target.workflowId === workflowId) || !/^[1-9]\d{0,19}$/.test(executionId)) {
    throw new Error("retry_context_identity_manual_action");
  }
}

// Only traverse the fixed anchor node, never recursively expose stored inputs,
// headers, credentials or other node output from the n8n flatted document.
export function decodeN8nRetryContext(row: Record<string, unknown>, raw: string) {
  assertRetryContextIdentity(String(row.workflowId), String(row.id));
  if (row.status !== "error" || !["trigger", "webhook"].includes(String(row.mode))
    || row.deletedAt !== null || row.retrySuccessId !== null || raw.length > 1048576) throw new Error("retry_context_not_terminal_manual_action");
  const started = n8nEvidenceTime(row.startedAt), stopped = n8nEvidenceTime(row.stoppedAt);
  if (stopped < started) throw new Error("retry_context_time_manual_action");
  const values = JSON.parse(raw) as unknown[];
  if (!Array.isArray(values) || !values.length || values.length > 10000) throw new Error("retry_context_format_manual_action");
  const deref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
  const object = (v: unknown): Record<string, unknown> => {
    const o = deref(v);
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("retry_context_object_manual_action");
    return o as Record<string, unknown>;
  };
  const one = (v: unknown): unknown => {
    const a = deref(v);
    if (!Array.isArray(a) || a.length !== 1) throw new Error("retry_context_ambiguous_manual_action");
    return a[0];
  };
  const run = object(object(object(values[0]).resultData).runData);
  const task = object(one(run[retryAnchorNode]));
  if (task.error !== undefined || deref(task.executionStatus) !== "success") throw new Error("retry_context_anchor_failed_manual_action");
  const anchor = object(object(one(one(object(task.data).main))).json);
  const scheduledAt = deref(anchor.scheduledAt), originalExecutionId = deref(anchor.originalExecutionId);
  if (deref(anchor.version) !== retryContextProtocol || deref(anchor.workflowId) !== String(row.workflowId)
    || deref(anchor.executionId) !== String(row.id)
    || typeof originalExecutionId !== "string" || !/^[1-9]\d{0,19}$/.test(originalExecutionId)
    || BigInt(originalExecutionId) > BigInt(String(row.id))
    || typeof scheduledAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scheduledAt)
    || !Number.isFinite(Date.parse(scheduledAt)) || new Date(scheduledAt).toISOString() !== scheduledAt || scheduledAt > stopped) {
    throw new Error("retry_context_binding_manual_action");
  }
  return { version: retryContextProtocol, workflowId: String(row.workflowId), failedExecutionId: String(row.id),
    originalExecutionId, originalScheduledAt: scheduledAt };
}
