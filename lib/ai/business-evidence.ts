import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoAi } from "@/lib/django/ai-service";
import { PublicApiError } from "@/lib/http/api-error";
import { requireAnalysisPrincipal } from "@/lib/netshop/analysis-tool";

export async function readBusinessEvidence(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const args = raw as { runId: string; sourceKey?: string; sequence?: number; rowOffset?: number; rowLimit?: number };
  if ((args.sourceKey === undefined) !== (args.sequence === undefined)) throw new PublicApiError(400, "invalid_request", "读取分块须同时指定 sourceKey 和 sequence");
  if (!args.sourceKey && (args.rowOffset !== undefined || args.rowLimit !== undefined)) throw new PublicApiError(400, "invalid_request", "行分页须指定分块");
  const result = await requestDjangoAi<Record<string, unknown>>(principal, {
    path: `/api/ai/business-evidence/${args.runId}${args.sourceKey ? `/chunks/${args.sourceKey}` : ""}`,
    method: "GET", ...(args.sourceKey ? { query: new URLSearchParams({ sequence: String(args.sequence), rowOffset: String(args.rowOffset ?? 0), rowLimit: String(args.rowLimit ?? 10) }) } : {}),
  }, { signal });
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
