import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { isJdWareProductQueryRequest, waitForJdWareQueryOrAutomatedLoginRedirect } from "../tools/jackyun-ware-export";
import { inspectJdSessionSurfaceCounts, isJdLoginSurface } from "../tools/jd-saved-login";
import { observeJdWareInitialQuery, waitForJdWareLoginSurface } from "../tools/jd-ware-query-observer";

const executablePath = path.join(process.env.LOCALAPPDATA ?? "", "Chromium/Application/chrome.exe");
const available = process.platform === "win32" && existsSync(executablePath);
const target = "https://wares-jdm.jd.com/ware/wareList";
const query = "https://sff.jd.com/api?api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList";

test("real isolated Chromium observes an embedded login and exactly one post-login query", { skip: !available, timeout: 30_000 }, async () => {
  // A deny-only local proxy is an independent network fence. All allowed pages
  // are route fixtures; no production profile, credentials or business endpoint
  // is reachable even if the fixture routing accidentally misses a request.
  const proxy = createServer((_req, res) => { res.writeHead(403); res.end(); });
  proxy.on("connect", (_req, socket) => { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ executablePath, headless: true, proxy: { server: `http://127.0.0.1:${address.port}` } });
  try {
    const page = await browser.newPage();
    let queries = 0, logins = 0;
    await page.route("**/*", async route => {
      const url = route.request().url();
      if (url === target) return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><body>商品管理<iframe id="login" src="https://passport.jd.com/login"></iframe></body>' });
      if (url === "https://passport.jd.com/login") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<meta charset="utf-8"><body>账号密码登录<input type="password"></body>' });
      if (url === query && route.request().method() === "POST") {
        queries++;
        return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: 200, data: { total: 83 } }) });
      }
      return route.abort("blockedbyclient");
    });
    const observer = observeJdWareInitialQuery(page, isJdWareProductQueryRequest);
    try {
      await page.goto(target);
      await page.frameLocator("#login").locator('input[type="password"]').waitFor();
      observer.navigationReady();
      const surfaces = await inspectJdSessionSurfaceCounts(page);
      assert.equal(surfaces.mainSurface, "authenticated");
      assert.equal(surfaces.loginSubframeCount, 1);
      await assert.rejects(page.waitForURL(url => /passport|login/i.test(url.hostname) || /passport|login/i.test(url.pathname), { timeout: 25 }), /Timeout/);
      let authentication: Promise<void> | undefined;
      const login = waitForJdWareLoginSurface(() => isJdLoginSurface(page), observer.isStopped, () => page.waitForTimeout(10));
      const response = await waitForJdWareQueryOrAutomatedLoginRedirect(observer.promise, login, () => authentication ??= (async () => {
        logins++;
        observer.loginObserved(); observer.loginStarted();
        await page.locator("#login").evaluate(element => element.remove());
        observer.loginCompleted();
        await page.evaluate(async url => { await fetch(url, { method: "POST", body: "fixture" }); }, query);
      })());
      await authentication;
      assert.equal((await response.json()).data.total, 83);
      observer.assertUniqueRequest();
      assert.equal(queries, 1); assert.equal(logins, 1);
      assert.equal(observer.diagnostics().requestCount, 1);
    } finally { observer.dispose(); }
  } finally {
    await browser.close();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
