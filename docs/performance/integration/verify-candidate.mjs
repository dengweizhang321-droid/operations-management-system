import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { buildEntrypointPlan } from "../../../tools/worker-local-release-rotation.mjs";

const root = process.cwd();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const taskRuntime = path.join(root, ".runtime/performance-integration");
const dto = JSON.parse(await readFile(path.join(taskRuntime, "worker-plan.json"), "utf8"));
const rawPlan = await readFile(dto.planPath);
assert.equal(hash(rawPlan), dto.planSha256);
const plan = JSON.parse(rawPlan);
const runtime = "D:\\teruisi-runtime\\teruisi-worker-sales";
async function manifest(binding) {
  const manifestPath = path.join(runtime, "releases", binding.releaseId, "deployment-manifest.json");
  const bytes = await readFile(manifestPath);
  assert.equal(hash(bytes), binding.manifestSha256);
  return { manifestPath, manifestSha256: binding.manifestSha256, manifest: JSON.parse(bytes) };
}
const before = await manifest(plan.predecessor), candidate = await manifest(plan.candidate);
const entries = await buildEntrypointPlan(before, candidate);
assert.deepEqual(entries, plan.protectedEntrypoints);
for (const entry of entries) {
  const target = path.join(candidate.manifest.runtime.protectedSourceRoot, entry.relativePath);
  if (entry.predecessorSha256 !== null) assert.equal(hash(await readFile(target)), entry.predecessorSha256);
}
const workerRoot = path.dirname(candidate.manifestPath);
const djangoRoot = "D:\\teruisi-runtime\\django-sales\\app.deploy-5cdf848db1a64ccaa17044c91e59b1d4";
const prepared = JSON.parse(await readFile(path.join(djangoRoot, "deployment.json"), "utf8"));
const changed = execFileSync("git", ["diff", "--name-only", "bab42d8c", "2f46e1a998264a15ed514165942c5ecccd4fc044"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);
const sourceBindings = [];
const excludedTestSources = changed.filter(file => /^backend\//.test(file) && /\/tests\//.test(file));
for (const file of changed.filter(file => /^(app|lib|backend)\//.test(file) && !excludedTestSources.includes(file))) {
  const delivered = file.startsWith("backend/") ? path.join(djangoRoot, file) : path.join(workerRoot, "source-snapshot", file);
  const current = await readFile(path.join(root, file));
  assert.equal(hash(await readFile(delivered)), hash(current), file);
  sourceBindings.push({ file, sha256: hash(current), target: file.startsWith("backend/") ? "django" : "worker" });
}
const result = {
  verified: true, sourceCommit: "2f46e1a998264a15ed514165942c5ecccd4fc044",
  planSha256: dto.planSha256, candidateReleaseId: dto.candidateReleaseId,
  candidateManifestSha256: dto.candidateManifestSha256,
  predecessorReleaseId: dto.predecessorReleaseId,
  protectedEntrypointsUnchanged: entries.length,
  djangoPreparedId: "5cdf848db1a64ccaa17044c91e59b1d4",
  djangoAppFingerprint: prepared.appFingerprint,
  sourceBindings, excludedTestSources, productionAdopted: false,
};
await writeFile(path.join(taskRuntime, "candidate-verification.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, sourceBindings: sourceBindings.length }));
