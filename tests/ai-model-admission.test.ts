import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { probeAttempt } from "../lib/ai/model-probe-request";
import type { AppPrincipal } from "../lib/auth/authorization";
import { requestDjangoAi } from "../lib/django/ai-service";

const principal: AppPrincipal = { email: "admin@example.invalid", displayName: "Fixture", role: "admin", scope: null };
const environment = {
  TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111",
  TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112",
  TERUISI_DJANGO_INTERNAL_SECRET: "fixture-signing-material-isolated-0123456789",
};
const clientRequestId = "74e1ed02-e8b7-4fc3-96b3-93112b699ac4";
const probes = [
  { path: "/api/ai/models", fields: { testMode: "structured_output" } },
  { path: "/api/ai/space/profiles", fields: { scene: "promotion", size: "1536x1024" } },
];

test("paid capability probes sign the same bounded writer request for the same intent", async () => {
  const receipts: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).port, "18112");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("x-teruisi-signature") ?? "", /^v1=[0-9a-f]{64}$/);
    receipts.push(headers.get("x-teruisi-request-id") ?? "");
    return Response.json({ ok: true }, { headers: { "x-ai-revision": "3" } });
  };
  for (const { path, fields } of probes) {
    const payload = { action: "test", id: "fixture", expectedVersion: 1, clientRequestId, ...fields };
    const input = { path, method: "POST" as const, payload };
    const opts = { environment, fetchImpl };
    await requestDjangoAi(principal, input, opts);
    await requestDjangoAi(principal, input, opts);
    const expected = "w10-probe-" + createHash("sha256").update([path, principal.email, clientRequestId].join("\n")).digest("hex");
    assert.deepEqual(receipts.slice(-2), [expected, expected]);
    await assert.rejects(requestDjangoAi(principal, { ...input, service: "reader" }, opts), /标识无效/);
    await assert.rejects(requestDjangoAi(principal, { ...input, query: new URLSearchParams("unsafe=1") }, opts), /标识无效/);
    await assert.rejects(requestDjangoAi(principal, { ...input, payload: { ...payload, clientRequestId: "not-uuid" } }, opts), /标识无效/);
  }
  assert.equal(receipts.length, 4);
  assert.notEqual(receipts[0], receipts[2]);
});

test("a missing probe response keeps the original request for this browser session", async () => {
  const values = new Map<string, string>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } } });
  try {
    const intent = "image:profile:3:promotion:1536x1024";
    const attempt = await probeAttempt(principal.email, intent);
    assert.equal((await probeAttempt(principal.email, intent)).clientRequestId, attempt.clientRequestId);
    assert.notEqual((await probeAttempt("second@example.invalid", intent)).clientRequestId, attempt.clientRequestId);
    assert.notEqual((await probeAttempt(principal.email, intent.replace(":3:", ":4:"))).clientRequestId, attempt.clientRequestId);
    attempt.finish();
    assert.notEqual((await probeAttempt(principal.email, intent)).clientRequestId, attempt.clientRequestId);
    assert.ok([...values.keys()].every((key) => !key.includes(principal.email)));
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
