import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import { PublicApiError } from "../lib/http/api-error";
import {
  createSalesGatewayAuthHeaders,
  routeSalesReadRequest,
  salesGatewayConfigFromEnvironment,
  type SalesGatewayConfig,
} from "../lib/django/sales-gateway";

const secret = "test-only-django-sales-secret-32-bytes-minimum";
const revision = "17:9";
const principal: AppPrincipal = {
  email: "analyst@example.com",
  displayName: "分析员",
  role: "analyst",
  scope: {
    warehouses: ["主仓"],
    channels: ["直营网"],
    platforms: ["京东"],
  },
};

const djangoConfig: SalesGatewayConfig = {
  mode: "django",
  djangoBaseUrl: "http://127.0.0.1:8000",
  internalSecret: secret,
  timeoutMs: 1_000,
  maxResponseBytes: 64 * 1024,
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function request(rawQuery = "startDate=2026-08-01&endDate=2026-08-02"): Request {
  return new Request(`http://localhost/api/sales/category-analysis?${rawQuery}`, {
    headers: {
      authorization: "Bearer must-not-leave-the-bff",
      cookie: "session=must-not-leave-the-bff",
      "x-untrusted": "client-value",
    },
  });
}

test("sales gateway signature uses the exact v1 canonical contract and a base64url principal", async () => {
  const timestamp = 1_788_000_000;
  const requestId = "request-fixed-1";
  const rawQuery = "category=%E9%A5%AE%E6%B0%B4&outlet=A%2FB";
  const headers = await createSalesGatewayAuthHeaders({
    secret,
    principal,
    method: "get",
    path: "/api/sales/category-analysis",
    rawQuery,
    timestamp,
    requestId,
  });

  const encodedPrincipal = headers.get("x-teruisi-principal");
  assert.ok(encodedPrincipal);
  assert.equal(encodedPrincipal.includes("="), false);
  assert.deepEqual(JSON.parse(Buffer.from(encodedPrincipal, "base64url").toString("utf8")), principal);
  const canonical = [
    "v1",
    String(timestamp),
    requestId,
    "GET",
    "/api/sales/category-analysis",
    rawQuery,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    encodedPrincipal,
  ].join("\n");
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  assert.equal(headers.get("x-teruisi-signature"), `v1=${expected}`);
  assert.equal(headers.get("x-teruisi-content-sha256"), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(headers.get("x-teruisi-timestamp"), String(timestamp));
  assert.equal(headers.get("x-teruisi-request-id"), requestId);
});

test("legacy is the default, never calls Django, and always returns no-store with a backend marker", async () => {
  assert.equal(salesGatewayConfigFromEnvironment({}).mode, "legacy");
  let fetched = false;
  const response = await routeSalesReadRequest({
    request: request(),
    principal,
    config: { mode: "legacy" },
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
    legacy: async () => jsonResponse({ source: "legacy" }, { headers: { "cache-control": "public" } }),
  });
  assert.equal(fetched, false);
  assert.deepEqual(await response.json(), { source: "legacy" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-teruisi-sales-backend"), "legacy");
});

test("Django base URL permits HTTP only on exact loopback hosts and requires HTTPS remotely", async () => {
  const allowed = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
    "https://sales.example.com",
  ];
  for (const djangoBaseUrl of allowed) {
    let fetched = false;
    const response = await routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: { ...djangoConfig, djangoBaseUrl },
      legacy: async () => jsonResponse({ source: "legacy" }),
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({ source: "django" }, {
          headers: { "x-sales-data-revision": revision, "x-sales-source-revision": revision },
        });
      },
    });
    assert.equal(fetched, true, djangoBaseUrl);
    assert.equal(response.status, 200);
  }

  for (const djangoBaseUrl of [
    "http://sales.example.com",
    "http://127.0.0.1.evil.example.com",
    "http://localhost.evil.example.com",
  ]) {
    let fetched = false;
    await assert.rejects(() => routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: { ...djangoConfig, djangoBaseUrl },
      legacy: async () => jsonResponse({ source: "legacy" }),
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({ source: "django" });
      },
    }), (error: unknown) => error instanceof PublicApiError && error.status === 503, djangoBaseUrl);
    assert.equal(fetched, false, djangoBaseUrl);
  }
});

test("django mode preserves the raw query, sends only signed allowlist headers, and filters response headers", async () => {
  const rawQuery = "category=%E9%A5%AE%E6%B0%B4&category=A%2FB";
  let legacyCalled = false;
  let capturedUrl = "";
  let capturedHeaders = new Headers();
  const response = await routeSalesReadRequest({
    request: request(rawQuery),
    principal,
    expectedRevision: revision,
    config: djangoConfig,
    now: () => 1_788_000_000_000,
    requestId: () => "request-fixed-2",
    legacy: async () => {
      legacyCalled = true;
      return jsonResponse({ source: "legacy" });
    },
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ source: "django" }, {
        headers: {
          "cache-control": "public, max-age=300",
          "set-cookie": "django_session=forbidden",
          "x-unsafe-upstream": "forbidden",
          "x-sales-data-revision": revision,
          "x-sales-overview-cache": "bypass",
          "x-sales-source-revision": revision,
        },
      });
    },
  });

  assert.equal(legacyCalled, false);
  assert.equal(capturedUrl, `http://127.0.0.1:8000/api/sales/category-analysis?${rawQuery}`);
  assert.equal(capturedHeaders.get("authorization"), null);
  assert.equal(capturedHeaders.get("cookie"), null);
  assert.equal(capturedHeaders.get("x-untrusted"), null);
  assert.deepEqual([...capturedHeaders.keys()].sort(), [
    "accept",
    "x-teruisi-content-sha256",
    "x-teruisi-principal",
    "x-teruisi-request-id",
    "x-teruisi-signature",
    "x-teruisi-timestamp",
  ]);
  assert.deepEqual(await response.json(), { source: "django" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-unsafe-upstream"), null);
  assert.equal(response.headers.get("x-sales-data-revision"), revision);
  assert.equal(response.headers.get("x-sales-overview-cache"), "bypass");
  assert.equal(response.headers.get("x-sales-source-revision"), revision);
  assert.equal(response.headers.get("x-teruisi-sales-backend"), "django");
});

test("django mode fails closed on network errors and timeouts without invoking legacy", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("connection refused"); },
    async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  ]) {
    let legacyCalled = false;
    await assert.rejects(() => routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: { ...djangoConfig, timeoutMs: 5 },
      fetchImpl,
      legacy: async () => {
        legacyCalled = true;
        return jsonResponse({ source: "legacy" });
      },
    }), (error: unknown) => error instanceof PublicApiError && error.status === 503 && error.code === "service_unavailable");
    assert.equal(legacyCalled, false);
  }
});

test("django mode preserves the bounded revision-race 503 retry contract", async () => {
  const response = await routeSalesReadRequest({
    request: request(),
    principal,
    expectedRevision: revision,
    config: djangoConfig,
    legacy: async () => jsonResponse({ source: "legacy" }),
    fetchImpl: async () => jsonResponse(
      { error: "销售数据版本持续变化，请稍后重试。", code: "sales_overview_revision_changed" },
      { status: 503, headers: { "retry-after": "1" } },
    ),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("x-teruisi-sales-backend"), "django");
  assert.equal((await response.json()).code, "sales_overview_revision_changed");
});

test("django 2xx requires both revision headers to equal the BFF expected revision", async () => {
  const cases: Array<{ headers: HeadersInit; label: string }> = [
    { headers: {}, label: "missing" },
    { headers: { "x-sales-data-revision": "18:9", "x-sales-source-revision": revision }, label: "mismatch" },
  ];
  for (const fixture of cases) {
    await assert.rejects(() => routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: djangoConfig,
      legacy: async () => jsonResponse({ source: "legacy" }),
      fetchImpl: async () => jsonResponse({ source: "django" }, { headers: fixture.headers }),
    }), (error: unknown) => error instanceof PublicApiError && error.status === 503, fixture.label);
  }
});

test("post-fetch revision fence rejects a Django response when D1 changes during the request", async () => {
  const upstream = async () => jsonResponse({ source: "django" }, {
    headers: { "x-sales-data-revision": revision, "x-sales-source-revision": revision },
  });
  await assert.rejects(() => routeSalesReadRequest({
    request: request(),
    principal,
    expectedRevision: revision,
    readCurrentRevision: async () => "18:9",
    config: djangoConfig,
    legacy: async () => jsonResponse({ source: "legacy" }),
    fetchImpl: upstream,
  }), (error: unknown) => error instanceof PublicApiError && error.status === 503);

  const shadow = await routeSalesReadRequest({
    request: request(),
    principal,
    expectedRevision: revision,
    readCurrentRevision: async () => "18:9",
    config: { ...djangoConfig, mode: "shadow" },
    legacy: async () => jsonResponse({ source: "legacy" }),
    fetchImpl: upstream,
  });
  assert.deepEqual(await shadow.json(), { source: "legacy" });
  assert.equal(shadow.headers.get("x-teruisi-sales-shadow-result"), "mismatch");
});

test("shadow returns the exact legacy payload and exposes only a bounded comparison result", async () => {
  const fixtures: Array<{ django: unknown; result: string }> = [
    { django: { nested: { a: 1, b: 2 }, items: [1, 2] }, result: "match" },
    { django: { nested: { a: 9, b: 2 }, items: [1, 2] }, result: "mismatch" },
  ];
  for (const fixture of fixtures) {
    const legacyPayload = { items: [1, 2], nested: { b: 2, a: 1 } };
    const response = await routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: { ...djangoConfig, mode: "shadow" },
      legacy: async () => jsonResponse(legacyPayload),
      fetchImpl: async () => jsonResponse(fixture.django, {
        headers: { "x-sales-data-revision": revision, "x-sales-source-revision": revision },
      }),
    });
    assert.deepEqual(await response.json(), legacyPayload);
    assert.equal(response.headers.get("x-teruisi-sales-backend"), "legacy");
    assert.equal(response.headers.get("x-teruisi-sales-shadow-result"), fixture.result);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("shadow keeps legacy on missing or stale revisions and distinguishes stale data", async () => {
  const fixtures: Array<{ headers: HeadersInit; result: string }> = [
    { headers: {}, result: "upstream_error" },
    { headers: { "x-sales-data-revision": "stale", "x-sales-source-revision": "stale" }, result: "mismatch" },
  ];
  for (const fixture of fixtures) {
    const response = await routeSalesReadRequest({
      request: request(),
      principal,
      expectedRevision: revision,
      config: { ...djangoConfig, mode: "shadow" },
      legacy: async () => jsonResponse({ source: "legacy" }),
      fetchImpl: async () => jsonResponse({ source: "django" }, { headers: fixture.headers }),
    });
    assert.deepEqual(await response.json(), { source: "legacy" });
    assert.equal(response.headers.get("x-teruisi-sales-shadow-result"), fixture.result);
  }
});
