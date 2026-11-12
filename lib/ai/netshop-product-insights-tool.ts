import { decodeProductInsights, ProductResponseError, productSorts, validateProductQuery } from "@/app/netshop/products/contract";
import { AuthorizationError } from "@/lib/auth/authorization";
import { createDjangoNetshopService, DjangoNetshopServiceResponseError, NETSHOP_PRODUCT_INSIGHTS_PATH } from "@/lib/django/netshop-service";
import { PublicApiError } from "@/lib/http/api-error";
import { netshopOutletsForPrincipal, netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { NetshopQueryError, netshopOutletKey } from "@/lib/netshop/query-contract";
import { netshopInsightsContextInputSchema } from "./netshop-insights-context-tool";
import { fitNetshopAiResult } from "./netshop-ai-compaction";
import { NETSHOP_AI_VIEWS, projectNetshopAiView, viewHint, viewOf, type AiViewPlan, type NetshopAiView } from "./netshop-ai-view";
import { compactProductInsightsForAi, productCompactionLadder } from "./netshop-product-compaction";
import { RegistryToolError, validateToolArguments, type AiToolExecutionContext, type JsonSchema } from "./tool-registry-contract";

export const NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME = "get_netshop_product_insights";
export const NETSHOP_PRODUCT_INSIGHTS_AI_TIMEOUT_MS = 30_000;
export const NETSHOP_PRODUCT_INSIGHTS_AI_MAX_CHARACTERS = 40_000;
/**
 * AI-side default page size per view (JSON schema cannot express per-view defaults, so the schema carries none and the
 * description states them). overview drops every row-bearing section, so 1; rankings: pageSize is the number of growth and
 * watchlist ranking rows (product_insights.py page/pageSize), 10; list: current-page rows, 4. The owning reader still allows up to 20.
 */
export const PRODUCT_SECTION_TOKEN_PAGE_SIZE_MESSAGE = "sectionToken绑定q/category/sort/pageSize：续读须传与取得该令牌时相同的pageSize（见上次结果的aiView.pageSize）；换视图且改pageSize时不要带sectionToken";
export const NETSHOP_PRODUCT_INSIGHTS_AI_DEFAULT_PAGE_SIZES: Record<NetshopAiView, number> = { overview: 1, rankings: 10, list: 4 };

/** What each view carries; `watchlist` is the pseudo key for sections.efficiency.watchlist. Coverage-bearing context, tokens and dataQuality are always kept. */
export const NETSHOP_PRODUCT_VIEW_PLAN: AiViewPlan = {
  always: ["dataQuality", "metadata"],
  keep: {
    overview: ["summary", "comparisons", "counts", "structure", "efficiency", "metadata", "baselineReads"],
    rankings: ["growth", "efficiency", "watchlist"],
    list: ["items", "pagination"],
  },
  reasons: {
    summary: "整期汇总属于总览", comparisons: "环比/同比比较属于总览", counts: "商品数口径属于总览", structure: "类目与价格带结构属于总览",
    efficiency: "效率汇总与关注规则不在本视图", metadata: "口径元数据属于总览", baselineReads: "基期读取回执属于总览",
    growth: "贡献排行行属于排名视图", watchlist: "低转化关注清单属于排名视图", items: "当前页商品行属于列表视图", pagination: "分页回执随当前页商品行属于列表视图",
  },
};

export const netshopProductInsightsInputSchema = {
  type: "object",
  properties: {
    ...netshopInsightsContextInputSchema.properties,
    q: { type: "string", maxLength: 120, description: "仅筛选主列表名称、精确ID或商家码；不改变上方经营汇总。" },
    category: { type: "string", maxLength: 120, description: "经营范围内的来源类目标签；不是跨平台官方分类ID。" },
    page: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
    view: { type: "string", enum: [...NETSHOP_AI_VIEWS], default: "overview", description: "overview(默认)=整体/环比同比/周报；rankings=涨跌最大/Top N排名行；list=当前页商品行及分页。不同视图省略的内容见返回的aiView.omitted。view只决定返回哪些已校验内容，不发送给后端。" },
    pageSize: { type: "integer", minimum: 1, maximum: 20, description: "行数；省略时按view取默认（schema无法按view给默认值）：overview=1（总览不含行）、rankings=10（即增长贡献与低转化关注清单各取的排名行数）、list=4（当前页商品行数；14分类重场景下5行约39.5K，故默认4）。调大更易超过40000字符被拒绝。" },
    sort: { type: "string", enum: [...productSorts], default: "payment_desc" },
    sectionToken: { type: "string", pattern: "^[a-f0-9]{64}$", description: "同一商品列表范围及排序分页的所属令牌；不得与其他类型令牌替换。令牌绑定q/category/sort/pageSize，带令牌时必须显式传与取得该令牌时相同的pageSize（结果aiView.pageSize即此值），否则直接拒绝且不发请求；换视图且改pageSize时不要带sectionToken。" },
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
    // The owner's sectionToken is bound to pageSize (product_insights.py _section_token); the AI default pageSize differs per view,
    // so a token without an explicit pageSize would 409 whenever the view changed. Refuse before any request.
    if (args.sectionToken !== undefined && args.pageSize === undefined) throw new RegistryToolError("invalid_arguments", PRODUCT_SECTION_TOKEN_PAGE_SIZE_MESSAGE);
    requireSupportedInsightScope(context.principal);
    for (const platform of args.platforms as string[]) query.append("platform", platform);
    const shops = (args.shops ?? []) as Array<{ platform: string; shopName: string }>;
    for (const shop of shops) query.append("outlet", netshopOutletKey(shop.platform, shop.shopName));
    query.set("dimension", String(args.dimension ?? "spu"));
    query.set("periodKind", String(args.periodKind ?? "custom"));
    query.set("startDate", String(args.startDate));
    query.set("endDate", String(args.endDate));
    query.set("page", String(args.page ?? 1));
    query.set("pageSize", String(args.pageSize ?? NETSHOP_PRODUCT_INSIGHTS_AI_DEFAULT_PAGE_SIZES[viewOf(args)]));
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
  // The owning DTO is returned unchanged whenever its complete envelope fits.
  // Otherwise a marked model-facing view (aiCompaction) is built from the already
  // decoded data; if even that does not fit, refuse rather than clip text.
  // The central runtime owns invocation limits and mandatory audit.
  const view = viewOf(args);
  const projected = projectNetshopAiView(data as Record<string, unknown>, view, NETSHOP_PRODUCT_VIEW_PLAN, (sections, builder) => {
    const efficiency = sections.efficiency as Record<string, any> | undefined;
    if (view === "overview" && efficiency && Array.isArray(efficiency.watchlist)) {
      const { watchlist, pagination: _pagination, ...rest } = efficiency;
      sections.efficiency = rest;
      builder.omit("sections.efficiency.watchlist", "watchlist", `低转化关注清单（本页${watchlist.length}行）及其分页回执不属于总览`);
    }
    const metadata = sections.metadata as Record<string, any> | undefined;
    if (view !== "overview" && metadata) {
      sections.metadata = { limitations: metadata.limitations };
      builder.omit("sections.metadata(limitations以外)", "metadata", "口径元数据属于总览；limitations始终保留");
    }
    return sections;
  });
  // The pageSize actually sent, so a follow-up call with sectionToken can repeat it.
  (projected.aiView as { pageSize?: number }).pageSize = Number(query.get("pageSize"));
  const fitted = fitNetshopAiResult(NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME, projected, NETSHOP_PRODUCT_INSIGHTS_AI_MAX_CHARACTERS, productCompactionLadder.map(level => (source: Record<string, unknown>) => compactProductInsightsForAi(source, level)));
  if (fitted === null) throw new RegistryToolError("tool_result_too_large", `商品表现精简后仍超过40000字符信封预算，请缩小店铺或日期范围、改用其他视图（${viewHint(NETSHOP_AI_VIEWS.filter(item => item !== view))}）或减小pageSize；覆盖缺口未被裁去`);
  return fitted;
}
