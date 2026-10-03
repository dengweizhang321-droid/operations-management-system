import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { isJdWareProductQueryRequest, reopenJdWareTargetAfterAutomatedLogin } from "../tools/jackyun-ware-export";
import { isJdWareCoreScript, JdWareQueryObservationError, jdWareBootstrapTimeoutMs, jdWarePageLoadTimeoutMs, jdWareQueryResponseTimeoutMs, observeJdWareInitialQuery, waitForJdWareLoginSurface } from "../tools/jd-ware-query-observer";

const url = "https://sff.jd.com/api?api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList";
function fixture() {
  const page = new EventEmitter();
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock = {
    schedule(run: () => void, delay: number) { const id = ++next; timers.set(id, { at: now + delay, run }); return id as never; },
    cancel(id: unknown) { timers.delete(id as number); },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    while (true) {
      const entry = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, t] = entry; timers.delete(id); now = t.at; t.run();
    }
    now = until;
  };
  const observer = observeJdWareInitialQuery(page as never, isJdWareProductQueryRequest, clock);
  const request = (target = url, resourceType = "fetch") => ({ url: () => target, method: () => "POST", resourceType: () => resourceType });
  const response = (req: ReturnType<typeof request>, status = 200) => ({ request: () => req, url: req.url, status: () => status });
  return { page, observer, advance, request, response, timers };
}

test("keeps the response budget at 60 seconds after request dispatch, including slow initial loading", async () => {
  const f = fixture();
  f.advance(29_000); f.observer.navigationReady(); f.advance(50_000);
  const req = f.request(); f.page.emit("request", req); f.advance(59_999);
  const res = f.response(req); f.page.emit("response", res);
  assert.equal(await f.observer.promise, res);
  assert.equal(jdWareQueryResponseTimeoutMs, 60_000);
  f.observer.dispose(); assert.equal(f.timers.size, 0);
});

test("fails after exactly the response budget, without manufacturing a retry or second request", async () => {
  const f = fixture(), req = f.request(); f.page.emit("request", req); f.advance(60_000);
  await assert.rejects(f.observer.promise, (e: unknown) => e instanceof JdWareQueryObservationError && e.code === "RESPONSE_TIMEOUT" && e.diagnostics.requestCount === 1);
  f.observer.dispose();
});

test("separates bounded authentication from product response waiting and retains the original listener", async () => {
  const f = fixture(); f.advance(20_000); f.observer.loginObserved(); f.observer.loginStarted();
  f.advance(70_000); f.observer.loginCompleted(); f.advance(10_000);
  const req = f.request(); f.page.emit("request", req); f.advance(10_000); const res = f.response(req); f.page.emit("response", res);
  assert.equal(await f.observer.promise, res);
  assert.deepEqual([f.observer.diagnostics().authenticationStarted, f.observer.diagnostics().loginCompleted], [true, true]);
  f.observer.dispose();
});

test("bounds the full observer even when authentication or page loading never completes", async () => {
  const f = fixture(); f.observer.loginStarted(); f.advance(jdWareBootstrapTimeoutMs);
  await assert.rejects(f.observer.promise, (e: unknown) => e instanceof JdWareQueryObservationError && e.code === "BOOTSTRAP_TIMEOUT");
  f.observer.dispose();
});

test("classifies missing query dispatch and core script failures without recording signed URLs", async () => {
  const f = fixture(); const secret = "DO_NOT_LOG_AUTH_VALUE";
  const asset = f.request(`https://storage.360buyimg.com/shop-pageframe/micro-app/ware-shop-static-plus/prod/app.js?token=${secret}`, "script");
  f.page.emit("requestfailed", asset); f.advance(jdWarePageLoadTimeoutMs);
  await assert.rejects(f.observer.promise, (e: unknown) => e instanceof JdWareQueryObservationError && e.code === "NOT_DISPATCHED" && e.diagnostics.failedCoreScripts === 1 && !JSON.stringify(e).includes(secret) && !e.message.includes(secret));
  f.observer.dispose();
});

test("rejects a second query and ignores stale responses from an unobserved request", async () => {
  const f = fixture(); f.page.emit("response", f.response(f.request())); assert.equal(f.observer.diagnostics().responseSeen, false);
  f.page.emit("request", f.request()); f.page.emit("request", f.request());
  await assert.rejects(f.observer.promise, (e: unknown) => e instanceof JdWareQueryObservationError && e.code === "DUPLICATE_REQUEST");
  f.observer.dispose();
});

test("request failure and failed core-script HTTP response have separate counts", async () => {
  const f = fixture(); const asset = f.request("https://storage.360buyimg.com/shop-pageframe/micro-app/ware-shop-static-plus/prod/vendors.js", "script");
  f.page.emit("response", f.response(asset, 503)); const req = f.request(); f.page.emit("request", req); f.page.emit("requestfailed", req);
  await assert.rejects(f.observer.promise, (e: unknown) => e instanceof JdWareQueryObservationError && e.code === "REQUEST_FAILED" && e.diagnostics.rejectedCoreScripts === 1);
  f.observer.dispose();
});

test("stopping detaches browser handlers and cannot start authentication on a late frame", async () => {
  const f = fixture(); f.observer.dispose(); assert.equal(f.page.listenerCount("request"), 0); assert.equal(f.page.listenerCount("response"), 0); assert.equal(f.page.listenerCount("requestfailed"), 0); assert.equal(f.timers.size, 0);
  f.page.emit("request", f.request()); assert.equal(f.observer.diagnostics().requestCount, 0);
  assert.throws(f.observer.loginStarted, /OBSERVER_CLOSED/);
});

test("a request arriving after a timeout cannot re-arm a timer or recover a failed observation", async () => {
  const f = fixture(); f.advance(jdWarePageLoadTimeoutMs);
  await assert.rejects(f.observer.promise, /NOT_DISPATCHED/);
  f.page.emit("request", f.request()); assert.equal(f.timers.size, 0); assert.equal(f.observer.diagnostics().requestCount, 0);
  f.observer.dispose();
});

test("observes an embedded login surface after an initially empty merchant shell", async () => {
  let samples = 0;
  assert.equal(await waitForJdWareLoginSurface(async () => ++samples >= 3, () => false, async () => undefined), "login");
  assert.equal(samples, 3);
});

test("propagates a frame security gate instead of hiding it behind the query timeout", async () => {
  await assert.rejects(waitForJdWareLoginSurface(async () => { throw new Error("waiting_login: challenge_present"); }, () => false, async () => undefined), /challenge_present/);
});

test("a second request after the response is still rejected before entering export", async () => {
  const f = fixture(), req = f.request(); f.page.emit("request", req); f.page.emit("response", f.response(req)); await f.observer.promise;
  f.page.emit("request", f.request()); assert.throws(f.observer.assertUniqueRequest, /DUPLICATE_REQUEST/); f.observer.dispose();
});

test("refuses a post-login second navigation if the original query was already dispatched", async () => {
  let navigations = 0;
  await assert.rejects(reopenJdWareTargetAfterAutomatedLogin({ authentication: "windows_dpapi_credentials", currentUrl: "https://shop.jd.com/home", queryObserved: true, gotoTarget: async () => { navigations++; }, verifyPostNavigation: async () => undefined }), /拒绝再次导航/);
  assert.equal(navigations, 0);
});

test("only recognizes the observed JD application CDN script scope", () => {
  assert.equal(isJdWareCoreScript("https://storage.360buyimg.com/shop-pageframe/micro-app/ware-shop-static-plus/prod/app.js", "script"), true);
  assert.equal(isJdWareCoreScript("https://storage.360buyimg.com/unrelated/app.js", "script"), false);
  assert.equal(isJdWareCoreScript("https://example.com/shop-pageframe/micro-app/ware-shop-static-plus/app.js", "script"), false);
});

test("production wiring uses frame-aware observation; query-only stops before export and never reads credentials", async () => {
  const source = await readFile("tools/jackyun-ware-export.ts", "utf8");
  const open = source.slice(source.indexOf("async function openTargetPage"), source.indexOf("async function dismissJdMenuUpdateNotice"));
  assert.match(open, /observeJdWareInitialQuery\(page, isJdWareProductQueryRequest\)/);
  assert.match(open, /return isJdLoginSurface\(page\)/);
  assert.match(open, /inspectJdLoginPageState\(page\)/);
  assert.match(open, /const runningAuthentication = currentAuthentication\(\)/);
  assert.match(open, /if \(runningAuthentication\) await runningAuthentication/);
  const main = source.slice(source.indexOf("async function main()"));
  assert.match(main, /options.inspectQueryOnly \? \{ \.\.\.options, loginMode: "manual" \}/);
  assert.match(source, /visibleRecovery: inspectQueryOnly \? false : visibleRecovery/);
  const exportIndex = main.indexOf("await runShopSkuExport(");
  assert.ok(exportIndex > 0);
  assert.ok(main.indexOf('status: "inspected"') < exportIndex);
  const inspectBranch = main.slice(main.indexOf("if (options.inspectQueryOnly)"), main.indexOf("const abandonRecovery"));
  assert.doesNotMatch(inspectBranch, /console\.log\(`@@JD_PIPELINE_RESULT@@/);
  assert.match(inspectBranch, /return;/);
});
