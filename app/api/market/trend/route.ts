import { ensureMarketSchema, getMarketDatabase, getMarketItemTrend } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";

export async function GET(request: Request) {
  try {
    const db = getMarketDatabase();
    await Promise.all([ensureMarketSchema(db), ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const dimension = params.get("dimension");
    const payload = await getMarketItemTrend(db, {
      skuCode: params.get("skuCode") ?? "",
      category: params.get("category") ?? undefined,
      rankingDimension: dimension === "SPU" ? "SPU" : dimension === "SKU" ? "SKU" : undefined,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取市场单品趋势失败" }, { status: 500 });
  }
}
