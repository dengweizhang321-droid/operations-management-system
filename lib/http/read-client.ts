import { requestJsonObserved } from "./api-client";
import type { PerformanceObserver } from "./performance";

export type ReadJsonOptions = {
  /** Caller-supplied opaque session + full verified principal/scope fingerprints. */
  identityKey: string;
  permissionKey: string;
  /** A reliable owner version; null disables joining, not reading. */
  version: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: HeadersInit;
};
type Subscriber = { resolve: (value: unknown) => void; reject: (error: unknown) => void; cleanup: () => void };
type Entry = { controller: AbortController; subscribers: Set<Subscriber>; timer: ReturnType<typeof setTimeout>; key: string };
type Result = { ok: true; value: unknown } | { ok: false; error: unknown };

function abortError() { return new DOMException("The operation was aborted", "AbortError"); }
function timeoutError() { return new DOMException("Read deadline exceeded", "TimeoutError"); }
function boundedInteger(value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError("invalid read limit");
  return value;
}
function fingerprint(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new TypeError("missing read identity/version fingerprint");
  return value;
}

/** Browser/session-owned GET-only pool. No result cache, queue or retries. */
export function createReadJsonClient(config: {
  origin: string;
  /** Exact, audited side-effect-free JSON paths. No wildcard endpoint matching. */
  paths: readonly string[];
  maxEntries?: number;
  maxSubscribersPerEntry?: number;
  maxSubscribers?: number;
  lifetimeMs?: number;
  maxBytes?: number;
  fetcher?: typeof fetch;
  observe?: PerformanceObserver;
}) {
  const origin = new URL(config.origin).origin;
  if (!/^https?:/.test(origin)) throw new TypeError("invalid read origin");
  const paths = new Set(config.paths);
  if (!paths.size || paths.size > 64 || [...paths].some(path => !path.startsWith("/api/") || /[?#]/.test(path) || path.startsWith("/api/ai/"))) throw new TypeError("invalid read paths");
  const maxEntries = boundedInteger(config.maxEntries ?? 8, 32);
  const maxPerEntry = boundedInteger(config.maxSubscribersPerEntry ?? 16, 64);
  const maxSubscribers = boundedInteger(config.maxSubscribers ?? 64, 128);
  const lifetime = boundedInteger(config.lifetimeMs ?? 15_000, 65_000);
  const maxBytes = boundedInteger(config.maxBytes ?? 2 * 1024 * 1024, 16 * 1024 * 1024);
  const entries = new Map<string, Entry>();
  // Aborted non-cooperative transports still consume capacity until they settle.
  const transports = new Set<AbortController>();
  let subscribers = 0;
  let sequence = 0;
  let disposed = false;

  function finish(entry: Entry, result: Result) {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    clearTimeout(entry.timer);
    for (const subscriber of entry.subscribers) {
      subscribers--;
      subscriber.cleanup();
      if (!result.ok) subscriber.reject(result.error);
      else {
        // Independent objects: one consumer cannot mutate another's response.
        try { subscriber.resolve(structuredClone(result.value)); } catch (cause) { subscriber.reject(cause); }
      }
    }
    entry.subscribers.clear();
  }

  return {
    async read<T = unknown>(input: string | URL, options: ReadJsonOptions): Promise<T> {
      if (disposed) throw new Error("read client disposed");
      // Runtime callers must not accidentally carry mutation/SSE options across.
      if (Object.keys(options).some(key => !["identityKey", "permissionKey", "version", "signal", "timeoutMs", "headers"].includes(key))) throw new TypeError("unsupported read option");
      const identity = fingerprint(options.identityKey);
      const permission = fingerprint(options.permissionKey);
      if (options.version !== null) fingerprint(options.version);
      const timeout = boundedInteger(options.timeoutMs ?? lifetime, lifetime);
      const url = new URL(input, origin);
      if (url.origin !== origin || url.username || url.password || url.hash || !paths.has(url.pathname)) throw new TypeError("unregistered read URL");
      const headers = new Headers(options.headers);
      if (headers.has("authorization") || headers.has("cookie") || headers.get("accept")?.includes("text/event-stream")) throw new TypeError("unsupported read header");
      if (!headers.has("accept")) headers.set("accept", "application/json");
      const key = JSON.stringify([identity, permission, options.version, url.href, [...headers].sort(), options.version === null ? ++sequence : null]);
      if (key.length > 16_384) throw new TypeError("read key too large");
      if (options.signal?.aborted) throw abortError();
      let entry = entries.get(key);
      if (subscribers >= maxSubscribers || (entry && entry.subscribers.size >= maxPerEntry) || (!entry && transports.size >= maxEntries)) throw new Error("read capacity exceeded");
      let start = false;
      if (!entry) {
        const controller = new AbortController();
        entry = { key, controller, subscribers: new Set(), timer: setTimeout(() => {
          finish(entry!, { ok: false, error: timeoutError() });
          controller.abort();
        }, lifetime) };
        entries.set(key, entry);
        transports.add(controller);
        start = true;
      }
      const current = entry;
      const promise = new Promise<T>((resolve, reject) => {
        const detach = (error: unknown) => {
          if (!current.subscribers.delete(subscriber)) return;
          subscribers--;
          subscriber.cleanup();
          reject(error);
          if (!current.subscribers.size) {
            finish(current, { ok: true, value: undefined });
            current.controller.abort();
          }
        };
        const cancel = () => detach(abortError());
        const timer = setTimeout(() => detach(timeoutError()), timeout);
        const subscriber: Subscriber = { resolve: value => resolve(value as T), reject, cleanup() {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", cancel);
        } };
        current.subscribers.add(subscriber);
        subscribers++;
        options.signal?.addEventListener("abort", cancel, { once: true });
      });
      if (start) {
        // Promise handler is always installed, including when the fetch ignores abort.
        void requestJsonObserved(url, { method: "GET", headers, signal: current.controller.signal, redirect: "error" }, {
          fetcher: async (input, init) => {
            const response = await (config.fetcher ?? fetch)(input, init);
            if (current.controller.signal.aborted) {
              if (response.body) void response.body.cancel().catch(() => undefined);
              throw abortError();
            }
            return response;
          }, maxBytes, observe: config.observe,
        }).then(value => finish(current, { ok: true, value }), error => finish(current, { ok: false, error }))
          .finally(() => transports.delete(current.controller));
      }
      return promise;
    },
    /** Logout, privilege/version change or owner teardown: releases all pending reads. */
    invalidate() {
      for (const entry of [...entries.values()]) { finish(entry, { ok: false, error: abortError() }); entry.controller.abort(); }
    },
    dispose() { this.invalidate(); disposed = true; },
    stats() { return { entries: entries.size, subscribers, transports: transports.size, resultCacheEntries: 0 }; },
  };
}
