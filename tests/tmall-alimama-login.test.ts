import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { Page } from "playwright-core";
import { ensureAlimamaLogin, trustedAlimamaLoginUrl } from "../tools/tmall-alimama-login";

const store = { storeKey: "tmall-yijiu", loginMode: "windows_dpapi_credentials" as const };
const clean = { challengePresent: false, credentialRejected: false, temporarilyLocked: false };

test("Both promotion paths use the guard; direct capture follows authentication", async () => {
  const ui = await readFile(new URL("../tools/tmall-promotion-export.ts", import.meta.url), "utf8");
  assert.match(ui, /await ensureAlimamaLogin\(page, store/);
  const direct = await readFile(new URL("../tools/tmall-direct-promotion-export.ts", import.meta.url), "utf8");
  const discovery = direct.slice(direct.indexOf("async function discoverIdentifiers"), direct.indexOf("async function apiCreateTask"));
  assert.ok(discovery.indexOf("await waitForAlimamaIdentity") < discovery.indexOf("page.waitForRequest"));
  assert.doesNotMatch(discovery, /apiCreateTask|\.post\(/);
  assert.match(discovery, /catch\(\(\) => null\)/);
});
function fixture(url = "https://one.alimama.com/index.html") {
  const context = {};
  const state = { url, authenticated: false, attempts: 0 };
  const page = {
    url: () => state.url,
    context: () => context,
    frames: () => [{ url: () => "https://login.taobao.com/member/login.jhtml" }, { url: () => "https://evil.example" }],
  } as unknown as Page;
  const identity = async () => { if (!state.authenticated) throw new Error("waiting_login"); };
  return { state, page, identity };
}

test("Alimama trusted origins reject lookalikes, HTTP and credential URLs", () => {
  assert.equal(trustedAlimamaLoginUrl("https://login.taobao.com/member/login.jhtml", true), true);
  for (const url of ["http://login.taobao.com", "https://login.taobao.com.evil.test", "https://evil.test/?next=login.taobao.com", "https://u:p@login.taobao.com", "https://login.taobao.com:444", "about:blank"]) {
    assert.equal(trustedAlimamaLoginUrl(url), false);
  }
  assert.equal(trustedAlimamaLoginUrl("https://one.alimama.com", true), false);
});

test("Existing Alimama session does not read credentials or submit", async () => {
  const f = fixture(); f.state.authenticated = true;
  await ensureAlimamaLogin(f.page, store, f.identity, {
    inspect: async () => clean,
    login: async () => { throw new Error("must not login"); },
  });
});

test("Expired session submits once through trusted frames then checks identity", async () => {
  const f = fixture("https://login.taobao.com/member/login.jhtml");
  await ensureAlimamaLogin(f.page, store, f.identity, {
    inspect: async () => clean,
    wait: async () => {},
    login: async (page, key) => {
      assert.equal(key, store.storeKey);
      assert.equal(page.frames().length, 1);
      f.state.attempts++;
      f.state.url = "https://one.alimama.com/index.html";
      f.state.authenticated = true;
      return { attempted: true, submitted: true, reason: "submitted" };
    },
  });
  assert.equal(f.state.attempts, 1);
});

test("Challenge, rejection and lock fail before credentials", async () => {
  for (const flag of ["challengePresent", "credentialRejected", "temporarilyLocked"]) {
    const f = fixture();
    await assert.rejects(ensureAlimamaLogin(f.page, store, f.identity, {
      inspect: async () => ({ ...clean, [flag]: true }),
      login: async () => { assert.fail("must not read credentials"); },
    }), /人工验证/);
  }
});

test("Uncertain login is sanitized and fenced across tabs/store keys", async () => {
  const f = fixture();
  await assert.rejects(ensureAlimamaLogin(f.page, store, f.identity, {
    inspect: async () => clean,
    login: async () => { throw new Error("secret-filled-argument"); },
  }), (error: Error) => !error.message.includes("secret") && /禁止自动重试/.test(error.message));
  await assert.rejects(ensureAlimamaLogin(f.page, { ...store, storeKey: "tmall-lili" }, f.identity, {
    inspect: async () => clean,
    login: async () => { assert.fail("second attempt"); },
  }), /本轮已尝试/);
});

test("Login origin cannot pass as authenticated; wrong identity times out", async () => {
  const f = fixture("https://login.taobao.com/member/login.jhtml");
  await assert.rejects(ensureAlimamaLogin(f.page, store, async () => {}, {
    timeoutMs: 0, inspect: async () => clean,
    login: async () => ({ attempted: true, submitted: true, reason: "submitted" }),
  }), /店铺身份未确认/);
  const g = fixture();
  await assert.rejects(ensureAlimamaLogin(g.page, store, async () => { throw new Error("shop_identity_mismatch"); }, {
    timeoutMs: 0, inspect: async () => clean,
    login: async () => { assert.fail("wrong store must not login"); },
  }), /店铺身份未确认/);
});

test("Unknown origin and missing credentials fail closed", async () => {
  const f = fixture("https://evil.example");
  await assert.rejects(ensureAlimamaLogin(f.page, store, f.identity), /来源未经许可/);
  const g = fixture();
  await assert.rejects(ensureAlimamaLogin(g.page, store, g.identity, {
    inspect: async () => clean,
    login: async () => ({ attempted: false, submitted: false, reason: "saved_credentials_missing" }),
  }), /禁止自动重试/);
});
