import { isSameOriginWriteRequest } from "../lib/http/same-origin";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that must stay reachable cross-site even though they sit under
 * /api/ and accept a write method.
 *
 * - /api/ai/webhooks/<channelId>: external platform callbacks (WeCom,
 *   DingTalk, etc. — app/api/ai/webhooks/[channelId]/route.ts). These are
 *   inherently cross-origin by design and are authenticated through their
 *   own signature/decryption contract instead of same-origin proof — that
 *   is why that route reads its body with readAiBoundedText rather than the
 *   same-origin-checked readAiJsonObject. Gating this path would break every
 *   inbound webhook delivery.
 *
 * - /api/ai/internal/edge (exact path, no trailing segment): the Django
 *   backend's own server-to-server call into the AI tool edge
 *   (app/api/ai/internal/edge/route.ts -> lib/ai/django-edge.ts
 *   handleAiEdge/verifyAiEdgeEnvelope). Django is a server process — it never
 *   sends Origin or Sec-Fetch-Site — so it authenticates with its own HMAC-
 *   SHA256 envelope (x-teruisi-signature / x-teruisi-timestamp / body SHA256,
 *   >=32 byte shared secret) instead of same-origin proof. Two call sites
 *   rely on this: backend/ai_assistant/transport.py's edge() and
 *   backend/workflow/pi_business_n8n.py's _coverage(), both via the shared
 *   signed_headers() helper. The pattern is deliberately exact (no wildcard
 *   segment) so future routes added under /api/ai/internal/ are NOT
 *   accidentally exempted.
 */
const EXEMPT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/ai\/webhooks\/[^/]+\/?$/,
  /^\/api\/ai\/internal\/edge\/?$/,
];

function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function logRejectedCrossSiteWrite(request: Request, pathname: string): void {
  // Deliberately omit body, cookies, query string, and any credential —
  // this line exists so a misclassified legitimate caller can be spotted
  // after rollout, not to capture request content.
  console.warn(
    "[same-origin-write-gate] rejected cross-site write request",
    JSON.stringify({
      method: request.method,
      pathname,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    }),
  );
}

/**
 * Global Worker-level same-origin gate for /api/* write methods.
 *
 * Returns a 403 Response when the request must be rejected, or null when the
 * request should continue to the app router handler unchanged. Only inspects
 * method, pathname, and the Origin / Sec-Fetch-Site headers — it never reads
 * or buffers the request body, so multipart file uploads (Excel imports,
 * etc.) are unaffected.
 */
export function evaluateSameOriginWriteGate(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (!WRITE_METHODS.has(method)) return null;

  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  if (isExemptPath(pathname)) return null;

  if (isSameOriginWriteRequest(request)) return null;

  logRejectedCrossSiteWrite(request, pathname);
  return Response.json(
    { error: "已拒绝跨站写入请求。", code: "cross_site_request_rejected" },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
