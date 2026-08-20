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
import { parseProductQueriesStrict } from "@/lib/sales/product-query";
import { parseShopFilterKey } from "@/lib/sales/shop-identity";
import { parsePositiveIntegerQuery, safeApiErrorResponse } from "@/lib/http/api-error";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function selections(params: URLSearchParams, ...keys: string[]) {
  const values = [...new Set(keys.flatMap((key) => params.getAll(key))
    .flatMap((value) => value.split(/[，,;；]+/))
    .map((value) => value.trim())
    .filter(Boolean))];
  if (values.length > 50 || values.some((value) => value.length > 100)) {
    throw new SalesCategoryRequestError(`${keys[0]} 筛选最多 50 项，且每项不能超过 100 字。`);
  }
  return values;
}

function keysForProductQueries(params: URLSearchParams) {
  return [...params.getAll("productQuery"), ...params.getAll("productQueries")];
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
    const level = parsePositiveIntegerQuery(params.get("level"), 1, "level", 3);
    const parsedOutlets = selections(params, "outlet", "outlets").map(parseShopFilterKey);
    if (parsedOutlets.some((value) => value === null)) {
      throw new SalesCategoryRequestError("outlet 必须使用有效的平台与店铺复合键。");
    }
    const outlets = parsedOutlets
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
      productQueries: (() => {
        try {
          return parseProductQueriesStrict(keysForProductQueries(params));
        } catch (error) {
          throw new SalesCategoryRequestError(error instanceof Error ? error.message : "商品筛选无效");
        }
      })(),
      granularity: granularityValue as SalesCategoryGranularity,
      sortBy: sortValue as SalesCategorySortKey,
      direction: directionValue,
      page: parsePositiveIntegerQuery(params.get("page"), 1, "page", 10_000),
      pageSize: parsePositiveIntegerQuery(params.get("pageSize"), 20, "pageSize", 100),
    }, principal);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    if (error instanceof SalesCategoryAccessError) {
      return Response.json({ error: error.message, code: "access_denied" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof SalesCategoryRequestError) {
      return Response.json({ error: error.message, code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "读取品类分析失败。", { headers: { "cache-control": "no-store" } });
  }
}
