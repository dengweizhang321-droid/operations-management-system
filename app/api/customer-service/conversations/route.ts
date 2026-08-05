import { deleteCustomerServiceConversationsByText, listCustomerServiceConversations, updateCustomerServiceConversationAnnotation } from "@/lib/customer-service/database";
import type { CustomerServiceAnnotationInput } from "@/lib/customer-service/contracts";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    const url = new URL(request.url);
    const payload = await listCustomerServiceConversations({
      shopNames: url.searchParams.getAll("shopName"),
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      agents: url.searchParams.getAll("agent"),
      statuses: url.searchParams.getAll("status"),
      robotScopes: url.searchParams.getAll("robotScope"),
      problemTypes: url.searchParams.getAll("problemType"),
      conversionStatuses: url.searchParams.getAll("conversionStatus"),
      categories: url.searchParams.getAll("category"),
      query: url.searchParams.get("query"),
      skuIds: url.searchParams.get("skuIds"),
      spuIds: url.searchParams.get("spuIds"),
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 30),
      includeOptions: url.searchParams.get("includeOptions") !== "false",
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) { const auth = authorizationErrorResponse(error); if (auth) return auth; return Response.json({ error: error instanceof Error ? error.message : "读取客服会话失败" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    await requireAppPrincipal(["operator", "admin"]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "请提供客服标注内容。" }, { status: 400 });
    const id = Number(body.id);
    const annotation = {
      ...(typeof body.robotScope === "string" ? { robotScope: body.robotScope } : {}),
      ...(typeof body.problemType === "string" ? { problemType: body.problemType } : {}),
      ...(typeof body.conversionStatus === "string" ? { conversionStatus: body.conversionStatus } : {}),
      ...(typeof body.serviceIssues === "string" ? { serviceIssues: body.serviceIssues } : {}),
      ...(typeof body.summaryText === "string" ? { summaryText: body.summaryText } : {}),
      analysisSource: "manual" as const,
    };
    return Response.json({ ok: true, ...(await updateCustomerServiceConversationAnnotation(id, annotation as CustomerServiceAnnotationInput)) });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "保存客服标注失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string") return Response.json({ error: "请提供需要剔除的文本关键词。" }, { status: 400 });
    return Response.json({ ok: true, ...(await deleteCustomerServiceConversationsByText(body.text)) });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "删除客服会话失败" }, { status: 422 });
  }
}
