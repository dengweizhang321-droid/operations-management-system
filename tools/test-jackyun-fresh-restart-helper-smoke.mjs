// Private mutable root, SQLite, DPAPI vault and HTTP gateway only. The actual
// bundled slot/authority/n8n/A-E code runs; only the export transport is replaced
// at its existing runApiExports boundary. No real browser or business endpoint.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { freshRestartFixture } from "../tests/fixtures/jackyun-fresh-restart.ts";
import { createPrivateJackyunVault, substituteKnownFolder } from "../tests/fixtures/jackyun-private-vault.mjs";

assert.equal(process.platform, "win32");
const sourceRoot = process.cwd(), nativeFetch = globalThis.fetch, callbacks = [];
const captureDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = offset => new Date(Date.parse(captureDate + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const fixtureOptions = { captureDate, asOfDate: day(-1), salesStartDate: day(-45), eventStart: new Date(Date.now() - 600000).toISOString() };
const x = await freshRestartFixture({ after: fn => callbacks.push(fn) }, fixtureOptions);
globalThis.fetch = nativeFetch; x.proceed();
const root = x.root, temp = path.join(root, "smoke"), user = path.join(temp, "user"), profile = path.join(root, "profile"), vault = path.join(temp, "known-folder");
for (const dir of [temp, path.join(user, ".n8n"), path.join(profile, "Default")]) await mkdir(dir, { recursive: true });
await symlink(path.join(sourceRoot, "node_modules"), path.join(temp, "node_modules"), "junction");
await writeFile(path.join(profile, "Local State"), "{}");
const login = { version: 1, loginMode: "windows_dpapi_credentials", tenantId: "999993", profileDirectory: profile, debuggingPort: 29225, initialWaitMs: 1000, afterSubmitWaitMs: 1000 };
await createPrivateJackyunVault(vault, login); await writeFile(path.join(root, "config/jackyun-login.json"), JSON.stringify(login));
const registry = JSON.parse(await readFile(path.join(sourceRoot, "config/tmall-store-accounts.json"), "utf8"));
for (const [i, store] of registry.stores.entries()) {
  store.loginMode = "manual";
  store.browser = { executablePath: path.join(temp, "NO-BROWSER.exe"), userDataDir: path.join(root, store.storeKey), profileName: "Default", profileDir: path.join(root, store.storeKey, "Default"), debugPort: 25000 + i, downloadDir: path.join(root, "downloads", store.storeKey) };
}
await writeFile(path.join(root, "config/tmall-store-accounts.json"), JSON.stringify(registry));
const authority = x.f.deps.humanAuthority.authority;
const gateway = createServer(async (req, res) => {
  try {
    const parts = []; for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts);
    let response;
    if (req.url.startsWith("/api/imports/recovery/run?")) {
      assert.equal(new URL(req.url, "http://localhost").searchParams.get("authorizationId"), authority.authorizationId);
      response = Response.json(authority);
    } else response = await x.f.deps.request(`http://localhost:3000${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body: body.toString("utf8") } : {}) });
    res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text());
  } catch (error) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve)); const gatewayPort = gateway.address().port;
const database = path.join(user, ".n8n/database.sqlite"), db = new DatabaseSync(database);
db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT); CREATE TABLE execution_data(executionId INTEGER,data TEXT,workflowData TEXT)");
function pack(value) {
  const pool = [null];
  const encode = x => typeof x === "string" ? String(pool.push(x) - 1) : Array.isArray(x) ? x.map(encode) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encode(v)])) : x;
  pool[0] = encode(value); return JSON.stringify(pool);
}
const iso = offset => new Date(Date.now() + offset).toISOString(), sqlite = offset => iso(offset).replace("T", " ").replace("Z", "");
const definition = JSON.stringify({ id: "J8kY2mQ5vR7sT4pN", meta: { jackyunRecovery: "jackyun-recovery-control-v1" } });
const data = new Map();
for (const id of ["9000", "9001"]) {
  const source = id === "9000", node = source ? "D·统一导入运营管理系统" : "A·固定采集日和销售日期";
  const runData = source ? Object.fromEntries(["A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练"].map(n => [n, [{ executionStatus: "success" }]])) : {};
  runData[node] = [{ executionStatus: "error", error: { description: source ? "synthetic controlled warehouse rejection" : "JACKYUN_RULES_CHANGED_MANUAL_ACTION" } }];
  const value = pack({ resultData: { lastNodeExecuted: node, runData, error: { description: source ? "synthetic controlled warehouse rejection" : "JACKYUN_RULES_CHANGED_MANUAL_ACTION", httpCode: "500", node: { parameters: { url: `http://127.0.0.1:5791/jackyun/export-first/${source ? "import" : "plan-api"}` } } } } });
  data.set(id, value);
  db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)").run(id, "J8kY2mQ5vR7sT4pN", "error", "webhook", sqlite(-500000), sqlite(-400000), null, null);
  db.prepare("INSERT INTO execution_data VALUES(?,?,?)").run(id, value, definition);
}
const recovery = { version: "jackyun-recovery-control-v1", kind: "new" };
const anchor = { executionStatus: "success", data: { main: [[{ json: { executionId: "9002", workflowId: "J8kY2mQ5vR7sT4pN", jackyunRecovery: recovery, humanAuthorizationId: authority.authorizationId } }]] } };
const current = { resultData: { runData: { "固定原执行计划时间": [anchor] } } };
db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)").run(9002, "J8kY2mQ5vR7sT4pN", "running", "webhook", sqlite(-1000), null, null, null);
db.prepare("INSERT INTO execution_data VALUES(?,?,?)").run(9002, pack(current), definition); db.close();
const shim = path.join(temp, "synthetic-boundaries.mjs"), bundle = path.join(temp, "helper.mjs");
await writeFile(shim, `import {unifiedFixture} from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "tests/fixtures/jackyun-unified-recovery.ts")).href)};
const native=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(u.origin==='http://localhost:3000')return native('http://127.0.0.1:${gatewayPort}'+u.pathname+u.search,options);throw new Error('Private smoke blocks all real network');};
globalThis.__freshSyntheticExports=async options=>{const f=await unifiedFixture(${JSON.stringify(root)},${JSON.stringify({ captureDate, asOfDate: day(-1), salesStartDate: day(-45) }).slice(0, -1)} ,eventStart:new Date().toISOString()});return f.deps.runApi(options);};`);
await promisify(execFile)(process.execPath, ["tools/build-worker-helper.mjs", "--source-root", sourceRoot, "--output", bundle], { cwd: sourceRoot, windowsHide: true, timeout: 120000 });
let code = substituteKnownFolder(await readFile(bundle, "utf8"));
const signature = "async function runApiExports(options, deps = {}) {";
assert.equal(code.split(signature).length, 2, "exact single export boundary");
code = code.replace(signature, signature + " return globalThis.__freshSyntheticExports(options);"); await writeFile(bundle, code);
const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { USERPROFILE: user, LOCALAPPDATA: path.join(temp, "local"), APPDATA: path.join(temp, "roaming"), TERUISI_HELPER_MUTABLE_ROOT: root, TERUISI_TEST_KNOWN_FOLDER: vault });
const reserve = createServer(); await new Promise(r => reserve.listen(0, "127.0.0.1", r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(sourceRoot, "node_modules/tsx/dist/loader.mjs")).href, "--import", pathToFileURL(shim).href, bundle, "serve", "--port", String(port)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "", diagnostics = ""; child.stdout.on("data", b => { output = (output + b).slice(-16000); }); child.stderr.on("data", b => { diagnostics = (diagnostics + b).slice(-16000); }); const exited = new Promise(r => child.once("exit", r));
async function call(route, id = "9002", auth = true) {
  const response = await nativeFetch(`http://127.0.0.1:${port}${route}`, { method: route === "/health" ? "GET" : "POST", headers: {
    "X-TERUISI-WORKFLOW-KEY": "jackyun", "X-TERUISI-N8N-EXECUTION-ID": id, "x-teruisi-jackyun-recovery": JSON.stringify(recovery),
    ...(auth ? { "x-teruisi-jackyun-human-authority-id": authority.authorizationId } : {}) }, signal: AbortSignal.timeout(120000) });
  return { status: response.status, body: await response.json() };
}
const results = [];
try {
  const deadline = Date.now() + 45000;
  while (!output.includes('"stage":"serve"')) { if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Private fresh helper startup failed ${diagnostics}`); await new Promise(r => setTimeout(r, 100)); }
  assert.equal((await call("/coordination/claim")).body.coordinationStatus, "granted");
  const a = await call("/jackyun/export-first/plan-api"); assert.equal(a.status, 200, JSON.stringify(a.body)); results.push("A");
  const replayA = await call("/jackyun/export-first/plan-api"); assert.equal(replayA.status, 200, JSON.stringify(replayA.body)); assert.equal(replayA.body.runId, a.body.runId);
  current.resultData.runData["A·固定采集日和销售日期"] = [{ executionStatus: "success", data: { main: [[{ json: a.body }]] } }];
  const writable = new DatabaseSync(database); writable.prepare("UPDATE execution_data SET data=? WHERE executionId=9002").run(pack(current)); writable.close();
  for (const [letter, action] of [["B", "export-all"], ["C", "validate"], ["D", "import"], ["E", "verify"]]) {
    const result = await call(`/jackyun/export-first/${action}`); assert.equal(result.status, 200, JSON.stringify(result.body)); results.push(letter);
    if (letter === "E") assert.equal(result.body.phase, "completed");
  }
  const active = await readFile(path.join(x.pipeline, "active.json"));
  for (const id of ["9000", "9001"]) for (const action of ["plan-api", "export-all", "validate", "import", "verify"]) {
    const result = await call(`/jackyun/export-first/${action}`, id); assert.equal(result.status, 409, JSON.stringify(result.body));
  }
  assert.deepEqual(await readFile(path.join(x.pipeline, "active.json")), active);
  const checked = new DatabaseSync(database, { readOnly: true }); for (const [id, bytes] of data) assert.equal(checked.prepare("SELECT data FROM execution_data WHERE executionId=?").get(id).data, bytes); checked.close();
  console.log(JSON.stringify({ ok: true, realBundledHelper: true, results, sameSlotAuthorityPropagated: true, runningSameIdAReplay: true, oldRoutesRejectedBySlotIdentity: true,
    oldN8nRowsUnchanged: true, productionNetworkCalls: 0, browserBoundary: "synthetic runApiExports", evidence: root, helperSha256: createHash("sha256").update(await readFile(bundle)).digest("hex") }));
} finally { child.kill(); await exited; await new Promise(r => gateway.close(r)); for (const callback of callbacks) callback(); }
