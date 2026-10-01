import test from "node:test";
import assert from "node:assert/strict";
import { loadStorePanorama } from "../app/netshop/panorama/data";
import { InsightReadError, ScopedReadGate } from "../app/netshop/shared/request-state";
import { panoramaFixture, panoramaFixtureQuery } from "./netshop-panorama-fixture";

const ok = () => Response.json(panoramaFixture(true), { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
test("bounded transport decodes a complete owning envelope from an isolated fixture", async () => {
  const result = await loadStorePanorama(panoramaFixtureQuery(), new AbortController().signal, async () => ok());
  assert.equal(result.sources.products.state, "ready");
});
test("authoritative HTTP401/403 survive HTML, empty and malformed UTF8 bodies", async () => {
  for (const status of [401, 403]) for (const body of [null, "<html>failure</html>", new Uint8Array([0xff])]) {
    await assert.rejects(loadStorePanorama(panoramaFixtureQuery(), new AbortController().signal, async () => new Response(body, { status })), error => error instanceof InsightReadError && error.code === (status === 401 ? "unauthenticated" : "access_denied"));
  }
});
test("one 409 recovery drops both tokens and shares the original deadline signal", async () => {
  const query = panoramaFixtureQuery(); query.set("snapshotToken", "b".repeat(64)); query.set("sectionToken", "c".repeat(64));
  const urls: string[] = [], signals: unknown[] = [];
  await loadStorePanorama(query, new AbortController().signal, async (url, init) => { urls.push(String(url)); signals.push(init?.signal); return urls.length === 1 ? new Response("<html>stale</html>", { status: 409 }) : ok(); });
  assert.equal(urls.length, 2); assert.equal(signals[0], signals[1]); assert.ok(urls[0].includes("sectionToken")); assert.ok(!urls[1].includes("sectionToken")); assert.ok(!urls[1].includes("snapshotToken"));
  let count = 0;
  await assert.rejects(loadStorePanorama(panoramaFixtureQuery(), new AbortController().signal, async () => { count++; return new Response(null, { status: 409 }); }), error => error instanceof InsightReadError && error.code === "insights_revision_changed");
  assert.equal(count, 2);
});
test("scope cancellation wins before a late protected failure is parsed", async () => {
  const controller = new AbortController();
  await assert.rejects(loadStorePanorama(panoramaFixtureQuery(), controller.signal, async () => { controller.abort(new DOMException("读取已取消", "AbortError")); return new Response("denied", { status: 403 }); }), error => error instanceof DOMException && error.name === "AbortError");
});
test("late old-shop transport never obtains the new-shop gate", async () => {
  const gate = new ScopedReadGate(), old = gate.begin("A"), current = gate.begin("B");
  await assert.rejects(loadStorePanorama(panoramaFixtureQuery(), old.signal, async () => ok()));
  assert.equal(old.current(), false); assert.equal(current.current(), true);
});
test("oversized transport is cancelled at the whole 2MiB boundary", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(loadStorePanorama(panoramaFixtureQuery(), new AbortController().signal, async () => new Response(stream)), error => error instanceof InsightReadError && error.code === "quality_incomplete");
  assert.equal(cancelled, true);
});
