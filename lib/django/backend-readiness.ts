import { BoundedFetchError, fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import { scheduleDeadlineTimer } from "@/lib/ai/deadline-timer";

const domains = [
  ["SALES", ""], ["FINANCE", "finance"], ["NETSHOP", "netshop"], ["MARKET", "market"],
  ["PRODUCTS", "products"], ["INVENTORY", "inventory"], ["WORKFLOW", "workflow"],
  ["CUSTOMER_SERVICE", "customerService"], ["ERP_REFERENCE", "erpReference"],
  ["ACCESS_CONTROL", "accessControl"], ["AI", "ai"], ["BI", "bi"],
] as const;
export const DJANGO_READINESS_SERVICES = domains.flatMap(([key, field]) =>
  (key === "BI" ? ["reader"] : ["reader", "writer"]).map((role) => ({
    name: `${key.toLowerCase()}.${role}`,
    variable: `TERUISI_DJANGO_${key === "ERP_REFERENCE" ? "ERP" : key}_${role.toUpperCase()}_BASE_URL`,
    field: field ? `${field}${role === "reader" ? "Reader" : "Writer"}` : role,
    aiRole: key === "AI" ? `ai_${role}` : null,
  })));

export const DJANGO_READINESS_REQUEST_TIMEOUT_MS = 4_000;
export const DJANGO_READINESS_ROUND_TIMEOUT_MS = 18_000;

type ServiceCheck = {
  service: string;
  state: "ready" | "not_ready" | "incomplete";
  reason: "none" | "not_checked" | "round_budget" | "cancelled" | "missing_configuration"
    | "invalid_endpoint" | "request_timeout" | "transport_error" | "redirect"
    | "response_too_large" | "http_status" | "invalid_response" | "identity_mismatch" | "not_ready_unknown";
  queueMs: number;
  requestMs: number;
  httpStatus?: number;
};

/** Read-only health probes, with no business query, credentials, or lifecycle action. */
export async function probeDjangoBackendReadiness(
  environment: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; /** Optional shorter round cap. */ timeoutMs?: number } = {},
) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const timeout = Number.isSafeInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.min(DJANGO_READINESS_ROUND_TIMEOUT_MS, Number(options.timeoutMs)) : DJANGO_READINESS_ROUND_TIMEOUT_MS;
  const deadline = startedAt + timeout;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const cancelTimer = scheduleDeadlineTimer(abort, timeout);
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  const checks: ServiceCheck[] = [];
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (cursor < DJANGO_READINESS_SERVICES.length) {
        const service = DJANGO_READINESS_SERVICES[cursor++];
        const check: ServiceCheck = { service: service.name, state: "incomplete", reason: "not_checked", queueMs: elapsed(), requestMs: 0 };
        checks.push(check);
        let requestStartedAt: number | undefined;
        try {
          // A service still in the queue never consumed its own request budget.
          if (controller.signal.aborted || performance.now() >= deadline) continue;
          const value = environment[service.variable]
            ?? (service.name === "sales.reader" ? environment.TERUISI_DJANGO_SALES_BASE_URL : undefined);
          check.state = "not_ready";
          check.reason = "missing_configuration";
          if (typeof value !== "string") continue;
          check.reason = "invalid_endpoint";
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
            || url.pathname !== "/" || (url.protocol === "http:"
              && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) continue;
          if (controller.signal.aborted || performance.now() >= deadline) {
            check.state = "incomplete";
            check.reason = "not_checked";
            continue;
          }
          requestStartedAt = performance.now();
          check.queueMs = elapsed();
          check.reason = "transport_error";
          const { response, data } = await fetchBoundedJson({
            url: new URL("/health/ready", url).toString(), init: { method: "GET", cache: "no-store" },
            timeoutMs: DJANGO_READINESS_REQUEST_TIMEOUT_MS, maxBytes: 16 * 1024, fetcher: options.fetchImpl, signal: controller.signal,
          });
          if (controller.signal.aborted || performance.now() >= deadline) {
            check.state = "incomplete";
            check.reason = options.signal?.aborted ? "cancelled" : "round_budget";
            continue;
          }
          // Reject a late transport completion even if its adapter ignored abort.
          if (performance.now() - requestStartedAt >= DJANGO_READINESS_REQUEST_TIMEOUT_MS) {
            check.reason = "request_timeout";
            continue;
          }
          check.httpStatus = response.status;
          const payload = data as Record<string, unknown> | null;
          if (response.status !== 200) {
            check.reason = response.status === 503 ? "not_ready_unknown" : "http_status";
          } else if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
            || !payload || Array.isArray(payload) || typeof payload !== "object") {
            check.reason = "invalid_response";
          } else if (payload.service !== "teruisi-django" || (service.aiRole
            && (payload.processRole !== service.aiRole || payload.authority !== "postgres"))
            || (!service.aiRole && payload.status === "ready" && payload.database === "ready" && payload[service.field] !== "ready")) {
            check.reason = "identity_mismatch";
          } else if (payload.status !== "ready" || payload.database !== "ready") {
            check.reason = "not_ready_unknown";
          } else {
            check.state = "ready";
            check.reason = "none";
          }
        } catch (error) {
          if (requestStartedAt !== undefined) {
            if (controller.signal.aborted || performance.now() >= deadline) {
              check.state = "incomplete";
              check.reason = options.signal?.aborted ? "cancelled" : "round_budget";
            } else if (error instanceof BoundedFetchError) {
              check.reason = error.code === "timeout" ? "request_timeout"
                : error.code === "cancelled" ? "cancelled" : error.code;
            }
          }
        } finally {
          if (requestStartedAt !== undefined) check.requestMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
        }
      }
    }));
  } finally {
    cancelTimer();
    options.signal?.removeEventListener("abort", abort);
  }
  const serviceChecks = DJANGO_READINESS_SERVICES.map(({ name }) => checks.find((check) => check.service === name)!);
  const unavailableServices = serviceChecks.filter((check) => check.state !== "ready").map((check) => check.service);
  return { ok: unavailableServices.length === 0, backend: "django-postgresql" as const, unavailableServices, serviceChecks };
}
