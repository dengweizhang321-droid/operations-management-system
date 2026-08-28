import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";
import {
  getSalesCategoryOutletBreakdown,
  SalesCategoryAccessError,
  SalesCategoryRequestError,
} from "@/lib/sales/category-analysis";
import { ensureSalesSchema, getSalesDatabase } from "@/lib/sales/database";
import { parseProductQueriesStrict } from "@/lib/sales/product-query";
import { parseShopFilterKey } from "@/lib/sales/shop-identity";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import { routeSalesReadRequest } from "@/lib/django/sales-gateway";
import { getSalesOverviewCacheRevision } from "@/lib/sales/overview-response-cache";

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

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const params = new URL(request.url).searchParams;
    const startDate = params.get("startDate") ?? "";
    const endDate = params.get("endDate") ?? "";
    const category = (params.get("category") ?? "").trim();
    if (!isoDatePattern.test(startDate) || !isoDatePattern.test(endDate)) {
      throw new SalesCategoryRequestError("startDate 和 endDate 必须使用 YYYY-MM-DD");
    }
    if (!category || category.length > 100) {
      throw new SalesCategoryRequestError("category 不能为空且不能超过 100 字");
    }
    const parsedOutlets = selections(params, "outlet", "outlets").map(parseShopFilterKey);
    if (parsedOutlets.some((value) => value === null)) {
      throw new SalesCategoryRequestError("outlet 必须使用有效的平台与店铺复合键。");
    }
    const outlets = parsedOutlets
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((value) => ({ platform: value.platform, shop: value.shopName }));
    const productQueries = (() => {
      try {
        return parseProductQueriesStrict([...params.getAll("productQuery"), ...params.getAll("productQueries")]);
      } catch (error) {
        throw new SalesCategoryRequestError(error instanceof Error ? error.message : "商品筛选无效");
      }
    })();
    const channels = selections(params, "channel", "channels");
    const platforms = selections(params, "platform", "platforms");
    const db = getSalesDatabase();
    await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
    const expectedRevision = await getSalesOverviewCacheRevision(db);
    return routeSalesReadRequest({
      request,
      principal,
      expectedRevision,
      readCurrentRevision: () => getSalesOverviewCacheRevision(db),
      legacy: async () => {
        const payload = await getSalesCategoryOutletBreakdown(db, {
          startDate,
          endDate,
          category,
          channels,
          platforms,
          outlets,
          productQueries,
        }, principal);
        return Response.json(payload, { headers: { "cache-control": "no-store" } });
      },
    });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    if (error instanceof SalesCategoryAccessError) {
      return Response.json({ error: error.message, code: "access_denied" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof SalesCategoryRequestError) {
      return Response.json({ error: error.message, code: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return safeApiErrorResponse(error, "读取品类平台店铺明细失败。", { headers: { "cache-control": "no-store" } });
  }
}
