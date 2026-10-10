// No production writes/operators: real adopted engine, isolated journal,
// synthetic evidence and injected operator/collector spies only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { batchSha, originalApproval, authorityPath, canonical, hash, validateSupplement, validateSupplementState, executeSupplement } from './supplement-controller.mjs';
const spec = JSON.parse(await readFile(authorityPath));
const engine = await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/release-batch.mjs'));
const operation = spec.batch.operations.find(op => op.id === 'actual-readonly-ui');
const sha = 'a'.repeat(64), failedSha = 'b'.repeat(64), root = 'E:\\codex-artifacts\\release-integration-review-20261010\\AB-ui-supplement-20261010-fixture';
const seal = value => { const { supplementSha256, ...core } = value; return { ...core, supplementSha256: hash(core) }; };
function fixture() {
  const proof = { independent: true, noReplay: true, noEffect: true, completed: false, batchSha256: batchSha, operationId: operation.id, observationPath: path.join(root, 'failure-observations.json'), observationsSha256: sha };
  const files = ['production-ui.mjs', 'request-completion.mjs', 'supplement-controller.mjs', 'failure-proof.json', 'failure-observations.json', 'independent-review.json', 'isolated-tests.log'].map(name => ({ path: path.join(root, name), sha256: sha }));
  const supplement = seal({ version: 'teruisi-ab-readonly-ui-supplement-v1', originalBatchSha256: batchSha, originalBatchPath: authorityPath,
    originalBatchFileSha256: '896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347', originalApprovedAt: originalApproval,
    sealedAt: new Date(Date.now() - 10).toISOString(), failedAt: '2026-10-10T08:08:11.698Z', operationId: operation.id,
    originalOperationSha256: hash(operation), binding: spec.batch.binding, assertions: operation.assertions, covers: operation.covers,
    failedEventSha256: failedSha, outputRoot: root, files, failureProof: { path: files[3].path, sha256: sha }, failureObservations: { path: files[4].path, sha256: sha },
    independentReview: { path: files[5].path, sha256: sha, status: 'passed' }, isolatedTests: { path: files[6].path, sha256: sha, status: 'passed' } });
  const state = { unknown: [], latest: new Map(spec.batch.operations.slice(0, 9).map(op => [op.id, { status: 'passed' }])) };
  state.latest.set(operation.id, { status: 'failed', at: supplement.failedAt, eventSha256: failedSha, receiptSha256: hash(proof) });
  const active = { batchSha256: batchSha, id: spec.batch.id };
  const approvedAt = new Date().toISOString();
  const approvalEvidence = { explicitHumanApproval: true, supplementSha256: supplement.supplementSha256, approvedAt, userItemId: '01a12499-1234-7dd0-ae6f-123456789abc' };
  return { proof, supplement, state, active, approvedAt, approvalEvidence };
}

test('supplement scope rejects a changed digest and old approval', () => {
  const f = fixture(); assert.equal(validateSupplement(spec, f.supplement, f.supplement.supplementSha256, f.approvedAt), operation);
  assert.throws(() => validateSupplement(spec, { ...f.supplement, operationId: 'backup-post' }, f.supplement.supplementSha256, f.approvedAt));
  assert.throws(() => validateSupplement(spec, f.supplement, f.supplement.supplementSha256, originalApproval));
});
for (const [name, mutate] of [
  ['another operation even if resealed', s => s.operationId = 'backup-post'],
  ['changed source binding even if resealed', s => s.binding = { ...s.binding, sourceSha256: sha }],
  ['weaker assertions even if resealed', s => s.assertions = [{ path: 'status', equals: 'passed' }]],
  ['missing coverage', s => s.covers = []],
  ['unreviewed new script', s => s.independentReview = { ...s.independentReview, status: 'pending' }],
  ['missing helper pin', s => s.files = s.files.filter(f => !f.path.endsWith('request-completion.mjs'))],
  ['duplicate file alias', s => s.files.push(s.files[0])],
  ['production output directory', s => s.outputRoot = 'D:\\teruisi-runtime\\new-output'],
  ['approval before final sealed evidence', s => s.sealedAt = new Date(Date.now() + 100000).toISOString()],
]) test(name, () => { const f = fixture(), s = structuredClone(f.supplement); mutate(s); const bad = seal(s); assert.throws(() => validateSupplement(spec, bad, bad.supplementSha256, f.approvedAt)); });

for (const [name, mutate] of [
  ['unresolved unknown refuses replay', f => f.state.unknown.push({ status: 'unknown' })],
  ['changed active owner', f => f.active.batchSha256 = sha],
  ['another failed event', f => f.state.latest.get(operation.id).eventSha256 = sha],
  ['prior lifecycle not confirmed', f => f.state.latest.get('startworker').status = 'unknown'],
  ['tail already started', f => f.state.latest.set('backup-post', { status: 'started' })],
  ['new failed attempt cannot be replayed under old supplement', f => f.state.latest.set(operation.id, { status: 'failed', eventSha256: sha })],
]) test(name, () => { const f = fixture(); mutate(f); assert.throws(() => validateSupplementState(f.state, f.active, spec, f.supplement)); });

test('adopted engine ABI: preserve failures, skip prior nine, new UI once, then exact original tail', async () => {
  const f = fixture(), temp = await mkdtemp(path.join(os.tmpdir(), 'teruisi-ui-supplement-'));
  const calls = [], written = [];
  try {
    let previous = null, index = 0;
    async function append(record) {
      const core = { batchSha256: batchSha, previous, at: f.supplement.failedAt, ...record }, event = { ...core, eventSha256: hash(core) };
      await engine.writeOnce(path.join(temp, spec.batch.id, String(index++).padStart(6, '0') + '.json'), event); previous = event.eventSha256; return event;
    }
    await append({ phase: 'queue', status: 'approved', at: originalApproval });
    for (const op of spec.batch.operations.slice(0, 9)) await append({ operationId: op.id, phase: op.phase, status: 'passed' });
    const failure = await append({ operationId: operation.id, phase: 'acceptance', status: 'failed', reason: 'independently-reconciled', receiptSha256: hash(f.proof) });
    f.supplement = seal({ ...f.supplement, failedEventSha256: failure.eventSha256 }); f.approvalEvidence.supplementSha256 = f.supplement.supplementSha256;
    await engine.writeOnce(path.join(temp, 'active.json'), f.active);
    const synthetic = new Map([
      [f.supplement.failureProof.path, Buffer.from(canonical(f.proof))],
      [f.supplement.independentReview.path, Buffer.from(canonical({ status: 'passed', uiSha256: sha, helperSha256: sha, controllerSha256: sha }))],
      [path.join(root, 'production-ui-audit.json'), Buffer.from(canonical({ status: 'passed', productionWrites: 0, attemptedBusinessWrites: 0, dangerous: [], failures: [], missing: [], attempts: [{ method: 'GET' }] }))],
      [path.join(root, 'production-ui-result.json'), Buffer.from(canonical({ status: 'passed', realHome: true, productionWrites: 0, customerDetailsPersisted: false, cases: ['three-date-cancellations', 'search-cancel-clear-recovers', 'customer-current-scope-and-readonly-detail', 'product-back-four-viewports-keyboard'].map(name => ({ name, status: 'passed' })) }))],
    ]);
    let uiExecuted = false;
    const translate = filename => filename.startsWith(root + path.sep) ? path.join(temp, 'supplement', path.relative(root, filename)) : filename === path.join(spec.journalRoot, 'active.json') ? path.join(temp, 'active.json') : filename;
    const runtime = {
      executeBatch: args => engine.executeBatch({ ...args, root: temp }), withRotationLock: callback => callback({ fixture: true }),
      journalState: (_root, batch) => engine.journalState(temp, batch), verifyFiles: async () => {},
      safeRead: async filename => { if (synthetic.has(filename) && (!filename.includes('production-ui-') || uiExecuted)) return synthetic.get(filename); return readFile(translate(filename)); },
      writeOnce: async (filename, value) => { written.push({ filename, value }); return engine.writeOnce(translate(filename), value); },
      collectCurrent: async () => ({ binding: spec.batch.binding }),
      runApprovedOperation: async (op, context) => { calls.push(op); if (op.id === operation.id) {
        assert.equal(context.state.latest.get(op.id).status, 'started');
        assert.deepEqual(op.command.args, [path.join(root, 'production-ui.mjs')]); assert.deepEqual(op.assertions, operation.assertions); uiExecuted = true;
      } return { status: 'passed', outputs: {}, receiptSha256: sha }; },
    };
    const result = await executeSupplement({ spec, supplement: f.supplement, approved: f.supplement.supplementSha256, approvedAt: f.approvedAt, approvalEvidence: f.approvalEvidence, runtime });
    assert.equal(result.completed, true); assert.deepEqual(calls.map(op => op.id), spec.batch.operations.slice(9).map(op => op.id));
    for (const op of calls.slice(1)) assert.equal(canonical(op), canonical(spec.batch.operations.find(item => item.id === op.id)));
    const state = await engine.journalState(temp, spec.batch), ui = state.latest.get(operation.id);
    assert.equal(ui.reason, 'explicitly-approved-readonly-validation-supplement'); assert.equal(state.events.find(event => event.eventSha256 === failure.eventSha256).status, 'failed');
    const started = written.find(item => item.filename.endsWith('supplement-started.json')); assert.ok(started); assert.equal(started.value.maxAttempts, 1);
    assert.equal(started.value.parentStartedEventSha256, state.events.findLast(event => event.operationId === operation.id && event.status === 'started').eventSha256);
    assert.equal(written.find(item => item.filename.endsWith('supplement-result.json')).value.originalAttemptSucceeded, false);
    await assert.rejects(readFile(path.join(temp, 'active.json')), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true }); }
});
