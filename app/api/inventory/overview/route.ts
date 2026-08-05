import {
  ensureInventorySchema,
  getInventoryDatabase,
} from "@/lib/inventory/database";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { ensureSalesSchema } from "@/lib/sales/database";

export async function GET(request: Request) {
  try {
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureSalesSchema(db)]);
    const params = new URL(request.url).searchParams;
    const payload = await getInventoryOverview(db, {
      query: params.get("q")?.trim() || undefined,
      startDate: params.get("startDate")?.trim() || undefined,
      endDate: params.get("endDate")?.trim() || undefined,
      warehouses: params.getAll("warehouse"),
      warehouseTypes: params.getAll("warehouseType").filter((value): value is "owned" | "jd_rdc" | "other" => ["owned", "jd_rdc", "other"].includes(value)),
      statuses: params.getAll("status").filter((value): value is "urgent" | "replenish" | "healthy" | "slow" | "stagnant" | "no_sales" => ["urgent", "replenish", "healthy", "slow", "stagnant", "no_sales"].includes(value)),
      limit: Number(params.get("limit") || 300),
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取库存健康数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
