import assert from "node:assert/strict";
import test from "node:test";
import { readPromotion } from "../app/netshop/promotion/read";
import { InsightReadError, ScopedReadGate } from "../app/netshop/shared/request-state";

const query = () => new URLSearchParams({ platform: "京东", startDate: "2026-09-23", endDate: "2026-09-29" });

test("promotion reader forwards request scope and owning revision to its decoder", async () => {
  const q = query();
  const value = await readPromotion("/api/netshop/promotion-insights", q, new AbortController().signal,
    (payload, actualQuery, revision) => {
      assert.equal(actualQuery, q); assert.equal(revision, "17:synthetic");
      return payload;
    }, async (input, init) => {
      assert.equal(String(input), `/api/netshop/promotion-insights?${q}`);
      assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
      return Response.json({ count: 0, missing: null }, { headers: { "X-Netshop-Data-Revision": "17:synthetic" } });
    });
  assert.deepEqual(value, { count: 0, missing: null });
});

test("promotion version and access failures stay errors and never decode as empty data", async () => {
  for (const status of [409, 401, 403, 503]) {
    let decoded = false;
    await assert.rejects(readPromotion("/api/netshop/promotion-insights/detail", query(), new AbortController().signal,
      () => { decoded = true; return null; }, async () => Response.json({ error: "合成来源拒绝" }, { status })),
    error => error instanceof InsightReadError && error.code === (status === 409 ? "promotion_revision_changed" : status === 401 || status === 403 ? "access_denied" : "service_unavailable"));
    assert.equal(decoded, false);
  }
});

test("promotion reader rejects invalid JSON and over-budget response", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(readPromotion("/api/netshop/promotion-insights", query(), signal, () => null, async () => new Response("<html>failure</html>")), /无法验证/);
  await assert.rejects(readPromotion("/api/netshop/promotion-insights", query(), signal, () => null, async () => new Response("x".repeat(2 * 1024 * 1024 + 1))), /安全读取范围/);
});

test("scope cancellation rejects a late upstream even when its fetch ignores abort", async () => {
  const gate = new ScopedReadGate(), stale = gate.begin("A");
  let finish: ((response: Response) => void) | undefined;
  let decoded = false;
  const promise = readPromotion("/api/netshop/promotion-insights", query(), stale.signal,
    () => { decoded = true; return "stale"; }, async () => new Promise(resolve => { finish = resolve; }));
  const current = gate.begin("B");
  finish?.(Response.json({ old: true }));
  await assert.rejects(promise, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(decoded, false); assert.equal(stale.current(), false); assert.equal(current.current(), true);
  gate.cancel();
});

test("owning decoder rejection cannot be presented as trusted promotion data", async () => {
  await assert.rejects(readPromotion("/api/netshop/promotion-insights", query(), new AbortController().signal,
    () => { throw new InsightReadError("invalid_promotion_contract", "范围或来源版本不符"); }, async () => Response.json({ summary: 100 })), /版本不符/);
});
