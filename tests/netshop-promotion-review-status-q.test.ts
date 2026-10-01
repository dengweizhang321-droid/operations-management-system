import test from "node:test";
import assert from "node:assert/strict";
import { readPromotion } from "../app/netshop/promotion/read";
import { InsightReadError } from "../app/netshop/shared/request-state";

const query = () => new URLSearchParams({ platform: "京东", startDate: "2026-09-01", endDate: "2026-09-07" });
for (const status of [401, 403, 409]) test(`Q authoritative ${status} refuses a never-ending optional body`, { timeout: 2000 }, async () => {
  let cancelled = false, decoded = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(readPromotion("/api/netshop/promotion-insights", query(), new AbortController().signal,
    () => { decoded = true; return null; }, async () => new Response(stream, { status })),
  error => error instanceof InsightReadError && error.code === (status === 409 ? "promotion_revision_changed" : "access_denied"));
  assert.equal(cancelled, true);
  assert.equal(decoded, false);
  assert.equal(stream.locked, false);
});
test("Q cancellation wins even if optional-body cancellation aborts the superseded scope", async () => {
  const scope = new AbortController(), reason = new DOMException("Superseded scope", "AbortError");
  let decoded = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { scope.abort(reason); } });
  await assert.rejects(readPromotion("/api/netshop/promotion-insights/detail", query(), scope.signal,
    () => { decoded = true; return null; }, async () => new Response(stream, { status: 403 })), error => error === reason);
  assert.equal(decoded, false);
});
