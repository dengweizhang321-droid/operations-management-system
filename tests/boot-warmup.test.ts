import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getBootWarmupWindowMs,
  isBootWarmupActive,
  triggerLocalScheduledEvent,
} from "../tools/start-local-worker.mjs";
import { BOOT_WARMUP_HEADER, bootWarmupSkipFor, isBootWarmupRequest } from "../worker/boot-warmup";

const minute = 60_000;

test("boot warmup window defaults to 20 minutes and falls back on invalid values", () => {
  assert.equal(getBootWarmupWindowMs({}), 20 * minute);
  assert.equal(getBootWarmupWindowMs({ TERUISI_BOOT_WARMUP_MINUTES: "5" }), 5 * minute);
  assert.equal(getBootWarmupWindowMs({ TERUISI_BOOT_WARMUP_MINUTES: " 30 " }), 30 * minute);
  assert.equal(getBootWarmupWindowMs({ TERUISI_BOOT_WARMUP_MINUTES: "0" }), 0);
  for (const invalid of ["", "abc", "-5", "1.5", "1e2", "0x10", "99999", "1441", "20min"]) {
    assert.equal(getBootWarmupWindowMs({ TERUISI_BOOT_WARMUP_MINUTES: invalid }), 20 * minute, `invalid: ${invalid}`);
  }
});

test("boot warmup is active only strictly below the window", () => {
  const env = { TERUISI_BOOT_WARMUP_MINUTES: "20" };
  assert.equal(isBootWarmupActive({ uptimeSeconds: 0, env }), true);
  assert.equal(isBootWarmupActive({ uptimeSeconds: 20 * 60 - 1, env }), true);
  assert.equal(isBootWarmupActive({ uptimeSeconds: 20 * 60, env }), false, "exactly the window is no longer warmup");
  assert.equal(isBootWarmupActive({ uptimeSeconds: 20 * 60 + 1, env }), false);
  assert.equal(isBootWarmupActive({ uptimeSeconds: 100, env: { TERUISI_BOOT_WARMUP_MINUTES: "0" } }), false);
  assert.equal(isBootWarmupActive({ uptimeSeconds: 1_199, env: {} }), true, "default window applies");
  assert.equal(isBootWarmupActive({ uptimeSeconds: 1_200, env: {} }), false);
  assert.equal(isBootWarmupActive({ uptimeSeconds: 60, env: { TERUISI_BOOT_WARMUP_MINUTES: "bad" } }), true, "invalid env uses default");
});

test("unreadable or nonsensical uptime never counts as warmup", () => {
  const env = {};
  assert.equal(isBootWarmupActive({ uptimeSeconds: () => { throw new Error("no uptime"); }, env }), false);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "5" as unknown as number, null as unknown as number]) {
    assert.equal(isBootWarmupActive({ uptimeSeconds: () => bad, env }), false, `uptime: ${String(bad)}`);
  }
});

test("scheduled trigger adds the warmup header only during warmup and keeps the base header", async () => {
  async function headersFor(uptimeSeconds: number, env: Record<string, string> = {}) {
    let seen: Record<string, string> | null = null;
    await triggerLocalScheduledEvent({
      ...{ uptimeSeconds: () => uptimeSeconds, env },
      fetchImpl: async (_url, init) => {
        seen = init?.headers as Record<string, string>;
        return Response.json({ ok: true, result: {} });
      },
    });
    return seen;
  }
  assert.deepEqual(await headersFor(30), { "x-teruisi-local-scheduled": "1", "x-teruisi-boot-warmup": "1" });
  assert.deepEqual(await headersFor(20 * 60), { "x-teruisi-local-scheduled": "1" });
  assert.deepEqual(await headersFor(30, { TERUISI_BOOT_WARMUP_MINUTES: "0" }), { "x-teruisi-local-scheduled": "1" });
});

test("a skipped run is not reported as continueImmediately", async () => {
  const status = await triggerLocalScheduledEvent({
    ...{ uptimeSeconds: () => 10, env: {} },
    fetchImpl: async () => Response.json({
      ok: true,
      result: { annotations: { skipped: "boot_warmup" } },
    }),
  });
  assert.deepEqual(status, { status: 200, continueImmediately: false });
});

test("worker reads only the exact marker value", () => {
  assert.equal(BOOT_WARMUP_HEADER, "x-teruisi-boot-warmup");
  assert.equal(isBootWarmupRequest(new Headers({ [BOOT_WARMUP_HEADER]: "1" })), true);
  for (const value of ["", "0", "true", "yes", "11", "1, 1"]) {
    const headers = new Headers({ [BOOT_WARMUP_HEADER]: value });
    assert.equal(isBootWarmupRequest(headers), false, `value: ${JSON.stringify(value)}`);
  }
  assert.equal(isBootWarmupRequest(new Headers()), false);
  assert.deepEqual(bootWarmupSkipFor(true), { skipped: "boot_warmup" });
  assert.equal(bootWarmupSkipFor(false), undefined);
  assert.equal(bootWarmupSkipFor(undefined), undefined);
});

test("Worker skips exactly the three heavy runners during warmup and everything else keeps running", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const maintenance = source.slice(
    source.indexOf("async function runScheduledMarketMaintenance"),
    source.indexOf("function allowsLoopbackDevelopmentRequest"),
  );
  const calls = [...maintenance.matchAll(/runScheduledMarketTask\(\s*("[^"]+"),([\s\S]*?)\n  \);/g)];
  assert.equal(calls.length, 9, "nine isolated runners");
  const skipped = calls.filter((call) => /\bbootWarmupSkip,\s*$/.test(call[2]!)).map((call) => call[1]);
  assert.deepEqual(skipped.sort(), [
    '"customer service auto analysis runner failed"',
    '"market annotation scheduled runner failed"',
    '"market netshop projection scheduled runner failed"',
  ]);
  assert.match(maintenance, /const bootWarmupSkip = bootWarmupSkipFor\(input\.bootWarmup\)/);
  // 跳过要在执行任务之前返回，且不是 ok:true / ok:false。
  const taskFn = source.slice(source.indexOf("async function runScheduledMarketTask"), source.indexOf("async function runScheduledMarketMaintenance"));
  assert.ok(taskFn.indexOf("if (bootWarmupSkip) return bootWarmupSkip;") < taskFn.indexOf("await task()"));
});

test("only the authenticated local scheduled route reads the marker; Cloudflare scheduled() stays unchanged", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const route = source.slice(
    source.indexOf("if (url.pathname === localScheduledPath)"),
    source.indexOf('if (url.pathname === "/_vinext/image")'),
  );
  const authAt = route.indexOf("if (!allowsLocalScheduledRequest(request, env)) return new Response(null, { status: 404 });");
  const markerAt = route.indexOf("isBootWarmupRequest(request.headers)");
  assert.ok(authAt >= 0 && markerAt > authAt, "marker is read only after local scheduled auth");
  assert.equal(source.split("isBootWarmupRequest(").length - 1, 1, "used exactly once");
  const scheduled = source.slice(source.indexOf("async scheduled("));
  assert.doesNotMatch(scheduled, /bootWarmup/);
});
