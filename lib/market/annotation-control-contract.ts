export type AnnotationControlCommand = {
  action: "set_cloud_run_state";
  jobId: string;
  state: "running" | "paused";
  expectedControlVersion: string;
  operationId: string;
};
export type AnnotationControlResult = {
  operationId: string; requestId: string; jobId: string; targetState: "running" | "paused";
  beforeControlVersion: string; afterControlVersion: string; auditId: string; committedAt: string;
  effectiveState: "running" | "paused" | "completed"; resumeAccepted: boolean; quarantinedExpiredClaims: boolean;
};
export type AnnotationControlOutcome = {
  outcome: "succeeded" | "rejected" | "processing" | "unknown";
  command: AnnotationControlCommand;
  result?: AnnotationControlResult;
  error?: string;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function annotationControlCommand(raw: unknown): AnnotationControlCommand {
  if (!record(raw) || Object.keys(raw).sort().join() !== ["action", "jobId", "state", "expectedControlVersion", "operationId"].sort().join()
    || raw.action !== "set_cloud_run_state" || typeof raw.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.jobId)
    || (raw.state !== "running" && raw.state !== "paused") || typeof raw.expectedControlVersion !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedControlVersion)
    || typeof raw.operationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.operationId)) {
    throw new Error("任务控制请求身份或版本无效");
  }
  return { action: raw.action, jobId: raw.jobId, state: raw.state, expectedControlVersion: raw.expectedControlVersion, operationId: raw.operationId };
}
export const annotationControlRequestId = (command: AnnotationControlCommand) => "annotation-control-" + command.operationId;
export function annotationControlOutcome(command: AnnotationControlCommand, raw: unknown, direct = false): AnnotationControlOutcome {
  const unknown: AnnotationControlOutcome = { outcome: "unknown", command };
  if (!record(raw)) return unknown;
  if (!direct && (raw.operationId !== command.operationId || raw.requestId !== annotationControlRequestId(command)
      || raw.jobId !== command.jobId || raw.targetState !== command.state)) return unknown;
  if (!direct && (raw.outcome === "processing" || raw.outcome === "unknown")) return { ...unknown, outcome: raw.outcome };
  if (!direct && raw.outcome === "rejected" && typeof raw.error === "string" && raw.error.length <= 1000) {
    return { ...unknown, outcome: "rejected", error: raw.error };
  }
  const value = raw.result;
  if ((direct ? raw.ok !== true : raw.outcome !== "succeeded") || !record(value)
      || value.operationId !== command.operationId || value.requestId !== annotationControlRequestId(command)
      || value.jobId !== command.jobId || value.targetState !== command.state || value.beforeControlVersion !== command.expectedControlVersion
      || typeof value.afterControlVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.afterControlVersion)
      || typeof value.auditId !== "string" || !/^[a-f0-9-]{36}$/.test(value.auditId)
      || typeof value.committedAt !== "string" || !Number.isFinite(Date.parse(value.committedAt))
      || !["running", "paused", "completed"].includes(String(value.effectiveState))
      || typeof value.resumeAccepted !== "boolean" || typeof value.quarantinedExpiredClaims !== "boolean") return unknown;
  return { outcome: "succeeded", command, result: value as AnnotationControlResult };
}
