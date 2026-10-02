/** Explicit release smoke checks, never liveness or an automatic restart input. */
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { decodeStoreOverview } from "../../lib/netshop/store-overview-contract";
import { decodeProductInsights, validateProductQuery } from "../../app/netshop/products/contract";
import { decodeStorePanorama, validatePanoramaQuery, panoramaSourceKeys } from "../../app/netshop/panorama/contract";
import { decodeComparisonInsights, validateComparisonQuery } from "../../app/netshop/comparison/contract";
import { decodePromotionInsightsForQuery, validatePromotionQuery } from "../../lib/netshop/promotion-insights-contract";
import { validateContextQuery } from "../../lib/netshop/insights-contract";

export type CheckState = "passed" | "degraded" | "unverified";
export type ProbeScope = { platform: "京东" | "天猫"; shopName: string; startDate: string; endDate: string };
export type ProbeResult = {
  id: string; state: CheckState; reason: string | null; httpStatus: number | null;
  elapsedMs: number; responseBytes: number; sourceChecks: Array<{ source: string; state: CheckState; reason: string | null }>;
  dataGaps: Record<string, number>;
};
export type BusinessReport = {
  schemaVersion: "netshop-business-readiness-v1"; checkedAt: string; finishedAt: string;
  scopeDigest: string; period: { startDate: string; endDate: string };
  state: CheckState; businessReady: boolean; checks: ProbeResult[];
  limitations: string[];
};
type Spec = { id: string; path: string; query: URLSearchParams; decode: (v: unknown, q: URLSearchParams, revision: string | null) => unknown | Promise<unknown> };
const MAX_BYTES = 2 * 1024 * 1024;
// Node's core HTTP client does not consult proxy environment variables. Keep
// local shop/date query strings on the local machine, even with proxy flags.
const directFetch: typeof fetch = async (input, init) => new Promise<Response>((resolve, reject) => {
  const url = new URL(String(input));
  const request = httpRequest(url, { method: "GET", agent: false, signal: init?.signal ?? undefined, headers: { accept: "application/json" } }, response => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const status = response.statusCode ?? 502, noBody = [204, 205, 304].includes(status);
    if (noBody) response.resume();
    try { resolve(new Response(noBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers })); }
    catch (error) { response.destroy(); reject(error); }
  });
  request.on("error", reject);
  request.on("upgrade", (_response, socket) => { socket.destroy(); reject(new Error("upgrade_rejected")); });
  request.end();
});
const checked = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("contract_invalid");
  return v as Record<string, unknown>;
};
export function validateBaseUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.username || u.password || u.pathname !== "/" || u.search || u.hash)
    throw new Error("Only an explicit http://127.0.0.1:port origin is allowed");
  return u.origin;
}
export function makeSpecs(scope: ProbeScope): Spec[] {
  if (!scope || !["京东", "天猫"].includes(scope.platform) || typeof scope.shopName !== "string" || !scope.shopName.trim()
      || scope.shopName !== scope.shopName.trim() || scope.shopName.length > 200 || /[\u0000-\u001f\u007f]/.test(scope.shopName)) throw new Error("A single exact shop is required");
  const q = new URLSearchParams({ platform: scope.platform, outlet: `${scope.platform}\u001f${scope.shopName}`,
    startDate: scope.startDate, endDate: scope.endDate, periodKind: "custom", dimension: "spu" });
  validateContextQuery(q);
  const span = (Date.parse(scope.endDate) - Date.parse(scope.startDate)) / 86400000 + 1;
  if (span < 1 || span > 7) throw new Error("Release probes accept 1 to 7 days; they are not full-period analytics");
  const overview = new URLSearchParams(q); overview.delete("dimension");
  const products = new URLSearchParams(q); products.set("pageSize", "1"); validateProductQuery(products);
  const promotion = new URLSearchParams(q); promotion.set("dimension", scope.platform === "京东" ? "sku" : "spu"); promotion.set("pageSize", "1"); validatePromotionQuery(promotion);
  const panorama = new URLSearchParams(q); panorama.set("pageSize", "5"); validatePanoramaQuery(panorama);
  const comparison = new URLSearchParams(q); comparison.set("pageSize", "1"); validateComparisonQuery(comparison);
  const health = (kind: string) => (v: unknown) => {
    const value = checked(v); if (value.ok !== true || value.status !== kind) throw new Error("contract_invalid");
    if (kind === "ready" && (value.backend !== "django-postgresql" || !Array.isArray(value.unavailableServices) || value.unavailableServices.length)) throw new Error("contract_invalid");
    return value;
  };
  return [
    { id: "liveness", path: "/_teruisi/local/health/live", query: new URLSearchParams(), decode: health("live") },
    { id: "structural_readiness", path: "/_teruisi/local/health/ready", query: new URLSearchParams(), decode: health("ready") },
    { id: "overview", path: "/api/netshop/store-overview", query: overview, decode: (v, query) => {
      const result = decodeStoreOverview(v);
      if (result.filters.platform !== scope.platform || result.filters.shopKeys.length !== 1 || result.filters.shopKeys[0] !== query.get("outlet")
        || result.periods.current.startDate !== scope.startDate || result.periods.current.endDate !== scope.endDate) throw new Error("contract_invalid");
      return result;
    } },
    { id: "products", path: "/api/netshop/product-insights", query: products, decode: decodeProductInsights },
    { id: "promotion", path: "/api/netshop/promotion-insights", query: promotion, decode: decodePromotionInsightsForQuery },
    { id: "panorama", path: "/api/netshop/store-panorama", query: panorama, decode: decodeStorePanorama },
    { id: "comparison", path: "/api/netshop/comparison-insights", query: comparison, decode: decodeComparisonInsights },
  ];
}
export function inspectValidatedPayload(value: unknown): { dataGaps: Record<string, number>; sourceErrors: number } {
  const counts: Record<string, number> = {}, queue: unknown[] = [value]; let examined = 0, sourceErrors = 0;
  while (queue.length) {
    if (++examined > 200000) throw new Error("contract_invalid");
    const current = queue.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) { queue.push(...current); continue; }
    const v = current as Record<string, unknown>;
    if (v.state === "error" && "data" in v && typeof v.code === "string") sourceErrors++;
    // Count validated metric reasons, never values, raw objects or exception text.
    if ("value" in v && ["partial", "unavailable", "invalid"].includes(String(v.status)) && typeof v.reasonCode === "string" && /^[a-z_]{1,64}$/.test(v.reasonCode)) counts[v.reasonCode] = (counts[v.reasonCode] ?? 0) + 1;
    queue.push(...Object.values(v));
  }
  return { dataGaps: counts, sourceErrors };
}
export function classifySources(id: string, decoded: unknown): ProbeResult["sourceChecks"] {
  if (id === "panorama") {
    const sources = checked(checked(decoded).sources);
    return panoramaSourceKeys.map(source => {
      const v = checked(sources[source]);
      if (v.state === "ready") return { source, state: "passed", reason: null };
      if (v.state === "error") return { source, state: "degraded", reason: "source_read_failed" };
      if (v.state === "unavailable") return { source, state: "unverified", reason: "source_not_exercised" };
      throw new Error("contract_invalid");
    });
  }
  if (id === "comparison") {
    const sections = checked(checked(decoded).sections), comparison = checked(sections.comparability), promotion = checked(sections.promotion);
    const entries = [{ source: "sales", value: checked(comparison.erpState) },
      ...(promotion.sourceStates as Array<Record<string, unknown>>).map((v, index) => ({ source: `promotion_${index}`, value: checked(v) }))];
    return entries.map(({ source, value: v }) => ({ source, state: v.state === "ready" ? "passed" : v.state === "error" ? "degraded" : "unverified", reason: v.state === "ready" ? null : v.state === "error" ? "source_read_failed" : "source_not_exercised" }));
  }
  return [];
}
function worst(states: CheckState[]): CheckState { return states.includes("degraded") ? "degraded" : states.includes("unverified") ? "unverified" : "passed"; }
export async function runBusinessChecks(base: string, scope: ProbeScope, options: {
  fetcher?: typeof fetch; totalMs?: number; perCheckMs?: number; signal?: AbortSignal;
} = {}): Promise<BusinessReport> {
  const origin = validateBaseUrl(base), specs = makeSpecs(scope), totalMs = options.totalMs ?? 120000, perCheckMs = options.perCheckMs ?? 20000;
  if (!Number.isInteger(totalMs) || totalMs < 1 || totalMs > 120000 || !Number.isInteger(perCheckMs) || perCheckMs < 1 || perCheckMs > 30000) throw new Error("Invalid bounded probe budget");
  const started = performance.now(), checkedAt = new Date().toISOString(), checks: ProbeResult[] = [];
  for (const spec of specs) {
    const at = performance.now(); let response: Response | undefined, bytes = 0;
    const result: ProbeResult = { id: spec.id, state: "unverified", reason: "not_run", httpStatus: null, elapsedMs: 0, responseBytes: 0, sourceChecks: [], dataGaps: {} };
    const remaining = totalMs - (at - started);
    if (options.signal?.aborted || remaining <= 0) { result.reason = options.signal?.aborted ? "cancelled" : "total_deadline"; checks.push(result); continue; }
    const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, perCheckMs));
    try {
      response = await (options.fetcher ?? directFetch)(`${origin}${spec.path}${spec.query.size ? "?" + spec.query.toString() : ""}`, {
        method: "GET", redirect: "manual", cache: "no-store", signal, headers: { accept: "application/json" },
      });
      result.httpStatus = response.status;
      if (response.status !== 200) {
        result.state = "degraded"; result.reason = response.status === 401 || response.status === 403 ? "access_denied" : response.status === 409 ? "version_changed" : response.status >= 300 && response.status < 400 ? "redirect_rejected" : "http_failed";
        await response.body?.cancel();
      } else {
        if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("contract_invalid");
        const declared = response.headers.get("content-length"); if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error("response_too_large");
        if (!response.body) throw new Error("contract_invalid");
        const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let body = "";
        try {
          while (true) {
            signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength; if (bytes > MAX_BYTES) throw new Error("response_too_large");
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        signal.throwIfAborted();
        const decoded = await spec.decode(JSON.parse(body), spec.query, response.headers.get("X-Netshop-Data-Revision"));
        signal.throwIfAborted(); if (performance.now() - started > totalMs || performance.now() - at > perCheckMs) throw new Error("probe_deadline");
        result.sourceChecks = classifySources(spec.id, decoded);
        const inspected = inspectValidatedPayload(decoded); result.dataGaps = inspected.dataGaps;
        result.state = worst(result.sourceChecks.map(v => v.state)); result.reason = result.state === "passed" ? null : result.state === "degraded" ? "source_read_failed" : "source_not_exercised";
        if (inspected.sourceErrors) { result.state = "degraded"; result.reason = "source_read_failed"; }
      }
    } catch (error) {
      result.state = "degraded";
      result.reason = options.signal?.aborted ? "cancelled" : signal.aborted || performance.now() - at >= perCheckMs || performance.now() - started >= totalMs ? "probe_deadline"
        : error instanceof Error && error.message === "response_too_large" ? "response_too_large" : response ? "contract_invalid" : "transport_failed";
    } finally {
      clearTimeout(timer); controller.abort(); result.elapsedMs = Math.round(performance.now() - at); result.responseBytes = bytes;
    }
    checks.push(result);
    // Access denial invalidates the run; do not repeatedly probe as a different role.
    if (result.reason === "access_denied" || result.reason === "probe_deadline" || options.signal?.aborted) {
      for (const rest of specs.slice(checks.length)) checks.push({ ...result, id: rest.id, state: "unverified", reason: "not_run", httpStatus: null, elapsedMs: 0, responseBytes: 0, sourceChecks: [], dataGaps: {} });
      break;
    }
  }
  const state = worst(checks.map(c => c.state));
  return { schemaVersion: "netshop-business-readiness-v1", checkedAt, finishedAt: new Date().toISOString(),
    scopeDigest: createHash("sha256").update(JSON.stringify(scope)).digest("hex"), period: { startDate: scope.startDate, endDate: scope.endDate },
    state, businessReady: state === "passed", checks,
    limitations: ["Explicit read-only sampled scope; not all shops or full-period certification", "Data gaps are separate from source failure", "Independent probes do not form an atomic cross-domain snapshot", "Candidate/runtime identity must also pass the existing deployment binding checks", "This report never triggers startup, restart, import, or notification", "No automatic retries; no production credentials are loaded by this tool"] };
}
