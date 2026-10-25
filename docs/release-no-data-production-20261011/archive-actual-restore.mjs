// Read-only production-file audit; writes only create-only, non-sensitive review archives.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
const specPath = 'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json';
const journal = 'D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011';
const auditPath = 'D:/teruisi-runtime/django-sales/audits/postgres-operations/ef627746ece34ad88a066d5af4083fe2.json';
const rehearsal = 'E:/TERUISI-Postgres-Rehearsals/restore-0d2c8cfba17c';
const resultPath = path.join(rehearsal, 'rehearsal-result.json');
const fields = ['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
function signature(s) { return Object.fromEntries(fields.map(k => [k, String(s[k])])); }
function physical(p) {
  p = path.resolve(p);
  for (let q = p;; q = path.dirname(q)) {
    assert(!fs.lstatSync(q).isSymbolicLink(), 'reparse: ' + q);
    assert.equal(fs.realpathSync.native(q).toLowerCase(), q.toLowerCase(), 'physical alias: ' + q);
    if (path.dirname(q) === q) break;
  }
}
function read(p, expectedLinks = 1n) {
  physical(p);
  const a = fs.lstatSync(p, { bigint: true });
  assert(a.isFile()); assert.equal(a.nlink, expectedLinks);
  const bytes = fs.readFileSync(p);
  const b = fs.lstatSync(p, { bigint: true });
  assert.deepEqual(signature(a), signature(b), 'read drift: ' + p); physical(p);
  return { bytes, sha256: sha(bytes), stat: signature(b) };
}
const specRead = read(specPath);
assert.equal(specRead.sha256, '960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
const spec = JSON.parse(specRead.bytes);
const op = spec.batch.operations.find(x => x.id === 'restore-installed');
const records = new Map();
function record(n) {
  const name = String(n).padStart(6, '0') + '.json';
  const raw = read(path.join(journal, name)); const value = JSON.parse(raw.bytes);
  const { eventSha256, ...core } = value;
  assert.equal(sha(canonical(core)), eventSha256);
  assert.equal(raw.bytes.toString(), canonical(value) + '\n');
  records.set(name, raw); return value;
}
const backup = record(10), consumer = record(39), admission = record(40), started = record(41), passed = record(42);
assert.equal(admission.previous, consumer.eventSha256);
assert.equal(started.previous, admission.eventSha256);
assert.equal(passed.previous, started.eventSha256);
assert.equal(passed.eventSha256, 'c0b89f1c2589eb03c7b2106cbe98d020547a7f87f154452de760b9eeb68b3d3b');
assert.equal(passed.operationId, op.id); assert.equal(passed.status, 'passed');
assert.equal(consumer.operationId, 'installed-recovery-consumer'); assert.equal(consumer.status, 'passed');
assert.equal(consumer.outputs.headReleaseId, '20261011T090355Z-21c2645a63247749');
assert.equal(consumer.outputs.chainStateSha256, 'bc87c4d60408ecb9b8ca5855bdd2a39c684a39c2d3ec29dafef8434216aead6c');
assert.equal(consumer.outputs.recoveryConsumerVersion, 'teruisi-release-payload-retention-v1');
const auditRaw = read(auditPath), resultRaw = read(resultPath), sidecar = read(resultPath + '.sha256');
const audit = JSON.parse(auditRaw.bytes), result = JSON.parse(resultRaw.bytes);
assert.equal(resultRaw.sha256, '0ab553b56878aadf67d1e7b0aa118ea2e74b8dee8b6f0ce76b392993e9631f1d');
assert.equal(sidecar.bytes.toString().trim(), resultRaw.sha256);
assert.equal(audit.status, 'completed'); assert.equal(audit.phase, 'restore_cleanup'); assert.equal(audit.failure, null);
assert.deepEqual(audit.result, result);
assert.equal(sha(canonical(result)), passed.receiptSha256);
const reconstructedStdout = Buffer.from(JSON.stringify(audit.result) + '\r\n');
assert.equal(reconstructedStdout.length, passed.processEvidence.stdoutBytes);
assert.equal(sha(reconstructedStdout), passed.processEvidence.stdoutSha256);
assert.equal(passed.processEvidence.exitCode, 0); assert.equal(passed.processEvidence.timeoutType, null);
assert.equal(result.version, 'teruisi-postgres-restore-rehearsal-v1');
assert.equal(result.rehearsalId, '0d2c8cfba17c'); assert.equal(result.isolatedPort, 55433);
assert.equal(result.backupId, backup.outputs.backupId);
assert.equal(result.backupManifestSha256, backup.outputs.manifestSha256);
assert.equal(result.dumpSha256, backup.outputs.dumpSha256);
assert.equal(result.expectedContentSha256, backup.outputs.contentSha256);
assert.equal(result.restoredContentSha256, backup.outputs.contentSha256);
for (const assertion of op.assertions) assert.deepEqual(result[assertion.path], assertion.equals);
const closure = op.command.files.map(pin => {
  const isSystemPS = pin.path.toLowerCase() === op.command.executable.toLowerCase();
  const got = read(pin.path, isSystemPS ? 2n : 1n); assert.equal(got.sha256, pin.sha256, pin.path);
  if (!isSystemPS) {
    const rel = 'tools/' + path.basename(pin.path);
    assert.equal(spec.batch.tests.scopeValidation.after.inventory[rel], got.sha256, rel);
  }
  return { path: pin.path, sha256: got.sha256, size: got.bytes.length, identity: got.stat };
});
// Recheck each identity after the complete small-file pass, without scanning source/dependencies.
for (const item of closure) { physical(item.path); assert.deepEqual(signature(fs.lstatSync(item.path, { bigint: true })), item.identity); }
const cleanup = {};
for (const name of ['data', '.postgres-password.tmp']) {
  try { fs.lstatSync(path.join(rehearsal, name)); cleanup[name] = 'present'; }
  catch (e) { if (e.code !== 'ENOENT') throw e; cleanup[name] = 'absent'; }
  assert.equal(cleanup[name], 'absent');
}
const summary = {
  version: 'astra-actual-restore-readback-v1', checkedAt: new Date().toISOString(), status: 'passed',
  specSha256: specRead.sha256, auditSha256: auditRaw.sha256, resultSha256: resultRaw.sha256,
  receiptSha256: passed.receiptSha256, walEventSha256: passed.eventSha256,
  reconstructedStdout: { bytes: reconstructedStdout.length, sha256: sha(reconstructedStdout), matchesOriginalCapturedDigest: true, rawOriginalStdoutRecovered: false },
  result, cleanupPathMetadata: cleanup, installedFileCount: closure.length, installedClosure: closure,
  consumerReceiptSha256: consumer.receiptSha256,
  limitations: ['No new SQL/native/process/port query or restore executed', 'No full source/dependency/dump scan', 'Optional policy syntax equivalence is false and is not established', 'Read-only retention planner success is not payload cleanup execution', 'Final nineteen-operation acceptance is outside this receipt readback']
};
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence', 'actual-restore');
fs.mkdirSync(out, { recursive: true });
const entries = [];
function save(name, bytes, source) {
  fs.writeFileSync(path.join(out, name), bytes, { flag: 'wx' });
  entries.push({ name, source, bytes: bytes.length, sha256: sha(bytes) });
}
save('operator-audit.json', auditRaw.bytes, auditPath);
save('rehearsal-result.json', resultRaw.bytes, resultPath);
save('rehearsal-result.json.sha256', sidecar.bytes, resultPath + '.sha256');
for (const [name, raw] of records) save('wal-' + name, raw.bytes, path.join(journal, name));
save('READBACK.json', Buffer.from(JSON.stringify(summary, null, 2) + '\n'), 'This read-only script');
const manifest = Buffer.from(JSON.stringify({ version: 'astra-restore-safe-archive-v1', entries }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'MANIFEST.json'), manifest, { flag: 'wx' });
console.log(JSON.stringify({ status: summary.status, installedFileCount: closure.length, archiveFiles: entries.length, archiveManifestSha256: sha(manifest), resultSha256: resultRaw.sha256, receiptSha256: passed.receiptSha256, cleanup, out }));
