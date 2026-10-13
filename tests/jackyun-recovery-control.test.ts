import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendRecoveryControl, parseRecoveryRequest, readRecoveryControl, recoveryProtocol, type RecoveryControl } from "../lib/jackyun/recovery-control";
import { acquireJackyunRunLock } from "../lib/jackyun/run-lock";
import { isProvenJackyunPreclaimWaiter } from "../lib/jackyun/n8n-preflight-decode";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-control-"));
  const lock = await acquireJackyunRunLock({ runId: "n8n-export-first-8556", purpose: "recovery-test", lockDirectory: path.join(root, "lock") });
  t.after(async () => { await lock.release(); assert(path.dirname(root) === tmpdir()); await rm(root, { recursive: true, force: true }); });
  const record: Omit<RecoveryControl, "sequence" | "previousDigest"> = { version: recoveryProtocol, logicalExecutionId: "8548", sourceExecutionId: "8548", attemptExecutionId: "8556",
    ownerToken: lock.ownerToken, generation: 1, decision: "resume" as const, proofDigest: "1".repeat(64), at: "2026-10-13T01:00:00.000Z",
    failureAttempts: 0, nextAllowedAt: null };
  return { root, lock, record };
}
test("retry requires an exact original run and failed attempt; new collection is explicit", () => {
  assert.equal(parseRecoveryRequest('{"version":"jackyun-recovery-control-v1","kind":"new"}').kind, "new");
  assert.equal(parseRecoveryRequest(JSON.stringify({ version: recoveryProtocol, kind: "retry", logicalExecutionId: "8548", failedExecutionId: "8556" })).kind, "retry");
  for (const value of [null, [], { version: recoveryProtocol, kind: "retry" }, { version: recoveryProtocol, kind: "new", logicalExecutionId: "8548" },
    { version: recoveryProtocol, kind: "retry", logicalExecutionId: "8556", failedExecutionId: "8548" }]) assert.throws(() => parseRecoveryRequest(JSON.stringify(value)));
});
test("recovery chain survives restarts and fences stale append attempts", async t => {
  const f = await fixture(t);
  const first = await appendRecoveryControl(f.root, f.record, null, f.lock.assertOwned);
  assert.deepEqual(await readRecoveryControl(f.root, "8548"), first);
  const next = await appendRecoveryControl(f.root, { ...f.record, attemptExecutionId: "8557", at: "2026-10-13T02:00:00.000Z" }, first.digest, f.lock.assertOwned);
  assert.equal(next.record.sequence, 2);
  await assert.rejects(appendRecoveryControl(f.root, f.record, first.digest, f.lock.assertOwned), /代次/);
  assert.deepEqual(await readRecoveryControl(f.root, "8548"), next);
});
test("corrupt, missing, partial and leftover temporary records stop without deleting evidence", async t => {
  for (const mutation of ["digest", "gap", "temporary"]) {
    const f = await fixture(t);
    await appendRecoveryControl(f.root, f.record, null, f.lock.assertOwned);
    const dir = path.join(f.root, "outputs/jackyun-export-first/recovery-control/8548");
    const file = path.join(dir, "0001.json");
    if (mutation === "digest") await writeFile(file, '{"record":');
    else if (mutation === "gap") await writeFile(path.join(dir, "0003.json"), await readFile(file));
    else await writeFile(path.join(dir, "0002.json.residue.tmp"), "partial");
    const before = await readFile(file);
    await assert.rejects(readRecoveryControl(f.root, "8548"));
    assert.deepEqual(await readFile(file), before);
  }
});
test("two writers cannot both publish the same recovery generation", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([1, 2].map(() => appendRecoveryControl(f.root, f.record, null, f.lock.assertOwned)));
  assert(results.filter(r => r.status === "fulfilled").length <= 1);
  assert(results.some(r => r.status === "rejected"));
  assert.equal(JSON.parse(await readFile(path.join(f.root, "outputs/jackyun-export-first/recovery-control/8548/0001.json"), "utf8")).record.sequence, 1);
  // The losing writer retains its temporary evidence. Recovery stops until an
  // operator reconciles it, rather than silently deciding who owns the record.
  await assert.rejects(readRecoveryControl(f.root, "8548"), /临时/);
});
test("ownership is checked again after late responses", async t => {
  const f = await fixture(t);
  const ownerPath = path.join(f.root, "lock/owner.json"), original = await readFile(ownerPath, "utf8");
  await writeFile(ownerPath, JSON.stringify({ ...JSON.parse(original), ownerToken: "2".repeat(36) }));
  await assert.rejects(f.lock.assertOwned(), /所有权/);
  await assert.rejects(appendRecoveryControl(f.root, f.record, null, f.lock.assertOwned), /所有权/);
  await writeFile(ownerPath, original);
});
function waiting(claims: string[], additional = "") {
  return JSON.stringify([{ resultData: "1" }, { runData: "2" }, {
    "领取共享 helper": claims.map(status => ({ executionStatus: "success", data: { main: [[{ json: { ok: true, workflow: "jackyun", coordinationStatus: status } }]] } })),
    ...(additional ? { [additional]: [] } : {}),
  }]);
}
test("only proven preclaim waiting executions are excluded; unknown and former owners remain blockers", () => {
  assert.equal(isProvenJackyunPreclaimWaiter(waiting(["waiting", "waiting"])), true);
  for (const raw of [waiting([]), waiting(["granted", "waiting"]), waiting(["waiting"], "A·固定采集日和销售日期"),
    waiting(["waiting"], "未知节点"), "{}", "partial"]) assert.equal(isProvenJackyunPreclaimWaiter(raw), false);
});
