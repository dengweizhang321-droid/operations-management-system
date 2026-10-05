import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/http/api-error";
import { createReadJsonClient, type ReadJsonOptions } from "../lib/http/read-client";
import { createPerformanceRecorder, createPerformanceTrace, observeServerTiming } from "../lib/http/performance";

const paths = ["/api/sales/summary", "/api/inventory/overview", "/api/products/summary", "/api/market/overview"];
const options: ReadJsonOptions = { identityKey: "session-A", permissionKey: "principal-scope-A", version: "owner-v1" };
function deferred() {
  let release!: (response: Response) => void;
  const promise = new Promise<Response>(resolve => { release = resolve; });
  return { promise, release };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("four audited representative reads join only exact in-flight keys; legacy results stay independent", async () => {
  for (const path of paths) {
    const gate = deferred(); let calls = 0;
    const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async (_input, init) => {
      calls++; assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "same-origin"); return gate.promise;
    } });
    const a = client.read<{ items: number[] }>(path + "?date=2026-09-01&filter=a&filter=b", options);
    const b = client.read<{ items: number[] }>(path + "?date=2026-09-01&filter=a&filter=b", options);
    assert.equal(calls, 1); gate.release(Response.json({ items: [1] }));
    const [first, second] = await Promise.all([a, b]); first.items.push(2);
    assert.deepEqual(second.items, [1]); await tick();
    assert.deepEqual(client.stats(), { entries: 0, subscribers: 0, transports: 0, resultCacheEntries: 0 }); client.dispose();
  }
});

test("user, permission/scope, date, filter order, version and headers isolate entries", async () => {
  const gates: ReturnType<typeof deferred>[] = [];
  const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async () => { const gate = deferred(); gates.push(gate); return gate.promise; } });
  const path = paths[0] + "?date=2026-09-01&filter=a&filter=b";
  const pending = [
    client.read(path, options), client.read(path, { ...options, identityKey: "B" }),
    client.read(path, { ...options, permissionKey: "limited" }), client.read(path, { ...options, version: "v2" }),
    client.read(path.replace("09-01", "09-02"), options), client.read(path.replace("filter=a&filter=b", "filter=b&filter=a"), options),
    client.read(path, { ...options, headers: { "x-owner-format": "2" } }),
  ];
  assert.equal(gates.length, 7);
  gates.forEach((gate, n) => gate.release(Response.json({ n })));
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 7 }, (_, n) => ({ n }))); client.dispose();
});

test("one cancellation and one short subscriber deadline cannot cancel a survivor", async () => {
  const gate = deferred(); let transport!: AbortSignal; const a = new AbortController();
  const client = createReadJsonClient({ origin: "http://fixture.test", paths, lifetimeMs: 200, fetcher: async (_url, init) => { transport = init!.signal!; return gate.promise; } });
  const cancelled = assert.rejects(client.read(paths[0], { ...options, signal: a.signal }), { name: "AbortError" });
  const short = assert.rejects(client.read(paths[0], { ...options, timeoutMs: 10 }), { name: "TimeoutError" });
  const survivor = client.read(paths[0], options); a.abort(); await Promise.all([cancelled, short]);
  assert.equal(transport.aborted, false); gate.release(Response.json({ ok: true })); assert.deepEqual(await survivor, { ok: true }); client.dispose();
});

test("all subscribers cancelling aborts transport; late completion cannot poison a new read", async () => {
  const gates = [deferred(), deferred()]; const signals: AbortSignal[] = [];
  const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async (_url, init) => { signals.push(init!.signal!); return gates[signals.length - 1].promise; } });
  const a = new AbortController(); const rejected = assert.rejects(client.read(paths[0], { ...options, signal: a.signal }), { name: "AbortError" });
  a.abort(); await rejected; assert.equal(signals[0].aborted, true);
  const fresh = client.read(paths[0], options); gates[0].release(Response.json({ stale: true })); gates[1].release(Response.json({ fresh: true }));
  assert.deepEqual(await fresh, { fresh: true }); await tick(); assert.equal(client.stats().transports, 0); client.dispose();
});

test("network/HTTP/JSON failures are shared only in flight, never retried or cached", async () => {
  for (const failure of ["network", "http", "json"]) {
    let calls = 0;
    const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async () => {
      calls++; if (calls > 1) return Response.json({ fresh: true });
      if (failure === "network") throw new TypeError("fixture");
      return failure === "http" ? Response.json({ code: "denied", error: "fixture" }, { status: 403 }) : new Response("bad");
    } });
    const results = await Promise.allSettled([client.read(paths[0], options), client.read(paths[0], options)]);
    assert.ok(results.every(result => result.status === "rejected" && result.reason instanceof ApiError)); assert.equal(calls, 1); await tick();
    assert.deepEqual(await client.read(paths[0], options), { fresh: true }); assert.equal(calls, 2); client.dispose();
  }
});

test("missing version disables joining; completed results are never reused", async () => {
  let calls = 0; const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async () => Response.json({ n: ++calls }) });
  assert.deepEqual(await Promise.all([client.read(paths[0], { ...options, version: null }), client.read(paths[0], { ...options, version: null })]), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(await client.read(paths[0], options), { n: 3 }); assert.deepEqual(await client.read(paths[0], options), { n: 4 }); client.dispose();
});

test("invalidation rejects old subscribers and permits a new epoch, without cached authorization", async () => {
  const gate = deferred(); let calls = 0;
  const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async () => ++calls === 1 ? gate.promise : Response.json({ fresh: true }) });
  const a = assert.rejects(client.read(paths[0], options), { name: "AbortError" }); const b = assert.rejects(client.read(paths[0], options), { name: "AbortError" });
  client.invalidate(); await Promise.all([a, b]); gate.release(Response.json({ old: true })); await tick(); assert.equal(client.stats().transports, 0);
  assert.deepEqual(await client.read(paths[0], { ...options, permissionKey: "new-epoch" }), { fresh: true }); client.dispose(); await assert.rejects(client.read(paths[0], options), /disposed/);
});

test("capacity bounds entries, subscribers, keys and abandoned transports", async () => {
  const gate = deferred(); const client = createReadJsonClient({ origin: "http://fixture.test", paths, maxEntries: 1, maxSubscribersPerEntry: 1, maxSubscribers: 1, lifetimeMs: 15, fetcher: async () => gate.promise });
  const pending = assert.rejects(client.read(paths[0], options), { name: "TimeoutError" });
  await assert.rejects(client.read(paths[0], options), /capacity/); await assert.rejects(client.read(paths[1], options), /capacity/);
  await pending; assert.equal(client.stats().subscribers, 0); assert.equal(client.stats().entries, 0); assert.equal(client.stats().transports, 1);
  await assert.rejects(client.read(paths[0], options), /capacity/); gate.release(Response.json({})); await tick(); assert.equal(client.stats().transports, 0); client.dispose();
});

test("pre-abort, writes, SSE, credentials, foreign/unregistered URLs and invalid budgets never reach transport", async () => {
  let calls = 0; const client = createReadJsonClient({ origin: "http://fixture.test", paths, fetcher: async () => { calls++; return Response.json({}); } });
  const controller = new AbortController(); controller.abort(); await assert.rejects(client.read(paths[0], { ...options, signal: controller.signal }), { name: "AbortError" });
  for (const path of ["http://other.test/api/sales/summary", "/api/unregistered", paths[0] + "#fragment", "http://a:b@fixture.test/api/sales/summary"]) await assert.rejects(client.read(path, options), TypeError);
  for (const extra of [{ method: "POST" }, { body: {} }, { headers: { accept: "text/event-stream" } }, { headers: { authorization: "redacted" } }, { timeoutMs: 999999 }, { identityKey: "" }, { version: undefined }]) await assert.rejects(client.read(paths[0], { ...options, ...extra } as ReadJsonOptions), TypeError);
  assert.equal(calls, 0); client.dispose();
});

test("bounded bodies reject dishonest Content-Length and release the reader", async () => {
  for (const declared of [undefined, "1", "100"]) {
    let cancelled = 0; const client = createReadJsonClient({ origin: "http://fixture.test", paths, maxBytes: 8, fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled++; } }), { headers: declared ? { "content-length": declared } : {} }) });
    await assert.rejects(client.read(paths[0], options), (error: unknown) => error instanceof ApiError && error.code === "response_too_large"); await tick(); assert.equal(cancelled, 1); client.dispose();
  }
});

test("one lifetime covers slow headers and slow body; stream cancellation releases slots", async () => {
  let cancelled = 0; const client = createReadJsonClient({ origin: "http://fixture.test", paths, lifetimeMs: 15, fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"items":')); }, cancel() { cancelled++; } })) });
  await assert.rejects(client.read(paths[0], options), { name: "TimeoutError" }); await tick(); assert.equal(cancelled, 1); assert.equal(client.stats().transports, 0); client.dispose();
});

test("observation is disabled by default, bounded and strips sensitive fields; observer failures are harmless", async () => {
  const recorder = createPerformanceRecorder(2);
  recorder.observe({ stage: "sql", durationMs: 1 }); assert.deepEqual(recorder.snapshot(), []); recorder.setEnabled(true);
  recorder.observe({ stage: "sql", durationMs: 1, secret: "must-not-persist" } as never);
  observeServerTiming('queue;dur=3, sql;dur=4, identity;dur=5;desc="secret"', recorder.observe);
  assert.deepEqual(recorder.snapshot(), [{ stage: "django.queue", durationMs: 3 }, { stage: "sql", durationMs: 4 }]);
  recorder.setEnabled(false); recorder.clear(); assert.deepEqual(recorder.snapshot(), []);
  let clocks = 0; const trace = createPerformanceTrace(undefined, () => { clocks++; return 0; }); assert.equal(await trace.measure("auth.local", async () => 1), 1); assert.equal(clocks, 0);
  const client = createReadJsonClient({ origin: "http://fixture.test", paths, observe: () => { throw Error("observer"); }, fetcher: async () => Response.json({ ok: true }) });
  assert.deepEqual(await client.read(paths[0], options), { ok: true }); client.dispose();
});
