import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { aiHeaders, aiConsumer, isPublicAiPath, requestDjangoAi } from "../lib/django/ai-service";
import { PublicApiError } from "../lib/http/api-error";

const principal = { email: "owner@example.invalid", displayName: "镜像操作员", role: "analyst" as const, scope: { warehouses: ["A"], channels: [], platforms: ["京东"] } };
const environment = { TERUISI_DJANGO_INTERNAL_SECRET: "Isolated-hmac-transport-secret-0123456789", TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112" };
const json = (payload: unknown, status = 200, headers = {}) => Response.json(payload, { status, headers: { "x-ai-revision": "42", ...headers } });

test("AI principal envelope binds exact Unicode identity, method, path, query, body and request ID", async () => {
  const input = { secret: environment.TERUISI_DJANGO_INTERNAL_SECRET, principal, method: "POST", path: "/api/ai/consumer", query: "page=1", body: '{"query":"大毛利"}', requestId: "idempotent-1", timestamp: 1800000000 };
  const headers = await aiHeaders(input);
  const encoded = headers.get("x-teruisi-principal")!;
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString()), principal);
  const digest = createHash("sha256").update(input.body).digest("hex");
  assert.equal(headers.get("x-teruisi-content-sha256"), digest);
  const canonical = ["v1", String(input.timestamp), input.requestId, input.method, input.path, input.query, digest, encoded].join("\n");
  assert.equal(headers.get("x-teruisi-signature"), "v1=" + createHmac("sha256", input.secret).update(canonical).digest("hex"));
  for (const change of [{ query: "page=2" }, { body: "{}" }, { path: "/api/ai/models" }, { requestId: "idempotent-2" }]) {
    assert.notEqual((await aiHeaders({ ...input, ...change })).get("x-teruisi-signature"), headers.get("x-teruisi-signature"));
  }
});

test("AI thin transport selects independent reader/writer and preserves revision and replay", async () => {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => { calls.push(new Request(input, init)); return json({ ok: true }, 201, { "x-teruisi-write-replay": "1" }); };
  const result = await requestDjangoAi(principal, { path: "/api/ai/conversations" }, { environment, fetchImpl });
  assert.equal(new URL(calls[0].url).port, "18111");
  assert.equal(result.revision, "42"); assert.equal(result.replayed, true);
  await requestDjangoAi(principal, { path: "/api/ai/artifacts/ai-artifact-fixture" }, { environment, fetchImpl });
  assert.equal(new URL(calls[1].url).port, "18112");
  await aiConsumer(principal, { operation: "model-runtime", id: "model" }, { environment, fetchImpl });
  assert.equal(new URL(calls[2].url).port, "18111");
  await aiConsumer(principal, { operation: "tool-audit", entry: {} }, { environment, fetchImpl });
  assert.equal(new URL(calls[3].url).port, "18112");
  assert.equal(calls[3].headers.has("x-teruisi-signature"), true);
});

test("AI transport rejects invalid configuration, oversized payloads, redirects, malformed JSON and missing revisions", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return json({ ok: true }); };
  for (const config of [{ ...environment, TERUISI_DJANGO_AI_READER_BASE_URL: "http://169.254.169.254" }, { ...environment, TERUISI_DJANGO_AI_WRITER_BASE_URL: environment.TERUISI_DJANGO_AI_READER_BASE_URL }, { ...environment, TERUISI_DJANGO_INTERNAL_SECRET: "short" }]) {
    await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/models" }, { environment: config, fetchImpl }), PublicApiError);
  }
  await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/consumer", method: "POST", payload: { value: "a".repeat(1024 * 1024) } }, { environment, fetchImpl }), PublicApiError);
  assert.equal(calls, 0);
  for (const response of [new Response("{}", { status: 302, headers: { location: "https://example.invalid" } }), new Response("not-json"), Response.json({}), json([], 200), json({ error: "unsafe", code: "arbitrary" }, 500)]) {
    await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/models" }, { environment, fetchImpl: async () => response }), (error: unknown) => error instanceof PublicApiError && error.status === 503 && !error.message.includes("unsafe"));
  }
});

test("AI production entry points contain no retired D1 domain implementation or schema bootstrap", async () => {
  const walk = async (url: URL): Promise<URL[]> => (await Promise.all((await readdir(url, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(new URL(entry.name + "/", url)) : [new URL(entry.name, url)]))).flat();
  for (const file of [...await walk(new URL("../lib/ai/", import.meta.url)), ...await walk(new URL("../app/api/ai/", import.meta.url))]) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /(?:FROM|INTO|UPDATE|TABLE)\s+[`"]?ai_(?:models|conversations|memory|agent|workflow|space|tool_audit)|ensureAi(?:Assistant|Space|Agent|Workflow|Memory|Artifact)Schema|tests\/legacy/i, file.pathname);
  }
  assert.equal(isPublicAiPath("/api/ai/internal/edge"), false);
  assert.equal(isPublicAiPath("/api/ai/consumer"), false);
  assert.equal(isPublicAiPath("/api/ai/space/assets/one/content"), true);
});
