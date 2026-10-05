/** Only downloads code for an explicit navigation intent; it never queues work. */
export function createNavigationPreloader(
  loaders: Readonly<Record<string, () => Promise<unknown>>>,
  maximumPending = 2,
) {
  const pending = new Set<string>();
  const completed = new Set<string>();
  const retryAfter = new Map<string, number>();
  return (key: string): void => {
    const load = Object.prototype.hasOwnProperty.call(loaders, key) ? loaders[key] : undefined;
    if (!load || pending.has(key) || completed.has(key) || pending.size >= maximumPending
      || (retryAfter.get(key) ?? 0) > Date.now()) return;
    pending.add(key);
    void Promise.resolve().then(load).then(
      () => { completed.add(key); retryAfter.delete(key); },
      () => { retryAfter.set(key, Date.now() + 5_000); },
    ).finally(() => { pending.delete(key); });
  };
}
