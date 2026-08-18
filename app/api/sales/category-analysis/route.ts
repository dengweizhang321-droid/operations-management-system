import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import {
  getSalesCategoryAnalysis,
  SalesCategoryAccessError,
  SalesCategoryRequestError,
  salesCategoryGranularities,
  salesCategorySortKeys,
  type SalesCategoryGranularity,
  type SalesCategorySortKey,
} from "@/lib/sales/category-analysis";
import { ensureSalesSchema, getSalesDatabase } from "@/lib/sales/database";
import { parseProductQueries } from "@/lib/sales/product-query";
import { parseShopFilterKey } from "@/lib/sales/shop-identity";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function selections(params: URLSearchParams, ...keys: string[]) {
  return [...new Set(keys.flatMap((key) => params.getAll(key))
    .flatMap((value) => value.split(/[，,;；]+/))
    .map((value) => value.trim())
    .filter(Boolean))].slice(0, 50);
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const params = new URL(request.url).searchParams;
    const startDate = params.get("startDate") ?? "";
    const endDate = params.get("endDate") ?? "";
    if (!isoDatePattern.test(startDate) || !isoDatePattern.test(endDate)) {
      throw new SalesCategoryRequestError("startDate 和 endDate 必须使用 YYYY-MM-DD");
    }
    const granularityValue = params.get("granularity") ?? "day";
    if (!salesCategoryGranularities.includes(granularityValue as SalesCategoryGranularity)) {
      throw new SalesCategoryRequestError(`granularity 必须是 ${salesCategoryGranularities.join(", ")} 之一`);
    }
    const sortValue = params.get("sortBy") ?? "netSalesCents";
    if (!salesCategorySortKeys.includes(sortValue as SalesCategorySortKey)) {
      throw new SalesCategoryRequestError(`sortBy 必须是 ${salesCategorySortKeys.join(", ")} 之一`);
    }
    const directionValue = params.get("direction") ?? "desc";
    if (directionValue !== "asc" && directionValue !== "desc") {
      throw new SalesCategoryRequestError("direction 必须是 asc 或 desc");
    }
    const level = positiveInteger(params.get("level"), 1);
    const outlets = selections(params, "outlet", "outlets")
      .map(parseShopFilterKey)
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((value) => ({ platform: value.platform, shop: value.shopName }));
    const db = getSalesDatabase();
    await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
    const payload = await getSalesCategoryAnalysis(db, {
      startDate,
      endDate,
      level,
      categories: selections(params, "category", "categories"),
      channels: selections(params, "channel", "channels"),
      platforms: selections(params, "platform", "platforms"),
      outlets,
      productQueries: parseProductQueries(selections(params, "productQuery", "productQueries")),
      granularity: granularityValue as SalesCategoryGranularity,
      sortBy: sortValue as SalesCategorySortKey,
      direction: directionValue,
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), 20),
    }, principal);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    const message = error instanceof Error ? error.message : "读取品类分析失败";
    if (error instanceof SalesCategoryAccessError) {
      return Response.json({ error: message, code: "access_denied" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    return Response.json(
      { error: message },
      { status: error instanceof SalesCategoryRequestError ? 400 : 500, headers: { "cache-control": "no-store" } },
    );
  }
}
