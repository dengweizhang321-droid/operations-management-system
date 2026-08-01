import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopProductPerformance,
  type NetshopProductPerformanceDimension,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformOptionsForPrincipal, netshopPlatformsForPrincipal } from "@/lib/netshop/access";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readDimension(value: string | null): NetshopProductPerformanceDimension {
  return value === "spu" ? "spu" : "sku";
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const params = new URL(request.url).searchParams;
    const dimension = readDimension(params.get("dimension"));
    const payload = await getNetshopProductPerformance(db, {
      dimension,
      query: params.get("q") ?? undefined,
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), 50),
      platformNames: netshopPlatformsForPrincipal(principal, params.getAll("platform")),
      shopNames: [...new Set(params.getAll("shop").map((value) => value.trim()).filter(Boolean))].slice(0, 50),
      startDate: params.get("startDate") ?? undefined,
      endDate: params.get("endDate") ?? undefined,
    });
    const platformOptions = netshopPlatformOptionsForPrincipal(principal)
      .filter((platform) => dimension === "spu" || platform === "京东");
    return Response.json(
      { ...payload, platforms: platformOptions },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取网店商品日数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
