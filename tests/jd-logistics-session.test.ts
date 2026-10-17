import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium, type Frame, type Page } from "playwright-core";
import { createJdLogisticsSessionGuard, isJdLogisticsLoginOrigin } from "../tools/jd-logistics-session";
import { autoLoginJdWithWindowsDpapiCredential, inspectJdLoginPageState } from "../tools/jd-saved-login";
import { jdLogisticsSourceUrls } from "../lib/jd/logistics-policy";

const store = { storeKey: "fixture-equipment", enabled: true, loginMode: "windows_dpapi_credentials" as const };
const businessUrl = "https://scsw.jdl.com/stockBusiness/warehouseInventoryRunningQueryNew";
const passport = "https://passport.jd.com/new/login.aspx";
const clean = { challengePresent: false, credentialRejected: false, temporarilyLocked: false };
function fixture() {
  let url: string = jdLogisticsSourceUrls.flow, frames: Frame[] = [], samples = 0;
  const frame = (url: string) => ({ url: () => url, locator: () => ({ isVisible: async () => true }) }) as unknown as Frame;
  const business = frame(businessUrl), login = frame(passport);
  const page = { url: () => url, frames: () => frames, locator: () => ({ innerText: async () => "" }),
    waitForTimeout: async () => { samples++; }, goto: async (value: string) => { url = value; },
  } as unknown as Page;
  let calls = 0, reads = 0, ownership = 0;
  const deps = { inspect: async () => clean,
    login: (async (p, key, load, _wait, authorize) => {
      calls++; assert.equal(p, page); assert.equal(key, store.storeKey);
      await authorize!(login); const secret = await load!(key); secret.username = ""; secret.password = "";
      url = jdLogisticsSourceUrls.flow; frames = [business];
      return { attempted: true, submitted: true, reason: "submitted" as const };
    }) as typeof autoLoginJdWithWindowsDpapiCredential,
    load: async () => { reads++; return { username: "synthetic", password: "synthetic" }; },
  };
  return { page, business, login, deps, set: (u: string, f: Frame[]) => { url = u; frames = f; },
    own: async () => { ownership++; }, stats: () => ({ samples, calls, reads, ownership }) };
}

test("logistics login only trusts exact HTTPS JD passport origins", () => {
  assert.equal(isJdLogisticsLoginOrigin(passport), true);
  assert.equal(isJdLogisticsLoginOrigin("https://passport.shop.jd.com/login"), true);
  for (const url of ["http://passport.jd.com/login", "https://passport.jd.com.evil/login", "https://passport.jd.com:8443/login",
    "https://u:p@passport.jd.com/login", "https://wl.jdl.com/login", "about:blank"]) assert.equal(isJdLogisticsLoginOrigin(url), false);
});

test("existing logistics session requires its business frame and produces zero credential actions", async () => {
  const f = fixture(); f.set(jdLogisticsSourceUrls.flow, [f.business]);
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0); assert.equal(f.stats().ownership, 2);
});

test("a delayed login redirect is handled once before a logistics frame can be accepted", async () => {
  const f = fixture();
  let redirected = false;
  f.page.waitForTimeout = async () => { if (!redirected) { redirected = true; f.set(passport, [f.login]); } };
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().reads, 1);
});

test("login iframe takes precedence over a still-visible stale business iframe", async () => {
  const f = fixture(); f.set(jdLogisticsSourceUrls.flow, [f.business, f.login]);
  await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow");
  assert.equal(f.stats().calls, 1);
});

test("challenge, rejection and account lock stop before reading any credential", async () => {
  for (const [key, code] of [["challengePresent", "CHALLENGE"], ["credentialRejected", "CREDENTIAL_REJECTED"], ["temporarilyLocked", "LOCKED"]] as const) {
    const f = fixture(); f.set(passport, [f.login]); f.deps.inspect = async () => ({ ...clean, [key]: true });
    await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), new RegExp(code));
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0);
  }
});

test("disabled/non-DPAPI accounts and multiple login frames cannot submit", async () => {
  for (const disabled of [{ ...store, enabled: false }, { ...store, loginMode: "manual" as const }]) {
    const f = fixture(); f.set(passport, [f.login]);
    await assert.rejects(createJdLogisticsSessionGuard(disabled, f.own, f.deps)(f.page, "flow"), /LOGIN_REQUIRED/);
    assert.equal(f.stats().reads, 0);
  }
  const f = fixture(); f.set(passport, [f.login, f.login]);
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /CONTROL_AMBIGUOUS/);
  assert.equal(f.stats().reads, 0);
});

test("foreign outer origin and revoked owner cannot obtain credentials", async () => {
  const f = fixture(); f.set("https://evil.example/", [f.login]);
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /ORIGIN_REJECTED/);
  assert.equal(f.stats().reads, 0);
  const g = fixture(); g.set(passport, [g.login]);
  let checks = 0;
  await assert.rejects(createJdLogisticsSessionGuard(store, async () => { if (++checks > 1) throw new Error("JD_LOGISTICS_OWNER_REVOKED"); }, g.deps)(g.page, "flow"), /OWNER_REVOKED/);
  assert.equal(g.stats().reads, 0);
});

test("uncertain login submission is sanitized and never resubmitted on the same browser operation", async () => {
  const f = fixture(); f.set(passport, [f.login]); let submissions = 0;
  f.deps.login = async () => { submissions++; throw new Error("private response must not escape"); };
  const guard = createJdLogisticsSessionGuard(store, f.own, f.deps);
  await assert.rejects(guard(f.page, "flow"), /^Error: JD_LOGISTICS_LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION$/);
  await assert.rejects(guard(f.page, "flow"), /LOGIN_NOT_COMPLETED/);
  assert.equal(submissions, 1);
});

test("challenge arising at a later credential action is detected before that action", async () => {
  const f = fixture(); f.set(passport, [f.login]); let samples = 0;
  f.deps.inspect = async () => ({ ...clean, challengePresent: ++samples >= 3 });
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /CHALLENGE_MANUAL_ACTION/);
  assert.equal(f.stats().reads, 0);
});

test("unrecognised business page and forged business origin are never authentication proof", async () => {
  const f = fixture();
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /BUSINESS_FRAME_NOT_READY/);
  assert.equal(f.stats().reads, 0);
  const g = fixture(); g.set(jdLogisticsSourceUrls.flow, [{ url: () => businessUrl.replace("scsw.jdl.com", "scsw.jdl.com.evil") } as Frame]);
  await assert.rejects(createJdLogisticsSessionGuard(store, g.own, g.deps)(g.page, "flow"), /BUSINESS_FRAME_NOT_READY/);
});

test("production exporter uses the guard for initial and JH cold-return navigation before identity/export", async () => {
  const source = await readFile(new URL("../tools/jd-logistics-export.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("createJdLogisticsSessionGuard(options.store, options.assertOwner)") < source.indexOf("const business = await navigate()"));
  assert.match(source, /return session\(page, options.sourceKind\)/);
  assert.ok(source.indexOf("const business = await navigate()") < source.indexOf("await identity(business, observedCodes"));
});

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("real DOM login uses synthetic credentials once, clears them and reaches exact logistics frame", { skip: !existsSync(chrome), timeout: 20000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url === passport) return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<input id="loginname"><input id="nloginpwd" type="password"><button id="loginsubmit" onclick="location.href='${jdLogisticsSourceUrls.flow}'">登录</button>` });
    if (url === jdLogisticsSourceUrls.flow) return route.fulfill({ contentType: "text/html", body: `<iframe src="${businessUrl}"></iframe>` });
    if (url === businessUrl) return route.fulfill({ contentType: "text/html", body: "仓库库存流水 EBU4418046540089" });
    return route.abort();
  });
  const page = await context.newPage(); await page.goto(passport);
  let reads = 0, writes = 0;
  const credential = { username: "fixture-user", password: "fixture-password" };
  const result = await createJdLogisticsSessionGuard(store, async () => { writes++; }, {
    login: autoLoginJdWithWindowsDpapiCredential, inspect: inspectJdLoginPageState,
    load: async key => { assert.equal(key, store.storeKey); reads++; return credential; },
  })(page, "flow");
  assert.equal(result.url(), businessUrl); assert.equal(reads, 1); assert.ok(writes >= 6);
  assert.deepEqual(credential, { username: "", password: "" });
});

test("bound credential fields cannot re-resolve into a foreign document after authorization", { skip: !existsSync(chrome), timeout: 15000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body:
    '<input id="loginname"><input id="nloginpwd" type="password"><button id="loginsubmit">登录</button><script>window.received=[];document.addEventListener("input",e=>received.push(e.target.value));</script>' }));
  const page = await context.newPage(); await page.goto(passport);
  const credential = { username: "synthetic-account", password: "synthetic-password" }; let checks = 0;
  await assert.rejects(autoLoginJdWithWindowsDpapiCredential(page, store.storeKey, async () => credential, 1000, async frame => {
    if (++checks === 2) await frame.evaluate(() => {
      document.querySelector("#loginname")!.remove();
      setTimeout(() => { location.href = "https://foreign.invalid/"; }, 100);
    });
    if (!isJdLogisticsLoginOrigin(frame.url())) throw new Error("ORIGIN_REJECTED");
  }));
  await page.waitForURL("https://foreign.invalid/");
  assert.deepEqual(await page.evaluate(() => (window as unknown as { received: string[] }).received), []);
  assert.deepEqual(credential, { username: "", password: "" });
});
