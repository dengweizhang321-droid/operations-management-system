// Readonly forensic snapshot. No service/operator invocation or customer data.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonical, hash, batchSha, originalApproval, authorityPath } from './supplement-controller.mjs';
const e = path.dirname(authorityPath), production = path.join(e, 'production');
const raw = await readFile(authorityPath), spec = JSON.parse(raw);
const records = [], dir = path.join(spec.journalRoot, spec.batch.id); let previous = null;
for (const name of (await readdir(dir)).sort()) {
  assert.match(name, /^\d{6}\.json$/); assert.equal(Number(name.slice(0, 6)), records.length);
  const bytes = await readFile(path.join(dir, name)), record = JSON.parse(bytes), { eventSha256, ...core } = record;
  assert.equal(hash(core), eventSha256); assert.equal(record.previous, previous); assert.equal(record.batchSha256, batchSha);
  assert.equal(bytes.toString(), canonical(record) + '\n'); records.push(record); previous = eventSha256;
}
const observer = JSON.parse(await readFile(path.join(production, 'observer-finished.json')));
const observationRaw = await readFile(path.join(production, 'entry-observations.jsonl'));
const samples = observationRaw.toString().trim().split('\n').map(line => JSON.parse(line));
assert.equal(samples.length, observer.count);
const intervals = [];
for (let i = 0; i < samples.length; i++) {
  if (samples[i].available) continue;
  const start = i; while (i + 1 < samples.length && !samples[i + 1].available) i++;
  const first = samples[start], last = samples[i], before = samples[start - 1], after = samples[i + 1];
  intervals.push({ firstUnavailable: first.at, lastUnavailable: last.at, lastAvailableBefore: before?.at ?? null, firstAvailableAfter: after?.at ?? null,
    unavailableSamples: i - start + 1, observedSpanMs: Date.parse(last.at) - Date.parse(first.at), conservativeBoundMs: before && after ? Date.parse(after.completedAt) - Date.parse(before.at) : null,
    errors: [...new Set(samples.slice(start, i + 1).map(sample => sample.errorCode ?? `HTTP_${sample.status}`))] });
}
const latest = new Map(); for (const record of records) if (record.operationId) latest.set(record.operationId, record);
const phases = {}; for (const record of records) if (Number.isFinite(record.durationMs)) phases[record.phase] = (phases[record.phase] ?? 0) + record.durationMs;
const snapshot = { version: 'teruisi-ab-production-blocked-snapshot-v1', observedAt: new Date().toISOString(), approvedAt: originalApproval,
  originalBatchSha256: batchSha, authorityFileSha256: createHash('sha256').update(raw).digest('hex'), sourceCommit: '5faac8151f59d66de72c3caead8cad916ea547da',
  releaseId: '20261010T014638Z-97833d2f2b7e7bc9', workerManifestSha256: spec.batch.binding.artifactSha256, djangoManifestSha256: spec.batch.binding.djangoCandidateSha256,
  journalRecords: records.length, latestEventSha256: previous, active: JSON.parse(await readFile(path.join(spec.journalRoot, 'active.json'))),
  operations: spec.batch.operations.map(op => ({ id: op.id, phase: op.phase, status: latest.get(op.id)?.status ?? 'not-started', at: latest.get(op.id)?.at ?? null,
    attempts: records.filter(record => record.operationId === op.id && record.status === 'started').length, eventSha256: latest.get(op.id)?.eventSha256 ?? null })),
  timing: { necessaryAcceptanceClosedAt: null, completeDeliveryAt: null, elapsedSinceApprovalMs: Date.now() - Date.parse(originalApproval),
    phaseRecordedMs: phases, approvalToLatestJournalMs: Date.parse(records.at(-1).at) - Date.parse(originalApproval),
    uiFailedAttemptMs: records.filter(record => record.operationId === 'actual-readonly-ui' && record.status === 'unknown').reduce((sum, record) => sum + record.durationMs, 0),
    unallocatedWallMsThroughLatestJournal: Date.parse(records.at(-1).at) - Date.parse(originalApproval) - Object.values(phases).reduce((sum, value) => sum + value, 0),
    calculation: 'Parent WAL phase durations only; nested engine/child durations are diagnostic subdivisions, never added again. Unallocated wall time includes manual investigation, coordination and gaps; no invented attribution.' },
  availability: { method: 'GET entry headers/status; body cancelled and not persisted', approvalToObserverStartUnobservedMs: Date.parse(observer.startedAt) - Date.parse(originalApproval),
    startedAt: observer.startedAt, finishedAt: observer.finishedAt, count: samples.length, unavailableSamples: samples.filter(sample => !sample.available).length,
    maximumSampleGapMs: Math.max(...samples.slice(1).map((sample, i) => Date.parse(sample.at) - Date.parse(samples[i].at))), intervals,
    observationsSha256: createHash('sha256').update(observationRaw).digest('hex'), observationPath: path.join(production, 'entry-observations.jsonl'),
    limits: 'Sample bounds only. Does not establish engine readiness, every request, user-visible rendering, intervals before/after sampling, or exact downtime.' },
  unresolvedScope: ['original UI acceptance requires reviewed explicit supplement', ...spec.batch.operations.slice(10).map(op => op.id)],
  productionBatchComplete: false, rollbackExecuted: false, productionDataRestoreApproved: false, cAdopted: false };
const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../production'); await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'PRODUCTION_SNAPSHOT.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ phases, intervals, elapsedMinutes: snapshot.timing.elapsedSinceApprovalMs / 60000, records: records.length }));
