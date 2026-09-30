import { AuthorizationError } from "@/lib/auth/authorization";
import { createDjangoNetshopService, DjangoNetshopServiceResponseError, NETSHOP_PROMOTION_INSIGHTS_PATH, NETSHOP_PROMOTION_INSIGHTS_DETAIL_PATH } from "@/lib/django/netshop-service";
import { PublicApiError } from "@/lib/http/api-error";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { periodKinds } from "@/lib/netshop/insights-contract";
import { NetshopQueryError, netshopOutletKey } from "@/lib/netshop/query-contract";
import { validatePromotionQuery, decodePromotionInsightsForQuery, decodePromotionDetailForQuery, PROMOTION_OBJECT_KINDS, PROMOTION_SORTS } from "@/lib/netshop/promotion-insights-contract";
import { RegistryToolError, validateToolArguments, type AiToolExecutionContext, type JsonSchema } from "./tool-registry-contract";

export const NETSHOP_PROMOTION_INSIGHTS_TOOL_NAME = "get_netshop_promotion_insights";
export const NETSHOP_PROMOTION_DETAIL_TOOL_NAME = "get_netshop_promotion_object_detail";
export const NETSHOP_PROMOTION_AI_TIMEOUT_MS = 30_000;
export const NETSHOP_PROMOTION_AI_MAX_CHARACTERS = 40_000;
export const NETSHOP_PROMOTION_AI_MAX_SOURCE_BYTES = 2 * 1024 * 1024;

const sharedProperties = {
  platform: { type: "string", enum: ["京东", "天猫"], description: "唯一平台，归因定义分别保留；SKU/SPU维度由平台派生，不接受模型指定。" },
  outlets: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", pattern: "^(京东|天猫)\\u001f[^\\u0000-\\u001f\\u007f]{1,100}$" }, description: "精确平台＋U+001F＋完整店名；省略时读取所属reader授权店集合，仍受50店边界。" },
  startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "本期含首尾自然日，最多366天。比较使用F实际期间规则。" },
  periodKind: { type: "string", enum: [...periodKinds], default: "custom" },
  trendGrain: { type: "string", enum: ["day", "week", "month"], default: "day" },
  snapshotToken: { type: "string", pattern: "^[a-f0-9]{64}$", description: "原共享上下文令牌；不可用其他种类的token替代。" },
  sectionToken: { type: "string", pattern: "^[a-f0-9]{64}$", description: "原推广章节令牌；详情必须承接列表该令牌。" },
  objectKind: { type: "string", enum: [...PROMOTION_OBJECT_KINDS], default: "product", description: "计划/单元/关键词/搜索词继续受原管理员、原支持京东单店及1—7天限制。" },
} as const;
export const netshopPromotionInsightsInputSchema = {
  type: "object", properties: { ...sharedProperties,
    q: { type: "string", maxLength: 120, default: "", description: "仅搜索对象列表；全期汇总和完整贡献集合不随搜索变化。" },
    page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 20, default: 20 },
    sort: { type: "string", enum: [...PROMOTION_SORTS], default: "spend_desc" },
  }, required: ["platform", "startDate", "endDate"], additionalProperties: false,
} satisfies JsonSchema;
export const netshopPromotionDetailInputSchema = {
  type: "object", properties: { ...sharedProperties,
    objectId: { type: "string", pattern: "^[a-f0-9]{64}$", description: "上一列表item.rowKey，非商品业务ID，不按名称猜测。" },
    shopKey: { type: "string", pattern: "^(京东|天猫)\\u001f[^\\u0000-\\u001f\\u007f]{1,100}$", description: "原item.shopKey，必须属于同一精确范围。" },
  }, required: ["platform", "startDate", "endDate", "objectKind", "objectId", "shopKey", "sectionToken"], additionalProperties: false,
} satisfies JsonSchema;

function notCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof RegistryToolError) throw signal.reason;
  throw new RegistryToolError("tool_cancelled", "推广只读查询已取消");
}
function promotionQuery(args: Record<string, unknown>, context: AiToolExecutionContext, detail: boolean) {
  try {
    validateToolArguments(args, detail ? netshopPromotionDetailInputSchema : netshopPromotionInsightsInputSchema);
    requireSupportedInsightScope(context.principal);
    const query = new URLSearchParams({ platform: String(args.platform), dimension: args.platform === "京东" ? "sku" : "spu", startDate: String(args.startDate), endDate: String(args.endDate), periodKind: String(args.periodKind ?? "custom"), trendGrain: String(args.trendGrain ?? "day"), objectKind: String(args.objectKind ?? "product") });
    const outlets = (args.outlets ?? []) as string[];
    outlets.forEach(key => query.append("outlet", key));
    for (const key of ["snapshotToken", "sectionToken"] as const) if (args[key] !== undefined) query.set(key, String(args[key]));
    if (detail) {
      query.set("objectId", String(args.objectId)); query.set("shopKey", String(args.shopKey));
    } else {
      query.set("q", String(args.q ?? "")); query.set("page", String(args.page ?? 1)); query.set("pageSize", String(args.pageSize ?? 20)); query.set("sort", String(args.sort ?? "spend_desc"));
    }
    const spec = validatePromotionQuery(query, detail);
    if (spec.context.shops.length !== outlets.length || spec.context.shops.some(shop => !outlets.includes(netshopOutletKey(shop.platform, shop.shopName)))) throw new RegistryToolError("invalid_arguments", "精确店铺身份不能重复或通过空格改变");
    netshopPlatformsForPrincipal(context.principal, [spec.platform]);
    netshopOutletsForPrincipal(context.principal, spec.context.shops, [spec.platform]);
    if (detail && spec.shopKey !== null) {
      const normalized = spec.shopKey.split("\u001f");
      if (normalized.length !== 2 || normalized[1].trim() !== normalized[1]) throw new RegistryToolError("invalid_arguments", "详情必须使用原精确店铺键");
    }
    // Reuse only known existing eligibility (role/platform/span/cardinality).
    // The actual handler owns its fixed shop identity; no guessed/new allowlist.
    if (spec.objectKind !== "product" && (context.principal.role !== "admin" || spec.platform !== "京东" || spec.context.window.days > 7 || spec.context.shops.length > 1)) throw new RegistryToolError("forbidden", "计划、单元及词明细继续只支持原管理员京东单店1—7天范围");
    return query;
  } catch (error) {
    if (error instanceof RegistryToolError) throw error;
    if (error instanceof AuthorizationError) throw new RegistryToolError("forbidden", "当前账号范围不能安全读取推广来源");
    if (error instanceof NetshopQueryError) throw new RegistryToolError("invalid_arguments", error.message);
    throw new RegistryToolError("invalid_arguments", "推广只读参数未通过实际栏目校验");
  }
}
async function readPromotion(args: Record<string, unknown>, context: AiToolExecutionContext, detail: boolean): Promise<Record<string, unknown>> {
  notCancelled(context.signal);
  const query = promotionQuery(args, context, detail);
  const name = detail ? NETSHOP_PROMOTION_DETAIL_TOOL_NAME : NETSHOP_PROMOTION_INSIGHTS_TOOL_NAME;
  let result;
  try {
    result = await createDjangoNetshopService().request<unknown>(context.principal, { method: "GET", path: detail ? NETSHOP_PROMOTION_INSIGHTS_DETAIL_PATH : NETSHOP_PROMOTION_INSIGHTS_PATH, query, service: "reader" }, { signal: context.signal, insightsTimeoutMs: NETSHOP_PROMOTION_AI_TIMEOUT_MS });
  } catch (error) {
    notCancelled(context.signal);
    if (error instanceof PublicApiError) {
      if (error.status === 403) throw new RegistryToolError("forbidden", "推广来源权限或原明细范围不允许读取");
      if (error.status === 409) throw new RegistryToolError("version_conflict", "推广范围、对象或所属来源版本已变化，请重新读取");
      if (error.status === 413 || error instanceof DjangoNetshopServiceResponseError && error.upstreamCode === "quality_incomplete") throw new RegistryToolError("tool_result_too_large", "完整推广来源超出预算，请缩小范围");
      if (error.status === 400 || error.status === 422) throw new RegistryToolError("invalid_arguments", "推广参数或范围未通过所属reader校验");
    }
    throw new RegistryToolError("service_unavailable", "推广所属只读服务不可用，请重新读取");
  }
  notCancelled(context.signal);
  let data;
  try {
    if (new TextEncoder().encode(JSON.stringify(result.data)).length > NETSHOP_PROMOTION_AI_MAX_SOURCE_BYTES) throw new RegistryToolError("tool_result_too_large", "完整推广响应超过2MiB来源预算");
    data = detail ? decodePromotionDetailForQuery(result.data, query, result.revision) : decodePromotionInsightsForQuery(result.data, query, result.revision);
  } catch (error) {
    if (error instanceof RegistryToolError) throw error;
    throw new RegistryToolError("invalid_tool_result", "推广实际DTO、范围、对象或拥有方响应头不一致");
  }
  notCancelled(context.signal);
  if (JSON.stringify({ ok: true, toolName: name, data }).length > NETSHOP_PROMOTION_AI_MAX_CHARACTERS) throw new RegistryToolError("tool_result_too_large", "完整推广信封超过40000字符，请缩小范围；未截断任何来源覆盖");
  return { ...data };
}
export function getNetshopPromotionInsightsForAi(args: Record<string, unknown>, context: AiToolExecutionContext) { return readPromotion(args, context, false); }
export function getNetshopPromotionObjectDetailForAi(args: Record<string, unknown>, context: AiToolExecutionContext) { return readPromotion(args, context, true); }
