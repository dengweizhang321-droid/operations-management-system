import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { classifySources, inspectValidatedPayload, makeSpecs, runBusinessChecks, validateBaseUrl, type ProbeScope } from "../tools/netshop-readiness/business-check";
import { decodeStorePanorama } from "../app/netshop/panorama/contract";
import { panoramaFixture } from "./netshop-panorama-fixture";

const scope: ProbeScope = { platform: "京东", shopName: "合成店A", startDate: "2026-09-01", endDate: "2026-09-01" };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/netshop-m5-home/same-run6-00dad2/${name}`, import.meta.url), "utf8"));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("probe origins cannot target remote hosts, credentials, relative paths or alternate origins", () => {
  assert.equal(validateBaseUrl("http://127.0.0.1:3120/"), "http://127.0.0.1:3120");
  for (const value of ["https://example.com", "http://localhost:3000", "http://127.0.0.1", "http://127.0.0.1:3000/api", "http://u:p@127.0.0.1:3000", "http://127.0.0.1:3000/?q=1", "http://127.0.0.1:3000/#x"]) assert.throws(() => validateBaseUrl(value));
});
test("fixed five-column GET plans require one exact store and a bounded real date interval", () => {
  const specs = makeSpecs(scope);
  assert.deepEqual(specs.map(s => s.id), ["liveness", "structural_readiness", "overview", "products", "promotion", "panorama", "comparison"]);
  assert.equal(specs.find(s => s.id === "promotion")!.query.get("dimension"), "sku");
  assert.equal(makeSpecs({ ...scope, platform: "天猫" }).find(s => s.id === "promotion")!.query.get("dimension"), "spu");
  for (const changed of [{ shopName: "" }, { shopName: "a\u001fb" }, { endDate: "2026-09-09" }, { startDate: "2026-02-30" }]) assert.throws(() => makeSpecs({ ...scope, ...changed }));
});

test("original Worker local health predicate accepts only the two fixed marked health GETs", async () => {
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const predicates = ["allowsLoopbackDevelopmentRequest", "allowsLocalHealthRequest"].map(name => {
    const source = worker.match(new RegExp(`function ${name}\\(request: Request, env: Env\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(source, "Actual original Worker predicate must be present");
    return source.replace("request: Request, env: Env", "request, env");
  });
  const allowsHealth = new Function("request", "env", predicates.join("\n") + "\nreturn allowsLocalHealthRequest(request, env);") as (r: Request, e: { TERUISI_RUNTIME_ENV: string }) => boolean;
  const paths = ["/_teruisi/local/health/live", "/_teruisi/local/health/ready"];
  assert.equal(allowsHealth(new Request("http://127.0.0.1:3120" + paths[0]), { TERUISI_RUNTIME_ENV: "development" }), false);
  const planned: Record<string, string>[] = [];
  await runBusinessChecks("http://127.0.0.1:3120", scope, { fetcher: (async (url, init) => {
    const path = new URL(String(url)).pathname, headers = Object.fromEntries(new Headers(init?.headers)); planned.push(headers);
    assert.deepEqual(headers, paths.includes(path) ? { accept: "application/json", "x-teruisi-local-health": "1" } : { accept: "application/json" });
    return paths.includes(path) ? json({ ok: true, status: path.endsWith("live") ? "live" : "ready", backend: "django-postgresql", unavailableServices: [] }) : json({}, 503);
  }) as typeof fetch });
  assert.equal(planned.length, 7);
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://127.0.0.1").pathname; seen.push(path);
    const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => typeof v === "string" ? [[k, v] as [string, string]] : []));
    assert.equal(req.method, "GET");
    for (const h of ["authorization", "cookie", "x-teruisi-principal", "x-teruisi-local-scheduled"]) assert.equal(headers.has(h), false);
    if (paths.includes(path)) {
      const request = new Request(`http://127.0.0.1:${(server.address() as { port: number }).port}${path}`, { headers });
      assert.equal(allowsHealth(request, { TERUISI_RUNTIME_ENV: "development" }), true);
      assert.equal(allowsHealth(request, { TERUISI_RUNTIME_ENV: "production" }), false);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, status: path.endsWith("live") ? "live" : "ready", backend: "django-postgresql", unavailableServices: [] }));
    } else { assert.equal(headers.has("x-teruisi-local-health"), false); res.statusCode = 503; res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const report = await runBusinessChecks(`http://127.0.0.1:${port}`, scope);
    assert.equal(report.checks[0].state, "passed"); assert.equal(report.checks[1].state, "passed");
    assert.equal(report.businessReady, false); assert.equal(seen.length, 7);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("HTTP health success is not business readiness and malformed 200 business DTOs fail", async () => {
  const calls: string[] = [];
  const report = await runBusinessChecks("http://127.0.0.1:3120", scope, { fetcher: (async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "manual");
    if (path.endsWith("/live")) return json({ ok: true, status: "live" });
    if (path.endsWith("/ready")) return json({ ok: true, status: "ready", backend: "django-postgresql", unavailableServices: [] });
    return json({});
  }) as typeof fetch });
  assert.equal(calls.length, 7); assert.equal(report.checks[0].state, "passed"); assert.equal(report.checks[1].state, "passed");
  assert.equal(report.businessReady, false); assert.equal(report.state, "degraded");
  assert.ok(report.checks.slice(2).every(r => r.reason === "contract_invalid"));
});
test("authentication denial is authoritative even with HTML and stops subsequent reads", async () => {
  let calls = 0;
  const report = await runBusinessChecks("http://127.0.0.1:3120", scope, { fetcher: (async () => { calls++; return new Response("private failure text", { status: 403 }); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(report.checks[0].reason, "access_denied");
  assert.ok(report.checks.slice(1).every(r => r.state === "unverified"));
  assert.ok(!JSON.stringify(report).includes("private failure text"));
});
test("redirects, oversized bodies and invalid UTF8 are refused without following or logging contents", async () => {
  for (const response of [() => new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "2097153" } }),
    () => new Response(Uint8Array.from([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) {
    const result = await runBusinessChecks("http://127.0.0.1:3120", scope, { fetcher: (async () => response()) as typeof fetch });
    assert.equal(result.businessReady, false); assert.ok(result.checks.every(c => c.state === "degraded"));
  }
});
test("six owning source captures pass strict decoder before dependency classification", () => {
  const value = read("response-owning-all-six.json"), metadata = read("response-owning-all-six.meta.json");
  const q = new URLSearchParams(metadata.request.query), revision = value.context.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision;
  const decoded = decodeStorePanorama(value, q, revision);
  assert.equal(classifySources("panorama", decoded).length, 6);
  assert.ok(classifySources("panorama", decoded).every(c => c.state === "passed"));
  assert.equal(inspectValidatedPayload(decoded).sourceErrors, 0);
  assert.ok(Object.keys(inspectValidatedPayload(decoded).dataGaps).length > 0, "Known data gaps must remain separate from source availability");
});
test("internal HTTP200-style source failures and unexercised peers cannot be declared ready", () => {
  const value = read("response-owning-all-six.json");
  value.sources.finance = { state: "error", code: "service_unavailable", data: null, message: "not logged" };
  value.sources.workflow = { state: "unavailable", reasonCode: "unmapped", data: null, message: "not logged" };
  const result = classifySources("panorama", value);
  assert.equal(result.find(c => c.source === "finance")!.state, "degraded");
  assert.equal(result.find(c => c.source === "workflow")!.state, "unverified");
  assert.equal(inspectValidatedPayload(value).sourceErrors, 1);
});
test("a schema-valid panorama HTTP200 with a failed workflow source is business degraded", async () => {
  const value = panoramaFixture();
  value.sources.workflow = { state: "error", data: null, code: "service_unavailable", message: "fixture private exception must not be logged" };
  value.sections.targets.state = "error"; value.sections.dataQuality.state = "error";
  const report = await runBusinessChecks("http://127.0.0.1:3120", scope, { fetcher: (async url => {
    if (new URL(String(url)).pathname === "/api/netshop/store-panorama") return new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "X-Netshop-Data-Revision": value.context.sourceRevisions.find(r => r.kind === "owning_revision")!.revision } });
    return json({}, 503);
  }) as typeof fetch });
  const result = report.checks.find(r => r.id === "panorama")!;
  assert.equal(result.state, "degraded"); assert.equal(result.reason, "source_read_failed");
  assert.equal(result.httpStatus, 200); assert.equal(report.businessReady, false);
  assert.ok(!JSON.stringify(report).includes("fixture private exception"));
});
test("valid real owning capture reaches the HTTP smoke report without exposing business values", async () => {
  const value = read("response-owning-all-six.json");
  const capturedScope: ProbeScope = { ...scope, shopName: value.context.requestedScope.shopKeys[0].split("\u001f")[1] };
  const revision = value.context.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision;
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    res.setHeader("content-type", "application/json");
    if (req.url!.startsWith("/api/netshop/store-panorama?")) { res.setHeader("X-Netshop-Data-Revision", revision); res.end(JSON.stringify(value)); }
    else { res.statusCode = 503; res.end('{"error":"fixture unavailable"}'); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const report = await runBusinessChecks(`http://127.0.0.1:${address.port}`, capturedScope);
    const panorama = report.checks.find(r => r.id === "panorama")!;
    assert.equal(panorama.state, "passed"); assert.equal(panorama.sourceChecks.length, 6);
    assert.equal(report.businessReady, false, "Other failed columns cannot be hidden by one good source");
    assert.ok(!JSON.stringify(report).includes(capturedScope.shopName));
    assert.ok(!JSON.stringify(report).includes("fixture unavailable"));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("transport deadline is real, bounded, and does not retry a slow peer", async () => {
  let calls = 0;
  const server = createServer(() => { calls++; });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const start = performance.now();
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const report = await runBusinessChecks(`http://127.0.0.1:${address.port}`, scope, { totalMs: 150, perCheckMs: 150 });
    assert.equal(report.businessReady, false); assert.equal(report.checks[0].reason, "probe_deadline");
    assert.ok(calls <= 2); assert.ok(performance.now() - start < 2000);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("an already cancelled run makes no requests and stays unverified", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runBusinessChecks("http://127.0.0.1:3120", scope, { signal: controller.signal, fetcher: (async () => { throw new Error("must not call"); }) as typeof fetch });
  assert.equal(result.state, "unverified"); assert.equal(result.businessReady, false);
  assert.ok(result.checks.every(c => c.reason === "cancelled"));
});
