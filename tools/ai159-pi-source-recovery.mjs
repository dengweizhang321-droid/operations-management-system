/** Native one-time start and handoff to the frozen original reconciliation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceCommit = 'e030caba1271d47fced663649f288855234a02e2';
const installedApp = 'D:\\teruisi-runtime\\django-sales\\app';
const attempt = 'D:\\codex-isolated\\main-release-packages\\e030caba1271-aaab2674-b0c1080e\\publish-e030caba1271';
const originalIdentity = Object.freeze({
  registeredPlanSha256: '58f8ce87c52d0040fe448131679baa72c5963e3e5b5bb9dcd1c1c4ee32c75d5a',
  operationId: '88b7e64f18dd4afdb67869895c5d7f1e',
  planSha256: '093fc9fcbe8ddba224bf90d2f434d04aa47398af70b8fe5eeec2f11abc52b749',
  sourceSha256: '781a2a300e668f78072c8105882af8851a7776374e068ca8472ed1bfff6ad557',
});
const originalImage = 'sha256:87e41e7e4d646d779eba8b552a213d5356c4afa935d42dbb618d19fab7e15956';
const script = fileURLToPath(new URL('./ai159-pi-source-recovery.ps1', import.meta.url));

function assertPaths(installed, originalAttempt, invocation) {
  assert.equal(path.win32.normalize(installed).toLowerCase(), installedApp.toLowerCase());
  assert.equal(path.win32.normalize(originalAttempt).toLowerCase(), attempt.toLowerCase());
  const root = path.win32.join(attempt, 'resume-ai159', 'attempts');
  assert.equal(path.win32.dirname(path.win32.normalize(invocation)).toLowerCase(), root.toLowerCase());
  assert.match(path.win32.basename(invocation), /^[a-f0-9]{32}$/);
}

function bind(value, prepared) {
  for (const [key, expected] of Object.entries(originalIdentity)) {
    assert.equal(prepared?.[key], expected, `AI159 original Runner preparation changed: ${key}`);
    assert.equal(value?.[key], expected, `AI159 original Runner evidence changed: ${key}`);
  }
}

async function absent(file) {
  try { await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`AI159 original Runner one-time guard exists: ${path.basename(file)}`);
}

async function pinned(file, expected) {
  const info = await fs.lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size < 65536, 'AI159 original Runner evidence path changed');
  const raw = await fs.readFile(file);
  assert.equal(createHash('sha256').update(raw).digest('hex'), expected, 'AI159 original Runner evidence bytes changed');
  return raw;
}

export async function recoverAi159Pi({ prepared, installed, originalAttempt, invocation, step, reconcileMainPiUpgrade, adoptRecordedKeeper = false }) {
  bind(prepared, prepared);
  assert.equal(prepared.image, originalImage);
  assertPaths(installed, originalAttempt, invocation);
  const processFile = await pinned(path.join(originalAttempt, '升级Pi Runner-process.json'), 'a5bc26ed6988a4c3617d1db8ddb122763513eac070911c3fc649e9d0397a31cc');
  const { processEvidence, originalBytesRetained } = JSON.parse(processFile);
  assert.equal(originalBytesRetained, true);
  assert.equal(processEvidence.processId, 30664);
  assert.equal(processEvidence.exitCode, 1);
  assert.equal(processEvidence.timeoutType, null);
  await pinned(path.join(originalAttempt, '升级Pi Runner-started.json'), '889dafb67515bca125833a02452aed6f8935728dfbe920e2d866c1bc934539f7');
  await pinned(path.join(originalAttempt, '升级Pi Runner.stderr.log'), processEvidence.stderrSha256);
  await pinned(path.join(originalAttempt, '升级Pi Runner.stdout.log'), processEvidence.stdoutSha256);
  await absent(path.join(originalAttempt, 'PiRunnerRecovery-started.json'));
  await absent(path.join(originalAttempt, 'PiReconcile-started.json'));

  const native = await step('恢复Pi Runner原新单元', script, adoptRecordedKeeper ? 'AdoptKeeper' : 'RestoreRunner', ['-Invocation', invocation]);
  bind(native, prepared);
  assert.equal(native.sourceCommit, sourceCommit);
  assert.equal(native.activeSuccessorVerified, true);
  assert.ok(Number.isInteger(native.mainPid) && native.mainPid > 0);
  assert.match(native.invocationId, /^[a-f0-9]{32}$/);
  assert.equal(native.keeper?.sourceCommit, sourceCommit);
  assert.equal(native.keeper.operationId, originalIdentity.operationId);
  assert.ok(Number.isInteger(native.keeper.processId) && native.keeper.processId > 0);
  if (adoptRecordedKeeper) {
    assert.equal(native.keeper.adopted, true);
    assert.equal(native.keeper.processId, 36128);
    assert.equal(native.keeper.childProcessId, 11916);
    assert.equal(native.keeper.startedSha256, 'd9366af3c076950757d4507516adc34dcf5dc94ae620147bc965670cf8001594');
  }

  const receipt = await reconcileMainPiUpgrade({
    prepared, installed, out: invocation, intentRoot: originalAttempt, step, requireDirectExit: true,
  });
  assert.equal(receipt.operationId, originalIdentity.operationId);
  assert.equal(receipt.planSha256, originalIdentity.planSha256);
  return { receipt, releaseKeeper: () => releaseAi159Keeper({ invocation, step, keeper: native.keeper }) };
}

export async function releaseAi159Keeper({ invocation, step, keeper, directory = invocation }) {
  const release = await step('移交Pi恢复保活', script, 'ReleaseKeeper', ['-Invocation', invocation], { directory });
  assert.equal(release.released, true);
  assert.equal(release.operationId, originalIdentity.operationId);
  assert.equal(release.processId, keeper.processId);
  if (keeper.adopted === true) assert.equal(release.childProcessId, keeper.childProcessId);
  assert.ok(Number.isInteger(release.formalProcessId) && release.formalProcessId > 0 && release.formalProcessId !== release.processId);
  return release;
}

export async function releaseAi159RecordedKeeper({ prepared, installed, originalAttempt, invocation, step, directory }) {
  bind(prepared, prepared);
  assertPaths(installed, originalAttempt, invocation);
  assert.equal(path.win32.dirname(path.win32.normalize(directory)).toLowerCase(), path.win32.normalize(invocation).toLowerCase());
  const guard = JSON.parse(await fs.readFile(path.join(originalAttempt, 'PiRunnerRecovery-started.json'), 'utf8'));
  bind(guard, prepared);
  assert.equal(guard.sourceCommit, sourceCommit);
  assert.equal(path.win32.normalize(guard.invocation).toLowerCase(), path.win32.normalize(invocation).toLowerCase());
  assert.ok(Number.isInteger(guard.keeper?.processId) && guard.keeper.processId > 0);
  return releaseAi159Keeper({ invocation, step, keeper: guard.keeper, directory });
}
