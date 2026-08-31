import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import type { AppPrincipal } from "../lib/auth/authorization";
import {
  DjangoFinanceServiceResponseError,
  financeBackendModeFromEnvironment,
  requestDjangoFinanceService,
} from "../lib/django/finance-service";
import { createSalesGatewayAuthHeaders } from "../lib/django/sales-gateway";
import { PublicApiError } from "../lib/http/api-error";

const principal: AppPrincipal = {
  email: "admin@example.test",
  displayName: "管理员",
  role: "admin",
  scope: null,
};
const secret = "finance-service-contract-secret-at-least-32-bytes";
const config = {
  readerBaseUrl: "http://127.0.0.1:8011",
  writerBaseUrl: "http://127.0.0.1:8012",
  internalSecret: secret,
  timeoutMs: 2_000,
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 1024 * 1024,
};

function verifySignature(request: Request, expectedPath: string, expectedQuery: string) {
  const principalEnvelope = request.headers.get("x-teruisi-principal")!;
  const timestamp = request.headers.get("x-teruisi-timestamp")!;
  const requestId = request.headers.get("x-teruisi-request-id")!;
  const bodyHash = request.headers.get("x-teruisi-content-sha256")!;
  const canonical = [
    "v1",
    timestamp,
    requestId,
    request.method,
    expectedPath,
    expectedQuery,
    bodyHash,
    principalEnvelope,
  ].join("\n");
  assert.equal(
    request.headers.get("x-teruisi-signature"),
    `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
  );
}

test("finance mode defaults to legacy and accepts only the staged cutover states", () => {
  assert.equal(financeBackendModeFromEnvironment({}), "legacy");
  assert.equal(financeBackendModeFromEnvironment({ TERUISI_DJANGO_FINANCE_MODE: "shadow" }), "shadow");
  assert.equal(financeBackendModeFromEnvironment({ TERUISI_DJANGO_FINANCE_MODE: "django" }), "django");
  assert.throws(
    () => financeBackendModeFromEnvironment({ TERUISI_DJANGO_FINANCE_MODE: "fallback" }),
    (error: unknown) => error instanceof PublicApiError && error.status === 503,
  );
});

test("finance reader signs the exact path/query and cannot use the writer URL", async () => {
  const observed: Request[] = [];
  const result = await requestDjangoFinanceService<Record<string, unknown>>(
    principal,
    {
      method: "GET",
      path: "/api/finance/analysis",
      query: new URLSearchParams("month=2026-08&platform=%E4%BA%AC%E4%B8%9C"),
      service: "reader",
    },
    {
      config,
      now: () => 1_800_000_000_000,
      requestId: () => "finance-read-1",
      fetchImpl: async (input, init) => {
        observed.push(new Request(input, init));
        return Response.json({ hasData: false }, {
          headers: { "x-finance-data-revision": "1:abcdef123456" },
        });
      },
    },
  );
  const request = observed[0];
  assert.ok(request);
  assert.equal(new URL(request.url).origin, "http://127.0.0.1:8011");
  assert.equal(request.method, "GET");
  verifySignature(request, "/api/finance/analysis", "month=2026-08&platform=%E4%BA%AC%E4%B8%9C");
  assert.equal(result.revision, "1:abcdef123456");
  assert.deepEqual(result.data, { hasData: false });
});

test("finance writer sends normalized JSON only to the writer and preserves replay status", async () => {
  const observed: Request[] = [];
  const payload = {
    schemaVersion: "finance-normalized-v1",
    disposition: "rejected",
    fileName: "bad.xlsx",
  };
  const result = await requestDjangoFinanceService<Record<string, unknown>>(
    principal,
    {
      method: "POST",
      path: "/api/finance/imports",
      payload,
      service: "writer",
      acceptedErrorStatuses: [422],
    },
    {
      config,
      now: () => 1_800_000_000_000,
      requestId: () => "finance-write-1",
      fetchImpl: async (input, init) => {
        observed.push(new Request(input, init));
        return Response.json(
          { ok: false, status: "rejected", message: "解析失败" },
          { status: 422, headers: { "x-teruisi-write-replay": "1" } },
        );
      },
    },
  );
  const request = observed[0];
  assert.ok(request);
  assert.equal(new URL(request.url).origin, "http://127.0.0.1:8012");
  assert.equal(request.method, "POST");
  assert.deepEqual(await request.json(), payload);
  verifySignature(request, "/api/finance/imports", "");
  assert.equal(result.status, 422);
  assert.equal(result.replayed, true);
});

test("finance service keeps reader/writer surfaces disjoint and sales signer remains sales-only", async () => {
  const neverFetch: typeof fetch = async () => {
    assert.fail("invalid service/path combinations must fail before fetch");
  };
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "POST",
      path: "/api/finance/targets",
      payload: {},
      service: "reader",
    }, { config, fetchImpl: neverFetch }),
    (error: unknown) => error instanceof PublicApiError && error.status === 503,
  );
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "GET",
      path: "/api/finance/analysis",
      service: "reader",
    }, {
      config: { ...config, writerBaseUrl: config.readerBaseUrl },
      fetchImpl: neverFetch,
    }),
    (error: unknown) => error instanceof PublicApiError && error.status === 503,
  );
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "GET",
      path: "/api/sales/summary",
      service: "reader",
    }, { config, fetchImpl: neverFetch }),
    (error: unknown) => error instanceof PublicApiError && error.status === 503,
  );
  await assert.rejects(
    createSalesGatewayAuthHeaders({
      secret,
      principal,
      method: "GET",
      path: "/api/finance/analysis",
      rawQuery: "",
      timestamp: 1_800_000_000,
      requestId: "wrong-domain",
    }),
    (error: unknown) => error instanceof PublicApiError && error.status === 503,
  );
});

test("finance upstream validation details are bounded errors and never silently fall back", async () => {
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "GET",
      path: "/api/finance/analysis",
      service: "reader",
    }, {
      config,
      fetchImpl: async () => Response.json({
        error: "筛选项不存在",
        code: "finance_dimension_filter_out_of_scope",
        invalidPlatforms: ["不存在"],
        invalidShops: [],
        incompatibleShops: [],
      }, { status: 400 }),
    }),
    (error: unknown) => error instanceof DjangoFinanceServiceResponseError
      && error.status === 400
      && error.upstreamCode === "finance_dimension_filter_out_of_scope"
      && Array.isArray(error.payload.invalidPlatforms),
  );
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "GET",
      path: "/api/finance/analysis",
      service: "reader",
    }, {
      config,
      fetchImpl: async () => new Response("not-json", { status: 502 }),
    }),
    (error: unknown) => error instanceof PublicApiError
      && error.status === 503
      && error.code === "service_unavailable",
  );
  await assert.rejects(
    requestDjangoFinanceService(principal, {
      method: "GET",
      path: "/api/finance/analysis",
      service: "reader",
    }, {
      config,
      fetchImpl: async () => Response.json({ hasData: false }),
    }),
    (error: unknown) => error instanceof PublicApiError
      && error.status === 503
      && error.code === "service_unavailable",
  );
});
