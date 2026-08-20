import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";
import { getMarketDatabase } from "@/lib/market/database";
import { isStrictMarketDate } from "@/lib/market/import-identity";
import { ensureMarketSchema } from "@/lib/market/database";

const MAX_DAYS = 4_000;

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > MAX_DAYS) throw new PublicApiError(400, "invalid_request", `日覆盖查询最多允许 ${MAX_DAYS} 天`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "市场日覆盖");
    const params = new URL(request.url).searchParams;
    const category = (params.get("category") ?? "").trim();
    const scope = (params.get("scope") ?? "").trim();
    const rankingDimension = (params.get("rankingDimension") ?? "").trim().toUpperCase();
    const priceBandFilter = (params.get("priceBandFilter") ?? "全部").trim();
    const startDate = (params.get("startDate") ?? "").trim();
    const endDate = (params.get("endDate") ?? "").trim();
    if (!category || !scope || !["SKU", "SPU"].includes(rankingDimension)
      || !isStrictMarketDate(startDate) || !isStrictMarketDate(endDate) || startDate > endDate) {
      return Response.json({ error: "市场日覆盖身份或日期范围无效" }, { status: 400 });
    }
    const expectedDates = datesBetween(startDate, endDate);
    const db = getMarketDatabase();
    await ensureMarketSchema(db);
    const rows = await db.prepare(`SELECT period_end business_date, COUNT(*) row_count
      FROM market_ranking_entries
      WHERE category=? AND scope=? AND ranking_dimension=? AND price_band_filter=?
        AND period_start=period_end AND period_end>=? AND period_end<=?
      GROUP BY period_end ORDER BY period_end`)
      .bind(category, scope, rankingDimension, priceBandFilter, startDate, endDate)
      .all<{ business_date: string; row_count: number }>();
    const counts = Object.fromEntries(rows.results.map((row) => [row.business_date, Number(row.row_count)]));
    const presentDates = expectedDates.filter((date) => Number(counts[date] ?? 0) > 0);
    const missingDates = expectedDates.filter((date) => !presentDates.includes(date));
    return Response.json({
      ok: true,
      identity: { category, scope, rankingDimension, priceBandFilter },
      startDate,
      endDate,
      cutoffDate: presentDates.at(-1) ?? null,
      presentDates,
      missingDates,
      rowCounts: counts,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取市场日覆盖失败", { headers: { "cache-control": "no-store" } });
  }
}
