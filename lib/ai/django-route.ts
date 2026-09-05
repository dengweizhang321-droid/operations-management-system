import { requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { isPublicAiPath, requestDjangoAi } from "@/lib/django/ai-service";
import { aiJsonResponse, aiRouteErrorResponse, readAiJsonObject, requireAiSameOriginWrite } from "@/app/api/ai/route-helpers";
import { PublicApiError } from "@/lib/http/api-error";
import { normalizeAiPageContext } from "@/lib/ai/page-context";

export async function forwardAiRequest(request: Request) {
  try {
    const url = new URL(request.url);
    if (!isPublicAiPath(url.pathname)) throw new PublicApiError(404, "not_found", "AI 接口不存在。");
    const read = request.method === "GET";
    if (!read) requireAiSameOriginWrite(request);
    const principal = await requireAppPrincipal(read ? undefined : ["admin", "operator", "analyst"]);
    if (/^\/api\/ai\/(?:models|channels|space\/(?:profiles|templates))$/.test(url.pathname)) {
      if (principal.role !== "admin") throw new PublicApiError(403, "access_denied", "AI 管理仅允许管理员。");
      requireUnrestrictedDataScope(principal, "AI 管理");
    }
    const payload = read || request.method === "DELETE" && !request.headers.get("content-type") ? undefined : await readAiJsonObject(request);
    if (url.pathname === "/api/ai/chat" && payload?.pageContext != null) {
      const context = normalizeAiPageContext(payload.pageContext);
      if (!context) throw new PublicApiError(400, "invalid_request", "AI 页面上下文无效。");
      payload.pageContext = context;
    }
    let cancellation: Promise<unknown> | undefined;
    const abort = () => {
      if (url.pathname === "/api/ai/chat" && request.method === "POST" && typeof payload?.clientRequestId === "string") {
        cancellation = requestDjangoAi(principal, { path: "/api/ai/chat/cancel", method: "POST", payload: { clientRequestId: payload.clientRequestId } }).catch(() => undefined);
      }
    };
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await requestDjangoAi<Record<string, unknown>>(principal, { path: url.pathname, method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", query: url.searchParams, payload }, { signal: request.signal });
      if (url.pathname.startsWith("/api/ai/artifacts/") || url.pathname.endsWith("/content")) {
        const file = result.data as { base64?: string; content?: string; mimeType: string; fileName: string };
        const bytes = file.base64 ? Uint8Array.from(atob(file.base64), c => c.charCodeAt(0)) : new TextEncoder().encode(file.content ?? "");
        return new Response(bytes, { headers: { "content-type": file.mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", ...(url.pathname.endsWith("/content") ? { "x-ai-generated": "true", "x-ai-review-required": "true" } : {}) } });
      }
      return aiJsonResponse(result.data, { status: result.status, headers: { "x-ai-revision": result.revision } });
    } finally { request.signal.removeEventListener("abort", abort); if (cancellation) await cancellation; }
  } catch (error) { return aiRouteErrorResponse(error, "AI 服务请求失败"); }
}
