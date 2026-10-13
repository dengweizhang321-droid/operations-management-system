import { recoverySha, type PreflightEvidence } from "./preflight-recovery";

/** Absence of A alone proves nothing: require every recorded claim to have
 * returned waiting, and reject unknown nodes or any grant in the history. */
export function isProvenJackyunPreclaimWaiter(data: string): boolean {
  try {
    if (Buffer.byteLength(data, "utf8") > 1048576) return false;
    const values: unknown[] = JSON.parse(data);
    if (!Array.isArray(values) || !values.length || values.length > 10000) return false;
    const deref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown): Record<string, unknown> => {
      const x = deref(v); if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("invalid");
      return x as Record<string, unknown>;
    };
    const arr = (v: unknown): unknown[] => { const x = deref(v); if (!Array.isArray(x)) throw new Error("invalid"); return x; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData);
    const allowed = new Set(["手动运行", "每天本机时间 00:10", "失败后每小时安全完整重跑", "失败后每小时安全重试入口",
      "固定原执行计划时间", "领取共享 helper", "helper 领取成功？", "等待 helper 空闲", "等待前序流程释放 helper"]);
    if (Object.keys(run).some(n => !allowed.has(n)) || result.error !== undefined) return false;
    const claims = arr(run["领取共享 helper"]);
    if (!claims.length || claims.length > 73) return false;
    return claims.every(value => {
      const task = obj(value);
      if (task.error !== undefined || deref(task.executionStatus) !== "success") return false;
      const main = arr(obj(task.data).main);
      if (main.length !== 1) return false;
      const items = arr(main[0]); if (items.length !== 1) return false;
      const json = obj(obj(items[0]).json);
      return deref(json.ok) === true && deref(json.coordinationStatus) === "waiting"
        && deref(json.workflow) === "jackyun";
    });
  } catch { return false; }
}

export function n8nEvidenceTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) throw new Error("n8n 时间证据不明确。");
  const utc = value.replace(" ", "T") + "Z", parsed = Date.parse(utc);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== utc) throw new Error("n8n 时间证据不明确。");
  return utc;
}

/** Decode only diagnostics, never request headers, tokens or complete node outputs. */
export function decodeN8nPreflightEvidence(row: Record<string, unknown>, data: string, activeExecutions: number): PreflightEvidence {
  const values = JSON.parse(data) as unknown[];
  if (!Array.isArray(values) || !values.length || values.length > 10000) throw new Error("n8n 证据格式不支持。");
  const deref = (value: unknown): unknown => typeof value === "string" && /^\d+$/.test(value) ? values[Number(value)] : value;
  const object = (value: unknown): Record<string, unknown> => {
    const result = deref(value);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("n8n 诊断对象格式不支持。");
    return result as Record<string, unknown>;
  };
  const root = object(values[0]), result = object(root.resultData), error = object(result.error), node = object(error.node), parameters = object(node.parameters);
  return { executionId: String(row.id), workflowId: String(row.workflowId), status: String(row.status),
    startedAt: n8nEvidenceTime(row.startedAt), stoppedAt: n8nEvidenceTime(row.stoppedAt), retrySuccessId: row.retrySuccessId === null ? null : String(row.retrySuccessId),
    lastNode: String(deref(result.lastNodeExecuted)), runNodes: Object.keys(object(result.runData)),
    error: String(deref(error.description)), httpCode: String(deref(error.httpCode)), requestUrl: String(deref(parameters.url)),
    executionDataSha256: recoverySha(data), activeExecutions };
}
