import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

// Bundle the real scheduler, real principal resolver and real dispatch loop.
// Only their signed service transports are replaced; no runtime or model access.
const bundled = await build({ entryPoints: [resolve("lib/market/django-annotation-scheduled.ts")], bundle: true, write: false,
  format: "cjs", platform: "node", alias: { "@": resolve(".") }, logLevel: "silent",
  plugins: [{ name: "isolated-service-boundaries", setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "env", namespace: "fixture" }));
    b.onResolve({ filter: /django\/access-control-service$/ }, () => ({ path: "access", namespace: "fixture" }));
    b.onResolve({ filter: /django-annotation-runner$/ }, () => ({ path: "market", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "env" ? "export const env = {};" : path === "access" ? `
      export class AccessControlServiceError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
      export const ACCESS_CONTROL_BACKGROUND_PATH='/authorize-background';
      export function createDjangoAccessControlService() { return { request: async () => {
        const f=globalThis.__marketResumeFixture; f.identityReads++;
        if(f.authStatus) throw new AccessControlServiceError(f.authStatus,'service_unavailable','fixture');
        return {data:{user:{email:'owner@example.test',displayName:'Owner',role:'operator',status:'active',scope:null}}};
      }}; }` : `
      export async function annotationQuery() {
        const f=globalThis.__marketResumeFixture; f.queries++;
        const ready=!f.gate && f.state==='running' && !f.finished;
        if(f.pauseAfterRead) { f.state='paused'; f.pauseAfterRead=false; }
        return {data:{jobs:ready?[{jobId:'job',ownerEmail:'owner@example.test',availableSlots:1}]:[]}};
      }
      export async function annotationCommand(_principal,c) {
        const f=globalThis.__marketResumeFixture; f.commands.push(c);
        if(c.action==='set_cloud_run_state') {f.state=c.state;return {data:{result:{}}};}
        return {data:{result:c.action==='begin_dispatch' && !f.gate && f.state==='running'?{coordinatorToken:'fixture-token'}:{}}};
      }
      export async function runClaimedDjangoMarketVisionTask() {
        const f=globalThis.__marketResumeFixture; f.models++; f.finished=true;
        return {data:{result:{processedCount:1,done:true}}};
      }`, loader: "js" }));
  }}] });
const loaded = { exports: {} as { runScheduledDjangoMarketAnnotation: () => Promise<{ continueImmediately: boolean }> } };
new Function("require", "module", "exports", bundled.outputFiles![0].text)(createRequire(import.meta.url), loaded, loaded.exports);
function fixture() {
  const value = { gate: "", state: "running", authStatus: 0, identityReads: 0, queries: 0, models: 0, finished: false,
    commands: [] as Array<{ action: string; state?: string }>, pauseAfterRead: false };
  (globalThis as typeof globalThis & { __marketResumeFixture?: typeof value }).__marketResumeFixture = value;
  return value;
}

test("temporary authorization 503 preserves running intent and retries on the natural next tick", async () => {
  const f = fixture(); f.authStatus = 503;
  assert.equal((await loaded.exports.runScheduledDjangoMarketAnnotation()).continueImmediately, false, "no immediate failure loop");
  assert.equal(f.state, "running"); assert.equal(f.models, 0); assert.equal(f.commands.length, 0);
  f.authStatus = 0;
  await loaded.exports.runScheduledDjangoMarketAnnotation();
  assert.equal(f.models, 1);
  assert.ok(f.commands.every((c) => c.action !== "set_cloud_run_state"), "resume never rewrites the user's intent");
});
test("helpers, request drain and maintenance retain the intent; normal exit resumes without a run command", async () => {
  const f = fixture();
  for (const gate of ["helpers", "requests", "maintenance"]) {
    f.gate = gate; await loaded.exports.runScheduledDjangoMarketAnnotation();
    assert.equal(f.state, "running"); assert.equal(f.models, 0); assert.equal(f.identityReads, 0);
  }
  f.gate = ""; await loaded.exports.runScheduledDjangoMarketAnnotation();
  assert.equal(f.models, 1);
  assert.ok(f.commands.every((c) => c.action !== "set_cloud_run_state"));
});
test("real authorization rejection still pauses, and non-service errors are not silently retryable", async () => {
  for (const status of [403, 401, 409]) {
    const f = fixture(); f.authStatus = status;
    await loaded.exports.runScheduledDjangoMarketAnnotation();
    assert.equal(f.state, "paused"); assert.equal(f.models, 0);
    assert.equal(f.commands.filter((c) => c.action === "set_cloud_run_state").length, 1);
  }
});
test("manual or unknown pause and a pause after dispatch read never start a model", async () => {
  const f = fixture(); f.state = "paused";
  await loaded.exports.runScheduledDjangoMarketAnnotation();
  assert.equal(f.commands.length, 0); assert.equal(f.models, 0);
  f.state = "running"; f.pauseAfterRead = true;
  await loaded.exports.runScheduledDjangoMarketAnnotation();
  assert.equal(f.state, "paused"); assert.equal(f.models, 0);
  assert.ok(f.commands.every((c) => c.action !== "set_cloud_run_state"));
});
