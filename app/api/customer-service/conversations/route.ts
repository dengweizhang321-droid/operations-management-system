import { listCustomerServiceConversations } from "@/lib/customer-service/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const url = new URL(request.url);
    const payload = await listCustomerServiceConversations({ startDate: url.searchParams.get("startDate"), endDate: url.searchParams.get("endDate"), agent: url.searchParams.get("agent"), status: url.searchParams.get("status"), query: url.searchParams.get("query"), skuIds: url.searchParams.get("skuIds"), spuIds: url.searchParams.get("spuIds"), page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 30) });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return Response.json({ error: error instanceof Error ? error.message : "读取客服会话失败" }, { status: 500 }); }
}
