import {
  listOperationRecordActivities,
  OperationRecordRequestError,
} from "@/lib/workflow/operations-records";
import { getSalesDatabase } from "@/lib/sales/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const payload = await listOperationRecordActivities(id, {
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    }, principal, getSalesDatabase());
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof OperationRecordRequestError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ error: "读取运营记录活动失败", code: "internal_error" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
