import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright-core";
import { assertJackyunBrowserIdentity, inspectJackyunLoginSurface, isJackyunLoginOrigin, submitJackyunDpapiLogin, waitForJackyunDpapiSession, resolveJackyunChromiumExecutable, type JackyunLoginSurface } from "../lib/jackyun/dpapi-login";
import { assertJackyunLoginConfig, invokeJackyunVault, windowsPowerShellEnvironment, type JackyunLoginConfig } from "../lib/jackyun/windows-dpapi";
import { jackyunDpapiProgram } from "../lib/jackyun/dpapi-program";

const config: JackyunLoginConfig = { version: 1, loginMode: "windows_dpapi_credentials", tenantId: "771168",
  profileDirectory: "D:\\test profiles\\jackyun", debuggingPort: 19223, initialWaitMs: 1000, afterSubmitWaitMs: 1000 };

function sessionHarness(surfaces: JackyunLoginSurface[]) {
  let now = 0;
  let submits = 0;
  const sequence = [...surfaces];
  return { deps: { inspect: async () => sequence.length > 1 ? sequence.shift()! : sequence[0],
    submit: async () => { submits++; }, initialWaitMs: 1000, afterSubmitWaitMs: 1000,
    now: () => now, sleep: async (ms: number) => { now += ms; } }, submits: () => submits };
}

test("DPAPI config and site binding reject invalid modes, ports and lookalike hosts", () => {
  assert.equal(assertJackyunLoginConfig(config), config);
  for (const patch of [{ loginMode: "manual" }, { tenantId: "unknown" }, { debuggingPort: 0 }, { profileDirectory: "relative" }]) {
    assert.throws(() => assertJackyunLoginConfig({ ...config, ...patch } as JackyunLoginConfig));
  }
  assert.equal(isJackyunLoginOrigin("https://web.jackyun.com/login/login_web.html"), true);
  for (const url of ["http://web.jackyun.com", "https://web.jackyun.com.evil.test", "https://jackyun.com", "about:blank"]) {
    assert.equal(isJackyunLoginOrigin(url), false);
  }
  assert.ok(Buffer.from(jackyunDpapiProgram, "utf16le").toString("base64").length < 30000);
});

test("browser process must match the Windows owner, executable, profile and exact unique port flags", () => {
  const expected = { chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", profileDirectory: config.profileDirectory, port: 19223 };
  const identity = { executablePath: expected.chromePath, ownedByCurrentUser: true,
    commandLine: `"${expected.chromePath}" --remote-debugging-port=19223 "--user-data-dir=${config.profileDirectory}"` };
  assert.doesNotThrow(() => assertJackyunBrowserIdentity(identity, expected));
  for (const patch of [{ ownedByCurrentUser: false }, { executablePath: "C:\\other.exe" },
    { commandLine: identity.commandLine.replace("19223", "9223") },
    { commandLine: identity.commandLine + " --remote-debugging-port=19223" },
    { commandLine: identity.commandLine.replace("test profiles", "another profile") }]) {
    assert.throws(() => assertJackyunBrowserIdentity({ ...identity, ...patch }, expected));
  }
});

test("scheduled API login requires independent Chromium and an unambiguous headless process", () => {
  const executable = resolveJackyunChromiumExecutable("C:\\Users\\fixture user\\AppData\\Local");
  assert.equal(executable, "C:\\Users\\fixture user\\AppData\\Local\\Chromium\\Application\\chrome.exe");
  for (const root of ["", "relative", "\\\\remote\\profile", "C:relative"]) {
    assert.throws(() => resolveJackyunChromiumExecutable(root));
  }
  const expected = { chromePath: executable, profileDirectory: config.profileDirectory, port: 19223, headless: true as const };
  const identity = { executablePath: executable, ownedByCurrentUser: true,
    commandLine: `"${executable}" --remote-debugging-port=19223 "--user-data-dir=${config.profileDirectory}"` };
  assert.doesNotThrow(() => assertJackyunBrowserIdentity({ ...identity, commandLine: identity.commandLine + " --headless=new" }, expected));
  for (const flags of ["", " --headless", " --headless=false", " --headless=old", " --headless=new --headless=new", " --headless=new --headless=false"]) {
    assert.throws(() => assertJackyunBrowserIdentity({ ...identity, commandLine: identity.commandLine + flags }, expected));
  }
  assert.throws(() => assertJackyunBrowserIdentity({ ...identity, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    commandLine: identity.commandLine + " --headless=new" }, expected));
});

test("initial loading waits for an actual login page and a successful tenant shell", async () => {
  const h = sessionHarness([{ phase: "pending" }, { phase: "login" }, { phase: "pending" }, { phase: "authenticated" }]);
  assert.equal((await waitForJackyunDpapiSession(h.deps)).authentication, "windows_dpapi_credentials");
  assert.equal(h.submits(), 1);
});

test("existing session and read-only probes never decrypt or submit", async () => {
  for (const phase of ["authenticated", "login"] as const) {
    const h = sessionHarness([{ phase }]);
    await waitForJackyunDpapiSession({ ...h.deps, readOnly: true });
    assert.equal(h.submits(), 0);
  }
});

test("unknown pages time out and a submitted login is never retried", async () => {
  for (const phase of ["pending", "login"] as const) {
    const h = sessionHarness([{ phase }]);
    await assert.rejects(waitForJackyunDpapiSession(h.deps), /限定时间/);
    assert.equal(h.submits(), phase === "login" ? 1 : 0);
  }
});

test("wrong tenant, challenges, rejected credentials and uncertain submission stop immediately", async () => {
  for (const reason of ["tenant_mismatch", "challenge_present", "credential_rejected", "form_ambiguous"]) {
    const h = sessionHarness([{ phase: "blocked", reason }]);
    await assert.rejects(waitForJackyunDpapiSession(h.deps));
    assert.equal(h.submits(), 0);
  }
  const h = sessionHarness([{ phase: "login" }]);
  let attempts = 0;
  await assert.rejects(waitForJackyunDpapiSession({ ...h.deps, submit: async () => { attempts++; throw new Error("uncertain"); } }));
  assert.equal(attempts, 1);
});

test("aborted login cannot consume a credential", async () => {
  const h = sessionHarness([{ phase: "login" }]);
  await assert.rejects(waitForJackyunDpapiSession({ ...h.deps, signal: AbortSignal.abort() }), /取消/);
  assert.equal(h.submits(), 0);
});

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
test("observed Jackyun three-field DOM, hidden recovery forms, tenant gate and error redaction", {
  skip: process.platform !== "win32" || !existsSync(chromePath), timeout: 30000,
}, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    // All requests are fulfilled locally; this fixture never connects to Jackyun.
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
      <input id="selAccount" placeholder="请输入或选择吉客号">
      <input id="txtUserName" placeholder="请输入手机号或工号">
      <input id="txtPwd" type="password" placeholder="请输入密码">
      <input id="btnLogin" type="button" value="登 录">
      <div hidden><input type="password"><input placeholder="请输入验证码"></div>
      <script>document.querySelector('#btnLogin').onclick=()=>{document.body.dataset.submitted='yes'}</script></body>` }));
    await page.goto("https://web.jackyun.com/login/login_web.html");
    assert.equal((await inspectJackyunLoginSurface(page, config.tenantId)).phase, "login");
    const fake = { username: "fixture-user", password: "fixture-not-real-password" };
    await submitJackyunDpapiLogin(page, config, async () => fake);
    assert.deepEqual(fake, { username: "", password: "" });
    assert.equal(await page.locator("body").getAttribute("data-submitted"), "yes");
    assert.equal(await page.locator("#selAccount").inputValue(), config.tenantId);
    await page.locator("body").evaluate(el => { el.insertAdjacentHTML("beforeend", '<input type="password">'); });
    let loads = 0;
    await assert.rejects(submitJackyunDpapiLogin(page, config, async () => { loads++; return { username: "x", password: "y" }; }));
    assert.equal(loads, 0);
    await page.setContent('<span id="jlink-sn">123456</span><ul id="J-menu"><li>货品</li></ul>');
    assert.equal((await inspectJackyunLoginSurface(page, config.tenantId)).reason, "tenant_mismatch");
    await page.setContent('<span id="jlink-sn">771168</span><ul id="J-menu"><li>货品</li></ul>');
    assert.equal((await inspectJackyunLoginSurface(page, config.tenantId)).phase, "authenticated");
    await page.goto("https://web.jackyun.com/login/login_web.html");
    const stale = { username: "fixture-user", password: "fixture-not-real-password" };
    await assert.rejects(submitJackyunDpapiLogin(page, config, async () => {
      await page.goto("https://lookalike.invalid/");
      return stale;
    }), error => {
      assert.doesNotMatch(String(error), /fixture-user|fixture-not-real-password/);
      return true;
    });
    assert.deepEqual(stale, { username: "", password: "" });
  } finally { await browser.close(); }
});

test("Windows DPAPI roundtrip rejects copied bindings, corrupted ciphertext and exposed ACLs", {
  skip: process.platform !== "win32", timeout: 60000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-dpapi-fixture-"));
  const exposedRoot = await mkdtemp(path.join(tmpdir(), "jackyun-dpapi-fixture-"));
  const binding = `TERUISI-JACKYUN:v1:${config.tenantId}:${config.profileDirectory.toLowerCase()}`;
  const key = createHash("sha256").update(binding).digest("hex");
  const fixture = String.raw`
    $ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security
    $r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    Set-Acl -LiteralPath $r.root -AclObject $acl
    $plain=@{tenantId=$r.tenant;profile=$r.profile;username='fixture-user';password='fixture-password'}|ConvertTo-Json -Compress
    $cipher=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($plain),[Text.Encoding]::UTF8.GetBytes($r.binding),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    @{version=1;binding=$r.key;ciphertext=[Convert]::ToBase64String($cipher)}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $r.root ($r.key+'.json')) -Encoding UTF8
  `;
  const environment = windowsPowerShellEnvironment();
  try {
    const prepared = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(fixture, "utf16le").toString("base64")], {
      input: JSON.stringify({ root, tenant: config.tenantId, profile: config.profileDirectory.toLowerCase(), binding, key }),
      windowsHide: true, env: environment, timeout: 15000,
    });
    assert.equal(prepared.status, 0, prepared.stderr.toString().slice(0, 3000));
    assert.equal(JSON.parse(await invokeJackyunVault("status", config, root)).ready, true);
    assert.deepEqual(JSON.parse(await invokeJackyunVault("read", config, root)), { username: "fixture-user", password: "fixture-password" });
    const file = path.join(root, `${key}.json`);
    const bytes = await readFile(file, "utf8");
    assert.doesNotMatch(bytes, /fixture-user|fixture-password/);
    const wrong = { ...config, tenantId: "999999" };
    const wrongKey = createHash("sha256").update(`TERUISI-JACKYUN:v1:999999:${config.profileDirectory.toLowerCase()}`).digest("hex");
    await writeFile(path.join(root, `${wrongKey}.json`), JSON.stringify({ ...JSON.parse(bytes.replace(/^\uFEFF/, "")), binding: wrongKey }));
    await assert.rejects(invokeJackyunVault("read", wrong, root), /waiting_login/);
    await writeFile(file, JSON.stringify({ version: 1, binding: key, ciphertext: "corrupt" }));
    await assert.rejects(invokeJackyunVault("read", config, root), /waiting_login/);
    await writeFile(file, bytes);
    // Copying otherwise-valid ciphertext into a directory with inherited ACLs
    // must be refused, even though DPAPI itself would still decrypt it.
    await writeFile(path.join(exposedRoot, `${key}.json`), bytes);
    await assert.rejects(invokeJackyunVault("read", config, exposedRoot), /waiting_login/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("jackyun-dpapi-fixture-"));
    await rm(root, { recursive: true, force: true });
    assert.ok(path.resolve(exposedRoot).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(exposedRoot).startsWith("jackyun-dpapi-fixture-"));
    await rm(exposedRoot, { recursive: true, force: true });
  }
});
