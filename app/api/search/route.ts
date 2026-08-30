import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getD1Database } from "@/lib/database/d1";
import { globalSearchErrorResponse } from "@/lib/search/api-response";
import {
  normalizeGlobalSearchRequest,
  searchAllBusinessData,
  type GlobalSearchDatabase,
} from "@/lib/search/global-search";

const noStoreHeaders = { "cache-control": "no-store" } as const;

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const searchRequest = normalizeGlobalSearchRequest(new URL(request.url).searchParams);
    const payload = await searchAllBusinessData(
      getD1Database() as unknown as GlobalSearchDatabase,
      searchRequest,
      principal,
      { signal: request.signal },
    );
    return Response.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    return auth ?? globalSearchErrorResponse(error);
  }
}
