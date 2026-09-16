import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoAi } from "@/lib/django/ai-service";
import { PublicApiError } from "@/lib/http/api-error";
import { requireAnalysisPrincipal } from "@/lib/netshop/analysis-tool";

export async function readBusinessEvidence(raw: unknown, principal: AppPrincipal, signal?: AbortSignal) {
  requireAnalysisPrincipal(principal);
  const args = raw as { runId: string; sourceKey?: string; sequence?: number };
  if ((args.sourceKey === undefined) !== (args.sequence === undefined)) throw new PublicApiError(400, "invalid_request", "读取分块须同时指定 sourceKey 和 sequence");
  const result = await requestDjangoAi<Record<string, unknown>>(principal, {
    path: `/api/ai/business-evidence/${args.runId}${args.sourceKey ? `/chunks/${args.sourceKey}` : ""}`,
    method: "GET", ...(args.sourceKey ? { query: new URLSearchParams({ sequence: String(args.sequence) }) } : {}),
  }, { signal });
  if (JSON.stringify(result.data).length > 38_000) throw new PublicApiError(413, "payload_too_large", "证据响应超过工具容量，不得截断；请从任务接口读取完整内容");
  return result.data;
}
