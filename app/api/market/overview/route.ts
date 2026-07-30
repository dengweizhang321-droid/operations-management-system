import { ensureMarketSchema, getMarketDatabase, getMarketOverview } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function GET(request: Request) {
  try {
    const db = getMarketDatabase();
    await Promise.all([ensureMarketSchema(db), ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const view = params.get("view") === "ranking" ? "ranking" : "full";
    const payload = await getMarketOverview(db, {
      query: params.get("q")?.trim() || undefined,
      categories: params.getAll("category"),
      scopes: params.getAll("scope"),
      brands: params.getAll("brand"),
      rankingDimensions: params.getAll("dimension"),
      operationModes: params.getAll("operationMode"),
      subcategories: params.getAll("subcategory"),
      priceBands: params.getAll("priceBand"),
      startDate: validDate(params.get("startDate")),
      endDate: validDate(params.get("endDate")),
    }, { view });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "市场分析数据读取失败" }, { status: 500 });
  }
}
