import {
  ensureSalesSchema,
  getSalesDatabase,
} from "@/lib/sales/database";
import {
  getSalesSummary,
  isSalesRange,
  salesRanges,
  SalesSummaryRequestError,
} from "@/lib/sales/summary";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import { parseShopFilterKey } from "@/lib/sales/shop-identity";
import { parseProductQueriesStrict } from "@/lib/sales/product-query";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import {
  getCachedSalesOverview,
  getSalesOverviewCacheRevision,
  SalesOverviewRevisionChangedError,
  salesOverviewBusinessDate,
} from "@/lib/sales/overview-response-cache";
import { routeSalesReadRequest } from "@/lib/django/sales-gateway";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "销售汇总");
    const searchParams = new URL(request.url).searchParams;
    const requestedViews = searchParams.getAll("view");
    if (requestedViews.length > 1) {
      throw new SalesSummaryRequestError("view 参数不能重复。");
    }
    const requestedView = requestedViews[0] ?? null;
    if (requestedView !== null && requestedView !== "dashboard") {
      throw new SalesSummaryRequestError("view 必须是 dashboard。");
    }
    const requested = searchParams.get("range") ?? "month";
    if (!isSalesRange(requested)) {
      return Response.json(
        { error: `range 必须是 ${salesRanges.join(", ")} 之一` },
        { status: 400 },
      );
    }

    const db = getSalesDatabase();
    await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
    let productQueries: string[];
    try {
      productQueries = parseProductQueriesStrict([
        ...searchParams.getAll("productQuery"),
        searchParams.get("productCodes") ?? "",
      ]);
    } catch (error) {
      throw new SalesSummaryRequestError(error instanceof Error ? error.message : "商品筛选无效");
    }
    const categories = [...new Set([...searchParams.getAll("categories"), ...searchParams.getAll("category")]
      .flatMap((value) => value.split(/[，,;；]+/))
      .map((value) => value.trim())
      .filter(Boolean))];
    if (categories.length > 50 || categories.some((value) => value.length > 100)) {
      throw new SalesSummaryRequestError("品类筛选最多 50 项，且每项不能超过 100 字。");
    }
    const platforms = [...new Set([...searchParams.getAll("platforms"), ...searchParams.getAll("platform")]
      .flatMap((value) => value.split(/[，,;；]+/))
      .map((value) => value.trim())
      .filter(Boolean))];
    if (platforms.length > 50 || platforms.some((value) => value.length > 100)) {
      throw new SalesSummaryRequestError("平台筛选最多 50 项，且每项不能超过 100 字。");
    }
    const rawOutletKeys = [...new Set([...searchParams.getAll("outlet"), ...searchParams.getAll("outlets")]
      .flatMap((value) => value.split(/[，,;；]+/))
      .map((value) => parseShopFilterKey(value.trim()))
    )];
    if (rawOutletKeys.some((value) => value === null)) {
      throw new SalesSummaryRequestError("outlet 必须使用有效的平台与店铺复合键。");
    }
    const outlets = [...new Map(rawOutletKeys
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((value) => [`${value.platform}\u001f${value.shopName}`, value])).values()];
    if (outlets.length > 50) throw new SalesSummaryRequestError("outlet 筛选最多 50 项。");
    const normalizedOutlets = outlets
      .map((value) => ({ platform: value.platform, shop: value.shopName }));
    const summaryInput = {
      range: requested,
      projection: requestedView === "dashboard" ? "dashboard" : "full",
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      productQueries,
      platforms,
      shop: searchParams.get("shop") ?? undefined,
      outlets: normalizedOutlets,
      categories,
    } as const;
    const expectedRevision = await getSalesOverviewCacheRevision(db);
    return routeSalesReadRequest({
      request,
      principal,
      expectedRevision,
      readCurrentRevision: () => getSalesOverviewCacheRevision(db),
      legacy: async () => {
        const result = await getCachedSalesOverview(db, {
          ...summaryInput,
          businessDate: salesOverviewBusinessDate(),
        }, () => getSalesSummary(db, summaryInput));
        const responsePayload = requestedView === "dashboard"
          ? {
              projection: "dashboard" as const,
              range: result.payload.range,
              startDate: result.payload.startDate,
              endDate: result.payload.endDate,
              requestedStartDate: result.payload.requestedStartDate,
              requestedEndDate: result.payload.requestedEndDate,
              dataCutoffDate: result.payload.dataCutoffDate,
              periodAdjustedToDataCutoff: result.payload.periodAdjustedToDataCutoff,
              comparisonDayCount: result.payload.comparisonDayCount,
              current: result.payload.current,
              previous: result.payload.previous,
              yearAgo: result.payload.yearAgo,
              outlets: result.payload.outlets,
              daily: result.payload.daily,
              latestBatch: result.payload.latestBatch,
            }
          : result.payload;
        return Response.json(responsePayload, {
          headers: {
            "cache-control": "no-store",
            "x-sales-overview-cache": result.status,
          },
        });
      },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof SalesSummaryRequestError) {
      return Response.json({ error: error.message, code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof SalesOverviewRevisionChangedError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 503, headers: { "cache-control": "no-store", "retry-after": "1" } },
      );
    }
    return safeApiErrorResponse(error, "读取销售汇总失败。", { headers: { "cache-control": "no-store" } });
  }
}
