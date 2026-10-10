import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, link, symlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewComposition, inspectComposition, version } from '../tools/release-composition-review.mjs';
import { hash, sourceTreeDigest, sourceInventory, readSourceTree, makeImpactProof, verifyImpactProof } from '../tools/release-impact.mjs';

const binding = files => ({ sourceSha256: sourceTreeDigest(files), inventorySha256: hash(sourceInventory(files)) });
const kinds = ['independent-tests', 'dependency-review', 'acceptance-plan', 'rollback-plan'];
function fixture() {
  const predecessor = { 'app/a.tsx': 'old', 'app/remove.tsx': 'remove', 'docs/stable.md': 'stable' };
  const a = { ...predecessor, 'app/a.tsx': 'new' };
  const b = { ...predecessor, 'app/added.tsx': 'added' }; delete b['app/remove.tsx'];
  const combined = { ...a, 'app/added.tsx': 'added' }; delete combined['app/remove.tsx'];
  const request = { version, predecessor: binding(predecessor), combined: binding(combined), items: [
    { id: 'a', state: 'ready-unexecuted', predecessor: binding(predecessor), source: binding(a), dependsOn: [], evidence: kinds.map(kind => ({ kind, path: path.resolve('fixture-evidence.json'), sha256: hash('evidence') })) },
    { id: 'b', state: 'ready-unexecuted', predecessor: binding(predecessor), source: binding(b), dependsOn: ['a'], evidence: kinds.map(kind => ({ kind, path: path.resolve('fixture-evidence.json'), sha256: hash('evidence') })) },
  ] };
  return { request, trees: { predecessor, candidates: { a, b }, combined } };
}
const report = f => reviewComposition(f.request, f.trees);

test('exact union preserves additions, removals, dependencies and every task evidence without granting approval', () => {
  const result = report(fixture());
  assert.equal(result.status, 'ready-for-combined-review');
  assert.equal(result.productionAuthorized, false);
  assert.deepEqual(result.preparationOrder, ['a', 'b']);
  assert.equal(result.combinedChanges.length, 3);
  assert.equal(result.items[1].evidence.length, 4);
  assert.equal(result.impact.level, 'strict');
});
test('unrelated combined change and omitted task deletion cannot enter scope', () => {
  for (const extra of [{ 'app/unapproved.tsx': 'other' }, { 'app/remove.tsx': 'remove' }]) {
    const f = fixture(); Object.assign(f.trees.combined, extra); f.request.combined = binding(f.trees.combined);
    const result = report(f); assert.ok(result.blockers.includes('combined-source-not-exact-union'));
    assert.equal(result.unexpectedCombinedChanges.length, 1);
  }
});
test('source and full inventory mismatches reject instead of blessing changed bytes', () => {
  for (const field of ['sourceSha256', 'inventorySha256']) {
    const f = fixture(); f.request.items[0].source[field] = hash('stale');
    assert.throws(() => report(f), /mismatch/);
  }
});
test('different actual predecessor blocks a separately prepared task', () => {
  const f = fixture(); f.request.items[1].predecessor.inventorySha256 = hash('other');
  assert.ok(report(f).blockers.includes('b: different-predecessor'));
});
test('executing, adopted and unknown task states cannot be rebundled', () => {
  for (const state of ['executing', 'adopted', 'unknown', 'ready']) {
    const f = fixture(); f.request.items[0].state = state;
    assert.ok(report(f).blockers.includes('a: not-ready-unexecuted'));
  }
});
test('missing dependency and cycle block even if byte union matches', () => {
  const missing = fixture(); missing.request.items[1].dependsOn = ['absent'];
  assert.ok(report(missing).blockers.includes('b: missing-dependency:absent'));
  const cyclic = fixture(); cyclic.request.items[0].dependsOn = ['b'];
  assert.ok(report(cyclic).blockers.some(reason => reason.endsWith('dependency-cycle')));
});
test('overlapping paths require manual scope reconstruction even when final bytes agree', () => {
  const f = fixture(); f.trees.candidates.b['app/a.tsx'] = 'new'; f.request.items[1].source = binding(f.trees.candidates.b);
  assert.ok(report(f).blockers.some(reason => reason.includes('overlapping-path')));
});
test('missing acceptance or rollback material remains an explicit blocker', () => {
  for (const kind of kinds) {
    const f = fixture(); f.request.items[0].evidence = f.request.items[0].evidence.filter(ref => ref.kind !== kind);
    assert.ok(report(f).blockers.includes(`a: missing-${kind}`));
  }
});
test('duplicate IDs and case collisions are rejected', () => {
  const duplicate = fixture(); duplicate.request.items[1].id = 'a'; assert.throws(() => report(duplicate), /duplicate/);
  const collision = fixture(); collision.trees.combined['App/a.tsx'] = 'collision'; collision.request.combined = binding(collision.trees.combined);
  assert.throws(() => report(collision), /Case-colliding/);
});
test('single task reports no batching opportunity', () => {
  const f = fixture(); f.request.items.pop(); f.trees.combined = f.trees.candidates.a; f.request.combined = binding(f.trees.combined);
  assert.ok(report(f).blockers.includes('fewer-than-two-items-no-batching-opportunity'));
});
test('prototype-shaped added filename remains an ordinary exact-union entry', () => {
  const f = fixture(); f.trees.candidates.b = { ...f.trees.candidates.b, ['__proto__']: 'plain file' };
  f.trees.combined = { ...f.trees.combined, ['__proto__']: 'plain file' };
  f.request.items[1].source = binding(f.trees.candidates.b); f.request.combined = binding(f.trees.combined);
  const result = report(f); assert.equal(result.status, 'ready-for-combined-review');
  assert.deepEqual(result.combinedChanges.find(change => change.name === '__proto__'), { name: '__proto__', before: null, after: hash('plain file') });
});
for (const name of ['__proto__', 'constructor']) for (const change of ['add', 'delete']) {
  test(`impact proof JSON roundtrip preserves exact ${change} bytes for ${name}`, () => {
    const before = change === 'add' ? {} : { [name]: 'one' }, after = change === 'add' ? { [name]: 'one' } : {};
    const proof = JSON.parse(JSON.stringify(makeImpactProof(before, after)));
    const proofBinding = { sourceSha256: sourceTreeDigest(after), sourceInventorySha256: hash(sourceInventory(after)),
      predecessorSourceSha256: sourceTreeDigest(before), predecessorInventorySha256: hash(sourceInventory(before)) };
    const result = verifyImpactProof(proof, proofBinding);
    assert.deepEqual(result.changed, [name]); assert.equal(result.level, 'strict');
    assert.equal(result.deltaSha256, hash([{ name, before: change === 'add' ? null : hash('one'), after: change === 'add' ? hash('one') : null }]));
    assert.equal(Object.hasOwn(proof[change === 'add' ? 'before' : 'after'], name), false);
    proof[change === 'add' ? 'after' : 'before'][name] = 'tampered';
    assert.throws(() => verifyImpactProof(proof, proofBinding), /Impact delta bytes changed/);
  });
}

async function diskFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'teruisi-composition-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture();
  for (const [name, files] of [['before', f.trees.predecessor], ['a', f.trees.candidates.a], ['b', f.trees.candidates.b], ['combined', f.trees.combined]]) {
    const dir = path.join(root, name); await mkdir(dir);
    for (const [relative, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true }); await writeFile(path.join(dir, relative), content);
    }
    const declaration = name === 'before' ? f.request.predecessor : name === 'combined' ? f.request.combined : f.request.items.find(item => item.id === name).source;
    declaration.root = dir;
  }
  const evidencePath = path.join(root, 'evidence.txt'); await writeFile(evidencePath, 'evidence');
  for (const item of f.request.items) for (const ref of item.evidence) ref.path = evidencePath;
  return { ...f, root, evidencePath };
}
test('fresh filesystem inspection verifies complete snapshots and evidence bytes', async t => {
  const f = await diskFixture(t); assert.equal((await inspectComposition(f.request)).status, 'ready-for-combined-review');
  await writeFile(f.evidencePath, 'changed'); await assert.rejects(inspectComposition(f.request), /evidence hash mismatch/);
});
test('added unlisted source file invalidates the complete inventory', async t => {
  const f = await diskFixture(t); await writeFile(path.join(f.request.items[0].source.root, 'unexpected.txt'), 'other');
  await assert.rejects(inspectComposition(f.request), /mismatch/);
});
test('root __proto__ filename is read as exact own bytes and cannot evade full inventory binding', async t => {
  const f = await diskFixture(t); const sourceRoot = f.request.items[0].source.root;
  const target = path.join(sourceRoot, '__proto__'); await writeFile(target, 'first bytes');
  const files = await readSourceTree(sourceRoot);
  assert.equal(Object.hasOwn(files, '__proto__'), true);
  assert.equal(files.__proto__, 'first bytes');
  assert.equal(sourceInventory(files).__proto__, hash('first bytes'));
  await assert.rejects(inspectComposition(f.request), /mismatch/);
  const digest = sourceTreeDigest(files); await writeFile(target, 'other bytes');
  assert.notEqual(sourceTreeDigest(await readSourceTree(sourceRoot)), digest);
});
test('hardlinked evidence cannot be used', async t => {
  const f = await diskFixture(t); await link(f.evidencePath, path.join(f.root, 'hardlink.txt'));
  await assert.rejects(inspectComposition(f.request), /Unsafe evidence/);
});
test('redirected source root is refused', async t => {
  const f = await diskFixture(t); const redirected = path.join(f.root, 'redirected');
  await symlink(f.request.items[0].source.root, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  f.request.items[0].source.root = redirected;
  await assert.rejects(inspectComposition(f.request), /Redirected/);
});
test('CLI reports blocked with exit 2 and leaves input files unchanged', async t => {
  const f = await diskFixture(t); f.request.items[0].state = 'executing';
  const input = path.join(f.root, 'request.json'); const raw = JSON.stringify(f.request); await writeFile(input, raw);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/release-composition-review.mjs', import.meta.url)), input], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 2, run.stderr); assert.equal(JSON.parse(run.stdout).productionAuthorized, false);
  assert.equal(await readFile(input, 'utf8'), raw);
});
