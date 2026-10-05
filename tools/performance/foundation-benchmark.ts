/** Synthetic loopback only. No application runtime config, production endpoints or tasks. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { cpus, freemem } from "node:os";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createReadJsonClient } from "../../lib/http/read-client";
import { createPerformanceRecorder, createPerformanceTrace } from "../../lib/http/performance";
import { decideLocalDirectAccess, isLoopbackRequestHost } from "../../lib/auth/local-direct-access";

const output = "docs/performance/foundation/benchmark.json";
const baseline = "bab42d8ce836b4ee9acd82e80de085ff71f9f494";
const baselineSource = execFileSync("git", ["show", `${baseline}:lib/http/api-client.ts`], { encoding: "utf8" });
const baselineCode = ts.transpileModule(baselineSource.replace("@/lib/http/api-error", pathToFileURL(resolve("lib/http/api-error.ts")).href), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { requestJson } = await import("data:text/javascript;base64," + Buffer.from(baselineCode).toString("base64"));
const sourceFiles = [];
for (const path of ["lib/http/api-client.ts", "lib/http/read-client.ts", "lib/http/performance.ts"]) {
  const bytes = await readFile(path); sourceFiles.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const paths = ["/api/sales/summary", "/api/inventory/overview", "/api/products/summary", "/api/market/overview"];
const body = JSON.stringify({ items: Array.from({ length: 100 }, (_, n) => ({ n, value: n * 100 })) });
let requests = 0, bytes = 0, active = 0, peak = 0;
const server = createServer((req, res) => {
  assert.equal(req.method, "GET");
  assert.ok(paths.includes(new URL(req.url!, "http://fixture").pathname) || req.url === "/permission");
  requests++; active++; peak = Math.max(peak, active);
  const isPermission = req.url === "/permission";
  setTimeout(() => {
    res.setHeader("Content-Type", "application/json");
    // Deliberately no pretend SQL/queue timings. Those layers are absent here.
    res.writeHead(200); res.flushHeaders();
    setTimeout(() => { bytes += Buffer.byteLength(isPermission ? "{}" : body); res.end(isPermission ? "{}" : body); active--; }, isPermission ? 0 : 5);
  }, isPermission ? 5 : 25);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const recorder = createPerformanceRecorder(1024); recorder.setEnabled(true);
const client = createReadJsonClient({ origin, paths, observe: recorder.observe });
const readOptions = { identityKey: "synthetic-session", permissionKey: "synthetic-scope", version: "synthetic-version" };
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const summary = (values: number[]) => ({ n: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) });
const hostCpu = () => cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((n, value) => n + value, 0) }), { idle: 0, total: 0 });
const records: unknown[] = [];
try {
  // Alternate order. Four independent subscribers, identical full query bytes.
  for (const path of paths) {
    const hostBefore = hostCpu(), freeBefore = freemem();
    const samples: Record<string, number[]> = { legacy: [], joined: [] };
    const resources: Record<string, { requests: number; bytes: number; cpuMicros: number; heapDeltaBytes: number; peakActive: number }> = {
      legacy: { requests: 0, bytes: 0, cpuMicros: 0, heapDeltaBytes: 0, peakActive: 0 }, joined: { requests: 0, bytes: 0, cpuMicros: 0, heapDeltaBytes: 0, peakActive: 0 },
    };
    for (let round = 0; round < 30; round++) {
      for (const mode of round % 2 ? ["joined", "legacy"] : ["legacy", "joined"]) {
        peak = 0; const requestStart = requests, bytesStart = bytes, cpuStart = process.cpuUsage(), heapStart = process.memoryUsage().heapUsed;
        const start = performance.now();
        const values = await Promise.all(Array.from({ length: 4 }, () => mode === "joined" ? client.read(origin + path + "?date=2026-09-01&filter=synthetic", readOptions) : requestJson(origin + path + "?date=2026-09-01&filter=synthetic")));
        values.forEach(value => assert.deepEqual(value, JSON.parse(body)));
        samples[mode].push(performance.now() - start);
        const cpu = process.cpuUsage(cpuStart), resource = resources[mode];
        resource.requests += requests - requestStart; resource.bytes += bytes - bytesStart; resource.cpuMicros += cpu.user + cpu.system;
        resource.heapDeltaBytes += process.memoryUsage().heapUsed - heapStart; resource.peakActive = Math.max(resource.peakActive, peak);
      }
    }
    const hostAfter = hostCpu();
    records.push({ path, legacy: { ...summary(samples.legacy), ...resources.legacy }, joined: { ...summary(samples.joined), ...resources.joined }, samples,
      host: { meanBusyPercent: 100 * (1 - (hostAfter.idle - hostBefore.idle) / (hostAfter.total - hostBefore.total)), freeBytesBefore: freeBefore, freeBytesAfter: freemem() } });
  }
  const observations = recorder.snapshot();
  const stages = Object.fromEntries([...new Set(observations.map(sample => sample.stage))].map(stage => [stage, summary(observations.filter(sample => sample.stage === stage).map(sample => sample.durationMs))]));

  // Execute the unchanged actual authorization function with explicit synthetic seams.
  const authSource = await readFile("lib/auth/authorization.ts", "utf8");
  let source = authSource.replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "");
  source = source.replace(/const viteEnvironment = \([\s\S]*?\)\.env;/, "const viteEnvironment = dependencies.vite;");
  assert.ok(!source.includes("import.meta") && !source.includes("from \""));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const counts = { identity: 0, permissions: 0, localHeaders: 0 };
  const trace = createPerformanceTrace(recorder.observe);
  const dependencies = {
    vite: { DEV: false, PROD: false }, env: {} as Record<string, string>,
    getChatGPTUser: () => trace.measure("auth.identity", async () => { counts.identity++; return { email: "synthetic@example.test", displayName: "Synthetic" }; }),
    headers: () => trace.measure("auth.local", async () => { counts.localHeaders++; return new Headers({ host: "127.0.0.1" }); }),
    decideLocalDirectAccess, isLoopbackRequestHost, ACCESS_CONTROL_RESOLVE_PATH: "/synthetic",
    AccessControlServiceError: class extends Error {},
    createDjangoAccessControlService: () => ({ request: () => trace.measure("auth.permissions", async () => { counts.permissions++; await fetch(origin + "/permission").then(response => response.text()); return { data: { user: { email: "synthetic@example.test", displayName: "Synthetic", role: "viewer", status: "active", scope: null } } }; }) }),
  };
  const exports: { requireAppPrincipal?: (roles?: string[]) => Promise<{ role: string }> } = {};
  new Function("dependencies", "exports", "const {getChatGPTUser,env,headers,decideLocalDirectAccess,isLoopbackRequestHost,ACCESS_CONTROL_RESOLVE_PATH,AccessControlServiceError,createDjangoAccessControlService}=dependencies;\n" + code)(dependencies, exports);
  const auth: Record<string, unknown> = {};
  for (const mode of ["ordinary", "local"]) {
    recorder.clear(); const values: number[] = []; const before = { ...counts };
    if (mode === "local") { dependencies.vite.DEV = true; dependencies.env.TERUISI_LOCAL_DIRECT_ACCESS = "true"; dependencies.env.TERUISI_RUNTIME_ENV = "development"; }
    for (let n = 0; n < 30; n++) { const start = performance.now(); const principal = await exports.requireAppPrincipal!(); assert.equal(principal.role, mode === "local" ? "admin" : "viewer"); values.push(performance.now() - start); }
    auth[mode] = { ...summary(values), calls: { identity: counts.identity - before.identity, permissions: counts.permissions - before.permissions, localHeaders: counts.localHeaders - before.localHeaders }, observations: recorder.snapshot() };
  }
  await assert.rejects(exports.requireAppPrincipal!(["viewer"])); // local admin must still respect allowed roles.
  const identityBefore = counts.identity; dependencies.vite.DEV = false; dependencies.vite.PROD = true; dependencies.env.TERUISI_RUNTIME_ENV = "production";
  assert.equal((await exports.requireAppPrincipal!()).role, "viewer"); assert.equal(counts.identity, identityBefore + 1);
  client.dispose();
  await mkdir("docs/performance/foundation", { recursive: true });
  await writeFile(output, JSON.stringify({
    schema: "foundation-synthetic-loopback-v1", baseline, baselineClientSha256: createHash("sha256").update(baselineSource).digest("hex"), sourceFiles,
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    synthetic: true, transport: "loopback dynamic port; native fetch; four identical subscribers; 30 alternating rounds per domain",
    limits: "No real Worker/permission service/Django/SQL/browser. Heap deltas include GC; process CPU includes the synthetic server. Latency is not production P95.",
    payloadBytes: Buffer.byteLength(body), records, browserTransportStagesMeasuredInNode: stages,
    authorization: { environment: "actual unchanged authorization.ts executed with injected synthetic identity/header + loopback permission seams", samples: auth, securityChecks: ["local admin role denial", "production disables local opt-in"] },
    unknown: ["Worker real frontend cost", "real auth", "Django queue", "SQL", "GPU rendering", "background resource contention"],
    finalStats: client.stats(),
  }, null, 2) + "\n");
  console.log(output);
} finally {
  client.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
