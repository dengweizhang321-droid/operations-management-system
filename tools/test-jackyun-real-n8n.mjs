// Real n8n engine + immutable helper. Default stops after A; --complete uses
// synthetic exports/domain gateway for A-E, never real browser/business writes.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { stringify } from "flatted";
const root = process.cwd();
const completeFixture = process.argv.includes("--complete");
assert.notEqual(path.resolve(root).toLowerCase(), "d:\\运营管理系统");
const fixture = await mkdtemp(path.join(tmpdir(), "jackyun-real-n8n-")), mirror = path.join(fixture, "mirror"), user = path.join(fixture, "user");
for (const dir of [user, path.join(mirror, "config"), path.join(mirror, "outputs/jackyun-export-first"), path.join(mirror, "profile/Default")]) await mkdir(dir, { recursive: true });
await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "junction");
const port = async () => { const server = createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r)); const p = server.address().port; await new Promise(r => server.close(r)); return p; };
const n8nPort = await port(), helperPort = await port(), brokerPort = await port();
assert(![3000, 5791, 5678, 5432].includes(n8nPort) && ![3000, 5791, 5678, 5432].includes(helperPort));
const inherited = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
const env = { ...inherited, USERPROFILE: user, N8N_USER_FOLDER: user, APPDATA: path.join(fixture, "roaming"), LOCALAPPDATA: path.join(fixture, "local"),
  N8N_PORT: String(n8nPort), N8N_LISTEN_ADDRESS: "127.0.0.1", N8N_HOST: "127.0.0.1", N8N_PROTOCOL: "http", N8N_SECURE_COOKIE: "false",
  N8N_DIAGNOSTICS_ENABLED: "false", N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_PERSONALIZATION_ENABLED: "false", N8N_RUNNERS_BROKER_PORT: String(brokerPort),
  N8N_ENCRYPTION_KEY: randomBytes(32).toString("hex"), TERUISI_HELPER_MUTABLE_ROOT: mirror, TZ: "Asia/Shanghai",
  ...(process.argv.includes("--debug-startup") ? { N8N_LOG_LEVEL: "debug" } : {}) };
const cli = path.join(process.env.APPDATA, "npm/node_modules/n8n/bin/n8n");
const children = []; let engineOutput = "", helperOutput = "";
let gateway, gatewayPort, adapter;
const authority = { ok: true, version: "jackyun-human-retry-authority-v1", authorizationId: randomUUID(), workflowId: "J8kY2mQ5vR7sT4pN",
  kind: "retry", logicalExecutionId: "8548", failedExecutionId: "8548", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
const start = (args, extraEnv = {}) => { const child = spawn(process.execPath, args, { cwd: mirror, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child); return child; };
const base = `http://127.0.0.1:${n8nPort}`;
let cookie = "";
async function api(url, body) { console.log(JSON.stringify({ phase: "isolated_api", path: url }));
  const response = await fetch(base + url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }).catch(error => { throw new Error(`isolated API ${url}: ${error.name}`); });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const value = await response.json(); if (!response.ok) throw new Error(`isolated n8n ${url} rejected HTTP ${response.status}: ${JSON.stringify(value).slice(0, 400)}`); return value; }
async function startEngine() {
  const engine = start([cli, "start"]); engine.stdout.on("data", x => { engineOutput = (engineOutput + x).slice(-32000); }); engine.stderr.on("data", x => { engineOutput = (engineOutput + x).slice(-32000); });
  console.log(JSON.stringify({ phase: "starting_isolated_engine", fixture, n8nPort, helperPort, pid: engine.pid }));
  const deadline = Date.now() + 120000;
  let startupProbe = {};
  while (true) { try { const response = await fetch(base + "/healthz/readiness", { signal: AbortSignal.timeout(1000) }); if (response.ok) {
      const settings = await fetch(base + "/rest/settings", { signal: AbortSignal.timeout(1000) }); startupProbe = { readiness: response.status, settings: settings.status, settingsType: settings.headers.get("content-type") }; if (settings.ok && settings.headers.get("content-type")?.includes("application/json")) break;
    } } catch {}
    if (engine.exitCode !== null || Date.now() > deadline) throw new Error("isolated n8n startup failed: " + JSON.stringify(startupProbe)); await new Promise(r => setTimeout(r, 300)); }
  console.log(JSON.stringify({ phase: "isolated_engine_ready", fixture }));
  await api("/rest/owner/setup", { email: "fixture-owner@example.test", firstName: "Fixture", lastName: "Owner", password: "Aa1!" + randomBytes(20).toString("hex") });
}
try {
  const workflow = JSON.parse(await readFile(path.join(root, "automation/n8n/jackyun-five-dataset-api.workflow.json"), "utf8"));
  workflow.active = false; workflow.settings.errorWorkflow = undefined;
  workflow.nodes = workflow.nodes.filter(n => n.type !== "n8n-nodes-base.scheduleTrigger"); delete workflow.connections["每天本机时间 00:10"];
  for (const node of workflow.nodes) {
    if (node.parameters.url) node.parameters.url = node.parameters.url.replace("127.0.0.1:5791", `127.0.0.1:${helperPort}`);
    if (node.parameters.jsCode) node.parameters.jsCode = node.parameters.jsCode.replaceAll("127.0.0.1:5791", `127.0.0.1:${helperPort}`);
  }
  const stop = workflow.nodes.find(n => n.name === "B·接口校验与五表下载");
  if (completeFixture) {
    const { unifiedFixture } = await import(new URL("../tests/fixtures/jackyun-unified-recovery.ts", import.meta.url));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const shift = days => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
    adapter = await unifiedFixture(mirror, { captureDate: today, asOfDate: shift(-1), salesStartDate: shift(-45) });
    gateway = createHttpServer(async (req, res) => {
      try {
        const pieces = []; let size = 0;
        for await (const piece of req) { size += piece.length; if (size > 8 * 1024 * 1024) throw new Error("synthetic gateway request limit"); pieces.push(piece); }
        const body = Buffer.concat(pieces);
        if (req.url === `/api/imports/recovery/run?authorizationId=${authority.authorizationId}` && req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(authority)); return;
        }
        if (req.url === "/fixture/export") {
          const binding = JSON.parse(body.toString("utf8")); assert.equal(binding.runId, `n8n-export-first-${binding.executionId}`);
          const planPath = path.join(mirror, "outputs/jackyun-export-first", binding.runId + ".json");
          const plan = JSON.parse(await readFile(planPath, "utf8")); assert.equal(plan.phase, "exporting");
          adapter = await unifiedFixture(mirror, { captureDate: plan.runDate, asOfDate: plan.asOfDate, salesStartDate: plan.salesStartDate, eventStart: plan.createdAt });
          await adapter.deps.runApi({ runId: plan.runId, runDate: plan.runDate, asOfDate: plan.asOfDate, salesStartDate: plan.salesStartDate,
            outputRoot: path.join(mirror, "outputs/jackyun-import-runs"), eventRoot: path.join(mirror, "outputs/jackyun-browser-events"),
            downloadDirectory: path.join(mirror, "downloads"),
            afterModule: async module => {
              const order = ["products", "inventory", "inventory_age", "sales", "combos"], event = path.join(mirror, "outputs/jackyun-browser-events", plan.runId, `${String(order.indexOf(module) + 1).padStart(2, "0")}-${module}.json`);
              const eventBytes = await readFile(event), handoff = JSON.parse(eventBytes.toString("utf8")), bytes = await readFile(handoff.filePath);
              plan.exports[module] = { handoffSha256: createHash("sha256").update(eventBytes).digest("hex"), fileSha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
            } });
          plan.phase = "exported"; delete plan.exportIntent; await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, runId: plan.runId, phase: plan.phase })); return;
        }
        const response = await adapter.request("http://localhost:3000" + req.url, { method: req.method, headers: req.headers,
          ...(req.method !== "GET" ? { body } : {}) });
        res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text());
      } catch (error) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve)); gatewayPort = gateway.address().port;
    stop.type = "n8n-nodes-base.httpRequest"; stop.typeVersion = 4.2;
    stop.parameters = { method: "POST", url: `http://127.0.0.1:${gatewayPort}/fixture/export`, sendBody: true, specifyBody: "json",
      jsonBody: "={{ {executionId:String($execution.id),runId:$('A·固定采集日和销售日期').first().json.runId} }}", options: { timeout: 180000 } };
    stop.retryOnFail = false;
  } else { stop.type = "n8n-nodes-base.stopAndError"; stop.typeVersion = 1; stop.parameters = { errorMessage: "Synthetic fixture ends after actual A: zero browser/business actions" }; }
  const json = path.join(fixture, "workflow.json"); await writeFile(json, JSON.stringify(workflow));
  await promisify(execFile)(process.execPath, [cli, "import:workflow", `--input=${json}`], { cwd: mirror, env, windowsHide: true, timeout: 60000 });
  const now = Date.now(), time = n => new Date(now + n).toISOString(), sqltime = n => time(n).replace("T", " ").replace("Z", "");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const offsetDay = n => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const plan = { version: 2, protocol: "2026-09-06.export-first.1", executionId: "8548", runId: "n8n-export-first-8548", runDate: day, asOfDate: offsetDay(-1), salesStartDate: offsetDay(-45),
    baseUrl: "http://localhost:3000", createdAt: time(-125000), phase: "exporting", exports: {}, exportTransport: "session_api_v1" };
  const pipeline = path.join(mirror, "outputs/jackyun-export-first"), planBytes = JSON.stringify(plan);
  await writeFile(path.join(pipeline, plan.runId + ".json"), planBytes); await writeFile(path.join(pipeline, "active.json"), JSON.stringify({ executionId: "8548", runId: plan.runId }));
  await writeFile(path.join(mirror, "profile/Local State"), "{}"); await writeFile(path.join(mirror, "profile/Default/Cookies"), "synthetic-profile-marker");
  if (!completeFixture) await writeFile(path.join(mirror, "config/jackyun-export-first-policy.json"), JSON.stringify({ version: plan.protocol, browser: { downloadDirectory: path.join(mirror, "downloads"), allowedDownloadHosts: [], controller: { profileDirectory: path.join(mirror, "profile") } } }));
  await writeFile(path.join(mirror, "config/jackyun-login.json"), JSON.stringify({ version: "jackyun-dpapi-login-v1", tenantId: "fixture", profileDirectory: path.join(mirror, "profile"), debuggingPort: 24567, startUrl: "https://web.jackyun.com/home/mainframe_web_horizontal.html", initialWaitMs: 1000, afterSubmitWaitMs: 1000, commandTimeoutMs: 1000 }));
  const registry = JSON.parse(await readFile(path.join(root, "config/tmall-store-accounts.json"), "utf8"));
  for (const [i, store] of registry.stores.entries()) { store.loginMode = "manual"; store.browser = { executablePath: path.join(fixture, "NO-BROWSER.exe"), userDataDir: path.join(mirror, store.storeKey), profileName: "Default", profileDir: path.join(mirror, store.storeKey, "Default"), debugPort: 25000 + i, downloadDir: path.join(mirror, "downloads", store.storeKey) }; }
  await writeFile(path.join(mirror, "config/tmall-store-accounts.json"), JSON.stringify(registry));
  const db = new DatabaseSync(path.join(user, ".n8n/database.sqlite"));
  try {
    db.prepare("INSERT INTO execution_entity(id,workflowId,mode,status,startedAt,stoppedAt,finished) VALUES(?,?,?,?,?,?,?)").run(8548, workflow.id, "trigger", "error", sqltime(-130000), sqltime(-120000), 0);
    db.prepare("INSERT INTO execution_entity(id,workflowId,mode,status,startedAt,stoppedAt,finished) VALUES(?,?,?,?,?,?,?)").run(8555, workflow.id, "manual", "error", sqltime(-110000), sqltime(-105000), 0);
    const names = ["每天本机时间 00:10", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·接口校验与五表下载"];
    const oldNodes = Object.fromEntries(names.map(n => [n, []]));
    oldNodes["固定原执行计划时间"] = [{ executionStatus: "success", data: { main: [[{ json: { version: "teruisi-retry-context-v1", workflowId: workflow.id,
      executionId: "8548", originalExecutionId: "8548", scheduledAt: time(-130000) } }]] } }];
    const data = stringify({ resultData: { error: { description: "waiting_login：调试端口不属于本次启动的独立浏览器，已停止接管。", httpCode: "500",
      node: { parameters: { url: "http://127.0.0.1:5791/jackyun/export-first/export-all" } } }, runData: oldNodes, lastNodeExecuted: names[5] } });
    db.prepare("INSERT INTO execution_data(executionId,workflowData,data) VALUES(?,?,?)").run(8548, JSON.stringify(workflow), data);
  } finally { db.close(); }
  // Import and seed only while the synthetic database is offline. Running a
  // second n8n CLI/migration writer against the server's live SQLite pool can
  // invalidate its schema/connection state and obscures the routing under test.
  await startEngine();
  const shim = path.join(fixture, "api-seam.mjs");
  await writeFile(shim, completeFixture
    ? `const original=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(u.origin==='http://localhost:3000')return original('http://127.0.0.1:${gatewayPort}'+u.pathname+u.search,options);if(u.origin==='http://127.0.0.1:5678'&&u.pathname.startsWith('/webhook/'))return original('http://127.0.0.1:${n8nPort}'+u.pathname,options);if(u.hostname==='127.0.0.1'&&u.port==='${helperPort}')return original(input,options);throw new Error('Fixture forbids external/production network');};`
    : `const original=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(u.origin==='http://localhost:3000'){if(u.pathname==='/api/sales/data-health')return Response.json({ok:true});if(u.pathname==='/api/imports/recovery'){const m=u.searchParams.get('module');const scope=m==='sales'?{source:'sales_ledger',startDate:u.searchParams.get('startDate'),endDate:u.searchParams.get('endDate')}:m==='inventory'||m==='inventory_age'?{dataset:m==='inventory'?'stock':'age',snapshotDate:u.searchParams.get('snapshotDate')}:{source:m};return Response.json({ok:true,version:'import-recovery-query-v1',status:'ready',stateToken:'1'.repeat(64),rulesDigest:'9'.repeat(64),scope});}}if(u.hostname==='127.0.0.1'&&u.port==='${helperPort}')return original(input,options);throw new Error('Fixture forbids external/production network');};`);
  const bundle = path.join(fixture, "helper.mjs"); await promisify(execFile)(process.execPath, [path.join(root, "tools/build-worker-helper.mjs"), "--source-root", root, "--output", bundle], { cwd: root, env, windowsHide: true, timeout: 60000 });
  const helper = start(["--import", pathToFileURL(shim).href, bundle, "serve", "--port", String(helperPort)]);
  helper.stdout.on("data", x => { helperOutput = (helperOutput + x).slice(-16000); }); helper.stderr.on("data", x => { helperOutput = (helperOutput + x).slice(-16000); });
  const helperDeadline = Date.now() + 30000; while (!helperOutput.includes('"stage":"serve"')) { if (helper.exitCode !== null || Date.now() > helperDeadline) throw new Error("fixture helper startup failed"); await new Promise(r => setTimeout(r, 100)); }
  let id;
  if (completeFixture) {
    for (const query of ["logicalExecutionId=8548&logicalExecutionId=8548", "logicalExecutionId=wrong", "unknown=8548"]) {
      const rejected = await fetch(`http://127.0.0.1:${helperPort}/coordination/jackyun-recovery-target?${query}`);
      assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error, "invalid_recovery_target_query");
    }
    const original = await fetch(`http://127.0.0.1:${helperPort}/coordination/jackyun-recovery-target?logicalExecutionId=8548`).then(r => r.json());
    assert.equal(original.state, "failed"); assert.equal(original.originalScheduledAt, time(-130000));
    const saved = await api(`/rest/workflows/${workflow.id}`);
    await api(`/rest/workflows/${workflow.id}/activate`, { versionId: saved.data.versionId });
    const dispatched = await fetch(`http://127.0.0.1:${helperPort}/coordination/jackyun-recovery-dispatch`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ authorizationId: authority.authorizationId }) }).then(r => r.json());
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
    const reader = new DatabaseSync(path.join(user, ".n8n/database.sqlite"), { readOnly: true });
    try { id = String(reader.prepare("SELECT id FROM execution_entity WHERE workflowId=? AND id>8555 ORDER BY id DESC LIMIT 1").get(workflow.id)?.id); } finally { reader.close(); }
  } else {
    const started = await api(`/rest/workflows/${workflow.id}/run`, { triggerToStartFrom: { name: "手动运行" } });
    id = String(started.data?.executionId ?? started.executionId);
  }
  assert(/^[1-9]\d*$/.test(id));
  let observed;
  for (let i = 0; i < (completeFixture ? 600 : 120); i++) { const reader = new DatabaseSync(path.join(user, ".n8n/database.sqlite"), { readOnly: true }); try { observed = reader.prepare("SELECT status,mode FROM execution_entity WHERE id=?").get(id); } finally { reader.close(); }
    if (["error", "success"].includes(observed?.status)) break; await new Promise(r => setTimeout(r, 300)); }
  assert.equal(observed?.status, completeFixture ? "success" : "error"); assert.equal(observed?.mode, completeFixture ? "webhook" : "manual");
  const active = JSON.parse(await readFile(path.join(pipeline, "active.json"), "utf8")); assert.equal(active.executionId, id);
  assert.equal(await readFile(path.join(pipeline, plan.runId + ".json"), "utf8"), planBytes);
  const receipt = JSON.parse(await readFile(path.join(pipeline, "preflight-closures/n8n-export-first-8548.json"), "utf8")); assert.equal(receipt.replacementExecutionId, id);
  if (completeFixture) {
    assert.deepEqual(Object.values(adapter.completes), [1, 1, 1, 1, 1]); assert.equal(adapter.verified.size, 5);
    const current = JSON.parse(await readFile(path.join(pipeline, `n8n-export-first-${id}.json`), "utf8")); assert.equal(current.phase, "completed");
    const target = await fetch(`http://127.0.0.1:${helperPort}/coordination/jackyun-recovery-target?logicalExecutionId=8548`).then(response => response.json());
    assert.equal(target.state, "completed"); assert.equal(target.logicalExecutionId, "8548"); assert.equal(target.failedExecutionId, id);
    assert.equal(target.originalScheduledAt, time(-130000));
  }
  const result = { ok: true, engine: "real n8n", helper: "real bundled routing", fixture, executionId: id, stoppedDeliberatelyAfterA: !completeFixture, source8548Unchanged: true,
    browserActions: 0, exports: 0, productionImports: 0, notifications: 0,
    ...(completeFixture ? { syntheticGateway: true, syntheticImportedModules: adapter.completes, exactVerifiedModules: [...adapter.verified], completedAE: true } : { imports: 0 }),
    helperSha256: createHash("sha256").update(await readFile(bundle)).digest("hex") };
  await writeFile(path.join(fixture, "RESULT.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await writeFile(path.join(fixture, "engine.log"), engineOutput); await writeFile(path.join(fixture, "helper.log"), helperOutput); throw error; }
finally { if (gateway) await new Promise(resolve => gateway.close(resolve)); for (const child of children.reverse()) { if (child.exitCode === null) { const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited; } } }
