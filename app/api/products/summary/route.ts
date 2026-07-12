import { ensureInventorySchema, getInventoryDatabase } from "@/lib/inventory/database";
import { getProductSummary } from "@/lib/products/summary";
import { ensureSalesSchema } from "@/lib/sales/database";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const db = getInventoryDatabase();
    await Promise.all([ensureSalesSchema(db), ensureInventorySchema(db)]);
    const rawDays = Number(new URL(request.url).searchParams.get("days") ?? 30);
    const payload = await getProductSummary(db, Number.isFinite(rawDays) ? rawDays : 30);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "读取商品与毛利数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
