// Run the installed n8n engine with an isolated database and synthetic HTTP
// endpoints. No production browser, database, helper or notification access.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const n8nRoot = process.argv[2];
assert.ok(n8nRoot && path.isAbsolute(n8nRoot));
const require = createRequire(path.join(n8nRoot, "package.json"));
const sqlite = require("sqlite3");
const flatted = require("flatted");
const root = await mkdtemp(path.join(tmpdir(), "teruisi-jd-cs-n8n-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"].includes(key.toUpperCase())));
Object.assign(env, {
  N8N_USER_FOLDER: root, DB_TYPE: "sqlite", DB_SQLITE_DATABASE: path.join(root, "test.sqlite"),
  N8N_DIAGNOSTICS_ENABLED: "false", N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false",
  N8N_RUNNERS_ENABLED: "true", N8N_RUNNERS_MODE: "internal", N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
  N8N_ENCRYPTION_KEY: "isolated-fixture-key-not-production", GENERIC_TIMEZONE: "Asia/Shanghai",
});
const run = async (args, label, failed = false) => {
  let output = "";
  const child = spawn(process.execPath, [path.join(n8nRoot, "bin/n8n"), ...args], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", bytes => { output += bytes; }); child.stderr.on("data", bytes => { output += bytes; });
  const timer = setTimeout(() => child.kill(), 90_000);
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  clearTimeout(timer); await writeFile(path.join(root, `${label}.log`), output);
  assert.equal(code, failed ? 1 : 0, `${label}: see ${root}`);
};
let scenario;
const calls = [];
const server = createServer((req, res) => {
  const call = { route: req.url, storeKey: req.headers["x-teruisi-jd-customer-service-store-key"], executionId: req.headers["x-teruisi-n8n-execution-id"], scheduledAt: req.headers["x-teruisi-scheduled-at"] };
  calls.push(call);
  res.setHeader("Content-Type", "application/json");
  if (call.storeKey !== scenario.storeKey || scenario.failRoute === call.route) {
    res.statusCode = 409; res.end('{"ok":false,"error":"synthetic_failure"}'); return;
  }
  if (call.route === "/coordination/claim") res.end('{"ok":true,"coordinationStatus":"granted"}');
  else res.end('{"ok":true}');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
env.N8N_RUNNERS_BROKER_PORT = String(reservation.address().port);
await new Promise(resolve => reservation.close(resolve));
const stores = ["cut-meat", "chudian", "dishwasher"];
const results = [];
try {
  for (let i = 0; i < 6; i++) {
    const workflow = JSON.parse(await readFile(new URL(`../automation/n8n/jd-customer-service-${stores[i % 3]}-daily.candidate.workflow.json`, import.meta.url), "utf8"));
    workflow.id = `IsolatedJdCustomerService${i}`;
    assert.equal(workflow.active, false);
    scenario = { storeKey: workflow.meta.storeKey, failRoute: i < 3 ? null : i === 3 ? "/jd/customer-service/plan" : i === 4 ? "/jd/customer-service/run" : "/jd/customer-service/verify" };
    for (const node of workflow.nodes) {
      if (node.type === "n8n-nodes-base.httpRequest") {
        const url = new URL(node.parameters.url); assert.equal(url.origin, "http://127.0.0.1:5791");
        node.parameters.url = `http://127.0.0.1:${port}${url.pathname}`; node.parameters.options.timeout = 5_000;
      } else if (node.type === "n8n-nodes-base.code") assert.equal(/https?:\/\//.test(node.parameters.jsCode), false);
      else assert.ok(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.manualTrigger", "n8n-nodes-base.if", "n8n-nodes-base.wait", "n8n-nodes-base.stickyNote"].includes(node.type));
    }
    calls.length = 0;
    const file = path.join(root, `workflow-${i}.json`); await writeFile(file, JSON.stringify(workflow));
    await run(["import:workflow", `--input=${file}`], `import-${i}`);
    await run(["execute", `--id=${workflow.id}`], `execute-${i}`, Boolean(scenario.failRoute));
    const db = new sqlite.Database(path.join(root, "test.sqlite"), sqlite.OPEN_READONLY);
    const record = await new Promise((resolve, reject) => db.get("SELECT e.status,d.data FROM execution_entity e JOIN execution_data d ON d.executionId=e.id WHERE e.workflowId=? ORDER BY e.id DESC LIMIT 1", [workflow.id], (error, row) => error ? reject(error) : resolve(row)));
    await new Promise(resolve => db.close(resolve));
    assert.equal(record?.status, scenario.failRoute ? "error" : "success");
    const stages = ["/coordination/claim", "/jd/customer-service/plan", "/jd/customer-service/run", "/jd/customer-service/verify"];
    const expected = scenario.failRoute ? stages.slice(0, stages.indexOf(scenario.failRoute) + 1) : stages;
    assert.deepEqual(calls.map(call => call.route), expected);
    assert.equal(new Set(calls.map(call => call.scheduledAt)).size, 1);
    assert.ok(Number.isFinite(Date.parse(calls[0].scheduledAt)));
    assert.equal(new Set(calls.map(call => call.executionId)).size, 1);
    assert.match(calls[0].executionId, /^\d+$/);
    const data = flatted.parse(record.data).resultData;
    const last = scenario.failRoute?.endsWith("plan") ? "A·固定客服店铺与30天范围" : scenario.failRoute?.endsWith("run") ? "B·双视图导出按日导入" : "C·独立复验全部日批次";
    assert.equal(data.lastNodeExecuted, last);
    results.push({ ...scenario, status: record.status, calls: [...calls] });
    await writeFile(path.join(root, `execution-${i}.json`), JSON.stringify({ workflow, record }));
  }
  await writeFile(path.join(root, "evidence.json"), JSON.stringify({ productionTouched: false, results }, null, 2));
  console.log(JSON.stringify({ ok: true, scenarios: results.length, productionTouched: false, isolatedDirectory: root }));
} finally { await new Promise(resolve => server.close(resolve)); }
