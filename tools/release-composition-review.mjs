import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, safeRead, readSourceTree, sourceInventory, sourceTreeDigest, requireHash, classifyImpact } from './release-impact.mjs';

// Offline preparation aid only. This report is neither a batch nor an admission
// receipt. Production still uses the original plan/batch and live revalidation.
export const version = 'teruisi-release-composition-review-v1';
const evidenceKinds = ['independent-tests', 'dependency-review', 'acceptance-plan', 'rollback-plan'];
const identity = files => ({ sourceSha256: sourceTreeDigest(files), inventorySha256: hash(sourceInventory(files)) });
const own = (files, name) => Object.hasOwn(files, name) ? files[name] : null;
const delta = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  .filter(name => own(before, name) !== own(after, name)).map(name => ({ name, before: own(before, name), after: own(after, name) }));

function checkNames(inventory) {
  const seen = new Set();
  for (const name of Object.keys(inventory)) {
    if (!name || /^[a-z]:/i.test(name) || name.startsWith('/') || name.includes('\\') || name.includes(':')
      || name.split('/').some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part))) throw Error('Unsafe composition source path');
    const key = name.toLowerCase();
    if (seen.has(key)) throw Error('Case-colliding composition source paths');
    seen.add(key);
  }
}

function bindSource(declared, files, label) {
  const actual = identity(files);
  checkNames(sourceInventory(files));
  for (const key of ['sourceSha256', 'inventorySha256']) {
    requireHash(declared?.[key], `${label} ${key}`);
    if (declared[key] !== actual[key]) throw Error(`${label} ${key} mismatch`);
  }
  return actual;
}

// Pure inspection uses already-read, complete source snapshots. Evidence bytes
// are checked by inspectComposition below, never by trusting a cached report.
export function reviewComposition(request, { predecessor, candidates, combined }) {
  if (request?.version !== version || !Array.isArray(request.items) || !request.items.length) throw Error('Invalid composition request');
  const predecessorIdentity = bindSource(request.predecessor, predecessor, 'predecessor');
  const combinedIdentity = bindSource(request.combined, combined, 'combined');
  const before = sourceInventory(predecessor), actualCombined = sourceInventory(combined);
  const expected = Object.assign(Object.create(null), before), owners = new Map(), ids = new Set(), blockers = [], items = [];
  for (const item of request.items) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id ?? '') || ids.has(item.id)) throw Error('Invalid or duplicate composition item id');
    ids.add(item.id);
  }
  for (const item of request.items) {
    const files = candidates[item.id];
    if (!files) throw Error(`Missing complete source snapshot for ${item.id}`);
    const source = bindSource(item.source, files, item.id);
    if (item.predecessor?.sourceSha256 !== predecessorIdentity.sourceSha256
      || item.predecessor?.inventorySha256 !== predecessorIdentity.inventorySha256) blockers.push(`${item.id}: different-predecessor`);
    if (item.state !== 'ready-unexecuted') blockers.push(`${item.id}: not-ready-unexecuted`);
    if (!Array.isArray(item.dependsOn) || new Set(item.dependsOn).size !== item.dependsOn.length) throw Error(`Invalid dependencies for ${item.id}`);
    for (const dependency of item.dependsOn) if (!ids.has(dependency)) blockers.push(`${item.id}: missing-dependency:${dependency}`);
    const references = item.evidence ?? [];
    if (!Array.isArray(references)) throw Error(`Invalid evidence for ${item.id}`);
    for (const kind of evidenceKinds) {
      if (!references.some(ref => ref.kind === kind)) blockers.push(`${item.id}: missing-${kind}`);
    }
    for (const ref of references) {
      if (!evidenceKinds.includes(ref.kind) || typeof ref.path !== 'string' || !path.isAbsolute(ref.path)) throw Error(`Invalid evidence reference for ${item.id}`);
      requireHash(ref.sha256, `${item.id} evidence`);
    }
    const changes = delta(before, sourceInventory(files));
    if (!changes.length) blockers.push(`${item.id}: empty-change`);
    for (const change of changes) {
      const key = change.name.toLowerCase();
      if (owners.has(key)) blockers.push(`${item.id}: overlapping-path:${change.name}:${owners.get(key)}`);
      else owners.set(key, item.id);
      if (change.after === null) delete expected[change.name];
      else expected[change.name] = change.after;
    }
    items.push({ id: item.id, state: item.state, source, dependsOn: item.dependsOn, changes, evidence: references });
  }
  const visiting = new Set(), visited = new Set(), preparationOrder = [];
  function visit(id) {
    if (visiting.has(id)) { blockers.push(`${id}: dependency-cycle`); return; }
    if (visited.has(id) || !ids.has(id)) return;
    visiting.add(id);
    for (const dependency of request.items.find(item => item.id === id).dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id); preparationOrder.push(id);
  }
  for (const id of ids) visit(id);
  checkNames(expected);
  const unexpectedCombinedChanges = delta(expected, actualCombined);
  if (unexpectedCombinedChanges.length) blockers.push('combined-source-not-exact-union');
  if (items.length < 2) blockers.push('fewer-than-two-items-no-batching-opportunity');
  return {
    version, requestSha256: hash(request), purpose: 'offline-composition-review-only', productionAuthorized: false,
    status: blockers.length ? 'blocked' : 'ready-for-combined-review', blockers: [...new Set(blockers)],
    predecessor: predecessorIdentity, combined: combinedIdentity, items, preparationOrder,
    combinedChanges: delta(before, actualCombined), unexpectedCombinedChanges,
    impact: classifyImpact({ before: predecessor, after: combined }),
    evidenceMeaning: 'Pinned review material only; contents require independent review and do not grant readiness or approval.',
    stateMeaning: 'Task states and predecessor provenance are caller declarations; no active batch, WAL, installed binding or live state was queried.',
    snapshotMeaning: 'Each complete source inventory is byte-bound to its declaration. Sequential reads are not an atomic current-state snapshot; later changes require fresh final verification by the original preparation/admission tools.',
    nextSteps: ['Review dependency compatibility, all task acceptance and rollback plans together.',
      'Run combined tests and independent review for this complete source.',
      'Use existing rotation plan preparation and release-batch prepare; obtain exact production approval.'],
  };
}

export async function inspectComposition(request) {
  const roots = [request?.predecessor, request?.combined, ...(request?.items ?? []).map(item => item.source)];
  for (const source of roots) if (typeof source?.root !== 'string' || !path.isAbsolute(source.root)) throw Error('Source roots must be absolute');
  // Sequential complete reads avoid competing with active backup/restore IO.
  const predecessor = await readSourceTree(request.predecessor.root);
  const candidates = Object.create(null);
  for (const item of request.items) candidates[item.id] = await readSourceTree(item.source.root);
  const combined = await readSourceTree(request.combined.root);
  const report = reviewComposition(request, { predecessor, candidates, combined });
  for (const item of report.items) for (const ref of item.evidence) {
    if (hash(await safeRead(ref.path)) !== ref.sha256) throw Error(`${item.id}: evidence hash mismatch`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node tools/release-composition-review.mjs <request.json>');
    const request = JSON.parse(await safeRead(process.argv[2]));
    const report = await inspectComposition(request);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status === 'blocked') process.exitCode = 2;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
