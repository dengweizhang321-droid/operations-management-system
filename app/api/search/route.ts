import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getSalesDatabase } from "@/lib/sales/database";
import {
  GlobalSearchRequestError,
  normalizeGlobalSearchRequest,
  searchAllBusinessData,
  type GlobalSearchDatabase,
} from "@/lib/search/global-search";

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const searchRequest = normalizeGlobalSearchRequest(new URL(request.url).searchParams);
    const payload = await searchAllBusinessData(
      getSalesDatabase() as unknown as GlobalSearchDatabase,
      searchRequest,
      principal,
    );
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    const status = error instanceof GlobalSearchRequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "搜索系统数据失败";
    return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
