// Explicitly approved task D supplement; imports the unchanged adopted engine.
// It replaces one FAILED readonly validation attempt, never a lifecycle action.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const batchSha = '9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
export const originalApproval = '2026-10-10T05:28:51.000Z';
export const authorityPath = 'E:\\codex-artifacts\\release-integration-review-20261010\\AB-v2-555729fd8f1dedc2\\approved-batch.json';
const authorityFileSha = '896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347';
const adoptedRoot = 'D:\\teruisi-runtime\\teruisi-worker-sales\\releases\\20261010T014638Z-97833d2f2b7e7bc9';
const journalRoot = 'D:\\teruisi-runtime\\teruisi-worker-sales\\state\\release-batches';
const reason = 'explicitly-approved-readonly-validation-supplement';
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const requireSha = value => assert.match(value ?? '', /^[a-f0-9]{64}$/);

export function validateSupplement(spec, supplement, approved, approvedAt, now = Date.now()) {
  const { supplementSha256, ...core } = supplement;
  requireSha(approved); assert.equal(hash(core), supplementSha256); assert.equal(approved, supplementSha256);
  assert.equal(supplement.version, 'teruisi-ab-readonly-ui-supplement-v1');
  assert.equal(spec.batch.batchSha256, batchSha); assert.equal(supplement.originalBatchSha256, batchSha);
  assert.equal(spec.journalRoot, journalRoot); assert.equal(supplement.originalBatchPath, authorityPath);
  assert.equal(supplement.originalBatchFileSha256, authorityFileSha); assert.equal(supplement.originalApprovedAt, originalApproval);
  assert.ok(Number.isFinite(Date.parse(supplement.failedAt)) && Number.isFinite(Date.parse(supplement.sealedAt)) && Date.parse(supplement.sealedAt) >= Date.parse(supplement.failedAt));
  assert.ok(Number.isFinite(Date.parse(approvedAt)) && Date.parse(approvedAt) > Date.parse(supplement.failedAt) && Date.parse(approvedAt) >= Date.parse(supplement.sealedAt) && Date.parse(approvedAt) <= now);
  assert.equal(supplement.operationId, 'actual-readonly-ui');
  const op = spec.batch.operations.find(item => item.id === supplement.operationId);
  assert.ok(op && op.kind === 'command' && op.phase === 'acceptance' && op.mutating === false && !op.readOnlyRetry);
  assert.equal(hash(op), supplement.originalOperationSha256); assert.equal(canonical(supplement.binding), canonical(spec.batch.binding));
  assert.equal(supplement.binding.artifactSha256, 'f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113');
  assert.equal(canonical(supplement.assertions), canonical(op.assertions)); assert.equal(canonical(supplement.covers), canonical(op.covers));
  assert.ok(!spec.collector.transport); assert.equal(hash(spec.collector), spec.batch.collectorSha256);
  requireSha(supplement.failedEventSha256); requireSha(supplement.failureProof.sha256); requireSha(supplement.failureObservations.sha256); requireSha(supplement.independentReview.sha256);
  assert.equal(supplement.independentReview.status, 'passed'); assert.equal(supplement.isolatedTests.status, 'passed');
  assert.ok(Array.isArray(supplement.files) && supplement.files.length >= 6);
  assert.equal(new Set(supplement.files.map(file => path.resolve(file.path))).size, supplement.files.length);
  for (const file of supplement.files) { assert.ok(path.isAbsolute(file.path)); requireSha(file.sha256); }
  assert.ok(supplement.files.some(file => file.path === supplement.failureProof.path && file.sha256 === supplement.failureProof.sha256));
  assert.ok(supplement.files.some(file => file.path === supplement.failureObservations.path && file.sha256 === supplement.failureObservations.sha256));
  assert.ok(supplement.files.some(file => file.path === supplement.independentReview.path && file.sha256 === supplement.independentReview.sha256));
  assert.ok(supplement.files.some(file => file.path === supplement.isolatedTests.path && file.sha256 === supplement.isolatedTests.sha256));
  assert.ok(path.isAbsolute(supplement.outputRoot));
  assert.equal(path.dirname(path.resolve(supplement.outputRoot)), path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
  assert.match(path.basename(supplement.outputRoot), /^AB-ui-supplement-20261010-[a-z0-9-]+$/);
  for (const name of ['production-ui.mjs', 'request-completion.mjs', 'supplement-controller.mjs']) assert.ok(supplement.files.some(file => file.path === path.join(supplement.outputRoot, name)));
  return op;
}

export function validateSupplementState(state, active, spec, supplement) {
  assert.deepEqual(active, { batchSha256: batchSha, id: spec.batch.id });
  assert.equal(state.unknown.length, 0, 'Unresolved operations cannot be replayed');
  const ui = state.latest.get('actual-readonly-ui');
  assert.ok(ui?.status === 'failed' && ui.eventSha256 === supplement.failedEventSha256, 'Only the exact independently resolved failed attempt is eligible');
  assert.equal(ui.at, supplement.failedAt, 'Failure time must bind the exact journal event');
  const index = spec.batch.operations.findIndex(op => op.id === 'actual-readonly-ui');
  for (const op of spec.batch.operations.slice(0, index)) assert.equal(state.latest.get(op.id)?.status, 'passed', 'Original prior operations cannot replay');
  for (const op of spec.batch.operations.slice(index + 1)) assert.ok(!state.latest.has(op.id), 'Unexpected subsequent work changes supplement eligibility');
}

async function digestFile(filename) {
  assert.ok(path.isAbsolute(filename));
  filename = path.resolve(filename);
  let cursor = path.parse(filename).root;
  for (const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); const info = await lstat(cursor);
    assert.ok(!info.isSymbolicLink()); if (cursor !== filename) assert.ok(info.isDirectory());
  }
  const before = await lstat(filename, { bigint: true }); assert.ok(before.isFile() && before.nlink === 1n);
  const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk);
  const after = await lstat(filename, { bigint: true });
  for (const key of ['size', 'mtimeNs', 'ctimeNs', 'ino', 'dev']) assert.equal(before[key], after[key]);
  return digest.digest('hex');
}
const verifyFiles = async files => { for (const file of files) assert.equal(await digestFile(file.path), file.sha256, 'A sealed dependency changed'); };

export async function executeSupplement({ spec, supplement, approved, approvedAt, approvalEvidence, runtime }) {
  const originalOp = validateSupplement(spec, supplement, approved, approvedAt);
  assert.ok(approvalEvidence?.explicitHumanApproval === true && approvalEvidence.supplementSha256 === approved && approvalEvidence.approvedAt === approvedAt);
  assert.match(approvalEvidence.userItemId ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.notEqual(approvalEvidence.userItemId, '01a12449-131b-7dd0-ae6f-b98a5f32b283', 'The old AB approval cannot authorize a new supplement');
  const { executeBatch, runApprovedOperation, journalState, writeOnce, withRotationLock, collectCurrent, safeRead } = runtime;
  return executeBatch({ batch: spec.batch, approved: batchSha, approvedAt: originalApproval, root: spec.journalRoot,
    lock: callback => withRotationLock(async lease => {
      await runtime.verifyFiles(supplement.files);
      const state = await journalState(spec.journalRoot, spec.batch), active = JSON.parse(await safeRead(path.join(spec.journalRoot, 'active.json')));
      validateSupplementState(state, active, spec, supplement);
      const proof = JSON.parse(await safeRead(supplement.failureProof.path));
      assert.ok(proof.independent === true && proof.noEffect === true && proof.noReplay === true && proof.batchSha256 === batchSha && proof.operationId === originalOp.id && proof.completed === false);
      assert.equal(path.resolve(proof.observationPath), path.resolve(supplement.failureObservations.path)); assert.equal(proof.observationsSha256, supplement.failureObservations.sha256);
      assert.equal(state.latest.get(originalOp.id).receiptSha256, hash(proof));
      const review = JSON.parse(await safeRead(supplement.independentReview.path));
      assert.equal(review.status, 'passed');
      for (const [key, name] of [['uiSha256', 'production-ui.mjs'], ['helperSha256', 'request-completion.mjs'], ['controllerSha256', 'supplement-controller.mjs']]) assert.equal(review[key], supplement.files.find(file => file.path === path.join(supplement.outputRoot, name)).sha256);
      for (const name of ['supplement-intent.json', 'supplement-started.json', 'supplement-result.json', 'production-ui-audit.json', 'production-ui-result.json']) {
        try { await safeRead(path.join(supplement.outputRoot, name)); throw new Error('Supplement output namespace is already occupied; independent reconciliation required'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const approval = { supplementSha256: approved, approvedAt, approvalEvidenceSha256: hash(approvalEvidence), userItemId: approvalEvidence.userItemId, originalApprovedAt: originalApproval, originalFailedEventSha256: supplement.failedEventSha256 };
      try { await writeOnce(path.join(supplement.outputRoot, 'supplement-approval.json'), approval); }
      catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(canonical(JSON.parse(await safeRead(path.join(supplement.outputRoot, 'supplement-approval.json')))), canonical(approval)); }
      return callback(lease);
    }),
    collectCurrent,
    run: async (op, context) => {
      await runtime.verifyFiles(supplement.files);
      assert.equal(hash(op), hash(spec.batch.operations.find(item => item.id === op.id)));
      if (op.id !== 'actual-readonly-ui') return runApprovedOperation(op, context);
      // New attempt, same obligation, explicitly new approved program. Old
      // failed/unknown events and old authority bytes remain untouched.
      const replacement = { ...op, command: { ...op.command, args: [path.join(supplement.outputRoot, 'production-ui.mjs')], files: [...op.command.files, ...supplement.files] } };
      const started = context.state.latest.get(op.id);
      assert.equal(started.status, 'started'); requireSha(started.eventSha256);
      await writeOnce(path.join(supplement.outputRoot, 'supplement-intent.json'), { supplementSha256: approved, originalFailedEventSha256: supplement.failedEventSha256, parentStartedEventSha256: started.eventSha256, intendedAt: new Date().toISOString(), operationId: op.id, productionBusinessWritesAllowed: false });
      await writeOnce(path.join(supplement.outputRoot, 'supplement-started.json'), { supplementSha256: approved, originalFailedEventSha256: supplement.failedEventSha256, parentStartedEventSha256: started.eventSha256, commandSha256: hash(replacement.command), maxAttempts: 1, startedAt: new Date().toISOString() });
      const result = await runApprovedOperation(replacement, context);
      assert.equal(result.status, 'passed');
      const auditRaw = await safeRead(path.join(supplement.outputRoot, 'production-ui-audit.json'));
      const resultRaw = await safeRead(path.join(supplement.outputRoot, 'production-ui-result.json'));
      const audit = JSON.parse(auditRaw), ui = JSON.parse(resultRaw);
      assert.ok(audit.status === 'passed' && audit.productionWrites === 0 && audit.attemptedBusinessWrites === 0);
      for (const key of ['dangerous', 'failures', 'missing']) assert.deepEqual(audit[key], []);
      assert.ok(audit.attempts.length > 0 && audit.attempts.every(item => item.method === 'GET'));
      assert.ok(ui.status === 'passed' && ui.realHome === true && ui.productionWrites === 0 && ui.customerDetailsPersisted === false);
      assert.deepEqual(ui.cases, ['three-date-cancellations', 'search-cancel-clear-recovers', 'customer-current-scope-and-readonly-detail', 'product-back-four-viewports-keyboard'].map(name => ({ name, status: 'passed' })));
      await runtime.verifyFiles(supplement.files);
      const receipt = { version: supplement.version, supplementSha256: approved, originalBatchSha256: batchSha, originalFailedEventSha256: supplement.failedEventSha256,
        parentStartedEventSha256: started.eventSha256, commandSha256: hash(replacement.command), originalAttemptSucceeded: false, acceptanceCompletedBySupplement: true, observedAt: new Date().toISOString(), auditSha256: hash(auditRaw), uiResultSha256: hash(resultRaw), originalAdapterResult: result };
      await writeOnce(path.join(supplement.outputRoot, 'supplement-result.json'), receipt);
      return { ...result, reason, receiptSha256: hash(receipt) };
    },
  });
}

async function main() {
  const [command, manifestPath, approved, approvedAt, approvalEvidencePath] = process.argv.slice(2);
  assert.equal(command, 'execute'); assert.ok(path.isAbsolute(manifestPath));
  assert.equal(await digestFile(authorityPath), authorityFileSha);
  const spec = JSON.parse(await readFile(authorityPath)), supplement = JSON.parse(await readFile(manifestPath));
  assert.ok(path.isAbsolute(approvalEvidencePath));
  const approvalEvidence = JSON.parse(await readFile(approvalEvidencePath));
  const op = validateSupplement(spec, supplement, approved, approvedAt);
  assert.equal(path.dirname(path.resolve(manifestPath)), supplement.outputRoot);
  assert.equal(path.resolve(approvalEvidencePath), path.join(supplement.outputRoot, 'human-supplement-approval.json'));
  assert.ok(supplement.files.some(file => path.resolve(file.path) === fileURLToPath(import.meta.url)));
  // Verify the complete old implementation closure before importing it.
  await verifyFiles([...spec.collector.files, ...op.command.files, ...supplement.files]);
  const engine = await import(pathToFileURL(path.join(adoptedRoot, 'tools/release-batch.mjs')));
  const impact = await import(pathToFileURL(path.join(adoptedRoot, 'tools/release-impact.mjs')));
  const worker = await import(pathToFileURL(path.join(adoptedRoot, 'tools/worker-local-release.mjs')));
  const rotation = await import(pathToFileURL(path.join(adoptedRoot, 'tools/worker-local-release-rotation.mjs')));
  engine.verifyBatch(spec.batch, batchSha);
  const collectCurrent = async (_batch, _lease, operation) => {
    await verifyFiles(supplement.files);
    await verifyFiles(spec.collector.files);
    const current = JSON.parse((await worker.runProcess(spec.collector.executable, [...spec.collector.args, '--phase', operation?.phase ?? 'admission'], { cwd: spec.collector.cwd, label: 'unchanged AB9 live admission' })).stdout.trim());
    assert.equal(current.batchSha256, batchSha); assert.ok(Number.isFinite(current.observedAtMs) && Math.abs(Date.now() - current.observedAtMs) <= 5000);
    return current;
  };
  console.log(canonical(await executeSupplement({ spec, supplement, approved, approvedAt, approvalEvidence, runtime: { ...engine, ...impact, ...rotation, collectCurrent, verifyFiles } })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
