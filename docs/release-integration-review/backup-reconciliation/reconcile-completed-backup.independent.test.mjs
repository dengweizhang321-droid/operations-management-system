// Non-author protocol tests. Metadata is read only; all journal/write/stream IO
// below uses memory spies. The production dump is never scanned or modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, mkdtemp, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { version, batchSha, unknownSha, validatedBackupOutputs, reconcileCompletedBackup } from './reconcile-completed-backup.mjs';

const root = path.resolve('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2');
const adoptedRoot = path.resolve('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9');
const apiPath = fileURLToPath(new URL('./reconcile-completed-backup.mjs', import.meta.url));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const spec = JSON.parse(await readFile(path.join(root, 'approved-batch.json')));
const originalUnknown = JSON.parse(await readFile(path.join(spec.journalRoot, spec.batch.id, '000074.json')));
const nativePath = path.resolve('D:/teruisi-runtime/django-sales/audits/postgres-operations/420adb985efc496a8c6d861a7c717046.json');
const nativeRaw = await readFile(nativePath), native = JSON.parse(nativeRaw), backupDirectory = native.result.backupDirectory;
const manifestPath = path.join(backupDirectory, 'backup-manifest.json'), sidecarPath = manifestPath + '.sha256';
const manifestRaw = await readFile(manifestPath), sidecarRaw = await readFile(sidecarPath);
const contractPath = path.join(root, 'candidate-handoff.json'), validatorPath = path.join(root, 'validators.mjs');
const contractRaw = await readFile(contractPath), validatorRaw = await readFile(validatorPath);
const h = JSON.parse(contractRaw), { assertFullManifest } = await import(pathToFileURL(validatorPath));
const originalEngine = await import(pathToFileURL(path.join(adoptedRoot, 'tools/release-batch.mjs')));
const proofPath = path.resolve('D:/.codex/worktrees/release-integration-review/运营管理系统/docs/release-integration-review/production/BACKUP_COMPLETED_PROOF.json');
const proofRaw = await readFile(proofPath), actualProof = JSON.parse(proofRaw);
const observationRaw = await readFile(actualProof.observationsPath);
const seal = core => { const { scopeSha256: _old, ...value } = core; return { ...value, scopeSha256: hash(value) }; };

async function fixture() {
  const files = new Map([
    [apiPath, await readFile(apiPath)], [nativePath, nativeRaw], [manifestPath, manifestRaw], [sidecarPath, sidecarRaw],
    [contractPath, contractRaw], [validatorPath, validatorRaw], [proofPath, proofRaw], [actualProof.observationsPath, observationRaw],
  ]);
  const originalPins = new Map([...spec.collector.files, ...spec.batch.operations.slice(15).flatMap(op => op.command?.files ?? [])]
    .map(file => [path.resolve(file.path), { path: path.resolve(file.path), sha256: file.sha256 }]));
  const scopeFiles = new Map(originalPins);
  for (const [filename, raw] of files) scopeFiles.set(filename, { path: filename, sha256: hash(raw) });
  const scope = seal({ version, sealedAt: new Date(Date.now() - 1000).toISOString(), batchSha256: batchSha,
    unknownEventSha256: unknownSha, expectedJournalHeadSha256: unknownSha,
    operationSha256: hash(spec.batch.operations.find(op => op.id === 'backup-post')),
    apiPath, apiSha256: hash(files.get(apiPath)), codePath: apiPath, codeSha256: hash(files.get(apiPath)), proofPath, proofSha256: hash(proofRaw),
    observationsPath: actualProof.observationsPath, observationsSha256: hash(observationRaw),
    contractPath, contractFileSha256: hash(contractRaw), validatorPath, validatorSha256: hash(validatorRaw),
    nativeAuditPath: nativePath, nativeAuditSha256: hash(nativeRaw), backupDirectory,
    manifestSha256: hash(manifestRaw), manifestSidecarSha256: hash(sidecarRaw),
    dumpSha256: native.result.dumpSha256, contentSha256: native.result.contentSha256,
    files: [...scopeFiles.values()],
  });
  const approval = { explicitHumanApproval: true, scopeSha256: scope.scopeSha256, approvedAt: new Date().toISOString(),
    userItemId: '01a126ee-1234-7555-bb55-123456789abc' };
  let current = { dir: path.join(spec.journalRoot, spec.batch.id), previous: unknownSha,
    unknown: [structuredClone(originalUnknown)], events: [structuredClone(originalUnknown)],
    latest: new Map(spec.batch.operations.slice(0, 15).map(op => [op.id, { status: 'passed' }])) };
  current.latest.set('backup-post', structuredClone(originalUnknown));
  let active = { batchSha256: batchSha, id: spec.batch.id }, lockHeld = false, dumpHook = null;
  const written = [], digestCalls = [], reads = [];
  const runtime = {
    hash, canonical, validateFullManifest: assertFullManifest,
    verifyBatch(batch, approved) { const { batchSha256, ...core } = batch; assert.equal(hash(core), approved); assert.equal(batchSha256, approved); },
    async withRotationLock(callback) { if (lockHeld) throw new Error('Original rotation lock busy'); lockHeld = true; try { return await callback(); } finally { lockHeld = false; } },
    async journalState() { assert.equal(lockHeld, true); return structuredClone(current); },
    async safeRead(filename) {
      assert.equal(lockHeld, true); reads.push(filename);
      if (filename === path.join(spec.journalRoot, 'active.json')) return Buffer.from(canonical(active));
      assert.ok(files.has(filename), `Unexpected isolated read ${filename}`); return files.get(filename);
    },
    async safeFileDigest(filename) {
      assert.equal(lockHeld, true); digestCalls.push(filename);
      if (filename === path.join(backupDirectory, 'teruisi-sales.dump')) { await dumpHook?.(); return native.result.dumpSha256; }
      if (files.has(filename)) return hash(files.get(filename));
      assert.ok(originalPins.has(path.resolve(filename)), `Unexpected isolated digest ${filename}`); return originalPins.get(path.resolve(filename)).sha256;
    },
    async writeOnce(filename, event) {
      assert.equal(lockHeld, true); assert.equal(written.length, 0, 'No duplicate reconciliation write');
      written.push({ filename, event: structuredClone(event) });
      current.previous = event.eventSha256; current.events.push(structuredClone(event)); current.latest.set('backup-post', structuredClone(event)); current.unknown = [];
    },
    runApprovedOperation() { throw new Error('Native operator execution is forbidden in reconciliation'); },
  };
  return { scope, humanApproval: approval, runtime, files, written, reads, digestCalls,
    setDumpHook(fn) { dumpHook = fn; }, mutateActive(fn) { fn(active); }, mutateState(fn) { fn(current); },
    arguments() { return { spec, scope: this.scope, approvedScope: this.scope.scopeSha256, humanApproval: this.humanApproval, runtime: this.runtime }; } };
}

test('independent valid typed native receipt creates one coordinated event with actual post content and no native action', async () => {
  const f = await fixture(), before = canonical(originalUnknown), event = await reconcileCompletedBackup(f.arguments());
  assert.equal(f.written.length, 1); assert.equal(event.previous, unknownSha);
  assert.equal(event.outputs.contentSha256, native.result.contentSha256);
  assert.deepEqual(event.outputs, actualProof.verifiedOutputCandidate);
  assert.equal(event.reconciliation.originalShellSucceeded, false); assert.equal(event.reconciliation.releaseRetentionStatus, 'blocked');
  assert.equal(event.reconciliation.backupReplayed, false); assert.equal(canonical(originalUnknown), before);
  assert.equal(f.digestCalls.filter(filename => filename.endsWith('teruisi-sales.dump')).length, 1, 'One simulated stream, no real dump scan');
  await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 1);
});

test('real original full manifest validator cannot be replaced by a no-op', async () => {
  const f = await fixture(); f.runtime.validateFullManifest = () => {};
  await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
});

for (const target of [proofPath, actualProof.observationsPath, nativePath, manifestPath, sidecarPath]) {
  test(`changed frozen input during long simulated dump verification is rejected: ${path.basename(target)}`, async () => {
    const f = await fixture(); f.setDumpHook(() => { f.files.set(target, Buffer.from('changed-after-initial-read')); });
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  });
}

test('active owner or WAL head changes while verifying dump cannot append metadata', async () => {
  for (const kind of ['active', 'head']) {
    const f = await fixture(); f.setDumpHook(() => kind === 'active'
      ? f.mutateActive(active => { active.id = 'another-batch'; })
      : f.mutateState(state => { state.previous = hash('changed-journal-head'); }));
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  }
});

test('another unresolved action or started tail cannot be collapsed into this completed backup', async () => {
  for (const kind of ['other-unknown', 'tail']) {
    const f = await fixture(); f.mutateState(state => kind === 'other-unknown'
      ? state.unknown.push({ status: 'unknown', eventSha256: hash('other-unknown') })
      : state.latest.set('restore-post', { status: 'started' }));
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  }
});

test('backup facts may not become original shell success or zero-effects retry permission', () => {
  const base = () => ({ batch: spec.batch, unknown: structuredClone(originalUnknown), proof: structuredClone(actualProof), nativeRaw,
    manifestRaw, manifestSidecar: sidecarRaw, dumpSha256: native.result.dumpSha256, validateFullManifest: assertFullManifest, contract: h.profileContract, hash, canonical });
  assert.deepEqual(validatedBackupOutputs(base()).outputs, actualProof.verifiedOutputCandidate);
  for (const mutate of [input => { input.proof.originalOperationPassed = true; }, input => { input.proof.noEffect = true; },
    input => { input.proof.originalShellSucceeded = true; }, input => { input.dumpSha256 = hash('wrong-dump'); }]) {
    const input = base(); mutate(input); assert.throws(() => validatedBackupOutputs(input));
  }
});

test('new metadata approval cannot reuse old AB/UI human items or a different exact scope', async () => {
  for (const kind of ['old-ab', 'old-ui', 'wrong-scope', 'future']) {
    const f = await fixture();
    if (kind === 'old-ab') f.humanApproval.userItemId = '01a12449-131b-7dd0-ae6f-b98a5f32b283';
    if (kind === 'old-ui') f.humanApproval.userItemId = '01a124f9-78a0-75b3-bd46-c484e6734b12';
    if (kind === 'wrong-scope') f.humanApproval.scopeSha256 = hash('other scope');
    if (kind === 'future') f.humanApproval.approvedAt = new Date(Date.now() + 60000).toISOString();
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  }
});

test('missing API self, native/observation input or actual tail pin still rejects after scope rehash', async () => {
  const tailControl = path.resolve('D:/运营管理系统/tools/operations-system-control.ps1');
  for (const target of [apiPath, actualProof.observationsPath, nativePath, sidecarPath, tailControl]) {
    const f = await fixture(); assert.ok(f.scope.files.some(file => file.path === target), 'Negative fixture must remove an existing mandatory pin');
    f.scope = seal({ ...f.scope, files: f.scope.files.filter(file => file.path !== target) });
    f.humanApproval.scopeSha256 = f.scope.scopeSha256;
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  }
});

test('sealed head and original full contract cannot be replaced with caller metadata', async () => {
  for (const kind of ['head', 'contract']) {
    const f = await fixture();
    f.scope = seal({ ...f.scope, ...(kind === 'head' ? { expectedJournalHeadSha256: hash('wrong-head') } : { contractPath: 'E:\\fake\\smaller-contract.json' }) });
    f.humanApproval.scopeSha256 = f.scope.scopeSha256;
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(f.written.length, 0);
  }
});

test('original journalState/writeOnce perform one real temporary canonical append and repeated execution refuses', async () => {
  const parent = path.resolve(os.tmpdir()), temp = await mkdtemp(path.join(parent, 'teruisi-backup-reconcile-independent-'));
  assert.equal(path.dirname(path.resolve(temp)), parent);
  assert.match(path.basename(temp), /^teruisi-backup-reconcile-independent-/);
  assert.equal((await lstat(temp)).isSymbolicLink(), false);
  try {
    // A bounded metadata prefix only. No runtime/source/database tree copy.
    for (let index = 0; index <= 74; index++) {
      const name = String(index).padStart(6, '0') + '.json';
      const event = JSON.parse(await readFile(path.join(spec.journalRoot, spec.batch.id, name)));
      await originalEngine.writeOnce(path.join(temp, spec.batch.id, name), event);
    }
    await originalEngine.writeOnce(path.join(temp, 'active.json'), { batchSha256: batchSha, id: spec.batch.id });
    const f = await fixture(), memoryRead = f.runtime.safeRead;
    f.runtime.journalState = (_root, batch) => originalEngine.journalState(temp, batch);
    f.runtime.safeRead = filename => filename === path.join(spec.journalRoot, 'active.json')
      ? readFile(path.join(temp, 'active.json')) : memoryRead(filename);
    let realWrites = 0;
    f.runtime.writeOnce = async (filename, event) => {
      assert.ok(path.resolve(filename).startsWith(path.resolve(temp) + path.sep), 'Only the owned isolated journal may be written');
      realWrites++; await originalEngine.writeOnce(filename, event);
    };
    const before = await originalEngine.journalState(temp, spec.batch), oldUnknownRaw = await readFile(path.join(temp, spec.batch.id, '000074.json'));
    const event = await reconcileCompletedBackup(f.arguments());
    assert.equal(realWrites, 1); assert.equal(event.previous, before.previous);
    const after = await originalEngine.journalState(temp, spec.batch);
    assert.equal(after.events.length, before.events.length + 1); assert.equal(after.unknown.length, 0);
    assert.deepEqual(after.latest.get('backup-post').outputs, actualProof.verifiedOutputCandidate);
    assert.deepEqual(await readFile(path.join(temp, spec.batch.id, '000074.json')), oldUnknownRaw);
    await assert.rejects(reconcileCompletedBackup(f.arguments())); assert.equal(realWrites, 1);
    assert.equal(after.latest.get('backup-post').reconciliation.originalShellSucceeded, false);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), parent); assert.match(path.basename(temp), /^teruisi-backup-reconcile-independent-/);
    assert.equal((await lstat(temp)).isSymbolicLink(), false);
    await rm(temp, { recursive: true });
  }
});

test('real temporary journal changed head with the same unresolved backup refuses before any coordination append', async () => {
  const parent = path.resolve(os.tmpdir()), temp = await mkdtemp(path.join(parent, 'teruisi-backup-reconcile-independent-'));
  assert.equal(path.dirname(path.resolve(temp)), parent); assert.equal((await lstat(temp)).isSymbolicLink(), false);
  try {
    for (let index = 0; index <= 74; index++) {
      const name = String(index).padStart(6, '0') + '.json';
      await originalEngine.writeOnce(path.join(temp, spec.batch.id, name), JSON.parse(await readFile(path.join(spec.journalRoot, spec.batch.id, name))));
    }
    await originalEngine.writeOnce(path.join(temp, 'active.json'), { batchSha256: batchSha, id: spec.batch.id });
    const extraCore = { batchSha256: batchSha, previous: unknownSha, at: new Date().toISOString(), phase: 'queue', status: 'resumed' };
    await originalEngine.writeOnce(path.join(temp, spec.batch.id, '000075.json'), { ...extraCore, eventSha256: hash(extraCore) });
    const actual = await originalEngine.journalState(temp, spec.batch);
    assert.equal(actual.unknown.length, 1); assert.equal(actual.latest.get('backup-post').eventSha256, unknownSha);
    assert.notEqual(actual.previous, unknownSha);
    const f = await fixture(), memoryRead = f.runtime.safeRead;
    f.runtime.journalState = (_root, batch) => originalEngine.journalState(temp, batch);
    f.runtime.safeRead = filename => filename === path.join(spec.journalRoot, 'active.json') ? readFile(path.join(temp, 'active.json')) : memoryRead(filename);
    let appended = 0; f.runtime.writeOnce = async () => { appended++; throw new Error('Changed-head branch must not write'); };
    await assert.rejects(reconcileCompletedBackup(f.arguments()), /Sealed journal head changed/);
    assert.equal(appended, 0); assert.equal((await originalEngine.journalState(temp, spec.batch)).events.length, 76);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), parent); assert.match(path.basename(temp), /^teruisi-backup-reconcile-independent-/);
    assert.equal((await lstat(temp)).isSymbolicLink(), false); await rm(temp, { recursive: true });
  }
});
