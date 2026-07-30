export const MARKET_ANNOTATION_JOB_LIMITS = {
  default: 10_000,
  maximum: 10_000,
} as const;

export function normalizeMarketAnnotationJobLimit(value?: number) {
  const resolved = value === undefined ? MARKET_ANNOTATION_JOB_LIMITS.default : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MARKET_ANNOTATION_JOB_LIMITS.maximum) {
    throw new Error(`limit 必须是 1 到 ${MARKET_ANNOTATION_JOB_LIMITS.maximum} 的整数`);
  }
  return resolved;
}
