import {
  ensureInventorySchema,
  getInventoryDatabase,
} from "@/lib/inventory/database";
import { getInventoryOverview } from "@/lib/inventory/overview";
import { ensureSalesSchema } from "@/lib/sales/database";

export async function GET() {
  try {
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureSalesSchema(db)]);
    const payload = await getInventoryOverview(db);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取库存健康数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
