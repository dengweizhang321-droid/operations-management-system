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
import { parseProductQueries } from "@/lib/sales/product-query";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "销售汇总");
    const searchParams = new URL(request.url).searchParams;
    const requested = searchParams.get("range") ?? "month";
    if (!isSalesRange(requested)) {
      return Response.json(
        { error: `range 必须是 ${salesRanges.join(", ")} 之一` },
        { status: 400 },
      );
    }

    const db = getSalesDatabase();
    await Promise.all([ensureSalesSchema(db), ensureErpReferenceSchema(db)]);
    const productQueries = parseProductQueries([
      ...searchParams.getAll("productQuery"),
      searchParams.get("productCodes") ?? "",
    ]);
    const categories = [...searchParams.getAll("categories"), ...searchParams.getAll("category")]
      .flatMap((value) => value.split(/[，,;；]+/))
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 50);
    const outlets = [...searchParams.getAll("outlet"), ...searchParams.getAll("outlets")]
      .flatMap((value) => value.split(/[，,;；]+/))
      .map((value) => parseShopFilterKey(value.trim()))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .filter((value, index, values) => values.findIndex((item) => item.platform === value.platform && item.shopName === value.shopName) === index)
      .slice(0, 50)
      .map((value) => ({ platform: value.platform, shop: value.shopName }));
    const payload = await getSalesSummary(db, {
      range: requested,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      productQueries,
      platform: searchParams.get("platform") ?? undefined,
      shop: searchParams.get("shop") ?? undefined,
      outlets,
      categories,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取销售汇总失败";
    return Response.json(
      { error: message },
      { status: error instanceof SalesSummaryRequestError ? 400 : 500 },
    );
  }
}
