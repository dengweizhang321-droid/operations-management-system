import {
  deleteOperationRecord,
  getOperationRecord,
  OperationRecordRequestError,
  updateOperationRecord,
  type UpdateOperationRecordInput,
} from "@/lib/workflow/operations-records";
import { getSalesDatabase } from "@/lib/sales/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, fallback: string) {
  const authorization = authorizationErrorResponse(error);
  if (authorization) return authorization;
  if (error instanceof OperationRecordRequestError) {
    return Response.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json({ error: fallback, code: "internal_error" }, {
    status: 500,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const { id } = await context.params;
    const item = await getOperationRecord(id, principal, getSalesDatabase());
    if (!item) {
      return Response.json({ error: "运营记录不存在或不可访问", code: "not_found" }, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "读取运营记录失败");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    const body = await request.json().catch(() => null) as UpdateOperationRecordInput | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "缺少可更新的运营记录字段", code: "invalid_request" }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const { id } = await context.params;
    const item = await updateOperationRecord(id, body, principal, getSalesDatabase());
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "更新运营记录失败");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    const { id } = await context.params;
    const expectedVersion = new URL(request.url).searchParams.get("expectedVersion");
    const result = await deleteOperationRecord(id, expectedVersion, principal, getSalesDatabase());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "删除运营记录失败");
  }
}
