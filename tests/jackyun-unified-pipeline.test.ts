import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { unifiedFixture } from "./fixtures/jackyun-unified-recovery";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import { runJackyunExportFirstAction } from "../tools/jackyun-export-first-pipeline";

for (const failedModule of jackyunModuleOrder) test(`real five-table pipeline resumes response loss at ${failedModule} without re-exporting or re-importing any committed table`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-unified-full-"));
  const f = await unifiedFixture(root), originalFetch = globalThis.fetch;
  globalThis.fetch = f.request; t.after(() => { globalThis.fetch = originalFetch; });
  const run = (action: string, id = "9000") => runJackyunExportFirstAction(action, id, f.deps);
  await run("plan-api"); await run("export-all"); await run("validate");
  f.failAfterCommit(failedModule);
  await assert.rejects(run("import"), /response lost after commit/);
  const committedIndex = jackyunModuleOrder.indexOf(failedModule);
  for (const [i, moduleKey] of jackyunModuleOrder.entries()) assert.equal(f.completes[moduleKey], i <= committedIndex ? 1 : 0);
  f.deps.recoveryRequest = { version: "jackyun-recovery-control-v1", kind: "retry", logicalExecutionId: "9000", failedExecutionId: "9000" };
  f.deps.readOwnerState = () => "error";
  f.deps.recoveryEvidence = () => ({ evidence: { status: "error", activeExecutions: 0, retrySuccessId: null }, replacement: { executionId: "9001" } }) as ReturnType<NonNullable<typeof f.deps.recoveryEvidence>>;
  for (const action of ["plan-api", "export-all", "validate", "import", "verify"]) await run(action, "9001");
  assert.equal(f.exportCount(), 1);
  for (const moduleKey of jackyunModuleOrder) assert.equal(f.completes[moduleKey], 1, `${moduleKey} commits exactly once`);
  assert.deepEqual([...f.verified].sort(), [...jackyunModuleOrder].sort());
  const planFile = path.join(root, "outputs/jackyun-export-first/n8n-export-first-9000.json");
  const completedBytes = await readFile(planFile), completed = JSON.parse(completedBytes.toString("utf8"));
  assert.equal(completed.phase, "completed");
  // A later independent collection is active. A delayed retry still binds
  // the original logical run and must not take over that new active pointer.
  const activeFile = path.join(root, "outputs/jackyun-export-first/active.json");
  const activeBytes = JSON.stringify({ executionId: "9100", runId: "n8n-export-first-9100" });
  await writeFile(activeFile, activeBytes);
  f.deps.now = () => new Date("2026-10-14T04:00:00.000Z");
  f.deps.recoveryRequest = { ...f.deps.recoveryRequest, failedExecutionId: "9001" };
  for (const action of ["plan-api", "export-all", "validate", "import", "verify"]) await run(action, "9200");
  assert.equal(await readFile(activeFile, "utf8"), activeBytes);
  assert.deepEqual(await readFile(planFile), completedBytes, "logical completion history stays unchanged across midnight and delayed retries");
  assert.equal(f.exportCount(), 1);
  for (const moduleKey of jackyunModuleOrder) assert.equal(f.completes[moduleKey], 1);
});
