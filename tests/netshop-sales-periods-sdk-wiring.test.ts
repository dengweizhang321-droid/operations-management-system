import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readDjangoSalesConsumer, type SalesConsumerReaderConfig } from "../lib/django/sales-consumer-reader";
import { PublicApiError } from "../lib/http/api-error";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { SalesPeriodsRpcRequest } from "../lib/netshop/sales-periods-contract";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/netshop-sales-periods/response-periods.json", import.meta.url), "utf8"));
const request: SalesPeriodsRpcRequest = { operation: "netshop_periods_v1", current: { startDate: fixture.periods.current.startDate, endExclusive: fixture.periods.current.endExclusive }, baseline: { startDate: fixture.periods.baseline.startDate, endExclusive: fixture.periods.baseline.endExclusive }, rawOutlets: fixture.requestedScope.rawOutlets, categories: fixture.requestedScope.categories };
const principal: AppPrincipal = { email: "synthetic-sdk@example.test", displayName: "Synthetic", role: "admin", scope: null };
const config: SalesConsumerReaderConfig = { djangoBaseUrl: "http://127.0.0.1:18199", internalSecret: "synthetic-only-sdk-wire-secret-at-least-32", timeoutMs: 1000, maxRequestBytes: 65536, maxResponseBytes: 2 * 1024 * 1024 };
const revision = fixture.sourceRevisions[0].revision;
function response(data = fixture) { return Response.json({ operation: request.operation, data }, { headers: { "X-Sales-Data-Revision": revision, "X-Sales-Source-Revision": revision } }); }

test("the actual SDK signs a bounded expiry and decodes the actual owning two-window DTO", async () => {
  let body: Record<string, unknown> | undefined;
  const result = await readDjangoSalesConsumer(principal, request, { config, now: () => 1_790_801_234_000, fetchImpl: async (_, init) => { body = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)); return response(); } });
  assert.equal(body?.expiresAtEpochMs, 1_790_801_235_000);
  assert.equal(result.revision, revision); assert.deepEqual(result.data, fixture);
  assert.equal(Object.hasOwn(result.data.requestedScope, "expiresAtEpochMs"), false);
});

test("all nine malformed authority responses keep 401/403/409 priority before body or size decoding", async () => {
  for (const status of [401, 403, 409]) for (const shape of ["html", "empty", "invalid-utf8"]) {
    const body = shape === "html" ? "<html>synthetic authority failure</html>" : shape === "empty" ? null : new Uint8Array([0xc3, 0x28]);
    await assert.rejects(readDjangoSalesConsumer(principal, request, { config, fetchImpl: async () => new Response(body, { status, headers: { "content-length": "99999999" } }) }), error => error instanceof PublicApiError && error.status === status && error.code === (status === 409 ? "version_conflict" : "access_denied"));
  }
});

test("late authority failures after cancellation cannot invalidate a current scope", async () => {
  const controller = new AbortController();
  await assert.rejects(readDjangoSalesConsumer(principal, request, { config, signal: controller.signal, fetchImpl: async () => { controller.abort(); return new Response(null, { status: 403 }); } }), error => error instanceof PublicApiError && error.status === 499);
});

test("success with invalid UTF8 or a wrong request/revision binding fails closed", async () => {
  await assert.rejects(readDjangoSalesConsumer(principal, request, { config, fetchImpl: async () => new Response(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]), { headers: { "content-type": "application/json", "X-Sales-Data-Revision": revision, "X-Sales-Source-Revision": revision } }) }), error => error instanceof PublicApiError && error.status === 503);
  for (const mutate of [(data: typeof fixture) => { data.scopeMode = ["restricted"]; }, (data: typeof fixture) => { data.periods.current.endDate = "2026-09-01"; }]) {
    const data = structuredClone(fixture); mutate(data);
    await assert.rejects(readDjangoSalesConsumer(principal, request, { config, fetchImpl: async () => response(data) }), error => error instanceof PublicApiError && error.status === 503);
  }
});

test("caller expiry shrinks the whole SDK read, including a transport that ignores abort", async () => {
  const expiresAtEpochMs = Date.now() + 10;
  await assert.rejects(readDjangoSalesConsumer(principal, { ...request, expiresAtEpochMs }, { config, fetchImpl: async () => { await new Promise(resolve => setTimeout(resolve, 80)); return response(); } }), error => error instanceof PublicApiError && error.status === 503);
  let fetched = false;
  await assert.rejects(readDjangoSalesConsumer(principal, { ...request, expiresAtEpochMs: Date.now() - 1 }, { config, fetchImpl: async () => { fetched = true; return response(); } }), error => error instanceof PublicApiError && error.status === 503);
  assert.equal(fetched, false);
});
