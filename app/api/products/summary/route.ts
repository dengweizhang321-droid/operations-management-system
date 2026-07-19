import { ensureInventorySchema, getInventoryDatabase } from "@/lib/inventory/database";
import {
  getProductSummary,
  ProductSummaryRequestError,
  type ProductSummaryRange,
} from "@/lib/products/summary";
import { ensureSalesSchema } from "@/lib/sales/database";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";

function readSelections(searchParams: URLSearchParams, key: string) {
  return [...new Set(searchParams.getAll(key).map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

export async function GET(request: Request) {
  try {
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db), ensureErpReferenceSchema(db)]);
    const searchParams = new URL(request.url).searchParams;
    const requestedRange = searchParams.get("range");
    const allowedRanges = new Set<ProductSummaryRange>(["last30", "last90", "halfYear", "custom"]);
    if (requestedRange && !allowedRanges.has(requestedRange as ProductSummaryRange)) {
      throw new ProductSummaryRequestError("不支持的商品统计周期");
    }
    const rawDays = Number(searchParams.get("days"));
    const payload = await getProductSummary(db, {
      range: requestedRange ? requestedRange as ProductSummaryRange : undefined,
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      days: Number.isFinite(rawDays) && rawDays > 0 ? rawDays : undefined,
      platforms: readSelections(searchParams, "platform"),
      shopKeys: readSelections(searchParams, "shop"),
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ProductSummaryRequestError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const message = error instanceof Error ? error.message : "读取商品与毛利数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
