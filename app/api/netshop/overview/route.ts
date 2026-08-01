import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopOverview,
} from "@/lib/netshop/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { netshopPlatformsForPrincipal } from "@/lib/netshop/access";

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
    const message = error instanceof Error ? error.message : "读取网店概览失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
