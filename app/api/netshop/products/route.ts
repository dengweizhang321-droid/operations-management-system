import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductCatalog,
} from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    const db = getNetshopDatabase();
    await Promise.all([ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const payload = await getNetshopProductCatalog(db, {
      query: params.get("q") ?? undefined,
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), 50),
      shopName: params.get("shop") ?? undefined,
      salesStartDate: params.get("startDate") ?? undefined,
      salesEndDate: params.get("endDate") ?? undefined,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取京东商品 SKU 数据失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
