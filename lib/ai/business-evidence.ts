import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoAi } from "@/lib/django/ai-service";
import { PublicApiError } from "@/lib/http/api-error";
import { requireAnalysisPrincipal } from "@/lib/netshop/analysis-tool";

export async function readBusinessEvidenceDirectoryV2(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const args = raw as { runId: string; offset?: number };
  if (!args || typeof args.runId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(args.runId)
    || !Number.isSafeInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 47) {
    throw new PublicApiError(400, "invalid_request", "来源目录参数无效");
  }
  // Version and digest are checked against the immutable report reference by
  // the Django runtime, never accepted as model-controlled trust anchors here.
  const result = await requestDjangoAi<Record<string, unknown>>(principal, {
    path: `/api/ai/business-evidence/${args.runId}/sources`, method: "GET",
    query: new URLSearchParams({ offset: String(args.offset ?? 0), limit: "20" }),
  }, { signal });
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > 38_000) {
    throw new PublicApiError(413, "payload_too_large", "来源目录页超过工具字节容量，不得截断");
  }
  return result.data;
}

export async function readBusinessEvidence(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const args = raw as { runId: string; sourceKey?: string; sequence?: number; rowOffset?: number; rowLimit?: number };
  if ((args.sourceKey === undefined) !== (args.sequence === undefined)) throw new PublicApiError(400, "invalid_request", "读取分块须同时指定 sourceKey 和 sequence");
  if (!args.sourceKey && (args.rowOffset !== undefined || args.rowLimit !== undefined)) throw new PublicApiError(400, "invalid_request", "行分页须指定分块");
  const result = await requestDjangoAi<Record<string, unknown>>(principal, {
    path: `/api/ai/business-evidence/${args.runId}${args.sourceKey ? `/chunks/${args.sourceKey}` : ""}`,
    method: "GET", ...(args.sourceKey ? { query: new URLSearchParams({ sequence: String(args.sequence), rowOffset: String(args.rowOffset ?? 0), rowLimit: String(args.rowLimit ?? 10) }) } : {}),
  }, { signal });
  if (!args.sourceKey) {
    const item = result.data.item as { plan?: { schemaVersion?: string } } | undefined;
    if (item?.plan?.schemaVersion !== "business-evidence-v1") throw new PublicApiError(409, "conflict", "此证据版本使用分页来源目录，当前工具尚未接入，不能声明已读取完整来源");
  }
  if (JSON.stringify(result.data).length > 38_000) throw new PublicApiError(413, "payload_too_large", "证据响应超过工具容量，不得截断；请从任务接口读取完整内容");
  return result.data;
}

export async function readBusinessAnalysisTable(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const { runId, ...args } = raw as { runId: string; sourceKey: string; dimension: string; baselineKey?: string; offset?: number; limit?: number };
  const query = new URLSearchParams({ limit: "10" });
  for (const [key, value] of Object.entries(args)) query.set(key, String(value));
  const result = await requestDjangoAi<Record<string, unknown>>(principal,
    { path: `/api/ai/business-evidence/${runId}/analysis`, method: "GET", query }, { signal });
  if (JSON.stringify(result.data).length > 38_000) throw new PublicApiError(413, "payload_too_large", "分析表页过大，请减小页长，不得截断");
  return result.data;
}

export async function readBusinessAnalysisTableV2(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  const result = await readBusinessAnalysisTable(raw, principal, signal);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 38_000) {
    throw new PublicApiError(413, "payload_too_large", "分析表页超过工具字节容量，请减小页长，不得截断");
  }
  return result;
}

export async function readBusinessBudget(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const { reportId, ...args } = raw as { reportId: string; runId: string; offset?: number; limit?: number };
  const query = new URLSearchParams({ limit: "10" });
  for (const [key, value] of Object.entries(args)) query.set(key, String(value));
  const result = await requestDjangoAi<Record<string, unknown>>(principal,
    { path: `/api/ai/reports/${reportId}/budget`, method: "GET", query }, { signal });
  if (JSON.stringify(result.data).length > 38_000) throw new PublicApiError(413, "payload_too_large", "预算情景页过大，请减小页长，不得截断");
  return result.data;
}

export async function readBusinessBudgetReferenceV1(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const args = raw as { reportId: string; runId: string; offset?: number };
  if (!args || typeof args !== "object" || Array.isArray(args)
    || Object.keys(args).some(key => !["reportId", "runId", "offset"].includes(key))
    || typeof args.reportId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(args.reportId)
    || typeof args.runId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(args.runId)
    || (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 99))) {
    throw new PublicApiError(400, "invalid_request", "固定预算引用参数无效");
  }
  const result = await requestDjangoAi<Record<string, unknown>>(principal, {
    path: `/api/ai/reports/${args.reportId}/budget-reference`, method: "GET",
    query: new URLSearchParams({ runId: args.runId, offset: String(args.offset ?? 0), limit: "20" }),
  }, { signal });
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > 38_000) {
    throw new PublicApiError(413, "payload_too_large", "固定预算页超过工具字节容量，不得截断");
  }
  if (result.data?.schemaVersion !== "business-budget-page-v1") {
    throw new PublicApiError(409, "conflict", "固定预算页协议不匹配");
  }
  return result.data;
}
