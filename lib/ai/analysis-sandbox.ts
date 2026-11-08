import type { AppPrincipal } from "@/lib/auth/authorization";
import { aiConsumer, aiSha256 } from "@/lib/django/ai-service";
import { createDjangoNetshopService, DjangoNetshopServiceResponseError, NETSHOP_PRODUCT_PERFORMANCE_PATH } from "@/lib/django/netshop-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";
import { AuthorizationError } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { NetshopQueryError, netshopOutletKey, resolveNetshopQueryPeriod } from "@/lib/netshop/query-contract";
export const describeAiAnalysisDatasets = (principal: AppPrincipal) => aiConsumer<Record<string, unknown>>(principal, { operation: "analysis-describe" });
export const runAndRecordAiAnalysisPlan = (input: unknown, principal: AppPrincipal, requestId: string) => aiConsumer<Record<string, unknown>>(principal, { operation: "analysis-plan", input }, { requestId });

export async function runPandasAnalysis(args: Record<string, unknown>, context: AiToolExecutionContext) {
  return aiConsumer<Record<string, unknown>>(context.principal, {
    operation: "pandas-analysis", ...args,
    surface: context.surface === "dingtalk_chat" ? "dingtalk_chat" : "ai_chat",
    parentRequestRef: await aiSha256(context.requestId),
  }, { signal: context.signal, requestId: context.invocationId ?? context.requestId });
}

export async function readPandasProductPage(args: Record<string, unknown>, context: AiToolExecutionContext) {
  const { principal, signal } = context;
  try {
    requireSupportedInsightScope(principal);
    const platform = typeof args.platform === "string" ? args.platform.trim() : "";
    const shop = typeof args.shop === "string" ? args.shop.trim() : "";
    if (shop && !platform) throw new RegistryToolError("invalid_arguments", "店铺必须同时指定平台。");
    const platforms = netshopPlatformsForPrincipal(principal, platform ? [platform] : []);
    resolveNetshopQueryPeriod(args.startDate as string | undefined, args.endDate as string | undefined);
    const snapshot = args.snapshotToken;
    if ((args.page === 1) !== (snapshot === undefined)) {
      throw new RegistryToolError("invalid_arguments", "商品日导出从第一页开始，后续页须绑定来源版本。");
    }
    const query = new URLSearchParams({ dimension: "spu", view: snapshot === undefined ? "full" : "page",
      page: String(args.page), pageSize: String(args.limit ?? 10) });
    for (const value of platforms) query.append("platform", value);
    if (shop) query.set("outlet", netshopOutletKey(platform, shop));
    if (args.startDate) query.set("startDate", String(args.startDate));
    if (args.endDate) query.set("endDate", String(args.endDate));
    if (args.query) query.set("q", String(args.query));
    if (snapshot !== undefined) query.set("snapshotToken", String(snapshot));
    const { data, revision } = await createDjangoNetshopService().request<Record<string, unknown>>(principal, {
      method: "GET", path: NETSHOP_PRODUCT_PERFORMANCE_PATH, query, service: "reader",
    }, { signal });
    if (snapshot !== undefined && data.snapshotToken !== snapshot) {
      throw new RegistryToolError("source_revision_changed", "商品日数据版本已变化，请缩小范围后重新发起。");
    }
    if (!revision || data.sourceRevision !== revision || typeof data.snapshotToken !== "string"
      || !/^[a-f0-9]{64}$/.test(data.snapshotToken) || !Array.isArray(data.items)
      || !data.pagination || typeof data.pagination !== "object" || Array.isArray(data.pagination)) {
      throw new RegistryToolError("invalid_source_structure", "商品日来源缺少完整分页或版本证明。");
    }
    return { items: data.items, pagination: data.pagination, snapshotToken: data.snapshotToken,
      sourceRevision: revision, dataCutoffDate: data.dataCutoffDate ?? null };
  } catch (error) {
    if (error instanceof AuthorizationError || (error instanceof DjangoNetshopServiceResponseError && error.status === 403)) {
      throw new RegistryToolError("access_denied", "当前账号无权导出此网店范围。");
    }
    if (error instanceof NetshopQueryError || (error instanceof DjangoNetshopServiceResponseError && error.status === 400)) {
      throw new RegistryToolError("invalid_arguments", "商品日导出筛选参数无效。");
    }
    if (error instanceof DjangoNetshopServiceResponseError && error.payload.reasonCode === "product_snapshot_changed") {
      throw new RegistryToolError("source_revision_changed", "商品日数据版本已变化，请缩小范围后重新发起。");
    }
    throw error;
  }
}
