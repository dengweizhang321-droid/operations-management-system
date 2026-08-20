import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopOverview,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";
import { safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const platforms = netshopPlatformsForPrincipal(principal, new URL(request.url).searchParams.getAll("platform"));
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const shop = new URL(request.url).searchParams.get("shop");
    const payload = await getNetshopOverview(db, shop, platforms);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "读取网店概览失败", {
      headers: { "cache-control": "no-store" },
    });
  }
}
