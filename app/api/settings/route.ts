import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";
import {
  readOperatingSettings,
  saveOperatingSettings,
  type OperatingSettings,
} from "@/lib/settings/service";

export async function GET() {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "系统设置");
    return Response.json(await readOperatingSettings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "读取系统设置失败", { headers: { "cache-control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "系统设置", "修改");
    const payload = await request.json().catch(() => null) as Partial<OperatingSettings> | null;
    if (!payload || typeof payload !== "object") {
      return Response.json({ error: "设置内容不能为空" }, { status: 400 });
    }
    return Response.json(await saveOperatingSettings(payload, principal.email), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "保存系统设置失败", { headers: { "cache-control": "no-store" } });
  }
}
