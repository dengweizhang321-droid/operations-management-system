import { decodeProductInsights, ProductResponseError, productSorts, validateProductQuery } from "@/app/netshop/products/contract";
import { AuthorizationError } from "@/lib/auth/authorization";
import { createDjangoNetshopService, DjangoNetshopServiceResponseError, NETSHOP_PRODUCT_INSIGHTS_PATH } from "@/lib/django/netshop-service";
import { PublicApiError } from "@/lib/http/api-error";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { NetshopQueryError, netshopOutletKey } from "@/lib/netshop/query-contract";
import { netshopInsightsContextInputSchema } from "./netshop-insights-context-tool";
import { RegistryToolError, validateToolArguments, type AiToolExecutionContext, type JsonSchema } from "./tool-registry-contract";

export const NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME = "get_netshop_product_insights";
export const NETSHOP_PRODUCT_INSIGHTS_AI_TIMEOUT_MS = 30_000;
export const NETSHOP_PRODUCT_INSIGHTS_AI_MAX_CHARACTERS = 40_000;

export const netshopProductInsightsInputSchema = {
  type: "object",
  properties: {
    ...netshopInsightsContextInputSchema.properties,
    q: { type: "string", maxLength: 120, description: "仅筛选主列表名称、精确ID或商家码；不改变上方经营汇总。" },
    category: { type: "string", maxLength: 120, description: "经营范围内的来源类目标签；不是跨平台官方分类ID。" },
    page: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    sort: { type: "string", enum: [...productSorts], default: "payment_desc" },
    sectionToken: { type: "string", pattern: "^[a-f0-9]{64}$", description: "同一商品列表范围及排序分页的所属令牌；不得与其他类型令牌替换。" },
  },
  required: [...netshopInsightsContextInputSchema.required],
  additionalProperties: false,
} satisfies JsonSchema;

function requireNotCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof RegistryToolError) throw signal.reason;
  throw new RegistryToolError("tool_cancelled", "商品表现读取已取消");
}

export async function getNetshopProductInsightsForAi(args: Record<string, unknown>, context: AiToolExecutionContext): Promise<Record<string, unknown>> {
  requireNotCancelled(context.signal);
  const query = new URLSearchParams();
  try {
    validateToolArguments(args, netshopProductInsightsInputSchema);
    requireSupportedInsightScope(context.principal);
    for (const platform of args.platforms as string[]) query.append("platform", platform);
    const shops = (args.shops ?? []) as Array<{ platform: string; shopName: string }>;
    for (const shop of shops) query.append("outlet", netshopOutletKey(shop.platform, shop.shopName));
    query.set("dimension", String(args.dimension ?? "spu"));
    query.set("periodKind", String(args.periodKind ?? "custom"));
    query.set("startDate", String(args.startDate));
    query.set("endDate", String(args.endDate));
    query.set("page", String(args.page ?? 1));
    query.set("pageSize", String(args.pageSize ?? 5));
    query.set("sort", String(args.sort ?? "payment_desc"));
    for (const key of ["q", "category", "snapshotToken", "sectionToken"] as const) {
      if (args[key] !== undefined) query.set(key, String(args[key]));
    }
    const spec = validateProductQuery(query);
    if (spec.shared.shops.length !== shops.length) throw new RegistryToolError("invalid_arguments", "店铺身份规范化后不能重复");
    netshopPlatformsForPrincipal(context.principal, spec.shared.platforms);
    netshopOutletsForPrincipal(context.principal, spec.shared.shops, spec.shared.platforms);
  } catch (error) {
    if (error instanceof RegistryToolError) throw error;
    if (error instanceof AuthorizationError) throw new RegistryToolError("forbidden", "当前账号范围不能安全读取此商品表现");
    if (error instanceof NetshopQueryError) throw new RegistryToolError("invalid_arguments", error.message);
    throw new RegistryToolError("invalid_arguments", "商品表现参数无效");
  }

  let result;
  try {
    result = await createDjangoNetshopService().request<unknown>(context.principal,
      { method: "GET", path: NETSHOP_PRODUCT_INSIGHTS_PATH, query, service: "reader" },
      { signal: context.signal, insightsTimeoutMs: NETSHOP_PRODUCT_INSIGHTS_AI_TIMEOUT_MS });
  } catch (error) {
    requireNotCancelled(context.signal);
    if (error instanceof PublicApiError) {
      if (error.status === 403) throw new RegistryToolError("forbidden", "取数期间账号或权限已变化");
      if (error.status === 409) throw new RegistryToolError("version_conflict", "商品范围或来源版本已变化，请重新读取");
      if (error.status === 413 || error instanceof DjangoNetshopServiceResponseError && error.upstreamCode === "quality_incomplete") throw new RegistryToolError("tool_result_too_large", "完整商品表现超过预算，请缩小店铺、日期或每页范围");
      if (error.status === 400 || error.status === 422) throw new RegistryToolError("invalid_arguments", "商品范围、日期或筛选未通过所属reader校验");
    }
    throw new RegistryToolError("service_unavailable", "商品表现读取失败，请重新读取");
  }
  requireNotCancelled(context.signal);
  let data;
  try {
    data = decodeProductInsights(result.data, query, result.revision);
  } catch (error) {
    if (error instanceof ProductResponseError) {
      if (error.status === 403) throw new RegistryToolError("forbidden", "商品基期读取权限失效，请重新读取当前授权范围");
      throw new RegistryToolError("version_conflict", "商品基期来源版本变化，请完整重读");
    }
    throw new RegistryToolError("invalid_tool_result", "商品表现回执、请求范围或所属来源版本不一致");
  }
  requireNotCancelled(context.signal);
  if (JSON.stringify({ ok: true, toolName: NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME, data }).length > NETSHOP_PRODUCT_INSIGHTS_AI_MAX_CHARACTERS) {
    throw new RegistryToolError("tool_result_too_large", "完整商品表现超过40000字符信封预算，请缩小店铺、日期或每页范围");
  }
  // Preserve the owning DTO: no page-derived summary, compact coverage or new
  // audit fields. The central runtime owns invocation limits and mandatory audit.
  return { ...data };
}
