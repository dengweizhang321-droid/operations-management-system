import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateSameOriginWriteGate } from "../worker/same-origin-write-gate";

const API_URL = "http://127.0.0.1:3000/api/finance/targets";
const WEBHOOK_URL = "http://127.0.0.1:3000/api/ai/webhooks/wechat-work-group-1";

function writeRequest(url: string, init: RequestInit = {}) {
  return new Request(url, { method: "POST", ...init });
}

test("same-origin write requests (Sec-Fetch-Site: same-origin) are allowed through", () => {
  const request = writeRequest(API_URL, {
    headers: { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000" },
  });
  assert.equal(evaluateSameOriginWriteGate(request), null);
});

test("cross-site write requests are rejected with 403", async () => {
  const request = writeRequest(API_URL, {
    headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  });
  const response = evaluateSameOriginWriteGate(request);
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, "cross_site_request_rejected");
  assert.equal(typeof body.error, "string");
});

test("non-browser clients without Origin or Sec-Fetch-Site (e.g. n8n/curl) are rejected", () => {
  const request = writeRequest(API_URL);
  const response = evaluateSameOriginWriteGate(request);
  assert.ok(response);
  assert.equal(response.status, 403);
});

test("missing Origin but Sec-Fetch-Site: same-origin is allowed through", () => {
  const request = writeRequest(API_URL, {
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(evaluateSameOriginWriteGate(request), null);
});

test("Origin mismatched with the request origin is rejected with 403", () => {
  const request = writeRequest(API_URL, {
    headers: { origin: "https://attacker.example" },
  });
  const response = evaluateSameOriginWriteGate(request);
  assert.ok(response);
  assert.equal(response.status, 403);
});

test('Origin: "null" is rejected with 403', () => {
  const request = writeRequest(API_URL, {
    headers: { origin: "null" },
  });
  const response = evaluateSameOriginWriteGate(request);
  assert.ok(response);
  assert.equal(response.status, 403);
});

test("the AI webhook callback path stays reachable cross-site (regression guard)", () => {
  const request = writeRequest(WEBHOOK_URL, {
    headers: { "sec-fetch-site": "cross-site", origin: "https://open.weixin.qq.com" },
  });
  assert.equal(evaluateSameOriginWriteGate(request), null);

  const noOriginAtAll = writeRequest(WEBHOOK_URL);
  assert.equal(evaluateSameOriginWriteGate(noOriginAtAll), null);
});

test("the Django AI edge path is allowed through with no Origin and no Sec-Fetch-Site (server-to-server HMAC call)", () => {
  // Mirrors backend/ai_assistant/transport.py's edge() and
  // backend/workflow/pi_business_n8n.py's _coverage(): both are Django
  // server processes that never send browser fetch metadata and instead
  // authenticate via verifyAiEdgeEnvelope's HMAC envelope.
  const request = writeRequest("http://127.0.0.1:3000/api/ai/internal/edge", {
    headers: {
      "x-teruisi-timestamp": "1700000000",
      "x-teruisi-request-id": "backend-request-1",
      "x-teruisi-signature": "v1=deadbeef",
    },
  });
  assert.equal(request.headers.get("origin"), null);
  assert.equal(request.headers.get("sec-fetch-site"), null);
  assert.equal(evaluateSameOriginWriteGate(request), null);
});

test("a neighboring /api/ai/internal/* path is NOT exempted by the edge allowlist (no over-broad wildcard)", () => {
  const other = writeRequest("http://127.0.0.1:3000/api/ai/internal/other");
  const otherResponse = evaluateSameOriginWriteGate(other);
  assert.ok(otherResponse);
  assert.equal(otherResponse.status, 403);

  const subPath = writeRequest("http://127.0.0.1:3000/api/ai/internal/edge/sub");
  const subPathResponse = evaluateSameOriginWriteGate(subPath);
  assert.ok(subPathResponse);
  assert.equal(subPathResponse.status, 403);
});

test("GET requests are never affected by the gate, even cross-site", () => {
  const request = new Request(API_URL, {
    method: "GET",
    headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  });
  assert.equal(evaluateSameOriginWriteGate(request), null);
});

test("multipart same-origin write requests are allowed through without forcing JSON", () => {
  const formData = new FormData();
  formData.set("file", new Blob(["a,b,c"], { type: "text/csv" }), "import.csv");
  const request = new Request(API_URL, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000" },
    body: formData,
  });
  assert.equal(request.headers.get("content-type")?.startsWith("multipart/form-data"), true);
  assert.equal(evaluateSameOriginWriteGate(request), null);
});

test("the gate is wired into worker/index.ts before the app router handler runs", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ evaluateSameOriginWriteGate \} from "\.\/same-origin-write-gate";/);
  const gateAt = source.indexOf("evaluateSameOriginWriteGate(request)");
  const handlerAt = source.indexOf("await handler.fetch(request, env, ctx);");
  assert.ok(gateAt >= 0 && handlerAt > gateAt, "the gate must run before the app router handler");
  assert.match(source, /if \(crossSiteWriteRejection\) return crossSiteWriteRejection;/);
});
