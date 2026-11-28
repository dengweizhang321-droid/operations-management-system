import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium, type Frame, type Page } from "playwright-core";
import { createJdLogisticsSessionGuard, isJdLogisticsLoginOrigin, isJdLogisticsRedirectTransitionOrigin } from "../tools/jd-logistics-session";
import { autoLoginJdWithWindowsDpapiCredential, inspectJdLoginPageState, type JdSessionSurface } from "../tools/jd-saved-login";
import { jdLogisticsSourceUrls } from "../lib/jd/logistics-policy";
import { jdCustomerServiceWorkflow } from "../lib/jd/customer-service-workflow";

const store = { storeKey: "fixture-equipment", enabled: true, loginMode: "windows_dpapi_credentials" as const };
const businessUrl = "https://scsw.jdl.com/stockBusiness/warehouseInventoryRunningQueryNew";
const passport = "https://passport.jd.com/new/login.aspx";
const clean = { challengePresent: false, credentialRejected: false, temporarilyLocked: false };
const merchantUrl = jdCustomerServiceWorkflow.entryUrl;
function fixture() {
  let url: string = jdLogisticsSourceUrls.flow, frames: Frame[] = [], samples = 0;
  let logisticsUrl = url, logisticsFrames = frames, merchantLocation: string = merchantUrl, merchantFrames: Frame[] = [];
  let merchantSurface: JdSessionSurface = "authenticated", merchantPhase = false;
  const navigations: string[] = [];
  const frame = (url: string) => ({ url: () => url, locator: () => ({ isVisible: async () => true }) }) as unknown as Frame;
  const business = frame(businessUrl), login = frame(passport);
  const page = { url: () => url, frames: () => frames, locator: () => ({ innerText: async () => "" }),
    waitForTimeout: async () => { samples++; }, goto: async (value: string) => {
      navigations.push(value); merchantPhase = value === merchantUrl;
      url = merchantPhase ? merchantLocation : logisticsUrl;
      frames = merchantPhase ? merchantFrames : logisticsFrames;
    },
  } as unknown as Page;
  let calls = 0, reads = 0, ownership = 0, submissions = 0;
  const deps = { inspect: async () => clean,
    surface: async (): Promise<JdSessionSurface> => merchantSurface,
    login: (async (p, key, load, _wait, authorize) => {
      calls++; assert.equal(p, page); assert.equal(key, store.storeKey);
      await authorize!(login); const secret = await load!(key); secret.username = ""; secret.password = "";
      submissions++;
      if (merchantPhase) { url = merchantUrl; frames = []; merchantSurface = "authenticated"; }
      else { url = jdLogisticsSourceUrls.flow; frames = [business]; }
      return { attempted: true, submitted: true, reason: "submitted" as const };
    }) as typeof autoLoginJdWithWindowsDpapiCredential,
    load: async () => { reads++; return { username: "synthetic", password: "synthetic" }; },
  };
  return { page, business, login, deps,
    set: (u: string, f: Frame[]) => { url = logisticsUrl = u; frames = logisticsFrames = f; },
    setCurrent: (u: string, f: Frame[]) => { url = u; frames = f; },
    setMerchant: (u: string, f: Frame[], surface: JdSessionSurface) => {
      merchantLocation = u; merchantFrames = f; merchantSurface = surface;
    },
    own: async () => { ownership++; }, stats: () => ({ samples, calls, reads, ownership, submissions, navigations }) };
}

test("logistics login only trusts exact HTTPS JD passport origins", () => {
  assert.equal(isJdLogisticsLoginOrigin(passport), true);
  assert.equal(isJdLogisticsLoginOrigin("https://passport.shop.jd.com/login"), true);
  for (const url of ["http://passport.jd.com/login", "https://passport.jd.com.evil/login", "https://passport.jd.com:8443/login",
    "https://u:p@passport.jd.com/login", "https://wl.jdl.com/login", "about:blank"]) assert.equal(isJdLogisticsLoginOrigin(url), false);
});

test("SSO redirect transition origins get bounded non-credential grace while foreign origins fail immediately", async () => {
  assert.equal(isJdLogisticsRedirectTransitionOrigin("https://sso.jdl.com/auth"), true);
  assert.equal(isJdLogisticsRedirectTransitionOrigin("https://wl.jdl.com/"), true);
  assert.equal(isJdLogisticsRedirectTransitionOrigin("about:blank"), true);
  for (const bad of ["http://sso.jdl.com/auth", "https://sso.jdl.com:8443/auth", "https://u:p@sso.jdl.com/auth", "https://eviljdl.com/", "https://jdl.com.evil/", "https://evil.example/"]) {
    assert.equal(isJdLogisticsRedirectTransitionOrigin(bad), false);
  }
  // A transition origin embedding a passport login frame must still fail credential authorization immediately
  const embedded = fixture();
  embedded.set("https://sso.jdl.com/embed", [embedded.login]);
  await assert.rejects(createJdLogisticsSessionGuard(store, embedded.own, embedded.deps)(embedded.page, "flow"), /LOGIN_ORIGIN_REJECTED/);
  assert.equal(embedded.stats().reads, 0);

  // Transient JD/JDL SSO bounce settles onto business frame within grace window
  const f = fixture();
  f.set("https://sso.jdl.com/redirect", []);
  let hops = 0;
  f.page.waitForTimeout = async () => { if (++hops === 3) f.setCurrent(jdLogisticsSourceUrls.flow, [f.business]); };
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(hops, 3);
  assert.equal(f.stats().calls, 0);

  // Stuck JD/JDL transition origin still fails closed after bounded grace
  const stuck = fixture();
  stuck.set("https://sso.jdl.com/stuck", []);
  let stuckWaits = 0;
  stuck.page.waitForTimeout = async () => { stuckWaits++; };
  await assert.rejects(createJdLogisticsSessionGuard(store, stuck.own, stuck.deps)(stuck.page, "flow"), /LOGIN_ORIGIN_REJECTED/);
  assert.equal(stuckWaits, 15);
  assert.equal(stuck.stats().reads, 0);

  // Foreign origin without login frame still fails immediately with zero grace
  const foreign = fixture();
  foreign.set("https://evil.example/landing", []);
  let foreignWaits = 0;
  foreign.page.waitForTimeout = async () => { foreignWaits++; };
  await assert.rejects(createJdLogisticsSessionGuard(store, foreign.own, foreign.deps)(foreign.page, "flow"), /LOGIN_ORIGIN_REJECTED/);
  assert.equal(foreignWaits, 0);
});

test("existing logistics session requires its business frame and produces zero credential actions", async () => {
  const f = fixture(); f.set(jdLogisticsSourceUrls.flow, [f.business]);
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0); assert.equal(f.stats().ownership, 4);
  assert.deepEqual(f.stats().navigations, [merchantUrl, jdLogisticsSourceUrls.flow]);
});

test("expired merchant session submits once on passport before the first logistics navigation and reuses authentication", async () => {
  const f = fixture(); f.setMerchant(passport, [f.login], "login"); f.set(jdLogisticsSourceUrls.flow, [f.business]);
  const guard = createJdLogisticsSessionGuard(store, f.own, f.deps);
  const original = f.deps.login;
  f.deps.login = async (...args) => {
    assert.deepEqual(f.stats().navigations, [merchantUrl]);
    return original(...args);
  };
  assert.equal(await guard(f.page, "flow"), f.business);
  assert.equal(await guard(f.page, "flow"), f.business);
  assert.equal(f.stats().submissions, 1); assert.equal(f.stats().reads, 1);
  assert.deepEqual(f.stats().navigations, [merchantUrl, jdLogisticsSourceUrls.flow, jdLogisticsSourceUrls.flow]);
});

test("merchant prelogin challenge, rejection and lock stop before any login invocation", async () => {
  for (const [key, code] of [["challengePresent", "CHALLENGE"], ["credentialRejected", "CREDENTIAL_REJECTED"], ["temporarilyLocked", "LOCKED"]] as const) {
    const f = fixture(); f.setMerchant(passport, [f.login], "login");
    f.deps.inspect = async () => ({ ...clean, [key]: true });
    await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), new RegExp(`^Error: JD_LOGISTICS_LOGIN_${code}_MANUAL_ACTION$`));
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().submissions, 0); assert.equal(f.stats().reads, 0);
    assert.deepEqual(f.stats().navigations, [merchantUrl]);
  }
});

test("merchant prelogin challenge, rejection and lock after submission retain the existing manual codes", async () => {
  for (const [key, code] of [["challengePresent", "CHALLENGE"], ["credentialRejected", "CREDENTIAL_REJECTED"], ["temporarilyLocked", "LOCKED"]] as const) {
    const f = fixture(); f.setMerchant(passport, [f.login], "login");
    f.deps.inspect = async () => ({ ...clean, [key]: f.stats().submissions === 1 });
    await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), new RegExp(`^Error: JD_LOGISTICS_LOGIN_${code}_MANUAL_ACTION$`));
    assert.equal(f.stats().submissions, 1); assert.equal(f.stats().reads, 1);
    assert.deepEqual(f.stats().navigations, [merchantUrl]);
  }
});

test("merchant prelogin consumes the sole attempt even if logistics still presents passport", async () => {
  const f = fixture(); f.setMerchant(passport, [f.login], "login"); f.set(passport, [f.login]);
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /^Error: JD_LOGISTICS_LOGIN_NOT_COMPLETED_MANUAL_ACTION$/);
  assert.equal(f.stats().submissions, 1); assert.equal(f.stats().calls, 1); assert.equal(f.stats().reads, 1);
});

test("non-whitelisted logistics QR login still fails without credential actions after merchant authentication", async () => {
  const f = fixture(); f.set("https://wl.jdl.com/login", []);
  f.page.locator = (() => ({ innerText: async () => f.page.url() === merchantUrl ? "" : "扫码登录" })) as unknown as Page["locator"];
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /^Error: JD_LOGISTICS_LOGIN_REQUIRED$/);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0);
});

test("owner revoked during merchant prelogin stops before loading or submitting credentials", async () => {
  const f = fixture(); f.setMerchant(passport, [f.login], "login"); let revoked = false;
  f.deps.inspect = async () => { revoked = true; return clean; };
  await assert.rejects(createJdLogisticsSessionGuard(store, async () => {
    if (revoked) throw new Error("JD_LOGISTICS_OWNER_REVOKED");
  }, f.deps)(f.page, "flow"), /^Error: JD_LOGISTICS_OWNER_REVOKED$/);
  assert.equal(f.stats().reads, 0); assert.equal(f.stats().submissions, 0);
  assert.deepEqual(f.stats().navigations, [merchantUrl]);
});

test("merchant prelogin missing credentials, unready forms and unknown submissions use existing sanitized codes", async () => {
  for (const scenario of ["credential", "form", "unknown", "incomplete", "pending", "navigation"] as const) {
    const f = fixture(); f.setMerchant(passport, [f.login], "login");
    if (scenario === "credential") f.deps.load = async () => { throw new Error("private credential detail"); };
    if (scenario === "form") f.deps.login = async () => ({ attempted: false, submitted: false, reason: "login_form_missing" });
    if (scenario === "unknown") f.deps.login = async () => { throw new Error("private submission detail"); };
    if (scenario === "incomplete") f.deps.login = async () => ({ attempted: true, submitted: true, reason: "submitted" });
    if (scenario === "pending") f.setMerchant(merchantUrl, [], "pending");
    if (scenario === "navigation") f.page.goto = async () => { throw new Error("private navigation detail"); };
    const suffix = scenario === "credential" ? "CREDENTIAL_UNAVAILABLE" : scenario === "unknown" ? "SUBMISSION_UNKNOWN"
      : scenario === "incomplete" ? "NOT_COMPLETED" : "FORM_NOT_READY";
    await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), new RegExp(`^Error: JD_LOGISTICS_LOGIN_${suffix}_MANUAL_ACTION$`));
    assert.ok(f.stats().calls <= 1); assert.deepEqual(f.stats().navigations, scenario === "navigation" ? [] : [merchantUrl]);
  }
});

test("merchant prelogin read and wait failures remain sanitized before and after a credential attempt", async () => {
  for (const submitted of [false, true]) {
    for (const action of ["inspect", "surface", "wait"] as const) {
      const f = fixture();
      f.setMerchant(submitted ? passport : merchantUrl, submitted ? [f.login] : [], submitted ? "login" : "pending");
      const failRead = async (): Promise<never> => { throw new Error("private browser failure must not escape"); };
      if (action === "inspect") f.deps.inspect = async () => {
        if (!submitted || f.stats().submissions) return failRead();
        return clean;
      };
      if (action === "surface") f.deps.surface = failRead;
      if (action === "wait") f.page.waitForTimeout = async () => {
        if (!submitted || f.stats().submissions) return failRead();
      };
      if (submitted && action === "wait") f.deps.surface = async () => "pending";
      const code = submitted ? "NOT_COMPLETED" : "FORM_NOT_READY";
      await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"),
        new RegExp("^Error: JD_LOGISTICS_LOGIN_" + code + "_MANUAL_ACTION$"));
      assert.equal(f.stats().submissions, submitted ? 1 : 0);
      assert.deepEqual(f.stats().navigations, [merchantUrl]);
    }
  }
});

test("merchant redirect changing during surface inspection is re-inspected before any credential action", async () => {
  const f = fixture(); f.setMerchant(merchantUrl, [], "pending"); f.set(jdLogisticsSourceUrls.flow, [f.business]);
  let samples = 0;
  f.deps.surface = async () => {
    if (++samples === 1) { f.setCurrent(passport, [f.login]); return "pending"; }
    return "authenticated";
  };
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(f.stats().submissions, 1); assert.equal(f.stats().reads, 1);
  assert.deepEqual(f.stats().navigations, [merchantUrl, jdLogisticsSourceUrls.flow]);
});

test("disabled or manual merchant accounts cannot use DPAPI", async () => {
  for (const account of [{ ...store, enabled: false }, { ...store, loginMode: "manual" as const }]) {
    const f = fixture(); f.setMerchant(passport, [f.login], "login");
    await assert.rejects(createJdLogisticsSessionGuard(account, f.own, f.deps)(f.page, "flow"), /^Error: JD_LOGISTICS_LOGIN_REQUIRED$/);
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0);
  }
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

const mobilePassport = "https://passport.jd.com/common/mobile/loginPage";
const hiddenFrame = (url: string, onVisibleCheck?: () => void) => ({ url: () => url, locator: () => ({ isVisible: async () => { onVisibleCheck?.(); return false; } }) }) as unknown as Frame;

test("a hidden passport frame beside the visible login frame is not a second login control", async () => {
  const f = fixture(); f.set("https://wl.jdl.com/login", [hiddenFrame(mobilePassport), f.login]);
  let loginFrame: Frame | undefined;
  const original = f.deps.login;
  f.deps.login = (async (page, key, load, wait, authorize) => {
    const wrapped = async (frame: Frame) => { loginFrame = frame; await authorize!(frame); };
    return original(page, key, load, wait, wrapped);
  }) as typeof autoLoginJdWithWindowsDpapiCredential;
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(loginFrame, f.login); assert.equal(f.stats().calls, 1); assert.equal(f.stats().reads, 1);
});

test("two visible passport frames are still ambiguous and no credential is read", async () => {
  const f = fixture(); const second = { url: () => "https://passport.jd.com/common/mobile/loginPage", locator: () => ({ isVisible: async () => true }) } as unknown as Frame;
  f.set("https://wl.jdl.com/login", [f.login, second]);
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /LOGIN_CONTROL_AMBIGUOUS/);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0);
});

test("only hidden passport frames: no immediate failure, no credential use, waits and ends with the existing closing code", async () => {
  const f = fixture(); let checks = 0;
  f.set("https://wl.jdl.com/login", [hiddenFrame(passport, () => { checks++; }), hiddenFrame(mobilePassport, () => { checks++; })]);
  await assert.rejects(createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), /^Error: JD_LOGISTICS_BUSINESS_FRAME_NOT_READY$/);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().reads, 0); assert.equal(f.stats().samples, 100); assert.equal(checks, 200);
});

test("a hidden login frame that becomes visible later is used once", async () => {
  const f = fixture(); let visible = false;
  const late = { url: () => passport, locator: () => ({ isVisible: async () => visible }) } as unknown as Frame;
  f.set("https://wl.jdl.com/login", [late]);
  f.page.waitForTimeout = async () => { visible = true; };
  f.deps.login = (async (_p, _k, load, _w, authorize) => {
    await authorize!(late); await load!(store.storeKey);
    f.set(jdLogisticsSourceUrls.flow, [f.business]);
    return { attempted: true, submitted: true, reason: "submitted" as const };
  }) as typeof autoLoginJdWithWindowsDpapiCredential;
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
});

test("credentials are only authorized for the one frame the guard selected", async () => {
  const f = fixture(); const hidden = hiddenFrame(mobilePassport);
  f.set("https://wl.jdl.com/login", [hidden, f.login]); // both are in the page, only f.login was selected
  let seen = 0;
  f.deps.login = (async (_p, _k, load, _w, authorize) => {
    seen++;
    await assert.rejects(authorize!(hidden), /^Error: JD_LOGISTICS_LOGIN_ORIGIN_REJECTED$/); // in the page and a passport origin, but not selected
    await authorize!(f.login);
    await load!(store.storeKey);
    f.set(jdLogisticsSourceUrls.flow, [f.business]);
    return { attempted: true, submitted: true, reason: "submitted" as const };
  }) as typeof autoLoginJdWithWindowsDpapiCredential;
  assert.equal(await createJdLogisticsSessionGuard(store, f.own, f.deps)(f.page, "flow"), f.business);
  assert.equal(seen, 1); assert.equal(f.stats().reads, 1);
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
  assert.match(source, /const navigate = async \(\) => \{ return session\(page, options.sourceKind\); \};/);
  assert.ok(source.indexOf("const business = await navigate()") < source.indexOf("await identity(business, observedCodes"));
});

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("real DOM login uses synthetic credentials once, clears them and reaches exact logistics frame", { skip: !existsSync(chrome), timeout: 20000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  let merchantVisits = 0;
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.split("#")[0] === merchantUrl.split("#")[0]) {
      if (++merchantVisits === 1) return route.fulfill({ contentType: "text/html", body: `<script>setTimeout(() => { location.href = "${passport}"; }, 50)</script>` });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: "聊天记录 列表视图 消息视图 查询 重置" });
    }
    if (url.split("#")[0] === passport) return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<input id="loginname"><input id="nloginpwd" type="password"><button id="loginsubmit" onclick="location.href='${merchantUrl}'">登录</button>` });
    if (url === jdLogisticsSourceUrls.flow) return route.fulfill({ contentType: "text/html", body: `<iframe src="${businessUrl}"></iframe>` });
    if (url === businessUrl) return route.fulfill({ contentType: "text/html", body: "仓库库存流水 EBU4418046540089" });
    return route.abort();
  });
  const page = await context.newPage();
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
