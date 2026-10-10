import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [input, output] = process.argv.slice(2);
assert.ok(input && output);
const observation = JSON.parse(await readFile(input, 'utf8'));
const events = observation.events;
const admission = events.filter(e => e.status === 'admission');
const statusAttempts = events.flatMap(e => (e.observationAttempts ?? []).map(attempt => ({ parentEvent: e.eventSha256, operationId: e.operationId ?? null, phase: e.phase, ...attempt })));
const result = { sourceObservation: input, observedAtUtc: observation.observedAtUtc,
  batchSha256: observation.batchSha256, eventCount: events.length, completed: observation.completed,
  admission: { count: admission.length, durationMs: admission.reduce((sum, e) => sum + e.durationMs, 0),
    samples: admission.map(e => ({ at: e.at, phase: e.phase, durationMs: e.durationMs })) },
  statusAttempts: { count: statusAttempts.length, durationMs: statusAttempts.reduce((sum, a) => sum + a.durationMs, 0), samples: statusAttempts },
  unavailableSubitems: ['wrapper', 'Python closure', 'source/tool reads', 'artifact verification', 'recovery qualification'],
  approvalUtc: events.find(e => e.status === 'approved')?.at ?? null,
  lastEventUtc: events.at(-1)?.at ?? null,
  approvalToNecessaryAcceptanceMs: null, approvalToFullDeliveryMs: null, measuredNetWaitingImprovementMs: null,
  limits: ['Status attempts are nested measurements, not additive savings.',
    'Admission durations are already included in phase durations.',
    'Current batch is unfinished; approval-to-delivery has no terminal endpoint.',
    'No production replay or new backup/restore was performed for this measurement.',
    'Missing instrumentation remains unknown; a single Worker Status is a different scope from aggregate component readiness.',
    'WAL durations measure operator wall time, not exclusive CPU/IO machine work or user-visible unavailability.'] };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ admissionCount: result.admission.count, admissionMinutes: result.admission.durationMs / 60000,
  nestedStatusCount: result.statusAttempts.count, nestedStatusMinutes: result.statusAttempts.durationMs / 60000, completed: result.completed }));
