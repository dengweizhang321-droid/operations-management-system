import assert from "node:assert/strict";
import test from "node:test";
import { requestDjangoNetshopService, NETSHOP_PRODUCT_INSIGHTS_PATH, NETSHOP_PRODUCT_INSIGHTS_DETAIL_PATH } from "../lib/django/netshop-service";
import { PublicApiError } from "../lib/http/api-error";

const principal = { email: "synthetic@example.test", displayName: "Synthetic", role: "viewer" as const, scope: null };
const config = { readerBaseUrl: "http://127.0.0.1:18222", writerBaseUrl: "http://127.0.0.1:18223", internalSecret: "synthetic-product-wiring-secret-0123456789", timeoutMs: 1000, maxResponseBytes: 32 * 1024 * 1024 };
test("new product fixed readers support bounded insights budget and exact query, never writer calls", async () => {
  for (const path of [NETSHOP_PRODUCT_INSIGHTS_PATH, NETSHOP_PRODUCT_INSIGHTS_DETAIL_PATH]) {
    const query = new URLSearchParams({ platform: "京东", startDate: "2026-09-01", endDate: "2026-09-01" });
    const result = await requestDjangoNetshopService(principal, { method: "GET", path, query, service: "reader" }, { config, insightsTimeoutMs: 90000, fetchImpl: async (input, init) => {
      const request = new Request(input, init); assert.equal(request.method, "GET"); assert.equal(new URL(request.url).pathname, path); assert.equal(new URL(request.url).searchParams.get("platform"), "京东");
      return Response.json({ schemaVersion: "synthetic" }, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
    } });
    assert.equal(result.revision, "1:aaaaaaaaaaaa");
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "writer" }, { config }), PublicApiError);
    await assert.rejects(requestDjangoNetshopService(principal, { method: "POST", path, service: "reader", payload: {} }, { config }), PublicApiError);
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "reader" }, { config, insightsTimeoutMs: 90001 }), PublicApiError);
  }
});
test("product paths retain 2MiB response cap despite larger configuration", async () => {
  await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path: NETSHOP_PRODUCT_INSIGHTS_PATH, service: "reader" }, { config, insightsTimeoutMs: 90000, fetchImpl: async () => Response.json({ data: "x".repeat(2 * 1024 * 1024) }, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }) }), e => e instanceof PublicApiError && e.code === "service_unavailable");
});
