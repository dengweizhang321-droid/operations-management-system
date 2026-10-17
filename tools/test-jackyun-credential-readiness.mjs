import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createPrivateJackyunVault, substituteKnownFolder } from "../tests/fixtures/jackyun-private-vault.mjs";

if (process.platform !== "win32") throw new Error("Windows fixture required");
const sourceRoot = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "jackyun-credential-readiness-"));
const root = path.join(temp, "mirror"), base = path.join(temp, "known-folder");
for (const dir of ["config", "profile/Default", "outputs"]) await mkdir(path.join(root, dir), { recursive: true });
await writeFile(path.join(root, "profile/Local State"), "{}");
await symlink(path.join(sourceRoot, "node_modules"), path.join(temp, "node_modules"), "junction");
const config = { version: 1, loginMode: "windows_dpapi_credentials", tenantId: "999991",
  profileDirectory: path.join(root, "profile"), debuggingPort: 29223, initialWaitMs: 1000, afterSubmitWaitMs: 1000 };
const vault = await createPrivateJackyunVault(base, config);
await writeFile(path.join(root, "config/jackyun-login.json"), JSON.stringify(config));
const registry = JSON.parse(await readFile(path.join(sourceRoot, "config/tmall-store-accounts.json"), "utf8"));
for (const [i, store] of registry.stores.entries()) {
  store.loginMode = "manual";
  store.browser = { executablePath: path.join(temp, "NO-BROWSER.exe"), userDataDir: path.join(root, store.storeKey), profileName: "Default",
    profileDir: path.join(root, store.storeKey, "Default"), debugPort: 25000 + i, downloadDir: path.join(root, "downloads", store.storeKey) };
}
await writeFile(path.join(root, "config/tmall-store-accounts.json"), JSON.stringify(registry));
await writeFile(path.join(root, "config/jackyun-export-first-policy.json"), JSON.stringify({ version: "2026-09-06.export-first.1",
  browser: { downloadDirectory: path.join(root, "downloads"), allowedDownloadHosts: [], controller: { profileDirectory: config.profileDirectory } } }));
const user = path.join(temp, "user"); await mkdir(path.join(user, ".n8n"), { recursive: true });
const database = path.join(user, ".n8n/database.sqlite"), db = new DatabaseSync(database);
db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT); CREATE TABLE execution_data(executionId INTEGER,data TEXT,workflowData TEXT)");
for (const id of [99001, 99002]) {
  db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)").run(id, "J8kY2mQ5vR7sT4pN", "running", "trigger", new Date().toISOString().replace('T',' ').replace('Z',''), null, null, null);
  db.prepare("INSERT INTO execution_data VALUES(?,?,?)").run(id, JSON.stringify([{ resultData: "1" }, { runData: "2" }, {}]), JSON.stringify({id:"J8kY2mQ5vR7sT4pN"}));
}
db.close(); const originalDatabase = await readFile(database);
const original = path.join(temp, "original.mjs"), bundle = path.join(temp, "helper.mjs");
await promisify(execFile)(process.execPath, ["tools/build-worker-helper.mjs", "--source-root", sourceRoot, "--output", original], { windowsHide: true, timeout: 120000 });
await writeFile(bundle, substituteKnownFolder(await readFile(original, "utf8")));
const shim = path.join(temp, "network-boundary.mjs");
await writeFile(shim, `const real=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(u.href==='http://localhost:3000/api/sales/data-health')return Response.json({status:'available'});throw new Error('Fixture disallows business network');};`);
const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { USERPROFILE: user, APPDATA: path.join(temp, "roaming"), LOCALAPPDATA: path.join(temp, "WRONG-ENV-DIRECTORY"),
  TERUISI_HELPER_MUTABLE_ROOT: root, TERUISI_TEST_KNOWN_FOLDER: base });
async function start() {
  const reserve = createServer(); await new Promise(r => reserve.listen(0, "127.0.0.1", r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const child = spawn(process.execPath, ["--import", pathToFileURL(shim).href, bundle, "serve", "--port", String(port)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", b => { output = (output + b).slice(-16000); }); child.stderr.resume();
  const exited = new Promise(r => child.once("exit", r));
  const call = async (route, id = "99001") => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: route === "/health" ? "GET" : "POST",
      headers: { "X-TERUISI-WORKFLOW-KEY": "jackyun", "X-TERUISI-N8N-EXECUTION-ID": id }, signal: AbortSignal.timeout(30000) });
    return { status: response.status, body: await response.json() };
  };
  const deadline = Date.now() + 30000;
  try {
    while (!output.includes('"stage":"serve"')) { if (child.exitCode !== null || Date.now() > deadline) throw new Error("Fixture helper startup failed"); await new Promise(r => setTimeout(r, 100)); }
    let health;
    do { health = (await call("/health")).body; if (health.jackyunCredential.state !== "checking") break; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < deadline);
    return { call, health, stop: async () => { child.kill(); await exited; } };
  } catch (error) { child.kill(); await exited; throw error; }
}
const results = [];
for (let restart = 0; restart < 2; restart++) {
  const helper = await start();
  try {
    assert.equal(helper.health.jackyunCredential.state, "ready"); assert.equal(helper.health.jackyunCredential.context, "isolated_worker");
    assert.equal(helper.health.busy, false); assert.deepEqual(helper.health.storeExecutions, []);
    assert.doesNotMatch(JSON.stringify(helper.health.jackyunCredential), /fixture-user|fixture-only-password|vaultRoot|tenantId|profileDirectory|S-1-/);
    if (restart === 1) {
      assert.equal((await helper.call("/coordination/claim")).body.coordinationStatus, "granted");
      const plan = await helper.call("/jackyun/export-first/plan-api");
      assert.equal(plan.status, 200, JSON.stringify(plan.body));
      assert.equal(plan.body.runId, "n8n-export-first-99001");
    }
    results.push({ restart, startup: "ready", wrongInheritedPath: "ignored", actualBusinessWorker: restart === 1 });
  } finally { await helper.stop(); }
}
// A fresh check in the business worker must catch damage after the cached
// startup success; no second plan, browser, export, or import may be produced.
const helper = await start();
try {
  assert.equal(helper.health.jackyunCredential.state, "ready");
  const file = path.join(vault, (await readdir(vault)).find(name => name.endsWith(".json")));
  const bytes = await readFile(file);
  await writeFile(file, "{}");
  assert.equal((await helper.call("/coordination/claim", "99002")).body.coordinationStatus, "granted");
  const denied = await helper.call("/jackyun/export-first/plan-api", "99002");
  assert.equal(denied.status, 500); assert.match(JSON.stringify(denied.body), /凭据仍未就绪/);
  await assert.rejects(readFile(path.join(root, "outputs/jackyun-export-first/n8n-export-first-99002.json")), /ENOENT/);
  await writeFile(file, bytes);
  results.push({ freshARecheck: "blocked_after_startup", secondPlanCreated: false });
} finally { await helper.stop(); }
env.TERUISI_TEST_KNOWN_FOLDER = path.join(temp, "absent-known-folder");
const absent = await start();
try { assert.equal(absent.health.jackyunCredential.state, "blocked"); assert.equal(absent.health.jackyunCredential.reason, "missing"); assert.equal(absent.health.ok, true); }
finally { await absent.stop(); }
assert.deepEqual(await readFile(database), originalDatabase);
await assert.rejects(readdir(path.join(root, "downloads")), /ENOENT/);
console.log(JSON.stringify({ ok: true, results, missingVaultBlocksOnlyJackyun: true, syntheticN8nUnchanged: true,
  businessExports: 0, businessImports: 0, nativeKnownFolderBoundarySubstituted: true, evidence: temp }));
