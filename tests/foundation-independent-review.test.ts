import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestJson, requestJsonObserved } from "../lib/http/api-client";
import { createReadJsonClient } from "../lib/http/read-client";
import { createPerformanceRecorder, observeServerTiming } from "../lib/http/performance";
import { createReloadableLazyController } from "../app/shell/reloadable-lazy";
import Loading from "../app/shell/module-loading-state";

const paths = ["/api/sales/summary", "/api/inventory/overview", "/api/products/summary", "/api/market/overview"];
const identity = { identityKey: "opaque-session-1", permissionKey: "role-and-scope-1", version: "snapshot-1" };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("independent: a late subscriber's own deadline leaves earlier subscriber alive", async () => {
  const gate = deferred<Response>(); let transport!: AbortSignal;
  const pool = createReadJsonClient({ origin: "http://review.test", paths, lifetimeMs: 250,
    fetcher: async (_url, init) => { transport = init!.signal!; return gate.promise; } });
  const earlier = pool.read(paths[0], identity);
  await turn();
  const later = assert.rejects(pool.read(paths[0], { ...identity, timeoutMs: 5 }), { name: "TimeoutError" });
  await later; assert.equal(transport.aborted, false);
  gate.resolve(Response.json({ ok: true })); assert.deepEqual(await earlier, { ok: true });
  await turn(); assert.equal(pool.stats().transports, 0); pool.dispose();
});

test("independent: cancellation during body does not cancel a surviving subscriber", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>; let cancelled = 0;
  const pool = createReadJsonClient({ origin: "http://review.test", paths,
    fetcher: async () => new Response(new ReadableStream({ start(c) { stream = c; c.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancelled++; } })) });
  const controller = new AbortController();
  const a = assert.rejects(pool.read(paths[0], { ...identity, signal: controller.signal }), { name: "AbortError" });
  const b = pool.read(paths[0], identity); await turn(); controller.abort(); await a;
  assert.equal(cancelled, 0); stream.enqueue(new TextEncoder().encode("true}")); stream.close();
  assert.deepEqual(await b, { ok: true }); pool.dispose();
});

test("independent: invalidation followed by old transport rejection cannot finish the replacement", async () => {
  const gates = [deferred<Response>(), deferred<Response>()]; let calls = 0;
  const pool = createReadJsonClient({ origin: "http://review.test", paths, fetcher: async () => gates[calls++].promise });
  const old = assert.rejects(pool.read(paths[0], identity), { name: "AbortError" }); pool.invalidate(); await old;
  const next = pool.read(paths[0], identity); gates[0].reject(new Error("late rejected")); await turn();
  assert.equal(pool.stats().entries, 1); gates[1].resolve(Response.json({ epoch: 2 }));
  assert.deepEqual(await next, { epoch: 2 }); await turn(); assert.equal(pool.stats().transports, 0); pool.dispose();
});

test("independent: lifetime is measured from first request, not extended by late joining", async () => {
  const gate = deferred<Response>(); let signal!: AbortSignal;
  const pool = createReadJsonClient({ origin: "http://review.test", paths, lifetimeMs: 25,
    fetcher: async (_url, init) => { signal = init!.signal!; return gate.promise; } });
  const a = assert.rejects(pool.read(paths[0], identity), { name: "TimeoutError" });
  await new Promise(resolve => setTimeout(resolve, 15));
  const b = assert.rejects(pool.read(paths[0], identity), { name: "TimeoutError" });
  await Promise.all([a, b]); assert.equal(signal.aborted, true);
  assert.equal(pool.stats().transports, 1); gate.resolve(Response.json({ late: true })); await turn();
  assert.equal(pool.stats().transports, 0); pool.dispose();
});

test("independent: exhausted transport capacity still permits an existing exact-key subscriber", async () => {
  const gate = deferred<Response>();
  const pool = createReadJsonClient({ origin: "http://review.test", paths, maxEntries: 1, maxSubscribers: 2,
    fetcher: async () => gate.promise });
  const a = pool.read(paths[0], identity); const b = pool.read(paths[0], identity);
  await assert.rejects(pool.read(paths[1], identity), /capacity/);
  await assert.rejects(pool.read(paths[0], identity), /capacity/);
  gate.resolve(Response.json({ ok: true })); await Promise.all([a, b]); pool.dispose();
});

test("independent: completed capacity-one reads can be awaited sequentially without a cleanup turn", async () => {
  let calls = 0;
  const pool = createReadJsonClient({ origin: "http://review.test", paths, maxEntries: 1,
    fetcher: async () => Response.json({ n: ++calls }) });
  try {
    for (let n = 1; n <= 6; n++) assert.deepEqual(await pool.read(paths[0], identity), { n });
  } finally { pool.dispose(); }
});

test("independent: user, permission, date, filter, version, and response header dimensions never join", async () => {
  let calls = 0; const gates: ReturnType<typeof deferred<Response>>[] = [];
  const pool = createReadJsonClient({ origin: "http://review.test", paths,
    fetcher: async () => { calls++; const gate = deferred<Response>(); gates.push(gate); return gate.promise; } });
  const url = paths[0] + "?start=2026-09-01&channel=jd";
  const reads = [pool.read(url, identity), pool.read(url, { ...identity, identityKey: "session-2" }),
    pool.read(url, { ...identity, permissionKey: "scope-2" }), pool.read(url, { ...identity, version: "snapshot-2" }),
    pool.read(url.replace("09-01", "09-02"), identity), pool.read(url.replace("jd", "tmall"), identity),
    pool.read(url, { ...identity, headers: { "accept-language": "en" } })];
  assert.equal(calls, 7); gates.forEach((gate, i) => gate.resolve(Response.json({ i })));
  assert.deepEqual(await Promise.all(reads), gates.map((_gate, i) => ({ i }))); pool.dispose();
});

test("independent: each of four representative endpoints can opt in without completed-result reuse", async () => {
  for (const path of paths) {
    let calls = 0; const gate = deferred<Response>();
    const pool = createReadJsonClient({ origin: "http://review.test", paths, fetcher: async () => ++calls === 1 ? gate.promise : Response.json({ n: calls }) });
    const a = pool.read(path, identity); const b = pool.read(path, identity); assert.equal(calls, 1);
    gate.resolve(Response.json({ n: 1 })); await Promise.all([a, b]); await turn();
    assert.deepEqual(await pool.read(path, identity), { n: 2 }); pool.dispose();
  }
});

test("independent: an undefined body rejection remains a failure for every subscriber", async () => {
  const pool = createReadJsonClient({ origin: "http://review.test", paths,
    fetcher: async () => new Response(new ReadableStream({ start(c) { c.error(undefined); } })) });
  try {
    const outcomes = await Promise.allSettled([pool.read(paths[0], identity), pool.read(paths[0], identity)]);
    assert.ok(outcomes.every(outcome => outcome.status === "rejected"), JSON.stringify(outcomes));
  } finally { pool.dispose(); }
});

test("independent: observed transport honors its declared options.signal", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const result = requestJsonObserved("/api/test", {}, { maxBytes: 64, signal: controller.signal,
    fetcher: async () => { calls++; return Response.json({ ok: true }); } });
  const outcome = await Promise.allSettled([result]);
  assert.equal(calls, 0);
  assert.equal(outcome[0].status, "rejected");
  if (outcome[0].status === "rejected") assert.equal(outcome[0].reason.name, "AbortError");
});

test("independent: active observed options.signal reaches fetch and cancels a pending body", async () => {
  const controller = new AbortController(); let received: AbortSignal | null | undefined; let cancels = 0;
  const result = requestJsonObserved("/api/test", {}, { maxBytes: 64, signal: controller.signal,
    fetcher: async (_url, init) => {
      received = init?.signal;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancels++; } }));
    } });
  const rejected = assert.rejects(result, { name: "AbortError" }); await turn();
  assert.equal(received, controller.signal); controller.abort(); await rejected; assert.equal(cancels, 1);
});

test("independent: the default requestJson remains uncapped and preserves writes", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; assert.equal(init?.method, "PUT"); assert.equal(init?.body, '{"value":1}');
    assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin");
    return Response.json({ text: "x".repeat(2 * 1024 * 1024 + 1) });
  };
  try { const value = await requestJson<{ text: string }>("/api/test", { method: "PUT", body: { value: 1 } });
    assert.equal(value.text.length, 2 * 1024 * 1024 + 1); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("independent: loading region escapes labels, hides spinner and does not steal keyboard focus", () => {
  const html = renderToStaticMarkup(createElement(Loading, { title: "<secret>" }));
  assert.match(html, /&lt;secret&gt;/); assert.match(html, /aria-hidden="true"/);
  assert.match(html, /aria-busy="true"/); assert.doesNotMatch(html, /tabindex|autofocus/);
});

test("independent: old preload failure after reset cannot clear a newer code load", async () => {
  const gates = [deferred<{ default: () => null }>(), deferred<{ default: () => null }>()]; let calls = 0;
  const controller = createReloadableLazyController(() => gates[calls++].promise);
  assert.equal(calls, 0); const old = assert.rejects(controller.preload(), /old/); await Promise.resolve();
  const oldLazy = controller.current; controller.reset(); assert.notEqual(controller.current, oldLazy);
  const next = controller.preload(); await Promise.resolve(); gates[0].reject(Error("old")); await old;
  assert.equal(controller.preload(), next); assert.equal(calls, 2);
  gates[1].resolve({ default: () => null }); await next;
});

test("independent: recorder wraps in chronological order and stores only numeric allowlisted spans", () => {
  const recorder = createPerformanceRecorder(2); recorder.setEnabled(true);
  recorder.observe({ stage: "sql", durationMs: 1 }); recorder.observe({ stage: "sql", durationMs: 2 });
  observeServerTiming('sql;dur=3, queue;dur=4;desc="private", unknown;dur=5', recorder.observe);
  assert.deepEqual(recorder.snapshot(), [{ stage: "sql", durationMs: 2 }, { stage: "sql", durationMs: 3 }]);
});
