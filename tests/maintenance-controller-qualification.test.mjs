/** Static byte tripwire only: never execute a lifecycle controller or inspect production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {
  piNativeCandidateControllerSha256,
  firstMaintenancePredecessor,
  nativePiWorkspacePredecessor,
  nativePiBusinessPredecessor,
  piMaintenancePredecessor,
} from '../tools/manual-maintenance-continuation.mjs';

const sha = raw => createHash('sha256').update(raw).digest('hex');

for (const name of ['django-local-service.ps1', 'worker-local-service.ps1']) {
  test(`repository ${name} bytes have an explicit reviewed candidate qualification`, async () => {
    const actual = sha(await readFile(new URL('../tools/' + name, import.meta.url)));
    const qualified = piNativeCandidateControllerSha256[name];
    assert.ok(Array.isArray(qualified) && qualified.every(value => /^[a-f0-9]{64}$/.test(value)));
    assert.ok(qualified.includes(actual), `${name}: repository SHA-256 ${actual} is not in its reviewed qualification list; review the controller before adding a hash`);
  });
}

test('repository process-deadline.ps1 remains the exact already-reviewed predecessor transport', async () => {
  // An empty candidate exception list is intentional: do not grant a new
  // cross-generation exception merely to make this static check pass.
  assert.deepEqual(piNativeCandidateControllerSha256['process-deadline.ps1'], []);
  const qualified = [firstMaintenancePredecessor, nativePiWorkspacePredecessor,
    nativePiBusinessPredecessor, piMaintenancePredecessor].map(value => value.workerTransportSha256);
  assert.ok(qualified.every(value => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(new Set(qualified).size, 1, 'Reviewed transport baselines diverged; explicit review required');
  const actual = sha(await readFile(new URL('../tools/process-deadline.ps1', import.meta.url)));
  assert.equal(actual, qualified[0], 'process-deadline.ps1 changed from its exact reviewed transport baseline');
});
