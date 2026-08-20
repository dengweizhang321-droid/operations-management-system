import {
  createOperationRecord,
  listOperationRecords,
  OperationRecordRequestError,
  type CreateOperationRecordInput,
} from "@/lib/workflow/operations-records";
import { getSalesDatabase } from "@/lib/sales/database";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

function requestErrorResponse(error: unknown, fallback: string) {
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

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const params = new URL(request.url).searchParams;
    const payload = await listOperationRecords({
      types: params.getAll("type"),
      statuses: params.getAll("status"),
      shopNames: params.getAll("shopName"),
      platforms: params.getAll("platform"),
      owners: params.getAll("owner"),
      query: params.get("query"),
      from: params.get("from"),
      to: params.get("to"),
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    }, principal, getSalesDatabase());
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return requestErrorResponse(error, "读取运营记录失败");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    const body = await request.json().catch(() => null) as CreateOperationRecordInput | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "运营记录必须是有效的 JSON 对象", code: "invalid_request" }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const item = await createOperationRecord(body, principal, getSalesDatabase());
    return Response.json({ item }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return requestErrorResponse(error, "保存运营记录失败");
  }
}
