import { ensureInventorySchema, getInventoryDatabase } from "@/lib/inventory/database";
import { getInventoryAgeAnalysis } from "@/lib/inventory/age-analysis";
import { ensureErpReferenceSchema } from "@/lib/erp-reference/database";

export async function GET() {
  try {
    const db = getInventoryDatabase();
    await Promise.all([ensureInventorySchema(db), ensureErpReferenceSchema(db)]);
    return Response.json(await getInventoryAgeAnalysis(db), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取库龄分析数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
