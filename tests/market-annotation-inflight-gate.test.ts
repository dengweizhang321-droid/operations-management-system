import assert from "node:assert/strict";
import test from "node:test";
import { createInflightGate } from "../lib/market/annotation-inflight-gate";

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test("same key joins the running request instead of sending again", async () => {
  const gate = createInflightGate(); const d = deferred<number>(); let starts = 0;
  const a = gate.run("k", () => { starts += 1; return d.promise; });
  const b = gate.run("k", () => { starts += 1; return d.promise; });
  assert.equal(starts, 1);
  d.resolve(7);
  assert.deepEqual([await a, await b], [7, 7]);
});

test("a different key starts a new request", async () => {
  const gate = createInflightGate(); let starts = 0;
  const d = deferred<number>();
  void gate.run("a", () => { starts += 1; return d.promise; });
  void gate.run("b", () => { starts += 1; return d.promise; });
  assert.equal(starts, 2);
  d.resolve(1);
});

test("after settling (success or failure) the same key is sent again; no result cache", async () => {
  const gate = createInflightGate(); let starts = 0;
  await gate.run("k", async () => { starts += 1; return 1; });
  await assert.rejects(gate.run("k", async () => { starts += 1; throw new Error("x"); }));
  await gate.run("k", async () => { starts += 1; return 2; });
  assert.equal(starts, 3);
});

test("reset after a write forces a resend even with the same key", async () => {
  const gate = createInflightGate(); const d = deferred<number>(); let starts = 0;
  void gate.run("k", () => { starts += 1; return d.promise; });
  gate.reset();
  void gate.run("k", () => { starts += 1; return d.promise; });
  assert.equal(starts, 2);
  d.resolve(1);
});

test("a superseded request settling does not clear the newer in-flight entry", async () => {
  const gate = createInflightGate(); const old = deferred<number>(); const next = deferred<number>(); let starts = 0;
  void gate.run("a", () => old.promise);
  void gate.run("b", () => { starts += 1; return next.promise; });
  old.resolve(1); await old.promise;
  void gate.run("b", () => { starts += 1; return next.promise; });
  assert.equal(starts, 1);
  next.resolve(2);
});
