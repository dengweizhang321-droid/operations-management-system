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

/** One final failed import invocation is necessary to exclude a forgotten
 * earlier HTTP outcome. A source with repeated D or unfamiliar nodes remains
 * unresolved even if its last error happens to be a known rejection. */
export function assertFreshRestartSerialFailure(data: string, source: boolean) {
  const values: unknown[] = JSON.parse(data);
  if (!Array.isArray(values) || values.length > 10000) throw new Error("从头采集终态格式无效。");
  const ref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
  const obj = (v: unknown): Record<string, unknown> => { const x = ref(v); if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("从头采集终态对象无效。"); return x as Record<string, unknown>; };
  const result = obj(obj(values[0]).resultData), run = obj(result.runData);
  const entry = source ? "D·统一导入运营管理系统" : "A·固定采集日和销售日期";
  const allowed = new Set(["手动运行", "每天本机时间 00:10", "失败后每小时安全重跑", "失败后每小时安全完整重跑", "失败后每小时安全重试入口", "固定原执行计划时间",
    "领取共享 helper", "helper 领取成功？", "等待 helper 空闲", "等待前序流程释放 helper", "A·固定采集日和销售日期", "A·固定采集日和销售日期·恢复等待？", "A·固定采集日和销售日期·等待原任务",
    ...(source ? ["B·接口校验与五表下载", "B·接口校验与五表下载·恢复等待？", "B·接口校验与五表下载·等待原任务", "C·五表完整校验和导入演练", "C·五表完整校验和导入演练·恢复等待？", "C·五表完整校验和导入演练·等待原任务", entry] : [])]);
  const attempts = ref(run[entry]);
  if (Object.keys(run).some(n => !allowed.has(n)) || !Array.isArray(attempts) || attempts.length !== 1
    || ref(obj(attempts[0]).executionStatus) !== "error" || obj(attempts[0]).error === undefined) throw new Error("旧执行存在重复、未知或非确定的 HTTP 调用，禁止从头采集。");
  if (source) for (const stage of ["A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练"]) {
    const tasks = ref(run[stage]);
    if (!Array.isArray(tasks) || tasks.length !== 1 || ref(obj(tasks[0]).executionStatus) !== "success" || obj(tasks[0]).error !== undefined) throw new Error("旧 D 缺少唯一串行 A/B/C 前驱。");
  }
}
