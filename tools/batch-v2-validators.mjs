// Pure validation. No filesystem, operator, lifecycle, schedule or network calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
const hash = value => sha(canonical(value));
const hex = value => assert.match(value, /^[a-f0-9]{64}$/);
const sameKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
export const softwareKeys = ['deploymentManifestSha256','serviceConfigSha256','serviceScriptSha256','operatorScriptSha256','evidenceToolSha256','pgDumpSha256','pgRestoreSha256'];
// Original Python digest: sort_keys, no spaces, ensure_ascii=True, no floats
// in this closed profile projection (roles/table counts/catalog digests).
export function profileCanonical(value) {
  if (typeof value === 'string') return JSON.stringify(value).replace(/[\u007f-\uffff]/g, ch => '\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
  if (typeof value === 'number') { assert.ok(Number.isSafeInteger(value)); return String(value); }
  if (Array.isArray(value)) return '['+value.map(profileCanonical).join(',')+']';
  if (value && typeof value === 'object') {
    const compare = (a,b) => { const x=[...a].map(c=>c.codePointAt(0)),y=[...b].map(c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length; };
    return '{'+Object.keys(value).sort(compare).map(k=>profileCanonical(k)+':'+profileCanonical(value[k])).join(',')+'}';
  }
  assert.ok(value === null || typeof value === 'boolean');return JSON.stringify(value);
}
export function profileDigest(profile) { return sha(profileCanonical(Object.fromEntries(['profile','roles','tables','catalog'].map(key=>[key,profile[key]])))); }
export const components = ['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];

export function assertCompleteStatus(status, releaseId) {
  assert.equal(status.state, 'Running'); assert.equal(status.backendState, 'Ready');
  assert.equal(status.workerState, 'exact_release'); assert.equal(status.releaseId, releaseId);
  sameKeys(status.components, components);
  for (const name of components) assert.equal(status.components[name], true, name);
  return status;
}

export function assertFullManifest(manifest, contract) {
  assert.equal(manifest.version, 'teruisi-postgres-daily-backup-v2-no-keys');
  assert.equal(manifest.status, 'completed');
  assert.match(manifest.backupId, /^daily-\d{8}T\d{6}Z-[a-f0-9]{12}$/);
  assert.ok(Number.isFinite(Date.parse(manifest.completedAt)));
  assert.equal(manifest.software.deploymentManifestSha256, contract.djangoManifestSha256);
  sameKeys(manifest.software, softwareKeys); sameKeys(contract.software, softwareKeys);
  for (const digest of Object.values(manifest.software)) hex(digest);
  assert.deepEqual(manifest.software, contract.software);
  assert.equal(manifest.profileEvidence.profile, contract.profile);
  assert.equal(manifest.profileEvidence.newRecoveryKeyGenerated, false);
  assert.equal(manifest.profileEvidence.archiveEncrypted, false);
  assert.equal(manifest.profileEvidence.privateKeyRows, 0);
  assert.ok(contract.evidenceTables.length > 0 && contract.profileTables.length > 0);
  sameKeys(manifest.evidence.tables, contract.evidenceTables);
  sameKeys(manifest.profileEvidence.tables, contract.profileTables);
  assert.ok(Object.keys(manifest.profileEvidence.roles).length > 0);
  sameKeys(manifest.profileEvidence.roles, contract.roleKeys);
  for (const table of Object.values(manifest.profileEvidence.tables)) {
    sameKeys(table, ['rows','sha256']); hex(table.sha256);
    assert.ok(Number.isSafeInteger(table.rows) && table.rows >= 0);
  }
  assert.ok(manifest.evidence.migrations.length > 0);
  sameKeys(manifest.profileEvidence.catalog, contract.catalogKeys);
  for (const digest of Object.values(manifest.profileEvidence.catalog)) hex(digest);
  assert.equal(manifest.profileEvidence.contentSha256, profileDigest(manifest.profileEvidence));
  hex(manifest.dump.sha256); hex(manifest.evidence.contentSha256); hex(manifest.profileEvidence.contentSha256);
  assert.deepEqual(manifest.database, contract.database);
  return manifest;
}

export function validateRecovery({ manifestRaw, manifestSidecar, restoreRaw, restoreSidecar,
  manifestSha256, dumpSha256, contentSha256, backupId, rehearsalId, rehearsalPort, contract }) {
  for (const digest of [manifestSha256, dumpSha256, contentSha256]) hex(digest);
  assert.equal(sha(manifestRaw), manifestSha256);
  assert.equal(manifestSidecar.toString().trim(), manifestSha256);
  assert.equal(restoreSidecar.toString().trim(), sha(restoreRaw));
  const manifest = assertFullManifest(JSON.parse(manifestRaw), contract), restore = JSON.parse(restoreRaw);
  assert.equal(manifest.backupId, backupId); assert.equal(manifest.dump.sha256, dumpSha256);
  assert.equal(manifest.evidence.contentSha256, contentSha256);
  assert.equal(restore.status, 'completed'); assert.equal(restore.backupId, backupId);
  assert.equal(restore.rehearsalId, rehearsalId); assert.match(rehearsalId, /^[a-f0-9]{12}$/);
  assert.ok(Number.isSafeInteger(rehearsalPort) && rehearsalPort >= 55432 && rehearsalPort <= 55999);
  assert.equal(restore.isolatedPort, rehearsalPort);
  assert.equal(restore.backupManifestSha256, manifestSha256); assert.equal(restore.dumpSha256, dumpSha256);
  assert.equal(restore.expectedContentSha256, contentSha256); assert.equal(restore.restoredContentSha256, contentSha256);
  assert.equal(restore.profileContentSha256, manifest.profileEvidence.contentSha256);
  assert.equal(restore.profileRestoreVerified, true); assert.equal(restore.sequenceHealthVerified, true);
  assert.equal(restore.productionDatabaseTouched, false); assert.equal(restore.serviceStateChanged, false);
  assert.equal(restore.cleanupStatus, 'isolated_data_removed');
  return { manifest, restore, originalRestoreSha256: sha(restoreRaw), fullProfileIsInOriginalManifest: true };
}

export function compareFullRecovery(before, after, contract) {
  assertFullManifest(before, contract); assertFullManifest(after, contract);
  assert.notEqual(before.backupId, after.backupId);
  assert.ok(Date.parse(after.completedAt) >= Date.parse(before.completedAt));
  assert.deepEqual(before.database, after.database);
  assert.deepEqual(before.software, after.software);
  assert.deepEqual(before.evidence.migrations, after.evidence.migrations);
  assert.deepEqual(before.profileEvidence.catalog, after.profileEvidence.catalog);
  assert.deepEqual(before.profileEvidence.roles, after.profileEvidence.roles);
  assert.deepEqual(before.evidence.tables, after.evidence.tables);
  assert.deepEqual(before.profileEvidence.tables, after.profileEvidence.tables);
  assert.equal(before.evidence.contentSha256, after.evidence.contentSha256);
  assert.equal(before.profileEvidence.contentSha256, after.profileEvidence.contentSha256);
  // No legal-transition exemption is inferred. Any real change fails and needs
  // an independent exact source witness/new plan; do not rewrite the baseline.
  return { status: 'passed', completeBusinessContentEqual: true, migrationsEqual: true,
    roleAndPermissionCatalogueEqual: true, profileTables: contract.profileTables.length,
    unauthorizedContentChanges: 0, baselineContentSha256: before.evidence.contentSha256,
    afterContentSha256: after.evidence.contentSha256 };
}

export function validateHistoricalAudit(baseline, actual, expectedCaptureSha256) {
  hex(expectedCaptureSha256); assert.equal(hash(baseline), expectedCaptureSha256);
  assert.equal(baseline.version, 'task-d-complete-audit-baseline-v2');
  assert.ok(Number.isFinite(Date.parse(baseline.capturedAt)));
  assert.ok(baseline.completeRootInventory === true && baseline.files.length > 0);
  assert.equal(baseline.fileCount, baseline.files.length);
  assert.equal(baseline.inventorySha256, hash(baseline.files));
  assert.ok(baseline.roots.length > 0);
  const roots = new Set(baseline.roots.map(root=>root.path));
  assert.equal(roots.size, baseline.roots.length);
  assert.equal(baseline.roots.reduce((sum,root)=>sum+root.fileCount,0),baseline.files.length);
  for(const file of baseline.files) assert.ok(roots.has(file.root), 'File root was not declared');
  for (const root of baseline.roots) {
    assert.ok(root.path && root.fileCount > 0);
    assert.equal(baseline.files.filter(file => file.root === root.path).length, root.fileCount);
  }
  assert.equal(new Set(baseline.files.map(file => file.path)).size, baseline.files.length);
  const found = new Map(actual.map(file => [file.path, file]));
  assert.equal(found.size, actual.length);
  for (const original of baseline.files) {
    const observed = found.get(original.path);
    assert.ok(observed, 'Original audit file removed');
    assert.equal(observed.sha256, original.sha256); assert.equal(observed.bytes, original.bytes);
  }
  const originalPaths = new Set(baseline.files.map(file => file.path));
  return { status: 'passed', originalAuditBytesPreserved: true, originalFiles: baseline.fileCount,
    addedFiles: actual.filter(file => !originalPaths.has(file.path)) };
}

export function validateNaturalObservation(value, { releaseId, fence, after }) {
  assert.ok(Date.parse(value.at) > after && Number.isFinite(Date.parse(value.at)));
  assert.equal(value.releaseId, releaseId); assert.equal(value.admission.mode, 'running');
  assert.equal(value.admission.fence, fence); hex(fence);
  assert.equal(value.healthy, true); assert.equal(value.probeError, false);
  assert.equal(value.system, 'Running'); assert.equal(value.backend, 'Ready');
  assert.equal(value.worker, 'exact_release'); assert.equal(value.supervisor, 'running');
  assert.equal(value.supervisorHealth, 'healthy'); sameKeys(value.components, components);
  for (const name of components) assert.equal(value.components[name], true);
  sameKeys(value.probes, ['homepage','live','ready','helper']);
  for (const probe of Object.values(value.probes)) assert.equal(probe.ok, true);
  assert.notEqual(value.business?.status, 'degraded');
  assert.ok(Number.isSafeInteger(value.workerPid) && value.workerPid > 0);
  assert.ok(Number.isSafeInteger(value.supervisorPid) && value.supervisorPid > 0);
  return value;
}

export function closeNaturalObservations(observations, expected) {
  assert.ok(observations.length >= 2);
  const instants = new Set(); let lastAt = expected.after, owner = null;
  for (const observation of observations) {
    assert.equal(sha(observation.raw), observation.sha256);
    const value = validateNaturalObservation(JSON.parse(observation.raw), expected);
    assert.ok(Date.parse(value.at) > lastAt); lastAt = Date.parse(value.at);
    assert.ok(!instants.has(value.at)); instants.add(value.at);
    const identity = { workerPid: value.workerPid, supervisorPid: value.supervisorPid, fence: value.admission.fence };
    if (owner) assert.deepEqual(identity, owner, 'A restart boundary cannot supply the same pair'); else owner = identity;
  }
  return { status: 'passed', twoNaturalHealthy: true, allFreshObservationsPreserved: true, observations: observations.length, identity: owner };
}

export function assertBoundEntrypoints(command) {
  const files = new Map(command.files.map(file => [file.path, file.sha256]));
  assert.equal(files.size, command.files.length);
  const entry = command.args[command.args.indexOf('-File') + 1];
  assert.ok(files.has(command.executable) && files.has(entry), 'Exact executable/argv path must be pinned');
  for (const digest of files.values()) hex(digest);
  return command;
}

export function validateWatchdogTask(before, expected) {
  assert.equal(before.taskName, 'TERUISI Operations Watchdog');
  assert.equal(before.taskXmlSha256, expected.taskXmlSha256);
  assert.equal(before.configurationSha256, expected.configurationSha256);
  assert.equal(before.exists, true);
  assert.equal(before.enabled, true);
  assert.notEqual(before.state, 'Running', 'Original installer must not start while the original task is running');
  return before;
}
