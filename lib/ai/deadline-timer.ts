/** Schedule long deadlines without the platform's signed 32-bit timer overflow. */
export function scheduleDeadlineTimer(callback: () => void, timeoutMs: number | null, now = () => performance.now()): () => void {
  if (timeoutMs === null) return () => undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > Number.MAX_SAFE_INTEGER) throw new TypeError("timeoutMs must be positive and finite");
  const deadline = now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const check = () => {
    if (cancelled) return;
    const remaining = deadline - now();
    if (remaining <= 0) { callback(); return; }
    timer = setTimeout(check, Math.min(Math.ceil(remaining), 2_147_483_647));
  };
  // Preserve the original first timer delay. Recomputing it immediately can
  // turn 10ms into 9.9ms, which Node truncates into an earlier timer bucket
  // than an already-registered parent deadline.
  timer = setTimeout(check, Math.min(timeoutMs, 2_147_483_647));
  return () => { cancelled = true; clearTimeout(timer); };
}
