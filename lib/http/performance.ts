/** Opt-in numeric observations. Never attach URL, headers, identity or payload. */
export const performanceStages = [
  "browser.headers", "browser.body", "browser.decode", "browser.render",
  "worker.frontend", "auth.identity", "auth.permissions", "auth.local",
  "django.roundtrip", "django.queue", "sql", "response.encode",
] as const;
export type PerformanceStage = typeof performanceStages[number];
export type PerformanceSample = Readonly<{ stage: PerformanceStage; durationMs: number }>;
export type PerformanceObserver = (sample: PerformanceSample) => void;

export function observeDuration(observer: PerformanceObserver | undefined, stage: PerformanceStage, durationMs: number) {
  if (!observer || !Number.isFinite(durationMs) || durationMs < 0) return;
  try { observer(Object.freeze({ stage, durationMs })); } catch { /* Diagnostics cannot break a read. */ }
}

export function createPerformanceRecorder(capacity = 128) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) throw new TypeError("invalid observation capacity");
  const samples: PerformanceSample[] = [];
  let next = 0;
  let enabled = false;
  const observe: PerformanceObserver = sample => {
    if (!enabled || !performanceStages.includes(sample.stage) || !Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
    // Copy only the allowlisted fields, even if a caller supplies extra properties.
    samples[next] = Object.freeze({ stage: sample.stage, durationMs: sample.durationMs });
    next = (next + 1) % capacity;
  };
  return {
    observe,
    setEnabled(value: boolean) { enabled = value; },
    clear() { samples.length = 0; next = 0; },
    snapshot() { return samples.length === capacity ? [...samples.slice(next), ...samples.slice(0, next)] : [...samples]; },
  };
}

/** Caller-owned request trace: no global map or reuse of authorization decisions. */
export function createPerformanceTrace(observer?: PerformanceObserver, now = () => performance.now()) {
  return {
    async measure<T>(stage: PerformanceStage, work: () => Promise<T>): Promise<T> {
      if (!observer) return work();
      const start = now();
      try { return await work(); }
      finally { observeDuration(observer, stage, now() - start); }
    },
  };
}

/** Only explicit numeric spans; missing queue/SQL instrumentation stays unknown. */
export function observeServerTiming(header: string | null, observer?: PerformanceObserver) {
  if (!observer || !header || header.length > 2048) return;
  const names: Record<string, PerformanceStage> = {
    worker: "worker.frontend", identity: "auth.identity", permissions: "auth.permissions",
    local: "auth.local", django: "django.roundtrip", queue: "django.queue", sql: "sql", encode: "response.encode",
  };
  for (const metric of header.split(",").slice(0, 16)) {
    const match = /^\s*([a-z]+)\s*;\s*dur=(\d+(?:\.\d+)?)\s*$/.exec(metric);
    if (match && names[match[1]]) observeDuration(observer, names[match[1]], Number(match[2]));
  }
}
