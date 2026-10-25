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
 *
 * Local automation below runs in Node (including n8n-triggered tools), not
 * in a browser. These server-to-server calls naturally send neither Origin
 * nor Sec-Fetch-Site. Only the exact write paths are exempted; their existing
 * route authentication and import checks remain responsible for admission.
 *
 * - /api/imports/erp/chunks: Jackyun (吉客云) products, inventory age and
 *   combos uploads in tools/jackyun-download-runner.ts,
 *   tools/manual-jackyun-import.ts and tools/erp-reference-import-runner.mjs.
 * - /api/imports/inventory/chunks: Jackyun stock uploads in
 *   tools/jackyun-download-runner.ts and tools/manual-jackyun-import.ts.
 * - /api/imports/sales/chunks: Jackyun sales uploads in
 *   tools/sales-import-runner.ts and tools/erp-sales-automation.ts.
 * - /api/imports/recovery/finish: Jackyun import reconciliation through
 *   lib/jackyun/import-coordination.ts, called by the download/sales runners.
 * - /api/netshop/import: JD (京东) SKU/SPU, product master and promotion
 *   imports in tools/jdsz-product-detail-export.ts, tools/jackyun-ware-export.ts
 *   and tools/jd-promotion-export.ts; Tmall (天猫) imports in
 *   tools/tmall-multi-store-import-runner.ts, tools/tmall-product-master-export.ts
 *   and tools/tmall-promotion-export.ts.
 * - /api/customer-service/import: JD customer-service workbook imports in
 *   tools/jd-customer-service-import.ts.
 * - /api/market/import: JD market ranking imports in
 *   tools/jd-market-ranking-daily.ts.
 * - /api/market/images/repair: JD market image repairs in
 *   tools/jd-market-image-repair.ts.
 * - /api/market/images/cache: JD market image cache jobs in
 *   tools/jd-market-image-repair.ts.
 * - /api/market/annotations/worker: market image annotation automation in
 *   tools/market-annotation-runner.ts and tools/market-annotation-cloud-pump.ts;
 *   these callers retain their existing Bearer token authentication.
 */
const EXEMPT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/ai\/webhooks\/[^/]+\/?$/,
  /^\/api\/ai\/internal\/edge\/?$/,
  /^\/api\/imports\/erp\/chunks\/?$/,
  /^\/api\/imports\/inventory\/chunks\/?$/,
  /^\/api\/imports\/sales\/chunks\/?$/,
  /^\/api\/imports\/recovery\/finish\/?$/,
  /^\/api\/netshop\/import\/?$/,
  /^\/api\/customer-service\/import\/?$/,
  /^\/api\/market\/import\/?$/,
  /^\/api\/market\/images\/repair\/?$/,
  /^\/api\/market\/images\/cache\/?$/,
  /^\/api\/market\/annotations\/worker\/?$/,
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
