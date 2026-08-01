import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductCatalog,
} from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const db = getNetshopDatabase();
    await Promise.all([ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const payload = await getNetshopProductCatalog(db, {
      query: params.get("q") ?? undefined,
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), 50),
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      platformNames: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      salesStartDate: params.get("startDate") ?? undefined,
      salesEndDate: params.get("endDate") ?? undefined,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取网店货品数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
