import {
  ensureSalesSchema,
  getSalesDatabase,
} from "@/lib/sales/database";
import {
  getSalesSummary,
  isSalesRange,
  salesRanges,
  SalesSummaryRequestError,
} from "@/lib/sales/summary";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requested = searchParams.get("range") ?? "month";
    if (!isSalesRange(requested)) {
      return Response.json(
        { error: `range 必须是 ${salesRanges.join(", ")} 之一` },
        { status: 400 },
      );
    }

    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const productCodes = (searchParams.get("productCodes") ?? "")
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 100);
    const payload = await getSalesSummary(db, {
      range: requested,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      productCodes,
      platform: searchParams.get("platform") ?? undefined,
      shop: searchParams.get("shop") ?? undefined,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取销售汇总失败";
    return Response.json(
      { error: message },
      { status: error instanceof SalesSummaryRequestError ? 400 : 500 },
    );
  }
}
