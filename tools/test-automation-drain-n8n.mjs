// Real installed n8n engine, independent SQLite/user folder, synthetic loopback
// endpoints only. Never imports/publishes into the production instance.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync } from "node:fs";
import { withMaintenanceCoordination, anchorNodeName } from "./n8n-maintenance-coordination.mjs";
import { buildHourlyRetryErrorWorkflow } from "./n8n-hourly-retry-policy.mjs";

const workspace = fileURLToPath(new URL("..", import.meta.url));
assert.notEqual(path.resolve(workspace).toLowerCase(), "d:\\运营管理系统");
const n8nRoot = process.argv[2];
assert.ok(n8nRoot && path.isAbsolute(n8nRoot));
const require = createRequire(path.join(n8nRoot, "package.json"));
const flatted = require("flatted");
await mkdir(path.join(workspace, ".codex-tmp"), { recursive: true });
const root = await mkdtemp(path.join(workspace, ".codex-tmp", "drain-n8n-"));
await mkdir(path.join(root, ".n8n"));
const database = path.join(root, ".n8n", "database.sqlite");
const cli = path.join(n8nRoot, "bin/n8n");
const calls = [];
let scenario = "wait-once";
let n8nUrl, releaseWait = false;
const server = createServer(async (req, res) => {
  calls.push({ route: req.url, executionId: req.headers["x-teruisi-n8n-execution-id"], scheduledAt: req.headers["x-teruisi-scheduled-at"] });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/coordination/claim") {
    const claims = calls.filter(c => c.route === req.url);
    if (scenario === "conflict") { res.statusCode = 409; res.end('{"ok":false}'); return; }
    if (scenario === "persisted-wait" && !releaseWait) { res.end('{"ok":true,"coordinationStatus":"waiting"}'); return; }
    if (scenario === "wait-once" && claims.length === 1) { res.statusCode = 503; res.end('{"ok":false}'); return; }
    res.end(JSON.stringify({ ok: true, coordinationStatus: "granted" })); return;
  }
  if (["/coordination/retry-context", "/coordination/reserve-retry"].includes(req.url)) {
    if (scenario === "invalid-context") { res.statusCode = 409; res.end('{"ok":false}'); return; }
    // Run the actual fixed-path reader in a process whose home is this fixture.
    const reserve=req.url==="/coordination/reserve-retry";
    const code = `import assert from 'node:assert/strict';import {homedir} from 'node:os';import {readN8nRetryContext} from './lib/jackyun/n8n-preflight-evidence.ts';import {reserveRetryDispatch} from './lib/jackyun/retry-dispatch-reservation.ts';assert.equal(homedir(),process.env.USERPROFILE);const context=readN8nRetryContext(process.argv[1],process.argv[2],process.argv[3]||undefined);console.log(JSON.stringify(process.argv[3]?reserveRetryDispatch(process.env.USERPROFILE,context,process.argv[3]):context));`;
    const read = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code,
      req.headers["x-teruisi-source-workflow-id"], req.headers["x-teruisi-failed-execution-id"], reserve?req.headers["x-teruisi-retry-execution-id"]: ""],
    { cwd: workspace, env: { ...environment, USERPROFILE: root, HOME: root }, windowsHide: true, encoding: "utf8" });
    if (read.status !== 0) { appendFileSync(path.join(root,"reader-failure.log"), read.stderr); res.statusCode = 409; res.end('{"ok":false}'); return; }
    res.end(JSON.stringify({ ok: true, ...JSON.parse(read.stdout) })); return;
  }
  if (req.url?.startsWith("/webhook/")) {
    let body = ""; for await (const bytes of req) body += bytes;
    const result = await fetch(n8nUrl + req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (scenario === "dispatch-unknown") { res.destroy(); return; }
    res.statusCode = result.status; res.end(await result.text()); return;
  }
  if (req.url === "/preflight") {
    if (["retry", "dispatch-unknown", "invalid-context"].includes(scenario) && calls.filter(c=>c.route==="/preflight").length === 1) {
      res.statusCode = 503; res.end('{"error":"synthetic transient before any business effect"}'); return;
    }
    res.end('{"ok":true}'); return;
  }
  if (req.url === "/effect") { res.end('{"ok":true}'); return; }
  res.statusCode = 404; res.end('{}');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const mockUrl = `http://127.0.0.1:${server.address().port}`;
const brokerProbe = createServer();
await new Promise(resolve => brokerProbe.listen(0, "127.0.0.1", resolve));
const brokerPort = brokerProbe.address().port;
await new Promise(resolve => brokerProbe.close(resolve));
const mainProbe=createServer();await new Promise(r=>mainProbe.listen(0,"127.0.0.1",r));const mainPort=mainProbe.address().port;await new Promise(r=>mainProbe.close(r));
n8nUrl=`http://127.0.0.1:${mainPort}`;
const guard=path.join(root,"network-guard.cjs");
await writeFile(guard,`const net=require('node:net');const original=net.Socket.prototype.connect;const ports=${JSON.stringify([brokerPort,mainPort,server.address().port])};
net.Socket.prototype.connect=function(...args){let o=Array.isArray(args[0])?args[0][0]:args[0];if(typeof o!=='object')o={port:Number(args[0]),host:typeof args[1]==='string'?args[1]:'localhost'};if(o.path&&String(o.path).startsWith('\\\\\\\\.\\\\pipe\\\\'))return original.apply(this,args);if(!ports.includes(Number(o.port))||!['127.0.0.1','::1','localhost'].includes(o.host||'localhost'))throw new Error('Isolated n8n denies non-fixture network');return original.apply(this,args);};`);
const environment = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"].includes(k.toUpperCase())));
Object.assign(environment, { N8N_USER_FOLDER: root, DB_TYPE: "sqlite", DB_SQLITE_DATABASE: database,
  N8N_DIAGNOSTICS_ENABLED: "false", N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false",
  N8N_RUNNERS_MODE: "internal", N8N_RUNNERS_BROKER_PORT: String(brokerPort), N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
  N8N_ENCRYPTION_KEY: "isolated-optimization-four-test-key", GENERIC_TIMEZONE: "Asia/Shanghai",
  NODE_OPTIONS:`--require "${guard.replaceAll("\\", "/")}"`,N8N_PORT:String(mainPort),N8N_HOST:"127.0.0.1",N8N_LISTEN_ADDRESS:"127.0.0.1",WEBHOOK_URL:n8nUrl+"/",N8N_SECURE_COOKIE:"false" });
let engine;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, ms=90000) {
  const end = Date.now()+ms;
  do { const value = await read(); if(value) return value; await pause(250); } while(Date.now()<end);
  throw new Error(`${label} timed out; ${root}`);
}
async function stopEngine() {
  if (!engine || engine.exitCode !== null) return;
  const done = new Promise(resolve => engine.once("exit", resolve));
  // Only the exact disposable child tree created by this harness.
  spawnSync("taskkill", ["/PID", String(engine.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await done;
}
async function startEngine() {
  const log = path.join(root, "server.log");
  const offset=(await readFile(log,"utf8").catch(()=>"")).length;
  engine = spawn(process.execPath,[cli,"start"],{cwd:root,env:environment,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  engine.stdout.on("data",b=>appendFileSync(log,b));engine.stderr.on("data",b=>appendFileSync(log,b));
  await until(async()=>{try{return (await fetch(n8nUrl+"/healthz/readiness")).ok;}catch{return false;}},"isolated n8n ready");
  await until(async()=> (await readFile(log,"utf8")).slice(offset).includes('Activated workflow'),"isolated webhook registration");
}
async function run(args, label, expectedFailure = false) {
  let output = "";
  const log = path.join(root, `${label}.log`);
  await writeFile(log, "");
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", b => { output += b; appendFileSync(log, b); }); child.stderr.on("data", b => { output += b; appendFileSync(log, b); });
  const timer = setTimeout(() => child.kill(), 100_000);
  const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  clearTimeout(timer); await writeFile(path.join(root, `${label}.log`), output);
  if (code !== 0 && !(expectedFailure && code === 1)) throw new Error(`${label} exited ${code}; ${root}`);
}
function execution(id) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const row = db.prepare("SELECT e.*,d.data FROM execution_entity e JOIN execution_data d ON d.executionId=e.id WHERE e.workflowId=? ORDER BY e.id DESC LIMIT 1").get(id);
    assert.ok(row); return { ...row, decoded: flatted.parse(row.data) };
  } finally { db.close(); }
}
const results = [];
try {
  console.log(JSON.stringify({ phase: "n8n", directory: root, mockUrl }));
  const source = JSON.parse(await readFile(new URL("../automation/n8n/tmall-lili-sycm-cookie-daily.workflow.json", import.meta.url), "utf8"));
  let workflow = withMaintenanceCoordination(source);
  const claim = workflow.nodes.find(n => n.name === "领取共享 helper");
  const condition = workflow.nodes.find(n => n.name === "helper 领取成功？");
  const wait = workflow.nodes.find(n => n.type === "n8n-nodes-base.wait");
  wait.parameters = { resume: "timeInterval", amount: 0.02, unit: "seconds" };
  const anchor = workflow.nodes.find(n => n.name === anchorNodeName);
  const manual = { id: "fixture-manual", name: "Fixture", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [-1000, 0], parameters: {} };
  const fixed = { id: "fixture-date", name: "Synthetic date", type: "n8n-nodes-base.code", typeVersion: 2, position: [-900, 0], parameters: { jsCode: "return [{json:{timestamp:'2026-09-27T23:59:00+08:00'}}];" } };
  const effect = { id: "fixture-effect", name: "Synthetic effect", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [0, 0], parameters: { method: "POST", url: `${mockUrl}/effect` } };
  const edge = name => [{ node: name, type: "main", index: 0 }];
  workflow.nodes = [manual, fixed, anchor, claim, condition, wait, effect];
  workflow.connections = { Fixture: { main: [edge(fixed.name)] }, [fixed.name]: { main: [edge(anchor.name)] },
    [anchor.name]: { main: [edge(claim.name)] }, [claim.name]: { main: [edge(condition.name)] },
    [condition.name]: { main: [edge(effect.name), edge(wait.name)] }, [wait.name]: { main: [edge(claim.name)] } };
  workflow.settings = { timezone: "Asia/Shanghai", executionOrder: "v1" };
  workflow = JSON.parse(JSON.stringify(workflow).replaceAll("http://127.0.0.1:5791", mockUrl));
  assert.equal(JSON.stringify(workflow).includes(":5791"), false);
  const file = path.join(root, "workflow.json"); await writeFile(file, JSON.stringify(workflow));
  if (!process.argv.includes("--live-only")) await run(["import:workflow", `--input=${file}`], "import");
  for (scenario of (process.argv.includes("--live-only") ? [] : ["wait-once", "conflict"])) {
    calls.length = 0;
    await run(["execute", `--id=${workflow.id}`], scenario, scenario === "conflict");
    const row = execution(workflow.id);
    assert.equal(row.status, scenario === "wait-once" ? "success" : "error", JSON.stringify(row.decoded.resultData.error));
    assert.equal(calls.filter(c => c.route === "/effect").length, scenario === "wait-once" ? 1 : 0);
    assert.equal(calls.filter(c => c.route === "/coordination/claim").length, scenario === "wait-once" ? 2 : 1);
    assert.ok(calls.filter(c => c.route === "/coordination/claim").every(c => c.scheduledAt === "2026-09-27T15:59:00.000Z" && c.executionId === String(row.id)));
    results.push({ scenario, status: row.status, calls: [...calls] });
    console.log(JSON.stringify(results.at(-1)));
  }
  // Real webhook executions exercise persisted Wait and the real error trigger.
  const live=structuredClone(workflow);
  Object.assign(live.nodes.find(n=>n.name==="Fixture"),{type:"n8n-nodes-base.webhook",typeVersion:2.1,webhookId:"6a1969a4-e26f-4c21-bf87-6f8d1649c551",parameters:{httpMethod:"POST",path:"optimization4-source",responseMode:"onReceived",options:{}}});
  const retry=source.nodes.find(n=>n.type==="n8n-nodes-base.webhook");live.nodes.push(retry);
  live.connections[retry.name]={main:[edge(anchor.name)]};
  const preflight={...effect,id:"fixture-preflight",name:"Synthetic preflight",parameters:{method:"POST",url:mockUrl+"/preflight"}};
  live.nodes.push(preflight);live.connections[condition.name].main[0]=edge(preflight.name);live.connections[preflight.name]={main:[edge(effect.name)]};
  live.settings.errorWorkflow="TeruisiHourlyRetry2026";
  live.nodes.find(n=>n.name===wait.name).parameters={resume:"timeInterval",amount:70,unit:"seconds"};
  let errorWorkflow=buildHourlyRetryErrorWorkflow();
  errorWorkflow.nodes.find(n=>n.type==="n8n-nodes-base.wait").parameters={resume:"timeInterval",amount:0.02,unit:"seconds"};
  errorWorkflow=JSON.parse(JSON.stringify(errorWorkflow).replaceAll("http://127.0.0.1:5791",mockUrl).replaceAll("http://127.0.0.1:5678",mockUrl).replaceAll("127.0.0.1:5678",new URL(mockUrl).host));
  assert.equal(JSON.stringify([live,errorWorkflow]).includes(":5791"),false);
  assert.equal(JSON.stringify([live,errorWorkflow]).includes(":5678"),false);
  const liveFile=path.join(root,"live.json");await writeFile(liveFile,JSON.stringify([live,errorWorkflow]));
  await run(["import:workflow",`--input=${liveFile}`],"import-live");
  await run(["publish:workflow",`--id=${live.id}`],"publish-isolated");
  await run(["publish:workflow",`--id=${errorWorkflow.id}`],"publish-isolated-error");
  await startEngine();
  scenario="persisted-wait";calls.length=0;
  assert.equal((await fetch(n8nUrl+"/webhook/optimization4-source",{method:"POST"})).status,200);
  const waiting=await until(()=>{const e=execution(live.id);return e.status==="waiting"&&e;},"persistent Wait");
  assert.ok(waiting.waitTill);
  await pause(500);
  await stopEngine();
  // Advance only the disposable scheduler deadline; do not edit plan data.
  const clockDb=new DatabaseSync(database);
  clockDb.prepare("UPDATE execution_entity SET waitTill=? WHERE id=? AND status='waiting'").run(new Date(Date.now()+1000).toISOString().replace("T"," ").replace("Z",""),waiting.id);clockDb.close();
  releaseWait=true;await startEngine();
  const resumed=await until(()=>{const e=execution(live.id);return e.status==="success"&&e;},"resume original execution");
  assert.equal(resumed.id,waiting.id);assert.equal(calls.filter(c=>c.route==="/effect").length,1);
  assert.ok(calls.filter(c=>c.route==="/coordination/claim").every(c=>c.executionId===String(waiting.id)&&c.scheduledAt==="2026-09-27T15:59:00.000Z"));
  results.push({scenario,status:resumed.status,sameExecution:true,effects:1,restarted:true});console.log(JSON.stringify(results.at(-1)));
  for(scenario of ["retry","dispatch-unknown","invalid-context"]){
    calls.length=0;const before=execution(live.id).id;
    assert.equal((await fetch(n8nUrl+"/webhook/optimization4-source",{method:"POST"})).status,200);
    const outcome=await until(()=>{try{const e=execution(errorWorkflow.id);return Number(e.startedAt?.replace(/\D/g,''))&&["success","error"].includes(e.status)&&Number(e.decoded.resultData.runData?.["仅保留可安全自动重试的失败"]?.[0]?.data?.main?.[0]?.[0]?.json?.failedExecutionId)>before&&e;}catch{return false;}},"hourly recovery chain");
    if(scenario!=="invalid-context") await until(()=>execution(live.id).status==="success","replacement completes");
    await pause(500);
    const dispatches=calls.filter(c=>c.route?.startsWith("/webhook/")).length;
    assert.equal(dispatches,scenario==="invalid-context"?0:1);
    assert.equal(calls.filter(c=>c.route==="/effect").length,scenario==="invalid-context"?0:1);
    assert.equal(outcome.status,scenario==="retry"?"success":"error",JSON.stringify(outcome.decoded.resultData.error));
    const claimed=calls.filter(c=>c.route==="/coordination/claim");assert.ok(claimed.every(c=>c.scheduledAt==="2026-09-27T15:59:00.000Z"));
    results.push({scenario,status:outcome.status,dispatches,effects:calls.filter(c=>c.route==="/effect").length,claims:claimed});console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(path.join(root, "evidence.json"), JSON.stringify({ status: "passed", productionTouched: false, results }, null, 2));
} finally { await stopEngine();server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
