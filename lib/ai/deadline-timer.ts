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
    timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
  };
  check();
  return () => { cancelled = true; clearTimeout(timer); };
}
