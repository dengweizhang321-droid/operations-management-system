import {
  ensureFinanceSchema,
  getFinanceDatabase,
} from "@/lib/finance/database";
import { getFinanceAnalysis, MAX_FINANCE_ANALYSIS_MONTHS } from "@/lib/finance/analysis";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { PublicApiError, safeApiErrorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "财报分析");
    const searchParams = new URL(request.url).searchParams;
    const monthValues = searchParams.getAll("month").flatMap((value) => value.split(",")).filter(Boolean);
    const allMonths = monthValues.includes("*");
    const requestedMonths = [...new Set(monthValues.filter((month) => month !== "*"))];
    const fallbackValues = searchParams.getAll("initialMonthFallback");
    if (fallbackValues.length > 1 || (fallbackValues.length === 1 && fallbackValues[0] !== "latest_completed")) {
      throw new PublicApiError(400, "invalid_request", "initialMonthFallback 只能是 latest_completed");
    }
    const fallbackToLatestCompletedMonth = fallbackValues[0] === "latest_completed";
    if (allMonths && requestedMonths.length) {
      throw new PublicApiError(400, "invalid_request", "month=* 不能与指定月份同时使用。");
    }
    if (allMonths && fallbackToLatestCompletedMonth) {
      throw new PublicApiError(400, "invalid_request", "month=* 不需要初始月份回退。");
    }
    if (fallbackToLatestCompletedMonth && requestedMonths.length === 0) {
      throw new PublicApiError(400, "invalid_request", "初始月份回退必须与指定月份同时使用。");
    }
    if (requestedMonths.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      throw new PublicApiError(400, "invalid_request", "月份格式应为真实的 YYYY-MM。");
    }
    if (requestedMonths.length > MAX_FINANCE_ANALYSIS_MONTHS) {
      throw new PublicApiError(400, "invalid_request", `单次最多分析 ${MAX_FINANCE_ANALYSIS_MONTHS} 个财务月份。`);
    }
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    return Response.json(await getFinanceAnalysis(db, {
      requestedMonths,
      allMonths,
      fallbackToLatestCompletedMonth,
      platformNames: searchParams.getAll("platform").filter(Boolean),
      shopKeys: searchParams.getAll("shop").filter(Boolean),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "财报分析读取失败。", { headers: { "cache-control": "no-store" } });
  }
}
