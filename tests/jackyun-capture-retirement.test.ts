import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { inspectCaptureRetirement, publishCaptureRetirement, assertCaptureRetired } from "../lib/jackyun/capture-retirement";
import { recordJackyunSafeWait } from "../lib/jackyun/recovery-wait";

test("cross-day new collection requires durable no-pending checkpoints; old capture remains unfinished", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-retire-")); t.after(() => rm(root, { recursive: true, force: true }));
  const plan = { executionId: "8548", runId: "n8n-export-first-8548", runDate: "2026-10-13", phase: "exporting" };
  const out = path.join(root, "outputs/jackyun-import-runs", plan.runId), pipe = path.join(root, "outputs/jackyun-export-first");
  await mkdir(out, { recursive: true }); await mkdir(pipe, { recursive: true });
  const bytes = JSON.stringify(plan); await writeFile(path.join(pipe, plan.runId + ".json"), bytes);
  const statePath = path.join(out, "api-controller-state.json");
  const state = { version: 2, runId: plan.runId, runDate: plan.runDate, modules: { inventory: { status: "handed_off" }, combos: { status: "handed_off" }, sales: { status: "handed_off" } } };
  await writeFile(statePath, JSON.stringify(state));
  const proof = await inspectCaptureRetirement(root, plan, "2026-10-14T04:00:00.000Z"); assert(proof);
  assert.equal(proof.oldCaptureDate, "2026-10-13"); assert.equal(proof.nextCaptureDate, "2026-10-14");
  await publishCaptureRetirement(root, proof, "8556"); await assertCaptureRetired(root, "8548", "8556");
  await assert.rejects(assertCaptureRetired(root, "8548", "8557"));
  assert.equal(await readFile(path.join(pipe, plan.runId + ".json"), "utf8"), bytes);
  for (const status of ["submit_intent", "submitted", "unknown"]) {
    await writeFile(statePath, JSON.stringify({ ...state, modules: { ...state.modules, inventory_age: { status } } }));
    assert.equal(await inspectCaptureRetirement(root, plan, "2026-10-14T04:00:00.000Z"), null);
  }
  await writeFile(statePath, JSON.stringify({ ...state, version: 1 }));
  assert.equal(await inspectCaptureRetirement(root, plan, "2026-10-14T04:00:00.000Z"), null);
});

test("normal task waiting persists its own bounded poll budget and never creates failure dispatches", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-wait-")); t.after(() => rm(root, { recursive: true, force: true }));
  const options = { root, runId: "n8n-export-first-8548", reason: "export_inventory", at: "2026-10-13T00:00:00.000Z", assertOwned: async () => undefined, maxPolls: 2 };
  assert.equal((await recordJackyunSafeWait(options)).recoveryDecision, "wait");
  await recordJackyunSafeWait({ ...options, at: "2026-10-13T00:05:00.000Z" });
  await assert.rejects(recordJackyunSafeWait({ ...options, at: "2026-10-13T00:10:00.000Z" }), /预算已用尽/);
  await assert.rejects(readFile(path.join(root, "outputs/jackyun-export-first/retry-budget/8548/0001.json")), /ENOENT/);
});
