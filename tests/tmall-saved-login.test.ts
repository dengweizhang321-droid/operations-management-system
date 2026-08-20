import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Frame, Page } from "playwright-core";

import { autoLoginTmallWithSavedBrowserCredentials } from "../tools/tmall-saved-login";

type Probe = {
  formFound: boolean;
  challengePresent: boolean;
  savedCredentialsReady: boolean;
  submitted: boolean;
  controlCount: number;
};

function fakePage(...probes: Probe[]): Pick<Page, "frames"> {
  return {
    frames: () => probes.map((probe) => ({
      evaluate: async () => probe,
    }) as unknown as Frame),
  };
}

test("天猫自动登录只提交 Chromium 已自动填充的保存密码", async () => {
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage({
    formFound: true,
    challengePresent: false,
    savedCredentialsReady: true,
    submitted: true,
    controlCount: 1,
  }), 0), {
    attempted: true,
    submitted: true,
    reason: "submitted",
  });

  const source = await readFile(new URL("../tools/tmall-saved-login.ts", import.meta.url), "utf8");
  assert.match(source, /:-webkit-autofill/);
  assert.doesNotMatch(source, /(?:account|password)\.value\b|TMALL_(?:USERNAME|PASSWORD)|credentials\.json/i);
  assert.doesNotMatch(source, /console\.(?:log|error).*password/i);
});

test("天猫自动登录遇到验证码、按钮歧义或缺少保存密码时失败关闭", async () => {
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage({
    formFound: true,
    challengePresent: true,
    savedCredentialsReady: true,
    submitted: false,
    controlCount: 1,
  }), 0), {
    attempted: false,
    submitted: false,
    reason: "challenge_present",
  });
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage({
    formFound: true,
    challengePresent: false,
    savedCredentialsReady: true,
    submitted: false,
    controlCount: 2,
  }), 0), {
    attempted: true,
    submitted: false,
    reason: "login_control_ambiguous",
  });
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage({
    formFound: true,
    challengePresent: false,
    savedCredentialsReady: false,
    submitted: false,
    controlCount: 0,
  }), 0), {
    attempted: false,
    submitted: false,
    reason: "saved_credentials_missing",
  });
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage({
    formFound: true,
    challengePresent: false,
    savedCredentialsReady: true,
    submitted: false,
    controlCount: 0,
  }), 0), {
    attempted: true,
    submitted: false,
    reason: "login_control_missing",
  });
  assert.deepEqual(await autoLoginTmallWithSavedBrowserCredentials(fakePage(
    {
      formFound: true,
      challengePresent: false,
      savedCredentialsReady: true,
      submitted: false,
      controlCount: 1,
    },
    {
      formFound: true,
      challengePresent: false,
      savedCredentialsReady: true,
      submitted: false,
      controlCount: 1,
    },
  ), 0), {
    attempted: true,
    submitted: false,
    reason: "login_control_ambiguous",
  });
});

test("n8n 的 A 节点先完成受控登录预检再生成目标日计划", async () => {
  const source = await readFile(new URL("../tools/tmall-sycm-cookie-pipeline.ts", import.meta.url), "utf8");
  const planBranch = source.slice(source.indexOf('request.url === "/plan"'), source.indexOf('request.url === "/fetch"'));
  assert.ok(planBranch.indexOf("ensureTmallStoreAuthenticatedSession") < planBranch.indexOf("planCommand"));
  assert.doesNotMatch(planBranch, /username|password|cookie\s*:/i);
});
