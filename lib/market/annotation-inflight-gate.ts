/** In-flight de-duplication only: the same key joins the running request; a different key starts a new one. Nothing is cached after settling. */
export function createInflightGate() {
  let current: { key: string; promise: Promise<unknown> } | null = null;
  return {
    run<T>(key: string, start: () => Promise<T>): Promise<T> {
      if (current?.key === key) return current.promise as Promise<T>;
      const entry: { key: string; promise: Promise<unknown> } = { key, promise: Promise.resolve() };
      current = entry;
      entry.promise = start().finally(() => { if (current === entry) current = null; });
      return entry.promise as Promise<T>;
    },
    /** Forget the running request (e.g. after a write) so the next call always re-sends. */
    reset() { current = null; },
  };
}
