import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const read = async p => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const sha = v => createHash('sha256').update(v).digest('hex');
const index = await read(new URL('evidence-index.json', root));
for (const entry of index) {
  const bytes = await readFile(new URL(entry.snapshot, root));
  assert.equal(bytes.length, entry.size);
  assert.equal(sha(bytes), entry.sha256);
  assert.equal(sha(await readFile(entry.source)), entry.sha256);
}
const runtime = 'D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/';
const journals = [];
for (const id of ['release-customer-combined-20261009', 'release-customer-ps5-fixed-20261009', 'jackyun-download-recovery-20261009', 'jackyun-download-recovery-v2-20261009', 'priority-interactions-20261009']) {
  const files = (await readdir(runtime + id)).filter(f => /^\d{6}\.json$/.test(f)).sort();
  let previous = null;
  let batchSha = null;
  const events = [];
  const latest = new Map();
  for (let n = 0; n < files.length; n++) {
    assert.equal(files[n], `${String(n).padStart(6, '0')}.json`);
    const raw = await readFile(runtime + id + '/' + files[n]);
    const event = JSON.parse(raw.toString('utf8'));
    const { eventSha256, ...core } = event;
    batchSha ??= event.batchSha256;
    assert.equal(event.batchSha256, batchSha);
    assert.equal(event.previous, previous);
    assert.equal(eventSha256, sha(canonical(core)));
    assert.equal(raw.toString('utf8'), canonical(event) + '\n');
    previous = eventSha256;
    if (event.operationId) latest.set(event.operationId, event.status);
    events.push(Object.fromEntries(['at', 'phase', 'status', 'reason', 'operationId', 'durationMs', 'previous', 'eventSha256'].filter(k => k in event).map(k => [k, event[k]])));
  }
  journals.push({ id, batchSha, eventCount: files.length, sequenceCanonicalHashChainVerified: true, sourceDirectory: runtime + id, finalEvent: events.at(-1), latestOperations: Object.fromEntries(latest), events });
}
const customer = await read(new URL('source-evidence/customer-delivery.json', root));
const jackyun = await read(new URL('source-evidence/jackyun-delivery.json', root));
const jackyunDoc = await read(new URL('source-evidence/jackyun-document-closeout.json', root));
const interaction = await read(new URL('source-evidence/interaction-delivery.json', root));
const customerResult = await read(new URL('source-evidence/customer-result.json', root));
const interactionResult = await read(new URL('source-evidence/interaction-closeout.json', root));
const rows = [
  { id: 'customer', approvedAt: customer.approvedAt, closedAt: customer.officialBatchCompletedAt, deliveredAt: customer.completedAt, timing: customerResult.timing, priorBatchWaitMs: 0 },
  { id: 'jackyun', approvedAt: jackyun.approvedAt, closedAt: jackyun.closedAt, deliveredAt: jackyunDoc.recordedAt, timing: jackyun.timing, priorBatchWaitMs: jackyun.otherBatchWaitToPreparationMs, deliveryIsDocumentationRecord: true },
  { id: 'interaction', approvedAt: interaction.approvedAt, closedAt: interaction.batchClosedAt, deliveredAt: interaction.completedAt, timing: interactionResult.originalTiming, priorBatchWaitMs: 0 },
].map(r => {
  const phaseTotal = Object.values(r.timing.durationMs).reduce((a, b) => a + b, 0);
  const gateMs = r.timing.waits.filter(w => ['live-predecessor-and-integrity-revalidation', 'operation-boundary-revalidation'].includes(w.reason)).reduce((a, b) => a + b.durationMs, 0);
  const backupRestoreMs = ['backup-pre', 'restore-pre', 'backup-post', 'restore-post'].reduce((a, p) => a + r.timing.durationMs[p], 0);
  return { id: r.id, approvedAt: r.approvedAt, closedAt: r.closedAt, deliveredAt: r.deliveredAt, approvedToBatchMinutes: (Date.parse(r.closedAt) - Date.parse(r.approvedAt)) / 60000, approvedToDeliveryMinutes: (Date.parse(r.deliveredAt) - Date.parse(r.approvedAt)) / 60000, deliveryAfterBatchMinutes: (Date.parse(r.deliveredAt) - Date.parse(r.closedAt)) / 60000, priorBatchWaitMinutes: r.priorBatchWaitMs / 60000, backupRestorePhaseMinutes: backupRestoreMs / 60000, admissionMinutesIncludedInPhases: gateMs / 60000, phaseAccountedMinutes: phaseTotal / 60000, residualMinutesNotProvenIdle: (Date.parse(r.closedAt) - Date.parse(r.approvedAt) - phaseTotal) / 60000, deliveryIsDocumentationRecord: r.deliveryIsDocumentationRecord ?? false };
});
const result = { capturedAtUtc: new Date().toISOString(), baseline: '0308adb9f4ab37b5012ac36ea9e65dafcbe648d0', snapshotHashesVerified: index.length, journalEventsVerified: journals.reduce((a, j) => a + j.eventCount, 0), limits: ['Read-only verification of existing evidence; no production state actions.', 'Admission times are subsets of phase times, never additional.', 'Unaccounted residual includes coordination and uninstrumented intervals; not idle time.', 'Overlapping approval intervals cannot be summed as exclusive work or downtime.', 'Record chains authenticate internal consistency, not every external assertion.'], timingRows: rows, journals };
await writeFile(new URL('source-evidence/verified-timing-and-journals.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ snapshots: index.length, journals: journals.map(j => ({ id: j.id, events: j.eventCount, final: j.finalEvent.status, operations: j.latestOperations })), timingRows: rows }, null, 2));
