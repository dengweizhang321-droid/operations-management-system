import { readFile, writeFile } from 'node:fs/promises';
import { hash } from '../../tools/release-impact.mjs';
const root = 'E:/codex-artifacts/release-high-impact-execution-20261010';
const rounds = [];
for (const round of [1, 2, 3]) {
  const call = JSON.parse(await readFile(`${root}/agy-round${round}-call.json`, 'utf8'));
  const trace = JSON.parse(await readFile(`${root}/AGY_ROUND${round}_TRACE.json`, 'utf8'));
  const result = JSON.parse(await readFile(`${root}/AGY_ROUND${round}_RESULT.json`, 'utf8'));
  const events = trace.toolCalls;
  rounds.push({ round, call, conversationId: result.conversation_id, status: result.status,
    responseCharacters: result.response.length, completedNativeTools: events.filter(e => e.state === 'DONE').length,
    errors: events.filter(e => e.state === 'ERROR'), deniedActionsFieldPresent: Object.hasOwn(result, 'denied_actions'),
    deniedActions: result.denied_actions ?? null });
}
const names = ['AGY_ROUND1_STREAM.ndjson', 'AGY_ROUND2_STREAM.ndjson', 'AGY_ROUND3_STREAM.ndjson',
  'AGY_ROUND1_RESULT.json', 'AGY_ROUND2_RESULT.json', 'AGY_ROUND3_RESULT.json',
  'ASTRA_ROUND1.md', 'ASTRA_ROUND2.md', 'ASTRA_FINAL.md', 'current-initial.json', 'current-final.json',
  'source-deltas.json', 'historical-source-coverage.json', 'main-object-check.json',
  'c-composition-request.json', 'c-composition-report.json', 'c-composition-cli-result.json',
  'related-release-tests.log', 'existing-watcher-isolated-recheck.log', 'related-release-tests-serial.log',
  'related-release-tests-final.log', 'related-release-tests-proof-final.log', 'prototype-proof-before-fix.log',
  'implementation-source-manifest-proof-final.json', 'all-task-scripts-lint.log', 'all-task-scripts-lint-final.log',
  'python-closure-measured.json', 'admission-observed.json', 'packaged-final-independent-tests.log',
  'offline-candidate-final-created.json', 'zip-verification.json', 'offline-candidate-final.zip'];
const files = [];
for (const name of names) { const raw = await readFile(`${root}/${name}`); files.push({ name, bytes: raw.length, sha256: hash(raw) }); }
const summary = { sealedAtUtc: new Date().toISOString(), baseline: 'bc1d830b6770bd2858c31aa4d861354da5ec433c',
  astra: { task: '/root/astra', dispatchedModel: 'gpt-6-astra', reasoningEffort: 'high' },
  antigravity: { executable: 'C:/Users/86137/AppData/Local/agy/bin/agy.exe', rounds },
  exchange: ['Independent AGY1 and Astra1', 'Astra read AGY1 and wrote Astra2', 'Same AGY conversation read Astra1/2 and code for AGY2',
    'AGY3 read final prototype proof implementation', 'Astra read AGY2/3 and wrote final corrections', 'Coordinator verified frozen package and source/evidence'],
  files, limitations: ['Model agreement does not certify a production batch.', '21 package tests repeat the same new cases inside the 99 relevant cases; not 120 unique cases.',
    'Watcher initial failure cause remains unknown.', 'Offline candidate is not a Worker release; production plan/batch are blocked.'] };
await writeFile(`${root}/TEAM_AND_EVIDENCE.json`, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ rounds: rounds.map(r => ({ round: r.round, status: r.status, nativeTools: r.completedNativeTools, errors: r.errors.length })), evidenceFiles: files.length }));
