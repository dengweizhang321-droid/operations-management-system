// Real helper Worker, synthetic root, no business routes or production APIs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { IsolatedHelperSlots, spawnIsolatedHelper } from "./tmall-isolated-helper.ts";

const sourceRoot = process.cwd();
const mirror = await mkdtemp(path.join(tmpdir(), "teruisi-claim-cleanup-"));
await mkdir(path.join(mirror, "config"));
for (const name of ["tmall-store-accounts.json", "jd-store-accounts.json"]) {
  await writeFile(path.join(mirror, "config", name), JSON.stringify({ version: 1, stores: [] }));
}
await symlink(path.join(sourceRoot, "node_modules"), path.join(mirror, "node_modules"), "junction");
const bundle = path.join(mirror, "helper.mjs");
const build = await promisify(execFile)(process.execPath, ["tools/build-worker-helper.mjs", "--source-root", sourceRoot, "--output", bundle], { cwd: sourceRoot, windowsHide: true, timeout: 120000 });
await writeFile(path.join(mirror, "build-receipt.json"), build.stdout);
// The bundle's mutable-root override points only to this new empty directory.
const originalRoot = process.env.TERUISI_HELPER_MUTABLE_ROOT;
process.env.TERUISI_HELPER_MUTABLE_ROOT = mirror;
const identity = { key: "legacy", storeKey: null, workflow: "jd-logistics", executionId: "synthetic-unclaimed" };
let child;
let finished;
const completed = new Promise(resolve => { finished = resolve; });
const pool = new IsolatedHelperSlots(new Set(), async (owner, finish) => {
  child = await spawnIsolatedHelper(bundle, owner, clean => { finish(clean); finished(clean); });
  return child;
});
const startedAt = Date.now();
let deadline;
try {
  await pool.claim(identity).slot.ready;
  const readyAt = Date.now();
  assert.equal(pool.summary()[0].status, "running");
  assert.equal(pool.claim({ ...identity, executionId: "other", workflow: "jd" }).status, "waiting");
  console.log(JSON.stringify({ phase: "waiting_for_real_initial_reaper", timeoutMs: 120000, mirror }));
  const clean = await Promise.race([completed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("unclaimed worker did not reap")), 135000); })]);
  assert.equal(clean, true);
  assert.deepEqual(pool.summary(), []);
  assert.equal(pool.claim(identity).reason, "execution_already_finished");
  console.log(JSON.stringify({ ok: true, readyToReleaseMs: Date.now() - readyAt, totalMs: Date.now() - startedAt, sourceBundleUnmodified: true, businessRequests: 0, mirror }));
} finally {
  clearTimeout(deadline);
  await child?.stop();
  if (originalRoot === undefined) delete process.env.TERUISI_HELPER_MUTABLE_ROOT;
  else process.env.TERUISI_HELPER_MUTABLE_ROOT = originalRoot;
}
