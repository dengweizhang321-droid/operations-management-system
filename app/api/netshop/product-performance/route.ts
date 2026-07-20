import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductPerformance,
  type NetshopProductPerformanceDimension,
} from "@/lib/netshop/database";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readDimension(value: string | null): NetshopProductPerformanceDimension {
  return value === "spu" ? "spu" : "sku";
}

export async function GET(request: Request) {
  try {
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const params = new URL(request.url).searchParams;
    const payload = await getNetshopProductPerformance(db, {
      dimension: readDimension(params.get("dimension")),
      query: params.get("q") ?? undefined,
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), 50),
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      startDate: params.get("startDate") ?? undefined,
      endDate: params.get("endDate") ?? undefined,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取京东商智商品明细失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
