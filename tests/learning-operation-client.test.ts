import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/http/api-error";
import { createLearningOperationClient, learningStorageKey, type LearningState } from "../lib/workflow/learning-operation-client";

const id1 = "40000000-0000-4000-8000-000000000001";
const id2 = "40000000-0000-4000-8000-000000000002";
const done = (operationId = id1) => ({ operationId, status: "completed", result: { added: [], ambiguous: [], scanned: 8575 } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(shared = new Map<string, string>(), ownerEmail = "admin@example.test") {
  const requests: Array<{ operationId: string; method: string; signal: AbortSignal; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  const states: LearningState[] = [];
  const timers = new Map<number, () => void>();
  const completed: unknown[] = [];
  let number = 0;
  let nextId = id1;
  const storage = { getItem: (key: string) => shared.get(key) ?? null, setItem: (key: string, value: string) => { shared.set(key, value); } };
  const client = createLearningOperationClient({
    ownerEmail, storage,
    request: (operationId, method, signal) => new Promise((resolve, reject) => requests.push({ operationId, method, signal, resolve, reject })),
    onState: state => states.push(state), onCompleted: result => completed.push(result), newId: () => nextId,
    schedule: callback => { timers.set(++number, callback); return number as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { timers.delete(timer as unknown as number); },
  });
  function fire() { const [key, callback] = [...timers.entries()][0]; timers.delete(key); callback(); }
  return { client, requests, states, timers, shared, storage, completed, fire, newId: (value: string) => { nextId = value; } };
}

test("persists an id before POST; rapid repeated clicks do not create or submit twice", async () => {
  const f = fixture(); f.client.restore();
  const run = f.client.start();
  assert.equal(JSON.parse(f.shared.get(learningStorageKey("admin@example.test"))!).operationId, id1);
  await f.client.start(); await f.client.start();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "POST");
  f.requests[0].resolve(done()); await run;
  assert.equal(f.client.getState().phase, "completed");
  assert.equal(f.completed.length, 1);
  f.newId(id2);
  const next = f.client.start();
  assert.equal(f.requests[1].operationId, id2);
  f.requests[1].resolve(done(id2)); await next; f.client.dispose();
});

test("lost POST response recovers original result using GET only", async () => {
  const f = fixture(); const run = f.client.start();
  f.requests[0].reject(new TypeError("connection reset after commit")); await run;
  assert.equal(f.client.getState().phase, "confirming");
  assert.match(f.client.getState().message, /正在确认执行结果/);
  await f.client.start(); assert.equal(f.requests.length, 1);
  f.fire(); assert.equal(f.requests[1].method, "GET"); assert.equal(f.requests[1].operationId, id1);
  f.requests[1].resolve(done()); await tick();
  assert.equal(f.client.getState().phase, "completed");
  assert.equal(f.timers.size, 0); f.client.dispose();
});

test("refresh or leaving to switch AI models restores only the original receipt", async () => {
  const shared = new Map<string, string>();
  const previous = fixture(shared); const run = previous.client.start(); previous.client.dispose();
  const restored = fixture(shared); restored.client.restore();
  assert.equal(restored.requests[0].method, "GET"); assert.equal(restored.requests[0].operationId, id1);
  previous.requests[0].resolve(done()); await run;
  assert.equal(previous.completed.length, 0);
  restored.requests[0].resolve(done()); await tick();
  assert.equal(restored.client.getState().phase, "completed");
  restored.client.dispose();
});

test("unknown and mismatched responses never clear the id or automatically repeat POST", async () => {
  const f = fixture(); const run = f.client.start();
  f.requests[0].resolve(done(id2)); await run;
  for (let n = 0; n < 7; n++) {
    f.fire(); f.requests.at(-1)!.resolve({ operationId: id1, status: "unconfirmed" }); await tick();
  }
  assert.equal(f.client.getState().phase, "unconfirmed");
  assert.equal(f.client.getState().operationId, id1);
  assert.equal(f.requests.filter(request => request.method === "POST").length, 1);
  assert.equal(f.timers.size, 0);
  // Explicit continuation is the SAME operation, including if the original
  // request arrives late. Backend's transaction lock handles both attempts.
  f.newId(id2); const continued = f.client.start();
  assert.equal(f.requests.at(-1)!.operationId, id1);
  f.requests.at(-1)!.resolve(done()); await continued; f.client.dispose();
});

test("connection/visibility recovery queries with the original id and no duplicate reads", async () => {
  const f = fixture(); const run = f.client.start();
  f.requests[0].reject(new Error("offline")); await run;
  f.client.confirm(); f.client.confirm();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].method, "GET");
  assert.equal(f.timers.size, 0);
  f.requests[1].resolve(done()); await tick(); f.client.dispose();
});

test("failed terminal receipt permits a fresh deliberate operation; 403 stops queries and keeps id", async () => {
  const f = fixture(); const run = f.client.start();
  f.requests[0].resolve({ operationId: id1, status: "failed", error: "业务事务已回滚" }); await run;
  assert.equal(f.client.getState().phase, "failed");
  f.newId(id2); const next = f.client.start();
  f.requests[1].reject(new ApiError({ status: 403, message: "permission changed" })); await next;
  assert.equal(f.client.getState().phase, "blocked");
  assert.equal(f.client.getState().operationId, id2);
  assert.equal(f.timers.size, 0);
  f.client.confirm(); await f.client.start(); assert.equal(f.requests.length, 2); f.client.dispose();
});

test("storage failure prevents POST and another account never restores original account id", async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error("quota"); };
  await f.client.start(); assert.equal(f.requests.length, 0); assert.equal(f.client.getState().phase, "blocked");
  const first = fixture(); const run = first.client.start();
  const other = fixture(first.shared, "other@example.test"); other.client.restore();
  assert.equal(other.requests.length, 0); assert.equal(other.client.getState().phase, "idle");
  first.requests[0].resolve(done()); await run; first.client.dispose(); other.client.dispose(); f.client.dispose();
});

test("corrupt saved operation is blocked instead of discarded and silently recreated", async () => {
  const shared = new Map([[learningStorageKey("admin@example.test"), '{"version":1,"operationId":"invalid"}']]);
  const f = fixture(shared); f.client.restore(); await f.client.start();
  assert.equal(f.client.getState().phase, "blocked"); assert.equal(f.requests.length, 0); f.client.dispose();
});

test("deadline followed by late success keeps the id and queries instead of publishing stale result", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const pending = f.client.start();
  context.mock.timers.tick(20_000);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve(done()); await pending;
  assert.equal(f.completed.length, 0);
  assert.equal(f.client.getState().phase, "confirming");
  assert.equal(f.client.getState().operationId, id1);
  f.fire(); assert.equal(f.requests[1].method, "GET");
  f.requests[1].resolve(done()); await tick();
  assert.equal(f.completed.length, 1); f.client.dispose();
});
