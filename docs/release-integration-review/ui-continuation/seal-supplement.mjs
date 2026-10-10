// Prepare only. No engine, collector or production operator is invoked.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, open, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hash, batchSha, originalApproval, authorityPath, validateSupplement } from './supplement-controller.mjs';
const source = path.dirname(fileURLToPath(import.meta.url));
const root = 'E:\\codex-artifacts\\release-integration-review-20261010\\AB-ui-supplement-20261010-0820-final';
const d = 'D:\\.codex\\worktrees\\release-integration-review\\运营管理系统\\docs\\release-integration-review\\production';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function writeNew(filename, bytes) { const handle = await open(filename, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
const authorityRaw = await readFile(authorityPath), spec = JSON.parse(authorityRaw);
assert.equal(sha(authorityRaw), '896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347');
const originalOp = spec.batch.operations.find(op => op.id === 'actual-readonly-ui');
const failed = JSON.parse(await readFile(path.join(path.dirname(authorityPath), 'production/ui-third-failed-reconciliation.json')));
assert.equal(failed.status, 'failed'); assert.equal(failed.eventSha256, 'b68be115be0dc4061a1aca79df78eaabf2ed858e76e2c1bdb96c8c178e507556');
const proofPath = path.join(d, 'INDEPENDENT_UI_THIRD_FAILED_PROOF.json'), proofRaw = await readFile(proofPath), proof = JSON.parse(proofRaw);
assert.equal(failed.receiptSha256, hash(proof)); assert.equal(proof.allowedOriginalRetryCount, 0); assert.equal(proof.completed, false);
const observationsPath = path.resolve(proof.observationPath), observationsRaw = await readFile(observationsPath); assert.equal(sha(observationsRaw), proof.observationsSha256);
const uiReview = JSON.parse(await readFile(path.join(source, 'UI_FINAL_REVIEW.json'))), controllerReview = JSON.parse(await readFile(path.join(source, 'CONTROLLER_FINAL_REVIEW.json')));
assert.equal(uiReview.status, 'passed'); assert.equal(controllerReview.status, 'passed');
for (const [name, expected] of [['production-ui.mjs', uiReview.uiSha256], ['request-completion.mjs', uiReview.helperSha256], ['supplement-controller.mjs', controllerReview.controllerSha256]]) assert.equal(sha(await readFile(path.join(root, name))), expected);
const copies = ['UI_FINAL_REVIEW.json', 'UI_FINAL_REVIEW.md', 'CONTROLLER_FINAL_REVIEW.json', 'CONTROLLER_FINAL_REVIEW.md', 'PROTOCOL_REVIEW.md',
  'UI_FINAL_TESTS.log', 'independent-deadline-final.log', 'CONTROLLER_FINAL_TESTS.log', 'INDEPENDENT_CONTROLLER_SECOND.log',
  'request-completion.test.mjs', 'request-completion-independent.test.mjs', 'supplement-controller.test.mjs', 'supplement-controller.independent.test.mjs',
  'prepare-ui-supplement.mjs', 'seal-supplement.mjs'];
for (const name of copies) await writeNew(path.join(root, name), await readFile(path.join(source, name)));
const independent = { version: 'teruisi-ab-supplement-combined-review-v1', status: 'passed', uiSha256: uiReview.uiSha256,
  helperSha256: uiReview.helperSha256, controllerSha256: controllerReview.controllerSha256,
  uiReviewSha256: sha(await readFile(path.join(root, 'UI_FINAL_REVIEW.json'))), controllerReviewSha256: sha(await readFile(path.join(root, 'CONTROLLER_FINAL_REVIEW.json'))),
  scope: 'Two non-author reviews; actual production new UI and tail have not run. This aggregation is authored metadata, not a third independent review.' };
await writeNew(path.join(root, 'independent-review.json'), Buffer.from(JSON.stringify(independent, null, 2) + '\n'));
const files = [];
for (const filename of [...['production-ui.mjs', 'request-completion.mjs', 'supplement-controller.mjs', 'preparation.json', 'independent-review.json', ...copies].map(name => path.join(root, name)), proofPath, observationsPath]) files.push({ path: filename, sha256: sha(await readFile(filename)) });
const core = { version: 'teruisi-ab-readonly-ui-supplement-v1', sealedAt: new Date().toISOString(), originalBatchSha256: batchSha,
  originalBatchPath: authorityPath, originalBatchFileSha256: sha(authorityRaw), originalApprovedAt: originalApproval,
  operationId: originalOp.id, originalOperationSha256: hash(originalOp), binding: spec.batch.binding, assertions: originalOp.assertions, covers: originalOp.covers,
  failedEventSha256: failed.eventSha256, failedAt: failed.at, outputRoot: root, files,
  failureProof: { path: proofPath, sha256: sha(proofRaw) }, failureObservations: { path: observationsPath, sha256: sha(observationsRaw) },
  independentReview: { path: path.join(root, 'independent-review.json'), sha256: files.find(file => file.path.endsWith('independent-review.json')).sha256, status: 'passed' },
  isolatedTests: { path: path.join(root, 'UI_FINAL_TESTS.log'), sha256: files.find(file => file.path.endsWith('UI_FINAL_TESTS.log')).sha256, status: 'passed',
    separateSuites: { uiRealChromeAndOriginalAudit: 16, independentDeadline: 5, authorControllerIncludingAdoptedEngine: 17, independentController: 8 }, notOneFullSuite: true },
  policy: { maxNewUiAttempts: 1, originalAttemptSucceeded: false, oldUnknownAndFailureRecordsPreserved: true, productionWritesInNewUiAllowed: false,
    candidateChanged: false, originalBatchChanged: false, cAdoptionAllowed: false, originalTailOperationsOnly: spec.batch.operations.slice(10).map(op => op.id),
    tailFailure: 'Independent exact reconciliation; once UI supplemented successfully use the original engine only, never rerun this single-use controller.' } };
const supplement = { ...core, supplementSha256: hash(core) };
// Schema validation time is deliberately not execution approval.
validateSupplement(spec, supplement, supplement.supplementSha256, core.sealedAt);
const manifestRaw = Buffer.from(JSON.stringify(supplement, null, 2) + '\n'); await writeNew(path.join(root, 'supplement.json'), manifestRaw);
const delivery = { preparedAt: core.sealedAt, status: 'prepared-awaiting-explicit-supplement-approval', supplementSha256: supplement.supplementSha256,
  manifestPath: path.join(root, 'supplement.json'), manifestFileSha256: sha(manifestRaw), files: files.length, sourceCommit: '5faac8151f59d66de72c3caead8cad916ea547da',
  releaseId: '20261010T014638Z-97833d2f2b7e7bc9', uiSha256: independent.uiSha256, helperSha256: independent.helperSha256, controllerSha256: independent.controllerSha256,
  originalFailedEventSha256: failed.eventSha256, humanApproved: false, productionExecuted: false, originalBatchCompleted: false };
await writeNew(path.join(root, 'sealed-supplement.json'), Buffer.from(JSON.stringify(delivery, null, 2) + '\n'));
await writeFile(path.join(source, 'SEALED_SUPPLEMENT.json'), JSON.stringify(delivery, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(delivery));
