import { ensureMarketSchema, getMarketDatabase, getMarketOverview } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";
import { getCachedMarketOverview } from "@/lib/market/overview-response-cache";

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export async function GET(request: Request) {
  try {
    const db = getMarketDatabase();
    await Promise.all([ensureMarketSchema(db), ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const view = params.get("view") === "ranking" ? "ranking" : "full";
    const pagination = view === "ranking" ? {
      page: boundedInteger(params.get("page"), 1, 1, 10_000),
      pageSize: boundedInteger(params.get("pageSize"), 20, 10, 50),
    } : { page: 1, pageSize: 200 };
    const filters = {
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
    };
    const result = await getCachedMarketOverview(db, { view, filters, pagination }, () =>
      getMarketOverview(db, filters, { view, rankingPage: pagination.page, rankingPageSize: pagination.pageSize }));
    return Response.json(result.payload, {
      headers: { "cache-control": "no-store", "x-market-overview-cache": result.status },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "市场分析数据读取失败" }, { status: 500 });
  }
}
