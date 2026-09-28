import { requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { SYSTEM_BACKUPS_PATH, createDjangoAccessControlService } from "@/lib/django/access-control-service";
import { accessControlErrorResponse, boundedAccessQuery, readAccessControlJson, requireSameOriginWrite } from "../route-helpers";

async function handle(request: Request, write: boolean) {
  try {
    if (write) requireSameOriginWrite(request);
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "数据库备份");
    const result = await createDjangoAccessControlService().request<Record<string, unknown>>(principal,
      write
        ? { method: "POST", path: SYSTEM_BACKUPS_PATH, service: "writer", payload: await readAccessControlJson(request, 192 * 1024) }
        : { method: "GET", path: SYSTEM_BACKUPS_PATH, service: "reader", query: boundedAccessQuery(request, ["downloadId", "offset"]) },
      { signal: request.signal });
    return Response.json(result.data, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return accessControlErrorResponse(error, "备份管理暂时不可用");
  }
}

export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
