import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoInventoryService, INVENTORY_IMPORT_RECOVERY_PATH } from "@/lib/django/inventory-service";
import { createDjangoErpReferenceService, ERP_REFERENCE_IMPORT_RECOVERY_PATH } from "@/lib/django/erp-reference-service";
import { requestDjangoSalesService, SALES_IMPORT_RECOVERY_PATH } from "@/lib/django/sales-writer";
import { safeApiErrorResponse } from "@/lib/http/api-error";

/** Read-only, authenticated status query. Never init/claim/complete an upload. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "导入恢复状态");
    const query = new URL(request.url).searchParams;
    if (query.toString().length > 2048 || query.getAll("module").length !== 1) return Response.json({ error: "恢复模块身份无效" }, { status: 400, headers });
    const moduleKey = query.get("module"); query.delete("module");
    let data: unknown;
    if (moduleKey === "products" || moduleKey === "combos") {
      if (query.has("source") || query.has("dataset")) return Response.json({ error: "恢复来源不能重复声明" }, { status: 400, headers });
      query.set("source", moduleKey);
      data = (await createDjangoErpReferenceService().requestJson(principal, { method: "GET", path: ERP_REFERENCE_IMPORT_RECOVERY_PATH,
        service: "writer", rawQuery: query.toString() }, { signal: request.signal })).data;
    } else if (moduleKey === "inventory" || moduleKey === "inventory_age") {
      if (query.has("source") || query.has("dataset")) return Response.json({ error: "恢复来源不能重复声明" }, { status: 400, headers });
      query.set("dataset", moduleKey === "inventory" ? "stock" : "age");
      data = (await createDjangoInventoryService().requestJson(principal, { method: "GET", path: INVENTORY_IMPORT_RECOVERY_PATH,
        service: "writer", rawQuery: query.toString() }, { signal: request.signal })).data;
    } else if (moduleKey === "sales") {
      data = (await requestDjangoSalesService(principal, { method: "GET", path: SALES_IMPORT_RECOVERY_PATH, service: "writer", query })).data;
    } else return Response.json({ error: "恢复模块无效" }, { status: 400, headers });
    return Response.json(data, { headers });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "导入恢复结果无法确认，请保留原运行。", { headers });
  }
}
