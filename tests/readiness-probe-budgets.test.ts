import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import { DJANGO_READINESS_SERVICES, probeDjangoBackendReadiness } from "../lib/django/backend-readiness";

function fixture() {
  const environment: Record<string, string> = {};
  const payloads = new Map<string, object>();
  for (const [index, service] of DJANGO_READINESS_SERVICES.entries()) {
    const url = `http://127.0.0.1:${23000 + index}`;
    environment[service.variable] = url;
    payloads.set(`${url}/health/ready`, { status: "ready", service: "teruisi-django", database: "ready",
      ...(service.aiRole ? { processRole: service.aiRole, authority: "postgres" } : { [service.field]: "ready" }) });
  }
  return { environment, payloads };
}

function clock(t: TestContext) {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return async (ms: number) => {
    now += ms;
    t.mock.timers.tick(ms);
    // Allow Response streams and each of the six workers to complete before advancing.
    await nextTurn(); await nextTurn();
  };
}

function delayedFetch(payloads: Map<string, object>, delay: number, starts: number[]): typeof fetch {
  return async (url, init) => {
    starts.push(performance.now());
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new Error("PRIVATE_URL_SQL_EXCEPTION")); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", onAbort); resolve(); }, delay);
      init?.signal?.addEventListener("abort", onAbort, { once: true });
    });
    return Response.json(payloads.get(String(url)));
  };
}

test("readiness allows 23 slow valid responses in four waves without stealing queued request budgets", async (t) => {
  const advance = clock(t);
  const { environment, payloads } = fixture();
  const starts: number[] = [];
  const result = probeDjangoBackendReadiness(environment, { fetchImpl: delayedFetch(payloads, 3900, starts) });
  for (let wave = 0; wave < 4; wave++) await advance(3900);
  const value = await result;
  assert.equal(value.ok, true);
  assert.deepEqual(starts, [...Array(6).fill(0), ...Array(6).fill(3900), ...Array(6).fill(7800), ...Array(5).fill(11700)]);
  assert.ok(value.serviceChecks.every((check) => check.requestMs === 3900 && check.reason === "none"));
  assert.equal(value.serviceChecks.at(-1)?.queueMs, 11700);
});

test("readiness gives each dispatched service four seconds and never waits for a fifth second", async (t) => {
  const advance = clock(t);
  const { environment, payloads } = fixture();
  const starts: number[] = [];
  const result = probeDjangoBackendReadiness(environment, { fetchImpl: delayedFetch(payloads, 5000, starts) });
  for (let wave = 0; wave < 4; wave++) await advance(4000);
  const value = await result;
  assert.equal(starts.length, 23);
  assert.equal(value.ok, false);
  assert.ok(value.serviceChecks.every((check) => check.reason === "request_timeout" && check.requestMs === 4000));
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|http:|SQL/);
});

test("readiness distinguishes a spent round from service failure and queued not_checked", async (t) => {
  const advance = clock(t);
  const { environment, payloads } = fixture();
  const starts: number[] = [];
  const result = probeDjangoBackendReadiness(environment, { timeoutMs: 6000, fetchImpl: delayedFetch(payloads, 3900, starts) });
  await advance(3900); await advance(2100);
  const value = await result;
  assert.equal(starts.length, 12);
  assert.equal(value.serviceChecks.filter((check) => check.state === "ready").length, 6);
  assert.equal(value.serviceChecks.filter((check) => check.reason === "round_budget").length, 6);
  assert.equal(value.serviceChecks.filter((check) => check.reason === "not_checked" && check.requestMs === 0).length, 11);
  assert.equal(value.ok, false);
});

test("readiness parent cancellation cancels only dispatched probes and does not disclose errors", async (t) => {
  const advance = clock(t);
  const { environment, payloads } = fixture();
  const parent = new AbortController();
  const starts: number[] = [];
  const result = probeDjangoBackendReadiness(environment, { signal: parent.signal, fetchImpl: delayedFetch(payloads, 3900, starts) });
  await advance(50); parent.abort(); await advance(0);
  const value = await result;
  assert.equal(starts.length, 6);
  assert.equal(value.serviceChecks.filter((check) => check.reason === "cancelled").length, 6);
  assert.equal(value.serviceChecks.filter((check) => check.reason === "not_checked").length, 17);
  assert.ok(value.serviceChecks.every((check) => check.state === "incomplete"));
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|http:|SQL/);
});

test("readiness request deadline includes the full body after response headers", async (t) => {
  const advance = clock(t);
  const { environment } = fixture();
  let calls = 0;
  const result = probeDjangoBackendReadiness(environment, { fetchImpl: async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new Error("PRIVATE_BODY")), { once: true });
    } }), { headers: { "content-type": "application/json" } });
  } });
  await advance(0);
  for (let wave = 0; wave < 4; wave++) await advance(4000);
  const value = await result;
  assert.equal(calls, 23);
  assert.ok(value.serviceChecks.every((check) => check.reason === "request_timeout" && check.requestMs === 4000));
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_BODY/);
});

test("readiness pre-aborted parent leaves every service unqueried", async () => {
  const { environment } = fixture();
  const parent = new AbortController(); parent.abort();
  const value = await probeDjangoBackendReadiness(environment, { signal: parent.signal, fetchImpl: async () => {
    throw new Error("unexpected dispatch");
  } });
  assert.ok(value.serviceChecks.every((check) => check.state === "incomplete" && check.reason === "not_checked"));
  assert.equal(value.ok, false);
});

test("readiness keeps generic Django 503 unknown and emits only finite public diagnostics", async () => {
  const { environment } = fixture();
  const value = await probeDjangoBackendReadiness(environment, { fetchImpl: async () => Response.json({
    error: "PRIVATE_SQL_URL_EXCEPTION", code: "permission_denied",
  }, { status: 503 }) });
  assert.ok(value.serviceChecks.every((check) => check.reason === "not_ready_unknown" && check.httpStatus === 503));
  for (const check of value.serviceChecks) {
    assert.deepEqual(Object.keys(check).sort(), ["httpStatus", "queueMs", "reason", "requestMs", "service", "state"]);
    assert.ok(DJANGO_READINESS_SERVICES.some((service) => service.name === check.service));
    assert.ok(Number.isFinite(check.queueMs) && Number.isFinite(check.requestMs));
  }
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|permission_denied|http:|SQL/);
});

test("direct callers reserve twenty seconds only for readiness and keep snapshot parent bounds", () => {
  const worker = readFileSync("tools/start-local-worker.mjs", "utf8");
  const control = readFileSync("tools/operations-system-control.ps1", "utf8");
  const watch = readFileSync("tools/operations-system-watchdog.ps1", "utf8");
  const launcher = readFileSync("tools/desktop-launcher/Launcher.cs", "utf8");
  assert.match(worker, /localReadinessTimeoutMs = 20_000/);
  assert.match(worker, /localLivenessTimeoutMs = 5_000/);
  assert.match(control, /-Uri \$ReadinessUrl -TimeoutSeconds 20 -Deadline \$healthDeadline/);
  assert.match(control, /Min\(\$TimeoutSeconds \* 1000, \(Get-ProcessRemaining \$Deadline\)\)/);
  assert.match(control, /\$LivenessUrl -Deadline \$healthDeadline/);
  assert.match(control, /\$HelperHealthUrl -Deadline \$healthDeadline/);
  assert.ok(watch.includes("Get-ProcessDeadline $(if($name -eq 'ready'){20000}else{5000})"));
  assert.match(watch, /Get-ProcessDeadline 120000/);
  assert.match(launcher, /ReadinessTimeout = TimeSpan.FromSeconds\(20\)/);
  assert.match(launcher, /HomepageTimeout = TimeSpan.FromSeconds\(8\)/);
  assert.match(launcher, /Timeout = ReadinessTimeout/);
  assert.match(launcher, /Timeout = HomepageTimeout/);
});
