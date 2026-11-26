import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { routeDjangoSalesReadRequest } from "@/lib/django/sales-gateway";
import { safeApiErrorResponse } from "@/lib/http/api-error";

const STATUSES = new Set(["all", "mapped", "unclassified", "missing"]);

function boundedInteger(params: URLSearchParams, key: string, maximum: number) {
  const raw = params.get(key);
  if (raw === null || raw === "") return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${key} 必须为 1 到 ${maximum} 的整数。`);
  }
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "系统设置");
    const source = new URL(request.url);
    const params = source.searchParams;
    try {
      if ((params.get("q") ?? "").length > 100) throw new RangeError("q 不能超过 100 字。");
      if (!STATUSES.has(params.get("status") ?? "all")) throw new RangeError("status 无效。");
      if ((params.get("subdivision") ?? "").length > 100) throw new RangeError("subdivision 不能超过 100 字。");
      boundedInteger(params, "page", 10_000);
      boundedInteger(params, "pageSize", 100);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return Response.json(
        { error: error.message, code: "invalid_request" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    // Same signed sales reader channel; only the public path differs.
    const target = new URL("/api/sales/product-subdivisions", source);
    for (const key of ["q", "subdivision", "status", "page", "pageSize"]) {
      const value = params.get(key);
      if (value !== null && value !== "") target.searchParams.set(key, value);
    }
    return await routeDjangoSalesReadRequest({
      request: new Request(target, { method: "GET", signal: request.signal }),
      principal,
    });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return safeApiErrorResponse(error, "读取货品细分映射失败。", { headers: { "cache-control": "no-store" } });
  }
}
