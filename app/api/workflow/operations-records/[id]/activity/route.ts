import {
  getOperationRecord,
  listOperationRecordActivities,
  OperationRecordRequestError,
} from "@/lib/workflow/operations-records";
import { getD1Database } from "@/lib/database/d1";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const { id } = await context.params;
    const current = await getOperationRecord(id, principal, getD1Database());
    if (current?.type === "launch") {
      return Response.json({ error: "运营记录不存在或不可访问", code: "not_found" }, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    const params = new URL(request.url).searchParams;
    const payload = await listOperationRecordActivities(id, {
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    }, principal, getD1Database());
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
