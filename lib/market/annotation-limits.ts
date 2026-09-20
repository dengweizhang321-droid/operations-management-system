export const MARKET_ANNOTATION_JOB_LIMITS = {
  default: 10_000,
  maximum: 10_000,
} as const;

export const MARKET_ANNOTATION_CONCURRENCY_LIMITS = {
  minimum: 1,
  maximum: 50,
  cloudDefault: 10,
  localDefault: 1,
} as const;

export type MarketAnnotationExecutor = "cloud" | "local";

export function normalizeMarketAnnotationJobLimit(value?: number) {
  const resolved = value === undefined ? MARKET_ANNOTATION_JOB_LIMITS.default : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MARKET_ANNOTATION_JOB_LIMITS.maximum) {
    throw new Error(`limit 必须是 1 到 ${MARKET_ANNOTATION_JOB_LIMITS.maximum} 的整数`);
  }
  return resolved;
}

export function defaultMarketAnnotationConcurrency(executor: MarketAnnotationExecutor) {
  return executor === "local"
    ? MARKET_ANNOTATION_CONCURRENCY_LIMITS.localDefault
    : MARKET_ANNOTATION_CONCURRENCY_LIMITS.cloudDefault;
}

export function normalizeMarketAnnotationConcurrency(value: number | undefined, executor: MarketAnnotationExecutor) {
  const resolved = value === undefined ? defaultMarketAnnotationConcurrency(executor) : value;
  if (!Number.isSafeInteger(resolved) || resolved < MARKET_ANNOTATION_CONCURRENCY_LIMITS.minimum || resolved > MARKET_ANNOTATION_CONCURRENCY_LIMITS.maximum) {
    throw new Error(`并发数必须是 ${MARKET_ANNOTATION_CONCURRENCY_LIMITS.minimum} 到 ${MARKET_ANNOTATION_CONCURRENCY_LIMITS.maximum} 的整数`);
  }
  return resolved;
}
