import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  LoadCheckError,
  parseLoadCheckArgs,
  runLoadCheck,
  validateLoadCheckBaseUrl,
  type LoadCheckConfig,
} from "../tools/django-sales-load-check";

const secret = "test-only-django-load-secret-32-bytes-minimum";

function config(overrides: Partial<LoadCheckConfig> = {}): LoadCheckConfig {
  return {
    baseUrl: new URL("http://127.0.0.1:8001"),
    startDate: "2026-08-01",
    endDate: "2026-08-27",
    concurrency: 2,
    rounds: 2,
    views: ["full"],
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, revision = "8:5", headers: HeadersInit = {}): Response {
  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
      "x-sales-data-revision": revision,
      "x-sales-source-revision": revision,
      "x-sales-overview-cache": "bypass",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

test("load check arguments require explicit bounded inputs and safe base URLs", () => {
  const parsed = parseLoadCheckArgs([
    "--base-url", "https://sales.example.com",
    "--start-date", "2026-08-01",
    "--end-date", "2026-08-27",
    "--concurrency", "4",
    "--rounds", "3",
    "--view", "full,dashboard,category",
  ]);
  assert.equal(parsed.baseUrl.origin, "https://sales.example.com");
  assert.deepEqual(parsed.views, ["full", "dashboard", "category"]);
  assert.equal(parsed.timeoutMs, 10_000);
  assert.equal(parsed.maxResponseBytes, 4 * 1024 * 1024);

  for (const unsafe of [
    "http://sales.example.com",
    "http://127.0.0.1.evil.example.com",
    "http://localhost.evil.example.com",
    "https://user:password@sales.example.com",
    "https://sales.example.com/api",
  ]) {
    assert.throws(() => validateLoadCheckBaseUrl(unsafe), LoadCheckError, unsafe);
  }
  assert.throws(() => parseLoadCheckArgs([
    "--base-url", "http://127.0.0.1:8001",
    "--start-date", "2026-08-01",
    "--end-date", "2026-08-27",
    "--concurrency", "1",
    "--rounds", "1",
    "--secret", secret,
  ]), /unknown option: --secret/);
});

test("load check sends the exact signed principal envelope and reports stable concurrent metrics", async () => {
  const observed: Array<{ target: URL; headers: Headers }> = [];
  const samples: unknown[] = [];
  let requestSequence = 0;
  const report = await runLoadCheck(config(), {
    environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
    now: () => 1_788_000_000_000,
    requestId: () => `load-check-test-${++requestSequence}`,
    onSample: (sample) => samples.push(sample),
    fetchImpl: async (input, init) => {
      const target = new URL(String(input));
      const headers = new Headers(init?.headers);
      observed.push({ target, headers });
      return jsonResponse({ current: { netSalesCents: 100 }, nested: { b: 2, a: 1 } });
    },
  });

  assert.equal(observed.length, 4);
  assert.equal(samples.length, 4);
  assert.equal(report.revision, "8:5");
  assert.equal(report.overall.requests, 4);
  assert.equal(report.byView.full?.requests, 4);
  assert.equal(report.samples.every((sample) => sample.overviewCache === "bypass"), true);
  assert.equal(new Set(report.samples.map((sample) => sample.jsonSha256)).size, 1);

  const first = observed[0]!;
  const principalBase64 = first.headers.get("x-teruisi-principal");
  assert.ok(principalBase64);
  assert.deepEqual(JSON.parse(Buffer.from(principalBase64, "base64url").toString("utf8")), {
    email: "django-sales-load-check@internal.invalid",
    displayName: "Django Sales Load Check",
    role: "admin",
    scope: null,
  });
  const canonical = [
    "v1",
    "1788000000",
    "load-check-test-1",
    "GET",
    first.target.pathname,
    first.target.search.slice(1),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    principalBase64,
  ].join("\n");
  assert.equal(
    first.headers.get("x-teruisi-signature"),
    `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
  );
  assert.equal(first.headers.has("authorization"), false);
  assert.equal([...first.headers.values()].some((value) => value.includes(secret)), false);
});

test("load check fails closed on inconsistent JSON, revisions, status, and response limits", async () => {
  let sequence = 0;
  await assert.rejects(
    runLoadCheck(config({ concurrency: 2, rounds: 1 }), {
      environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
      fetchImpl: async () => jsonResponse({ sequence: ++sequence }),
    }),
    /JSON digest changed/,
  );

  sequence = 0;
  await assert.rejects(
    runLoadCheck(config({ concurrency: 2, rounds: 1 }), {
      environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
      fetchImpl: async () => jsonResponse({ stable: true }, ++sequence === 1 ? "8:5" : "9:5"),
    }),
    /revision changed/,
  );

  await assert.rejects(
    runLoadCheck(config({ concurrency: 1, rounds: 1 }), {
      environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
      fetchImpl: async () => jsonResponse({ error: true }, "8:5", { "content-length": "999999" }),
    }),
    /response exceeds/,
  );

  await assert.rejects(
    runLoadCheck(config({ concurrency: 1, rounds: 1 }), {
      environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
      fetchImpl: async () => Response.json({ error: true }, { status: 503 }),
    }),
    /HTTP 503/,
  );

  await assert.rejects(
    runLoadCheck(config({ concurrency: 1, rounds: 1 }), {
      environment: { TERUISI_DJANGO_INTERNAL_SECRET: secret },
      fetchImpl: async () => jsonResponse({ stable: true }, "8:5", { "x-sales-source-revision": "8:4" }),
    }),
    /revision headers are missing or inconsistent/,
  );

  await assert.rejects(
    runLoadCheck(config({ concurrency: 1, rounds: 1 }), { environment: {} }),
    /TERUISI_DJANGO_INTERNAL_SECRET/,
  );
});
