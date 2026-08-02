export type AnnotationRetryKind = "waiting" | "transient" | "rate_limit";

const TRANSIENT_RETRY_BASE_MS = 15_000;
const RATE_LIMIT_RETRY_BASE_MS = 60_000;
const WAITING_RETRY_MS = 5_000;
const AUTO_RETRY_MAX_MS = 5 * 60_000;

export function annotationRetryDelayMs(kind: AnnotationRetryKind, failureCount: number, providerRetryAfterMs = 0) {
  const providerDelay = Number.isFinite(providerRetryAfterMs) ? Math.max(0, Math.trunc(providerRetryAfterMs)) : 0;
  if (kind === "waiting") return Math.max(WAITING_RETRY_MS, Math.min(providerDelay, AUTO_RETRY_MAX_MS));
  const base = kind === "rate_limit" ? RATE_LIMIT_RETRY_BASE_MS : TRANSIENT_RETRY_BASE_MS;
  const normalizedFailureCount = Number.isFinite(failureCount) ? Math.max(1, Math.trunc(failureCount)) : 1;
  const exponent = Math.min(4, normalizedFailureCount - 1);
  return Math.min(AUTO_RETRY_MAX_MS, Math.max(providerDelay, base * (2 ** exponent)));
}

export function annotationRequestRetryKind(error: unknown): Exclude<AnnotationRetryKind, "waiting"> | null {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error ?? "");
  if (status === 429 || /(?:HTTP|状态码)\s*429|rate limit|限流|额度不足/i.test(message)) return "rate_limit";
  if ([408, 425, 500, 502, 503, 504].includes(status)) return "transient";
  if (/abort|超时|timeout|network|fetch|failed to fetch|load failed/i.test(message)) return "transient";
  return null;
}

export function isRetryableAnnotationRequestError(error: unknown) {
  return annotationRequestRetryKind(error) !== null;
}
