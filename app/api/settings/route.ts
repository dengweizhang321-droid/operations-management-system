import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";
import {
  readOperatingSettings,
  saveOperatingSettings,
  type OperatingSettings,
} from "@/lib/settings/service";

export async function GET() {
  try {
    return Response.json(await readOperatingSettings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取系统设置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const payload = await request.json().catch(() => null) as Partial<OperatingSettings> | null;
    if (!payload || typeof payload !== "object") {
      return Response.json({ error: "设置内容不能为空" }, { status: 400 });
    }
    return Response.json(await saveOperatingSettings(payload, principal.email), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "保存系统设置失败" }, { status: 500 });
  }
}
