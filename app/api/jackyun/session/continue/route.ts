import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireAppPrincipal(["operator", "admin"]);
    return Response.json({
      ok: false,
      status: "disabled",
      message: "旧继续入口已停用；请从工作流重新执行计划，由原 RUN_ID 的安全恢复校验决定是否续跑。",
    }, { status: 410 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ ok: false, message: "吉客云继续入口不可用" }, { status: 500 });
  }
}
