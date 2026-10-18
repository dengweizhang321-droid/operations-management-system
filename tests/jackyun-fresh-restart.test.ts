import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { freshRestartFixture } from "./fixtures/jackyun-fresh-restart";
import { assertNoFreshRestart, validFreshRestartTarget } from "../lib/jackyun/fresh-restart";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import { readHumanRetryAuthority, claimHumanRetryAuthority } from "../lib/jackyun/human-retry";
import { reserveJackyunFailureRetry } from "../lib/jackyun/retry-budget";
import { reserveRetryDispatch } from "../lib/jackyun/retry-dispatch-reservation";

const fixture = freshRestartFixture;

test("fresh full A-E exports all five files and preserves predecessor facts and evidence", async t => {
  const x = await fixture(t), { f, pipeline, source } = x;
  const oldPlan = await readFile(path.join(pipeline, "n8n-export-first-9000.json")), oldControl = await readFile(path.join(pipeline, "recovery-control/9000/0002.json"));
  const oldManifest = await readFile(path.join(source, "run-manifest.json")), originalProducts = await readFile(path.join(source, "audit/products.json"));
  const proof = await x.inspect(); assert.equal(proof.results.length, 2);
  await x.run("plan-api", "9002"); x.proceed();
  for (const action of ["export-all", "validate", "import", "verify"]) await x.run(action, "9002");
  assert.equal(f.exportCount(), 2);
  assert.deepEqual([...f.verified].sort(), [...jackyunModuleOrder].sort());
  const fresh = JSON.parse(await readFile(path.join(pipeline, "n8n-export-first-9002.json"), "utf8"));
  assert.equal(fresh.phase, "completed"); assert.notEqual(fresh.runId, "n8n-export-first-9000");
  assert.deepEqual(await readFile(path.join(pipeline, "n8n-export-first-9000.json")), oldPlan);
  assert.deepEqual(await readFile(path.join(pipeline, "recovery-control/9000/0002.json")), oldControl);
  assert.deepEqual(await readFile(path.join(source, "run-manifest.json")), oldManifest);
  assert.deepEqual(await readFile(path.join(source, "audit/products.json")), originalProducts);
  const active = await readFile(path.join(pipeline, "active.json"));
  for (const execution of ["9000", "9001"]) for (const action of ["plan-api", "export-all", "validate", "import", "verify"]) {
    await assert.rejects(x.run(action, execution), /SUPERSEDED/);
  }
  f.deps.recoveryRequest = { version: "jackyun-recovery-control-v1", kind: "retry", logicalExecutionId: "9000", failedExecutionId: "9001" };
  for (const action of ["plan-api", "export-all", "validate", "import", "verify"]) await assert.rejects(x.run(action, "9010"), /SUPERSEDED/);
  await assert.rejects(reserveJackyunFailureRetry(x.root, { workflowId: "J8kY2mQ5vR7sT4pN", originalExecutionId: "9000", failedExecutionId: "9001", originalScheduledAt: "2026-10-13T00:00:00Z" }, "9010",
    { failedStoppedAt: "2026-10-13T00:00:00Z", lockDirectory: f.deps.lockDirectory }), /SUPERSEDED/);
  assert.throws(() => reserveRetryDispatch(x.root, { workflowId: "J8kY2mQ5vR7sT4pN", originalExecutionId: "9000", failedExecutionId: "9001", originalScheduledAt: "2026-10-13T00:00:00Z" }, "9010"), /SUPERSEDED/);
  assert.deepEqual(await readFile(path.join(pipeline, "active.json")), active);
});

test("fresh proof rejects unknown, processing, scope, changing files, live owner and wrong authorization", async t => {
  const x = await fixture(t), beforePosts = x.posts();
  for (const mode of ["unknown", "uploading", "processing", "scope"] as const) { x.mode(mode); await assert.rejects(x.inspect()); }
  x.mode("ready");
  x.evidence.latest.activeExecutions = 1; await assert.rejects(x.inspect()); x.evidence.latest.activeExecutions = 0;
  x.evidence.source.status = "running"; await assert.rejects(x.inspect()); x.evidence.source.status = "error";
  const oldTarget = x.f.deps.humanAuthority!.authority;
  if (oldTarget.kind !== "new") throw new Error("fixture");
  x.setAuthority({ ...oldTarget, expiresAt: new Date(0).toISOString() }); await assert.rejects(x.run("plan-api", "9002"), /授权/);
  x.setAuthority({ ...oldTarget, supersedes: { ...x.target, sourceDigest: "f".repeat(64) } }); await assert.rejects(x.run("plan-api", "9002"), /变化/);
  x.setAuthority(oldTarget);
  const file = path.join(x.root, "downloads/jackyun/n8n-export-first-9000/inventory/synthetic.xlsx"), original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from("changed")])); await assert.rejects(x.inspect()); await writeFile(file, original);
  await writeFile(path.join(x.source, "import-checkpoints/sales.json"), "{}"); await assert.rejects(x.inspect(), /后三表/);
  assert.equal(x.posts(), beforePosts, "all proof checks use GET only");
  assert.equal(validFreshRestartTarget({ ...x.target, injection: true }), false);
  assert.equal(validFreshRestartTarget({ ...x.target, failedExecutionId: "1" }), false);
});

test("strict fresh authority is read from persisted permission; n8n stays bare new", async () => {
  const value = { ok: true, version: "jackyun-human-retry-authority-v1", kind: "new", authorizationId: randomUUID(), workflowId: "J8kY2mQ5vR7sT4pN",
    createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    supersedes: { logicalExecutionId: "10037", sourceExecutionId: "10039", failedExecutionId: "10048", sourceDigest: "a".repeat(64), controlDigest: "b".repeat(64), activeDigest: "c".repeat(64) } };
  const request: typeof fetch = async () => Response.json(value);
  const authority = await readHumanRetryAuthority(value.authorizationId, request);
  const root = await mkdtemp(path.join(tmpdir(), "fresh-authority-"));
  await claimHumanRetryAuthority(root, authority, "10050", { version: "jackyun-recovery-control-v1", kind: "new" });
  await assert.rejects(claimHumanRetryAuthority(root, authority, "10051", { version: "jackyun-recovery-control-v1", kind: "new" }), /另一完整/);
  await assert.rejects(readHumanRetryAuthority(value.authorizationId, async () => Response.json({ ...value, supersedes: { ...value.supersedes, ownerToken: "injected" } })), /无效/);
});

for (const boundary of ["reservation", "plan", "control", "baseline", "superseded", "active"]) test(`fresh crash after ${boundary} binds one successor and resumes without POST or overwriting old proof`, async t => {
  const x = await fixture(t), oldActive = await readFile(path.join(x.pipeline, "active.json")), originalPosts = x.posts();
  x.f.deps.freshRestartBoundary = async name => { if (name === boundary) throw new Error(`crash ${name}`); };
  await assert.rejects(x.run("plan-api", "9002"), new RegExp(`crash ${boundary}`));
  assert.throws(() => assertNoFreshRestart(x.root, ["9000"]), /SUPERSEDED/);
  const reservationFile = path.join(x.pipeline, "fresh-restarts/9000/reservation.json"), reserved = await readFile(reservationFile);
  const priorAuthority = x.f.deps.humanAuthority!.authority;
  x.setAuthority(x.authority(), "9003");
  await assert.rejects(x.run("plan-api", "9003"), /successor|预约/);
  assert.deepEqual(await readFile(reservationFile), reserved);
  x.setAuthority(priorAuthority); x.f.deps.freshRestartBoundary = undefined;
  await x.run("plan-api", "9002");
  assert.equal(x.posts(), originalPosts, "A reconciliation cannot POST import or dispatch");
  assert.deepEqual(await readFile(reservationFile), reserved);
  const receipt = JSON.parse(await readFile(path.join(x.pipeline, "fresh-restarts/9000/superseded.json"), "utf8"));
  assert.equal(receipt.oldActiveBytes, oldActive.toString("utf8"));
  assert.deepEqual((await readdir(path.join(x.pipeline, "fresh-restarts/9000"))).sort(), ["activated.json", "reservation.json", "superseded.json"]);
  assert.equal(JSON.parse(await readFile(path.join(x.pipeline, "active.json"), "utf8")).executionId, "9002");
});
