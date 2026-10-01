import { AuthorizationError } from "@/lib/auth/authorization";
import { createDjangoNetshopService, DjangoNetshopServiceResponseError, NETSHOP_INSIGHTS_CONTEXT_PATH } from "@/lib/django/netshop-service";
import { PublicApiError } from "@/lib/http/api-error";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { decodeInsightsContextForQuery, periodKinds, validateContextQuery } from "@/lib/netshop/insights-contract";
import { NetshopQueryError, netshopOutletKey } from "@/lib/netshop/query-contract";
import { RegistryToolError, validateToolArguments, type AiToolExecutionContext, type JsonSchema } from "./tool-registry-contract";

export const NETSHOP_INSIGHTS_CONTEXT_TOOL_NAME = "get_netshop_insights_context";
export const NETSHOP_INSIGHTS_AI_TIMEOUT_MS = 30_000;
export const NETSHOP_INSIGHTS_AI_MAX_CHARACTERS = 40_000;

export const netshopInsightsContextInputSchema = {
  type: "object",
  properties: {
    platforms: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["京东", "天猫"] } },
    shops: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: {
      type: "object", properties: {
        platform: { type: "string", enum: ["京东", "天猫"] },
        shopName: { type: "string", minLength: 1, maxLength: 100 },
      }, required: ["platform", "shopName"], additionalProperties: false,
    }, description: "精确平台与店铺身份；省略时读取授权平台内全部店铺，仍受50店上限约束。" },
    dimension: { type: "string", enum: ["sku", "spu"], default: "spu", description: "天猫尚无SKU日经营源；SKU/SPU不能混用。" },
    startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "本期含首尾日，最多366天；比较日期由所属reader按共享规则产生。" },
    periodKind: { type: "string", enum: [...periodKinds], default: "custom" },
    snapshotToken: { type: "string", pattern: "^[a-f0-9]{64}$", description: "同一上下文重读时可传上次令牌；范围或版本改变时明确拒绝。" },
  },
  required: ["platforms", "startDate", "endDate"],
  additionalProperties: false,
} satisfies JsonSchema;

function requireNotCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof RegistryToolError) throw signal.reason;
  throw new RegistryToolError("tool_cancelled", "共享上下文读取已取消");
}

export async function getNetshopInsightsContextForAi(args: Record<string, unknown>, context: AiToolExecutionContext): Promise<Record<string, unknown>> {
  requireNotCancelled(context.signal);
  const query = new URLSearchParams();
  try {
    validateToolArguments(args, netshopInsightsContextInputSchema);
    requireSupportedInsightScope(context.principal);
    for (const platform of args.platforms as string[]) query.append("platform", platform);
    const shops = (args.shops ?? []) as Array<{ platform: string; shopName: string }>;
    for (const shop of shops) query.append("outlet", netshopOutletKey(shop.platform, shop.shopName));
    query.set("dimension", String(args.dimension ?? "spu"));
    query.set("periodKind", String(args.periodKind ?? "custom"));
    query.set("startDate", String(args.startDate));
    query.set("endDate", String(args.endDate));
    if (args.snapshotToken !== undefined) query.set("snapshotToken", String(args.snapshotToken));
    const spec = validateContextQuery(query);
    if (spec.shops.length !== shops.length) throw new RegistryToolError("invalid_arguments", "店铺身份规范化后不能重复");
    netshopPlatformsForPrincipal(context.principal, spec.platforms);
    netshopOutletsForPrincipal(context.principal, spec.shops, spec.platforms);
  } catch (error) {
    if (error instanceof RegistryToolError) throw error;
    if (error instanceof AuthorizationError) throw new RegistryToolError("forbidden", "当前账号范围不能安全读取此网店上下文");
    if (error instanceof NetshopQueryError) throw new RegistryToolError("invalid_arguments", error.message);
    throw new RegistryToolError("invalid_arguments", "共享上下文参数无效");
  }

  let result;
  try {
    result = await createDjangoNetshopService().request<unknown>(context.principal,
      { method: "GET", path: NETSHOP_INSIGHTS_CONTEXT_PATH, query, service: "reader" },
      { signal: context.signal, insightsTimeoutMs: NETSHOP_INSIGHTS_AI_TIMEOUT_MS });
  } catch (error) {
    requireNotCancelled(context.signal);
    if (error instanceof PublicApiError) {
      if (error.status === 403) throw new RegistryToolError("forbidden", "取数期间账号或权限已变化");
      if (error.status === 409) throw new RegistryToolError("version_conflict", "共享范围或来源版本已变化，请重新读取");
      if (error.status === 413 || error instanceof DjangoNetshopServiceResponseError && error.upstreamCode === "quality_incomplete") throw new RegistryToolError("tool_result_too_large", "完整上下文超过预算，请缩小店铺或日期范围");
      if (error.status === 400 || error.status === 422) throw new RegistryToolError("invalid_arguments", "共享范围、日期或维度未通过所属reader校验");
    }
    throw new RegistryToolError("service_unavailable", "共享上下文读取失败，请重新读取");
  }
  requireNotCancelled(context.signal);
  let data;
  try {
    data = decodeInsightsContextForQuery(result.data, query, result.revision);
  } catch {
    throw new RegistryToolError("invalid_tool_result", "共享上下文回执、请求范围或所属来源版本不一致");
  }
  requireNotCancelled(context.signal);
  if (JSON.stringify({ ok: true, toolName: NETSHOP_INSIGHTS_CONTEXT_TOOL_NAME, data }).length > NETSHOP_INSIGHTS_AI_MAX_CHARACTERS) {
    throw new RegistryToolError("tool_result_too_large", "完整上下文超过40000字符信封预算，请缩小店铺或日期范围");
  }
  // Keep the complete validated DTO, including the daily comparison calendar.
  // The registry owns invocation budgets, role/surface gates and mandatory audit.
  return { ...data };
}
