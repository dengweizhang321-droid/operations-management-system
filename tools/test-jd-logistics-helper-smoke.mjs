// Build the real immutable helper and exercise its logistics routes only against
// a new synthetic mutable root and local read-only API fixture. No browser or
// source business task is permitted in this smoke.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const sourceRoot = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "teruisi-jd-logistics-helper-"));
const runtime = path.join(temp, "mirror"); await mkdir(path.join(runtime, "config"), { recursive: true });
await symlink(path.join(sourceRoot, "node_modules"), path.join(temp, "node_modules"), "junction");
for (const name of ["jd-store-accounts.json", "tmall-store-accounts.json"]) await writeFile(path.join(runtime, "config", name), JSON.stringify({ version: 1, stores: [] }));
await writeFile(path.join(runtime, "config/jd-logistics-sources.json"), JSON.stringify({ version: 1, bindings: [] }));
let reads = 0, writes = 0;
const api = createServer((request, response) => {
  if (request.method !== "GET") { writes++; response.writeHead(405); response.end(); return; }
  assert.equal(request.url, "/api/inventory/jd-logistics?operation=settings"); reads++;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ success: true, data: { contractVersion: "jd-logistics-v1", departments: [], scopeRevisions: [] } }));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const bundle = path.join(temp, "helper.mjs");
const build = await promisify(execFile)(process.execPath, ["tools/build-worker-helper.mjs", "--source-root", sourceRoot, "--output", bundle], { cwd: sourceRoot, windowsHide: true, timeout: 120000 });
const receipt = JSON.parse(build.stdout);
assert.ok(receipt.inputFiles.some(file => file.relativePath === "tools/jd-logistics-n8n-pipeline.ts"));
assert.ok(receipt.inputFiles.some(file => file.relativePath === "tools/jd-logistics-export.ts"));
assert.ok(!receipt.mutableRootRewritePaths.includes("tools/jd-logistics-n8n-pipeline.ts"));
await writeFile(path.join(temp, "build-receipt.json"), JSON.stringify(receipt, null, 2));
const reserve = createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
env.TERUISI_HELPER_MUTABLE_ROOT = runtime; env.OPERATIONS_SYSTEM_URL = apiUrl;
const child = spawn(process.execPath, [bundle, "serve", "--port", String(port)], { cwd: runtime, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; child.stdout.on("data", part => { output = (output + part.toString()).slice(-16000); }); child.stderr.resume();
const exited = new Promise(resolve => child.once("exit", resolve));
const origin = `http://127.0.0.1:${port}`;
async function call(route, execution = "synthetic-logistics", workflow = "jd-logistics") {
  const response = await fetch(origin + route, { method: "POST", headers: { "X-TERUISI-WORKFLOW-KEY": workflow, "X-TERUISI-N8N-EXECUTION-ID": execution }, signal: AbortSignal.timeout(40000) });
  return { status: response.status, body: await response.json() };
}
try {
  const deadline = Date.now() + 30000;
  while (!output.includes('"stage":"serve"')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error("synthetic logistics helper did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await call("/jd-logistics/run")).status, 409);
  assert.equal((await call("/coordination/claim")).body.coordinationStatus, "granted");
  assert.equal((await call("/jd-logistics/run")).body.error, "jd_logistics_stage_mismatch");
  assert.equal((await call("/jd-logistics/plan", "foreign")).status, 409);
  const a = await call("/jd-logistics/plan"); assert.equal(a.status, 200); assert.equal(a.body.status, "disabled");
  const b = await call("/jd-logistics/run"); assert.equal(b.status, 200); assert.equal(b.body.status, "disabled");
  const c = await call("/jd-logistics/verify"); assert.equal(c.status, 200); assert.equal(c.body.status, "disabled"); assert.equal(c.body.verifiedCount, 0);
  assert.equal(c.body.stage, "verified");
  const d = await call("/jd-logistics/notify"); assert.equal(d.status, 200); assert.equal(d.body.stage, "completed"); assert.equal(d.body.notification.status, "disabled");
  assert.equal((await call("/jd-logistics/release", "foreign")).status, 409);
  assert.equal((await call("/jd-logistics/release")).status, 200);
  let health;
  const releaseDeadline = Date.now() + 10000;
  do {
    health = await fetch(origin + "/health").then(response => response.json());
    if (!health.busy) break; await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < releaseDeadline);
  assert.equal(health.busy, false); assert.equal(health.jdLogisticsProfile, "missing");
  assert.equal((await call("/coordination/claim")).body.error, "execution_already_finished");
  // A new execution may release after a known pre-business failure too.
  assert.equal((await call("/coordination/claim", "synthetic-failure")).status, 200);
  await writeFile(path.join(runtime, "config/jd-logistics-sources.json"), "{broken");
  assert.equal((await call("/jd-logistics/plan", "synthetic-failure")).status, 500);
  assert.equal((await call("/jd-logistics/release", "synthetic-failure")).status, 200);
  const files = await readdir(path.join(runtime, "outputs/jd-logistics-pipeline"));
  assert.ok(!files.includes("downloads")); assert.equal(writes, 0); assert.ok(reads > 0);
  const manifestName = files.find(file => /^jdl-.*\.json$/.test(file));
  const manifest = JSON.parse(await readFile(path.join(runtime, "outputs/jd-logistics-pipeline", manifestName), "utf8"));
  assert.equal(manifest.stage, "completed"); assert.equal(manifest.outcome, "disabled"); assert.equal(manifest.operations.length, 0);
  console.log(JSON.stringify({ ok: true, immutableBuilder: receipt.version, realHelperRoutes: true, successAndFailureRelease: true,
    defaultOff: true, businessWrites: writes, downloads: 0, mirror: temp }));
} finally {
  child.kill(); await exited; await new Promise(resolve => api.close(resolve));
}
