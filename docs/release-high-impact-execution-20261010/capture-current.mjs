// Read-only: validates a finite WAL prefix and the existing effective-head chain.
import { readdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { canonical, hash, safeRead } from '../../tools/release-impact.mjs';
import { resolveEffectiveReleaseChain } from '../../tools/worker-local-release-rotation.mjs';
const output = process.argv[2];
assert.ok(output && /\.json$/.test(output));
const startedAtUtc = new Date().toISOString();
const root = 'D:/teruisi-runtime/teruisi-worker-sales';
const id = 'integration-ab-v2-20261010-c22d8dd69a';
const batchSha256 = '9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
const dir = `${root}/state/release-batches/${id}`;
const names = (await readdir(dir)).filter(f => /^\d{6}\.json$/.test(f)).sort();
const events = [], latest = {};
let previous = null;
for (let i = 0; i < names.length; i++) {
  assert.equal(names[i], `${String(i).padStart(6,'0')}.json`);
  const bytes = await safeRead(`${dir}/${names[i]}`), event = JSON.parse(bytes);
  const { eventSha256, ...core } = event;
  assert.equal(event.batchSha256, batchSha256);
  assert.equal(event.previous, previous);
  assert.equal(eventSha256, hash(core));
  assert.equal(bytes.toString(), `${canonical(event)}\n`);
  previous = eventSha256;
  if (event.operationId) latest[event.operationId] = event.status;
  events.push(event);
}
const bound = async source => {
  try { const bytes = await safeRead(source); return { source, rawSha256: hash(bytes), value: JSON.parse(bytes) }; }
  catch (error) { if (error.code === 'ENOENT') return { source, exists: false }; throw error; }
};
const chain = await resolveEffectiveReleaseChain({ verifyInstalledHead: true });
const active = await bound(`${root}/state/release-batches/active.json`);
const receipt = await bound(`${root}/state/worker-process.json`);
const result = { startedAtUtc, observedAtUtc: new Date().toISOString(), baseline: 'bc1d830b6770bd2858c31aa4d861354da5ec433c',
  journalSource: dir, batchSha256, eventCount: events.length, chainCanonicalSequenceVerified: true, latest, events, active, receipt,
  effective: { head: chain.head, manifestPath: chain.headManifestPath, source: chain.headManifest.source,
    successorCount: chain.successorCount, chainStateSha256: chain.chainStateSha256, installedEntrypointsVerified: true },
  completed: events.some(e => e.status === 'completed'),
  limits: ['Finite WAL prefix; not an atomic global snapshot', 'Separate installed Worker Status saved with call metadata; not a full Django/PG/business readiness claim', 'No batch takeover/reconcile/replay, lifecycle mutation, backup, restore, schedule change or business write'] };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ observedAtUtc: result.observedAtUtc, eventCount: result.eventCount, latest, effectiveHead: chain.head, active: active.value, completed: result.completed }));
