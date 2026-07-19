import {
  ensureNetshopSchema,
  getNetshopDatabase,
  getNetshopOverview,
} from "@/lib/netshop/database";

export async function GET(request: Request) {
  try {
    const db = getNetshopDatabase();
    await ensureNetshopSchema(db);
    const shop = new URL(request.url).searchParams.get("shop");
    const payload = await getNetshopOverview(db, shop);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取京东网店概览失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
