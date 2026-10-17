import type { AppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal, requireSupportedInsightScope } from "@/lib/netshop/access";
import { netshopOutletKey, resolveNetshopQueryPeriod } from "@/lib/netshop/query-contract";
import { createDjangoNetshopService, NETSHOP_PRODUCT_PERFORMANCE_PATH, NETSHOP_PROMOTION_PERFORMANCE_PATH } from "@/lib/django/netshop-service";
import { RegistryToolError, type AiToolExecutionContext } from "@/lib/ai/tool-registry-contract";

/** A new Pi surface over existing paged, authorized domain readers. */
export async function readPiNetshopPage(args: Record<string, unknown>, context: AiToolExecutionContext) {
  if (context.surface !== "pi_agent") throw new RegistryToolError("forbidden", "仅 Pi 分页导出可使用此读取。");
  const principal: AppPrincipal = context.principal;
  requireSupportedInsightScope(principal);
  const platforms = netshopPlatformsForPrincipal(principal, args.platform ? [String(args.platform)] : []);
  const shop = typeof args.shop === "string" ? args.shop.trim() : "";
  if (shop && !args.platform) throw new RegistryToolError("invalid_arguments", "店铺必须同时指定平台。");
  resolveNetshopQueryPeriod(args.startDate as string | undefined, args.endDate as string | undefined);
  const query = new URLSearchParams({ page: String(args.page ?? 1), pageSize: String(args.limit ?? 20) });
  for (const platform of platforms) query.append("platform", platform);
  if (shop) query.append("outlet", netshopOutletKey(String(args.platform), shop));
  for (const key of ["startDate", "endDate"]) if (args[key]) query.set(key, String(args[key]));
  if (args.query) query.set("q", String(args.query));
  const promotion = args.dataset === "promotion";
  if (!promotion) { query.set("dimension", "spu"); query.set("view", "full"); }
  const result = await createDjangoNetshopService().request<Record<string, unknown>>(principal, {
    method: "GET", path: promotion ? NETSHOP_PROMOTION_PERFORMANCE_PATH : NETSHOP_PRODUCT_PERFORMANCE_PATH, query, service: "reader",
  }, { signal: context.signal });
  const data = result.data;
  if (!Array.isArray(data.items) || !data.pagination || typeof data.pagination !== "object") throw new RegistryToolError("service_unavailable", "网店来源缺少分页完整性证明。");
  // Retain the owning domain's full page metadata and revision. A page is not
  // itself a complete snapshot; the asynchronous exporter must follow it.
  return { ...data, dataset: promotion ? "promotion" : "product_daily", sourceRevision: result.revision,
    sourceDomain: "netshop", returned: data.items.length, consistency: "live_per_page",
    units: { monetary: "CNY_cents", visitor: "product_day_sum" },
    filtersApplied: { platforms, shop: shop || null, startDate: args.startDate ?? null, endDate: args.endDate ?? null } };
}
