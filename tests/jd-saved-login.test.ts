import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Frame, Page } from "playwright-core";

import { autoLoginJdWithWindowsDpapiCredential, inspectJdLoginPageState } from "../tools/jd-saved-login";

function secureLoginPage(options: { challenge?: boolean; forms?: number; controls?: number } = {}) {
  const filled = { account: "", password: "", clicked: false };
  const frames = Array.from({ length: options.forms ?? 1 }, () => {
    const account = {
      isVisible: async () => true,
      fill: async (value: string) => { filled.account = value; },
    };
    const password = {
      isVisible: async () => true,
      fill: async (value: string) => { filled.password = value; },
    };
    const controls = Array.from({ length: options.controls ?? 1 }, () => ({
      isVisible: async () => true,
      textContent: async () => "登 录",
      getAttribute: async () => null,
      click: async () => { filled.clicked = true; },
    }));
    const collection = (items: unknown[]) => ({
      count: async () => items.length,
      nth: (index: number) => items[index],
    });
    return {
      evaluate: async () => ({
        challengePresent: Boolean(options.challenge),
        credentialRejected: false,
        temporarilyLocked: false,
      }),
      locator: (selector: string) => {
        if (selector.includes("#nloginpwd")) return collection([password]);
        if (selector.includes("#loginname")) return collection([account]);
        return collection(controls);
      },
    } as unknown as Frame;
  });
  return { page: { frames: () => frames } as unknown as Page, filled };
}

test("JD DPAPI login fills one unique form once and clears the in-memory credential", async () => {
  const { page, filled } = secureLoginPage();
  const credential = { username: "vault-account", password: "vault-password" };
  const result = await autoLoginJdWithWindowsDpapiCredential(page, "jd-yiyong-director", async () => credential);
  assert.deepEqual(result, { attempted: true, submitted: true, reason: "submitted" });
  assert.deepEqual(filled, { account: "vault-account", password: "vault-password", clicked: true });
  assert.deepEqual(credential, { username: "", password: "" });
});

test("JD DPAPI login fails closed before reading credentials for challenge or cross-frame ambiguity", async () => {
  let reads = 0;
  const challenged = secureLoginPage({ challenge: true });
  assert.deepEqual(await autoLoginJdWithWindowsDpapiCredential(
    challenged.page,
    "jd-yiyong-director",
    async () => { reads += 1; return { username: "unused", password: "unused" }; },
  ), { attempted: false, submitted: false, reason: "challenge_present" });
  assert.equal(reads, 0);
  assert.equal(challenged.filled.clicked, false);

  const ambiguous = secureLoginPage({ forms: 2 });
  assert.deepEqual(await autoLoginJdWithWindowsDpapiCredential(
    ambiguous.page,
    "jd-yiyong-director",
    async () => { reads += 1; return { username: "unused", password: "unused" }; },
  ), { attempted: false, submitted: false, reason: "login_control_ambiguous" });
  assert.equal(reads, 0);
});

test("JD login state combines challenge, credential rejection and lock signals without reading fields", async () => {
  const page = {
    frames: () => [{
      evaluate: async () => ({ challengePresent: true, credentialRejected: false, temporarilyLocked: false }),
    }, {
      evaluate: async () => ({ challengePresent: false, credentialRejected: true, temporarilyLocked: true }),
    }] as unknown as Frame[],
  } as Pick<Page, "frames">;
  assert.deepEqual(await inspectJdLoginPageState(page), {
    challengePresent: true,
    credentialRejected: true,
    temporarilyLocked: true,
  });
  const source = await readFile(new URL("../tools/jd-saved-login.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:account|password)\.value\b/);
});

test("JD DPAPI credentials never travel through n8n, environment variables, CLI secrets or logs", async () => {
  const credentialSource = await readFile(new URL("../tools/jd-secure-credential.ts", import.meta.url), "utf8");
  const vaultSource = await readFile(new URL("../tools/jd-credential-vault.ps1", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../automation/n8n/jd-multi-store-daily.workflow.json", import.meta.url), "utf8");
  assert.doesNotMatch(credentialSource, /process\.env|console\.|--(?:username|password)|JD_(?:USERNAME|PASSWORD)/i);
  assert.doesNotMatch(vaultSource, /Write-(?:Host|Output).*password|ConvertTo-SecureString[^\n]+-Key\b/i);
  assert.doesNotMatch(workflow, /--(?:username|password)|JD_(?:USERNAME|PASSWORD)|"credentials"\s*:/i);
  assert.match(vaultSource, /ProtectedData.*Protect/);
  assert.match(vaultSource, /DataProtectionScope.*CurrentUser/);
  assert.match(vaultSource, /ZeroFreeBSTR/);
});

test("both JD product flows authenticate before business identity or export actions", async () => {
  const ware = await readFile(new URL("../tools/jackyun-ware-export.ts", import.meta.url), "utf8");
  const daily = await readFile(new URL("../tools/jdsz-product-detail-export.ts", import.meta.url), "utf8");
  const wareOpen = ware.slice(ware.indexOf("async function openTargetPage"), ware.indexOf("async function dismissJdMenuUpdateNotice"));
  assert.match(wareOpen, /ensureJdStoreAuthenticatedSession/);
  assert.match(wareOpen, /loginMode === "windows_dpapi_credentials"\) return query/);
  const dailyRun = daily.slice(daily.indexOf("async function run()"), daily.indexOf("async function main()"));
  assert.ok(dailyRun.indexOf("ensureJdStoreAuthenticatedSession") < dailyRun.indexOf("readAndAssertJdProductDetailStoreIdentity"));
});
