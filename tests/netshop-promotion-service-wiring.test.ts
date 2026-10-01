import assert from "node:assert/strict";
import test from "node:test";
import {
  NETSHOP_PROMOTION_INSIGHTS_PATH,
  NETSHOP_PROMOTION_INSIGHTS_DETAIL_PATH,
  requestDjangoNetshopService,
} from "../lib/django/netshop-service";
import { PublicApiError } from "../lib/http/api-error";

const principal = { email: "synthetic@example.test", displayName: "Synthetic", role: "viewer" as const, scope: null };
const config = {
  readerBaseUrl: "http://127.0.0.1:18388", writerBaseUrl: "http://127.0.0.1:18389",
  internalSecret: "synthetic-promotion-wiring-secret-0123456789",
  timeoutMs: 1000, maxResponseBytes: 32 * 1024 * 1024,
};
const paths = [NETSHOP_PROMOTION_INSIGHTS_PATH, NETSHOP_PROMOTION_INSIGHTS_DETAIL_PATH];

test("promotion readers preserve exact GET scope and owning revision with the insights budget", async () => {
  for (const path of paths) {
    const query = new URLSearchParams({ platform: "京东", q: "合成 & 编号", page: "2" });
    const result = await requestDjangoNetshopService(principal, { method: "GET", path, query, service: "reader" }, {
      config, insightsTimeoutMs: 90_000, fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        assert.equal(request.method, "GET");
        assert.equal(new URL(request.url).origin, config.readerBaseUrl);
        assert.equal(new URL(request.url).pathname, path);
        assert.equal(new URL(request.url).searchParams.toString(), query.toString());
        assert.equal(init?.cache, "no-store");
        assert.ok(request.headers.get("x-teruisi-signature"));
        return Response.json({ columnVersion: "synthetic" }, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
      },
    });
    assert.equal(result.revision, "1:aaaaaaaaaaaa");
  }
});

test("promotion and unknown routes never become writer or POST readers", async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return Response.json({}); };
  for (const path of paths) {
    for (const input of [
      { method: "GET" as const, path, service: "writer" as const },
      { method: "POST" as const, path, service: "writer" as const, payload: {} },
      { method: "POST" as const, path, service: "reader" as const, payload: {} },
    ]) {
      await assert.rejects(requestDjangoNetshopService(principal, input, { config, fetchImpl }), PublicApiError);
    }
  }
  await assert.rejects(requestDjangoNetshopService(principal, {
    method: "GET", path: NETSHOP_PROMOTION_INSIGHTS_PATH + "/unknown", service: "reader",
  }, { config, fetchImpl }), PublicApiError);
  assert.equal(fetched, 0);
});

test("promotion insights timeout rejects above 90 seconds or an overview-only override", async () => {
  for (const path of paths) {
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "reader" },
      { config, insightsTimeoutMs: 90_001 }), PublicApiError);
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "reader" },
      { config, overviewTimeoutMs: 90_000 }), PublicApiError);
  }
});

test("promotion readers enforce the 2MiB complete response cap for both fixed paths", async () => {
  for (const path of paths) {
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "reader" }, {
      config, insightsTimeoutMs: 90_000,
      fetchImpl: async () => Response.json({ data: "x".repeat(2 * 1024 * 1024) },
        { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } }),
    }), error => error instanceof PublicApiError && error.code === "service_unavailable");
  }
});

test("successful promotion responses require an owning revision header", async () => {
  for (const path of paths) {
    await assert.rejects(requestDjangoNetshopService(principal, { method: "GET", path, service: "reader" }, {
      config, insightsTimeoutMs: 90_000, fetchImpl: async () => Response.json({ columnVersion: "synthetic" }),
    }), PublicApiError);
  }
});
