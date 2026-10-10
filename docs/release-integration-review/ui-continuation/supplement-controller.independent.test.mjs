// Non-author guard/ABI tests. The real sealed spec is read only; all runtime,
// journal, process and filesystem effects below are in-memory test doubles.
// In particular the adopted AB executeBatch does NOT call beforeOperation.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { executeSupplement, validateSupplement, hash, canonical, batchSha, authorityPath, originalApproval } from './supplement-controller.mjs';

const sealedSpec = JSON.parse(await readFile(authorityPath));
const finalFailedEvent = 'b68be115be0dc4061a1aca79df78eaabf2ed858e76e2c1bdb96c8c178e507556';
const unknownEvent = 'e414c03dc2c89b553529cfe5afaf973cb4860688a82e1bd6f9ebe05b67117377';
const suiteRoot = path.resolve('E:/codex-artifacts/release-integration-review-20261010/AB-ui-supplement-20261010-independent-memory-only');
const currentCases = ['three-date-cancellations', 'search-cancel-clear-recovers', 'customer-current-scope-and-readonly-detail', 'product-back-four-viewports-keyboard'];
const rehash = supplement => {
  const { supplementSha256: _old, ...core } = supplement;
  supplement.supplementSha256 = hash(core);
  return supplement;
};

function fixture({ failUi = false } = {}) {
  const spec = structuredClone(sealedSpec), originalOp = spec.batch.operations.find(op => op.id === 'actual-readonly-ui');
  const writes = new Map(), calls = [], timeline = [], files = new Map();
  const proofPath = path.join(suiteRoot, 'failed-proof.json'), observationPath = path.join(suiteRoot, 'failed-observation.json');
  const reviewPath = path.join(suiteRoot, 'review.json'), testsPath = path.join(suiteRoot, 'tests.log');
  const observation = { independent: true, batchSha256: batchSha, unknownEventSha256: unknownEvent, status: 'failed' };
  const observationRaw = Buffer.from(canonical(observation)); files.set(observationPath, observationRaw);
  const proof = { independent: true, noEffect: true, noReplay: true, completed: false, requestedResolution: 'failed',
    batchSha256: batchSha, operationId: originalOp.id, unknownEventSha256: unknownEvent,
    observationPath, observationsSha256: hash(observationRaw), allowedOriginalRetryCount: 0 };
  const proofRaw = Buffer.from(canonical(proof)); files.set(proofPath, proofRaw);
  const shaUi = hash(Buffer.from('isolated-ui')), shaHelper = hash(Buffer.from('isolated-helper')), shaController = hash(Buffer.from('isolated-controller'));
  files.set(path.join(suiteRoot, 'production-ui.mjs'), Buffer.from('isolated-ui'));
  files.set(path.join(suiteRoot, 'request-completion.mjs'), Buffer.from('isolated-helper'));
  files.set(path.join(suiteRoot, 'supplement-controller.mjs'), Buffer.from('isolated-controller'));
  const review = { status: 'passed', uiSha256: shaUi, helperSha256: shaHelper, controllerSha256: shaController };
  files.set(reviewPath, Buffer.from(canonical(review))); files.set(testsPath, Buffer.from('isolated tests passed'));
  const supplement = rehash({ version: 'teruisi-ab-readonly-ui-supplement-v1', originalBatchSha256: batchSha,
    originalBatchPath: authorityPath, originalBatchFileSha256: '896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347',
    originalApprovedAt: originalApproval, operationId: originalOp.id, originalOperationSha256: hash(originalOp),
    binding: structuredClone(spec.batch.binding), assertions: structuredClone(originalOp.assertions), covers: structuredClone(originalOp.covers),
    failedEventSha256: finalFailedEvent, failedAt: '2026-10-10T08:08:11.698Z', sealedAt: new Date(Date.now() - 1000).toISOString(),
    failureProof: { path: proofPath, sha256: hash(proofRaw) },
    failureObservations: { path: observationPath, sha256: hash(observationRaw) },
    independentReview: { path: reviewPath, sha256: hash(files.get(reviewPath)), status: 'passed' },
    isolatedTests: { path: testsPath, sha256: hash(files.get(testsPath)), status: 'passed' }, outputRoot: suiteRoot,
    files: [
      { path: path.join(suiteRoot, 'production-ui.mjs'), sha256: shaUi },
      { path: path.join(suiteRoot, 'request-completion.mjs'), sha256: shaHelper },
      { path: path.join(suiteRoot, 'supplement-controller.mjs'), sha256: shaController },
      ...[proofPath, observationPath, reviewPath, testsPath].map(filename => ({ path: filename, sha256: hash(files.get(filename)) })),
    ],
  });
  const latest = new Map(spec.batch.operations.slice(0, 9).map(op => [op.id, { status: 'passed', operationId: op.id, eventSha256: hash(op.id) }]));
  const failed = { status: 'failed', operationId: originalOp.id, eventSha256: finalFailedEvent, receiptSha256: hash(proof), at: supplement.failedAt };
  latest.set(originalOp.id, failed);
  const state = { latest, unknown: [], events: [failed], previous: finalFailedEvent };
  let lockDepth = 0, childCalls = 0;
  const runtime = {
    async verifyFiles(list) { timeline.push('verify-files'); for (const file of list) assert.equal(hash(files.get(file.path)), file.sha256); },
    async safeRead(filename) {
      if (filename === path.join(spec.journalRoot, 'active.json')) return Buffer.from(canonical({ batchSha256: batchSha, id: spec.batch.id }));
      if (writes.has(filename)) return Buffer.from(canonical(writes.get(filename)));
      if (files.has(filename)) return files.get(filename);
      const error = new Error('not found in isolated map'); error.code = 'ENOENT'; throw error;
    },
    async writeOnce(filename, value) {
      assert.equal(lockDepth, 1, 'Control writes must remain inside the original rotation lock');
      if (writes.has(filename) || files.has(filename)) { const error = new Error('exists'); error.code = 'EEXIST'; throw error; }
      writes.set(filename, structuredClone(value)); timeline.push(`write:${path.basename(filename)}`);
    },
    async journalState() { return state; },
    async withRotationLock(callback) { assert.equal(lockDepth, 0); lockDepth++; try { return await callback({ isolatedLease: true }); } finally { lockDepth--; } },
    async collectCurrent() { assert.equal(lockDepth, 1); timeline.push('collect-current'); return { binding: spec.batch.binding }; },
    async runApprovedOperation(op, context) {
      assert.equal(lockDepth, 1); calls.push(op.id);
      if (op.id !== originalOp.id) {
        assert.equal(hash(op), hash(spec.batch.operations.find(item => item.id === op.id)), 'Tail command must remain original');
        return { status: 'passed', receiptSha256: hash(op.id) };
      }
      childCalls++; timeline.push('invoke-supplement-ui');
      const intents = [...writes].filter(([filename]) => /supplement-intent\.json$/.test(filename));
      const startedRecords = [...writes].filter(([filename]) => /supplement-started\.json$/.test(filename));
      assert.equal(intents.length, 1, 'Real adopted ABI must fsync a new supplement intent BEFORE child invocation');
      assert.equal(startedRecords.length, 1, 'Exactly one new bound supplement started record must precede invocation');
      const intent = intents[0][1], startedRecord = startedRecords[0][1], parentStarted = context.state.latest.get(originalOp.id);
      assert.equal(parentStarted.status, 'started');
      assert.equal(intent.supplementSha256, supplement.supplementSha256);
      assert.equal(intent.originalFailedEventSha256, finalFailedEvent);
      assert.ok(Object.values(intent).includes(parentStarted.eventSha256), 'Intent must bind the exact new parent WAL started event');
      assert.equal(startedRecord.parentStartedEventSha256, parentStarted.eventSha256);
      assert.equal(startedRecord.commandSha256, hash(op.command), 'Started record must bind the actual replacement command');
      assert.equal(startedRecord.maxAttempts, 1);
      assert.equal(op.command.args[0], path.join(suiteRoot, 'production-ui.mjs'));
      if (failUi) { const error = new Error('isolated child exit1'); error.processEvidence = { code: 'nonzero_exit', exitCode: 1 }; throw error; }
      files.set(path.join(suiteRoot, 'production-ui-audit.json'), Buffer.from(canonical({ status: 'passed', productionWrites: 0,
        attemptedBusinessWrites: 0, dangerous: [], failures: [], missing: [], attempts: [{ method: 'GET' }] })));
      files.set(path.join(suiteRoot, 'production-ui-result.json'), Buffer.from(canonical({ status: 'passed', realHome: true,
        productionWrites: 0, customerDetailsPersisted: false, cases: currentCases.map(name => ({ name, status: 'passed' })) })));
      return { status: 'passed', receiptSha256: hash('isolated child receipt'), processEvidence: { exitCode: 0, code: 'success' } };
    },
    // Model the actual old ABI, including ignored beforeOperation and catch->unknown.
    // No actual engine, journal, collector or operator is executed.
    async executeBatch(options) {
      assert.equal(options.approvedAt, originalApproval, 'Original wait start must not reset');
      return options.lock(async lease => {
        await options.collectCurrent(spec.batch, lease);
        for (const op of spec.batch.operations) {
          if (state.latest.get(op.id)?.status === 'passed') continue;
          await options.collectCurrent(spec.batch, lease, op, state);
          const started = { operationId: op.id, status: 'started', eventSha256: hash({ id: op.id, ordinal: state.events.length }) };
          state.events.push(started); state.latest.set(op.id, started);
          let result;
          try { result = await options.run(op, { batch: spec.batch, lease, state }); }
          catch (error) { result = { status: 'unknown', error: error.message, processEvidence: error.processEvidence }; }
          const event = { operationId: op.id, ...result, eventSha256: hash({ id: op.id, result }) };
          state.events.push(event); state.latest.set(op.id, event);
          if (result.status !== 'passed') throw new Error(result.error ?? `retained ${op.id}`);
        }
        return { completed: true };
      });
    },
  };
  return { spec, supplement, state, runtime, writes, files, calls, timeline, get childCalls() { return childCalls; } };
}

function execution(f, approvedAt = new Date().toISOString()) {
  return { spec: f.spec, supplement: f.supplement, approved: f.supplement.supplementSha256, approvedAt,
    approvalEvidence: { explicitHumanApproval: true, supplementSha256: f.supplement.supplementSha256, approvedAt,
      userItemId: '01a12499-1234-7dd0-ae6f-123456789abc' }, runtime: f.runtime };
}

test('isolated valid supplement uses the adopted ABI intent before UI, preserves failed audit and executes only original tail', async () => {
  const f = fixture();
  await executeSupplement(execution(f));
  assert.equal(f.childCalls, 1);
  assert.deepEqual(f.calls, f.spec.batch.operations.slice(9).map(op => op.id));
  assert.equal(f.state.events[0].status, 'failed'); assert.equal(f.state.events[0].eventSha256, finalFailedEvent);
  const receipt = f.writes.get(path.join(suiteRoot, 'supplement-result.json'));
  assert.equal(receipt.originalAttemptSucceeded, false); assert.equal(receipt.acceptanceCompletedBySupplement, true);
});

test('new UI failure remains unknown and cannot run original tail', async () => {
  const f = fixture({ failUi: true });
  await assert.rejects(executeSupplement(execution(f)));
  assert.deepEqual(f.calls, ['actual-readonly-ui']); assert.equal(f.state.latest.get('actual-readonly-ui').status, 'unknown');
  assert.equal(f.writes.has(path.join(suiteRoot, 'supplement-result.json')), false);
});

test('exact failed event is required and a stale unknown or other unresolved operation cannot dispatch', async () => {
  for (const kind of ['wrong-failed-event', 'unknown-target', 'other-unknown']) {
    const f = fixture();
    if (kind === 'wrong-failed-event') f.state.latest.get('actual-readonly-ui').eventSha256 = hash('stale anchor');
    else if (kind === 'unknown-target') { f.state.latest.get('actual-readonly-ui').status = 'unknown'; f.state.unknown = [f.state.latest.get('actual-readonly-ui')]; }
    else f.state.unknown = [{ operationId: 'backup-post', status: 'unknown' }];
    await assert.rejects(executeSupplement(execution(f)));
    assert.equal(f.childCalls, 0); assert.deepEqual(f.calls, []);
  }
});

test('reusing the original approval time is rejected for a supplement after the failed attempt', () => {
  const f = fixture();
  assert.throws(() => validateSupplement(f.spec, f.supplement, f.supplement.supplementSha256, originalApproval));
});

test('rehashed target/contract/closure mutations still cannot broaden the approved supplement', () => {
  for (const mutation of [s => { s.operationId = 'startworker'; }, s => { s.assertions = []; }, s => { s.covers = []; },
    s => { s.binding.artifactSha256 = hash('other manifest'); }, s => { s.failureObservations.sha256 = hash('unbound observations'); }]) {
    const f = fixture(); mutation(f.supplement); rehash(f.supplement);
    assert.throws(() => validateSupplement(f.spec, f.supplement, f.supplement.supplementSha256, new Date().toISOString()));
  }
});

test('missing or reused old human approval cannot dispatch a new read-only supplement', async () => {
  for (const mutate of [args => { delete args.approvalEvidence; }, args => { args.approvalEvidence.explicitHumanApproval = false; },
    args => { args.approvalEvidence.userItemId = '01a12449-131b-7dd0-ae6f-b98a5f32b283'; },
    args => { args.approvalEvidence.approvedAt = originalApproval; }, args => { args.approvalEvidence.supplementSha256 = hash('other approval'); }]) {
    const f = fixture(), args = execution(f); mutate(args);
    await assert.rejects(executeSupplement(args)); assert.equal(f.childCalls, 0); assert.deepEqual(f.calls, []);
  }
});

test('changed bound helper bytes fail before UI or tail and an occupied intent cannot replay', async () => {
  for (const mutation of ['helper-byte-change', 'occupied-intent']) {
    const f = fixture();
    if (mutation === 'helper-byte-change') f.files.set(path.join(suiteRoot, 'request-completion.mjs'), Buffer.from('changed helper'));
    else f.writes.set(path.join(suiteRoot, 'supplement-intent.json'), { earlierAttempt: true });
    await assert.rejects(executeSupplement(execution(f))); assert.equal(f.childCalls, 0); assert.deepEqual(f.calls, []);
  }
});

test('manifest failedAt must equal the exact anchored failed journal event rather than a caller supplied earlier time', async () => {
  const f = fixture(); f.supplement.failedAt = '2026-10-10T06:00:00.000Z'; rehash(f.supplement);
  await assert.rejects(executeSupplement(execution(f))); assert.equal(f.childCalls, 0);
});
