// Read-only candidate verification and a NON-EXECUTABLE scope document.
// No engine batch, approval, lifecycle, install, backup or production writes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const runtime = 'D:/teruisi-runtime/teruisi-worker-sales';
const artifact = 'E:/codex-artifacts/release-integration-review-20261010';
const tools = await import(pathToFileURL(path.resolve(own, '../../tools/release-impact.mjs')));
const { safeFileDigest, readSourceTree, sourceTreeDigest, sourceInventory, hash, canonical } = tools;
const read = async name => JSON.parse(await readFile(name));
const evidence = await read(own + '/evidence/independent-reviewed-source-final.json');
const plans = {
  AB: { commit: '5faac8151f59d66de72c3caead8cad916ea547da', plan: '266a8574000a90cbeb5baf12fcba7bc2f4a8a06f0262f3b47d4ad73b9d0ddaee' },
  ABC: { commit: '9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c', plan: '1b8cd3f26b9e0ed386a32518077ca3f836414b737f1a7026593c9e1ff3f44107' },
};
const djangoPath = 'D:/teruisi-runtime/django-sales/app/deployment.json';
const djangoSha256 = await safeFileDigest(djangoPath);
assert.equal(djangoSha256, '237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9');
const records = {};
for (const [scope, input] of Object.entries(plans)) {
  const planPath = `${runtime}/state/worker-release-rotation-plans/${input.plan}.json`;
  assert.equal(await safeFileDigest(planPath), input.plan);
  const plan = await read(planPath);
  assert.equal(plan.status, 'candidate_verified');
  assert.equal(plan.predecessor.releaseId, '20261009T080026Z-d5fb5b62de630ae2');
  const candidateRoot = `${runtime}/releases/${plan.candidate.releaseId}`;
  const manifestPath = candidateRoot + '/deployment-manifest.json';
  assert.equal(await safeFileDigest(manifestPath), plan.candidate.manifestSha256);
  const manifest = await read(manifestPath);
  const before = await readSourceTree(`${runtime}/releases/${plan.predecessor.releaseId}/source-snapshot`);
  const after = await readSourceTree(candidateRoot + '/source-snapshot');
  assert.equal(sourceTreeDigest(before), '8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646');
  assert.equal(sourceTreeDigest(after), manifest.source.sourceFingerprint);
  const bi = sourceInventory(before), ai = sourceInventory(after);
  const changed = [...new Set([...Object.keys(bi), ...Object.keys(ai)])].filter(name => bi[name] !== ai[name]).sort();
  assert.equal(changed.length, scope === 'AB' ? 124 : 164);
  assert.ok(changed.every(name => /^(tools|tests|docs)\//.test(name)));
  const coreFiles = [];
  for (const reviewed of evidence.implementationFiles) {
    if (scope === 'AB' && ['tools/release-preparation-evidence.mjs', 'tools/release-admission-timing.mjs'].includes(reviewed.path)) {
      assert.equal(ai[reviewed.path], undefined);
      coreFiles.push({ path: reviewed.path, sha256: null, matchesCombinedReview: false, reason: 'C module excluded from first AB batch' });
      continue;
    }
    const actual = await safeFileDigest(path.join(candidateRoot, 'source-snapshot', reviewed.path));
    if (scope === 'ABC') assert.equal(actual, reviewed.afterSha256, reviewed.path);
    coreFiles.push({ path: reviewed.path, sha256: actual, matchesCombinedReview: actual === reviewed.afterSha256 });
  }
  for (const entry of manifest.artifacts.keyFiles) assert.equal(await safeFileDigest(path.join(candidateRoot, entry.relativePath)), entry.sha256, entry.relativePath);
  for (const name of ['guardReceipt', 'helperReceipt', 'contractReceipt', 'd1RetirementReceipt']) {
    const entry = manifest.artifacts[name];
    assert.equal(await safeFileDigest(path.join(candidateRoot, entry.relativePath)), entry.sha256, name);
  }
  const planSummary = { status: 'planned', version: plan.version, planSha256: input.plan, planPath: path.resolve(planPath),
    predecessorReleaseId: plan.predecessor.releaseId, candidateReleaseId: plan.candidate.releaseId,
    candidateManifestSha256: plan.candidate.manifestSha256, candidateGuardReceiptSha256: plan.candidate.guardReceiptSha256,
    cutoverId: plan.lineage.cutoverId };
  const handoff = { sourceGitCommit: input.commit, scope: scope + ' plus reviewed necessary safety repairs', workerPlan: planSummary,
    predecessor: plan.predecessor, djangoManifestSha256: djangoSha256, djangoChange: false, productionApproval: false, productionAdopted: false,
    sourceRoot: 'D:\\运营管理系统-sales-django-release', immutableCandidateRoot: path.resolve(candidateRoot),
    watchdogAdoption: 'Separate original Install -Execute copies script/helper/launcher and updates/enables/starts existing task; requires final explicit task scope approval' };
  // Existing AB handoff was recorded before this final read-only inventory.
  if (scope === 'AB') {
    const prior = await read(`${artifact}/AB/candidate-handoff.json`);
    assert.equal(prior.sourceGitCommit, input.commit);
    assert.equal(prior.workerPlan.planSha256, input.plan);
  } else {
    await mkdir(`${artifact}/ABC`, { recursive: true });
    await writeFile(`${artifact}/ABC/candidate-handoff.json`, JSON.stringify(handoff, null, 2) + '\n', { flag: 'wx' });
    await writeFile(`${artifact}/ABC/worker-plan.json`, await readFile(planPath), { flag: 'wx' });
    await writeFile(`${artifact}/ABC/worker-manifest.json`, await readFile(manifestPath), { flag: 'wx' });
  }
  records[scope] = { ...handoff, completePredecessorFiles: Object.keys(before).length, completeCandidateFiles: Object.keys(after).length,
    predecessorSourceSha256: sourceTreeDigest(before), candidateSourceSha256: sourceTreeDigest(after),
    candidateInventorySha256: hash(ai), predecessorInventorySha256: hash(bi), changedPaths: changed,
    businessAndDependencySourceChanges: [], sourceInvarianceIsNotProductionAcceptance: true,
    keyFileHashesVerified: manifest.artifacts.keyFiles.length, immutableReceiptHashesVerified: 4, coreFiles,
    build: manifest.build, preparation: await read(`${own}/evidence/${scope.toLowerCase()}-online-prepare.json`) };
}
const result = {
  version: 'teruisi-task-d-non-executable-candidate-scope-v1', capturedAt: new Date().toISOString(),
  status: 'candidates-prepared-release-execution-blocked', records,
  default: 'AB first; C second must be rebuilt and rebound to the NEW ACTUAL predecessor after AB adoption',
  alternative: 'ABC strict single batch only while AB has not been adopted; fixed source is currently AB, so ABC mutable-source identity is NOT currently eligible',
  safeguards: 'STRICT/FULL pre and post Backup/Verify/RestoreRehearsal; original maintenance/drain, identities, permissions, 12 enabled domains, exact resources, business/history acceptance and two natural watchdog observations all remain required',
  django: { path: path.resolve(djangoPath), predecessorSha256: djangoSha256, candidateSha256: djangoSha256, deployApp: false },
  engineBatchSha256: null, productionApproval: false, productionAdopted: false, productionExecutionPerformed: false,
  recoveryFastPathEligible: false, schedulerLatest: 'unknown',
  blockers: ['Execution adapters and complete actual tool/installed-owner closure are not sealed (BD01-BD10); withdrawn draft is not a production entrypoint',
    'Current business/history baseline, exact read-only UI resources/routes and all strict acceptance coverage must be concretely bound and independently reviewed',
    'Original independent watchdog installer/task XML, physical installed control/helper, owner and all native dependencies require exact final binding; do not infer installation from Worker package',
    'Fresh dynamic admission, active/unknown reconciliation, permissions, maintenance/drain and final predecessor/identity check remain mandatory',
    'Final engine batch bytes/operation scope and rollback must be reviewed before the human separately approves that exact batch'],
  measurements: { approvalToRequiredAcceptanceMs: null, approvalToFullDeliveryMs: null, otherBatchQueueMs: null,
    actualEntrypointUnavailableMs: null, comparativeProductionBeforeAfter: 'not measured; no downtime or minutes guarantee established' },
};
await writeFile(own + '/candidate-scope.json', canonical(result) + '\n', { flag: 'wx' });
const sha256 = await safeFileDigest(own + '/candidate-scope.json');
await writeFile(own + '/candidate-scope.json.sha256', sha256 + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, scopeDocumentSha256: sha256, AB: records.AB.workerPlan, ABC: records.ABC.workerPlan }));
