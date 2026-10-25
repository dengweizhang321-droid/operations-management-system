/**
 * Shared same-origin write judgment, extracted from the two existing
 * near-identical implementations:
 *   - app/api/ai/route-helpers.ts: requireAiSameOriginWrite
 *   - app/api/access-control/route-helpers.ts: requireSameOriginWrite
 *
 * This module intentionally only judges; it never throws and never builds a
 * Response, so it can be reused by call sites with different error shapes
 * (PublicApiError-throwing helpers, the Worker-level gate, future callers).
 * The two existing helpers above are left untouched and keep throwing their
 * own PublicApiError — they stay in place as defense in depth and are not
 * rewired to call this function.
 */
export function isSameOriginWriteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return fetchSite === "same-origin";
  }
  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedOrigin = new URL(origin).origin;
    if (origin === "null" || origin !== suppliedOrigin || suppliedOrigin !== requestOrigin) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}
