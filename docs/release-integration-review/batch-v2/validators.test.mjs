import test from 'node:test';
import assert from 'node:assert/strict';
import { sha, canonical, components, assertCompleteStatus, validateRecovery, compareFullRecovery,
  validateHistoricalAudit, closeNaturalObservations, assertBoundEntrypoints, validateWatchdogTask, softwareKeys, profileDigest } from './validators.mjs';
const h = c => c.repeat(64), clone = value => structuredClone(value);
const contract = { djangoManifestSha256: h('a'), profile: 'teruisi-postgres-no-new-keys-v1', database: { name: 'fixture' },
  software:Object.fromEntries(softwareKeys.map(k=>[k,h('a')])),evidenceTables: ['old','more'], profileTables: ['old','more','keys'], catalogKeys: ['relations','policies'], roleKeys: ['roles','grants'] };
const manifest = { version: 'teruisi-postgres-daily-backup-v2-no-keys', status: 'completed', backupId: 'daily-20261010T020000Z-111111111111',
  completedAt: '2026-10-10T02:00:00Z', database: contract.database, software:contract.software, dump: { sha256: h('b') },
  evidence: { contentSha256: h('c'), migrations: [['owned','001']], tables: { old: { rows: 3 }, more: { rows: 1 } } },
  profileEvidence: { profile: contract.profile, newRecoveryKeyGenerated: false, archiveEncrypted: false, privateKeyRows: 0,
    contentSha256: h('d'), roles: { roles: ['read-only'], grants: [] }, catalog: { relations: h('e'), policies: h('f') },
    tables: Object.fromEntries(contract.profileTables.map(name => [name,{ rows: 1, sha256: h('e') }])) } };
manifest.profileEvidence.contentSha256=profileDigest(manifest.profileEvidence);
function recovery(changes = {}) {
  const m = clone(manifest), r = { status: 'completed', backupId: m.backupId, rehearsalId: '222222222222', isolatedPort: 55592,
    backupManifestSha256: sha(canonical(m)), dumpSha256: m.dump.sha256,
    expectedContentSha256: m.evidence.contentSha256, restoredContentSha256: m.evidence.contentSha256,
    profileContentSha256: m.profileEvidence.contentSha256, profileRestoreVerified: true, sequenceHealthVerified: true,
    productionDatabaseTouched: false, serviceStateChanged: false, cleanupStatus: 'isolated_data_removed' };
  Object.assign(r, changes);
  const manifestRaw = Buffer.from(canonical(m)), restoreRaw = Buffer.from(canonical(r));
  return { manifestRaw, manifestSidecar: Buffer.from(sha(manifestRaw)), restoreRaw, restoreSidecar: Buffer.from(sha(restoreRaw)),
    manifestSha256: sha(manifestRaw), dumpSha256: m.dump.sha256, contentSha256: m.evidence.contentSha256,
    backupId: m.backupId, rehearsalId: r.rehearsalId, rehearsalPort: 55592, contract };
}
test('v2 exact canonical PS entrypoint must be the pinned physical path', () => {
  const c = { executable: 'C:\\Windows\\powershell.exe', args: ['-File','D:\\original.ps1'],
    files: [{ path:'C:\\Windows\\powershell.exe',sha256:h('a') },{ path:'D:\\original.ps1',sha256:h('b') }] };
  assertBoundEntrypoints(c); c.args[1]='D:/original.ps1'; assert.throws(() => assertBoundEntrypoints(c));
});
test('v2 complete components cannot be replaced by completed/not-ready wrapper', () => {
  const s = { state:'Running',backendState:'Ready',workerState:'exact_release',releaseId:'fixture',components:Object.fromEntries(components.map(n=>[n,true])) };
  assertCompleteStatus(s,'fixture'); s.components.finance=false; assert.throws(()=>assertCompleteStatus(s,'fixture'));
  delete s.components.finance; s.components.fake=true; assert.throws(()=>assertCompleteStatus(s,'fixture'));
});
test('v2 complete original recovery bytes and both sidecars bind exact point', () => validateRecovery(recovery()));
for (const [name, mutation] of [
  ['wrong-original-restore-sidecar', x => x.restoreSidecar=Buffer.from(h('f'))],
  ['wrong-original-manifest-sidecar', x => x.manifestSidecar=Buffer.from(h('f'))],
  ['wrong-backup-id', x => x.backupId='daily-20261010T020000Z-333333333333'],
  ['wrong-rehearsal-id', x => x.rehearsalId='333333333333'],
  ['wrong-isolated-port', x => x.rehearsalPort=55593],
  ['wrong-original-dump', x => x.dumpSha256=h('f')],
  ['fake-equal-content-labels', x => { const r=JSON.parse(x.restoreRaw);r.expectedContentSha256=h('f');r.restoredContentSha256=h('f');x.restoreRaw=Buffer.from(canonical(r));x.restoreSidecar=Buffer.from(sha(x.restoreRaw)); }],
  ['wrong-original-full-profile', x => { const r=JSON.parse(x.restoreRaw);r.profileContentSha256=h('f');x.restoreRaw=Buffer.from(canonical(r));x.restoreSidecar=Buffer.from(sha(x.restoreRaw)); }],
  ['missing-original-table', x => { const m=JSON.parse(x.manifestRaw);delete m.profileEvidence.tables.more;x.manifestRaw=Buffer.from(canonical(m));x.manifestSha256=sha(x.manifestRaw);x.manifestSidecar=Buffer.from(x.manifestSha256); }],
]) test('v2 recovery rejects '+name, () => { const x=recovery(); mutation(x); assert.throws(()=>validateRecovery(x)); });
test('v2 two NEW full snapshots compare every table, role, catalog and migration', () => {
  const next=clone(manifest);next.backupId='daily-20261010T030000Z-444444444444';next.completedAt='2026-10-10T03:00:00Z';
  assert.equal(compareFullRecovery(manifest,next,contract).completeBusinessContentEqual,true);
  const changed=clone(next);changed.profileEvidence.tables.old.sha256=h('f'); assert.throws(()=>compareFullRecovery(manifest,changed,contract));
  const role=clone(next);role.profileEvidence.roles.roles=['writable'];assert.throws(()=>compareFullRecovery(manifest,role,contract));
  const migration=clone(next);migration.evidence.migrations.push(['owned','002']);assert.throws(()=>compareFullRecovery(manifest,migration,contract));
  assert.throws(()=>compareFullRecovery(manifest,manifest,contract));
});
const oldFiles = [{root:'D:\\fixed',path:'D:\\fixed\\one.json',bytes:10,sha256:h('a')}, {root:'D:\\fixed',path:'D:\\fixed\\failed.json',bytes:20,sha256:h('b')}];
const baseline = {version:'task-d-complete-audit-baseline-v2',capturedAt:'2026-10-10T02:00:00Z',completeRootInventory:true,
  roots:[{path:'D:\\fixed',fileCount:2}],files:oldFiles,fileCount:2,inventorySha256:sha(canonical(oldFiles))};
test('v2 complete old audits retain unknown/failed bytes and record additions', () => {
  const out=validateHistoricalAudit(baseline,[...oldFiles,{root:'D:\\fixed',path:'D:\\fixed\\new.json',bytes:1,sha256:h('c')}],sha(canonical(baseline)));
  assert.equal(out.originalFiles,2);assert.equal(out.addedFiles.length,1);
});
test('v2 empty/partial/wrong-byte historical baselines cannot claim full preservation', () => {
  const empty={...baseline,files:[],fileCount:0,inventorySha256:sha(canonical([]))};assert.throws(()=>validateHistoricalAudit(empty,[],sha(canonical(empty))));
  const missing={...baseline,files:[oldFiles[0]]};assert.throws(()=>validateHistoricalAudit(missing,oldFiles,sha(canonical(missing))));
  assert.throws(()=>validateHistoricalAudit(baseline,[oldFiles[0]],sha(canonical(baseline))));
  assert.throws(()=>validateHistoricalAudit(baseline,[oldFiles[0],{...oldFiles[1],sha256:h('f')}],sha(canonical(baseline))));
});
const naturalExpected={releaseId:'fixture',fence:h('a'),after:Date.parse('2026-10-10T02:00:00Z')};
function natural(at) { const value={at,releaseId:'fixture',admission:{mode:'running',fence:h('a')},healthy:true,probeError:false,system:'Running',backend:'Ready',worker:'exact_release',
  supervisor:'running',supervisorHealth:'healthy',components:Object.fromEntries(components.map(n=>[n,true])),probes:Object.fromEntries(['homepage','live','ready','helper'].map(n=>[n,{ok:true}])),workerPid:100,supervisorPid:101};
  const raw=Buffer.from(canonical(value));return {raw,sha256:sha(raw)}; }
test('v2 all observed natural bytes, same fence and process identity are required', () => {
  const a=natural('2026-10-10T02:01:00Z'), b=natural('2026-10-10T02:02:00Z'); assert.equal(closeNaturalObservations([a,b],naturalExpected).twoNaturalHealthy,true);
  assert.throws(()=>closeNaturalObservations([a,a],naturalExpected));
  const failed=JSON.parse(a.raw);failed.healthy=false;const raw=Buffer.from(canonical(failed));
  assert.throws(()=>closeNaturalObservations([a,{raw,sha256:sha(raw)},b],naturalExpected));
  const other=JSON.parse(b.raw);other.supervisorPid=102;const moved=Buffer.from(canonical(other));assert.throws(()=>closeNaturalObservations([a,{raw:moved,sha256:sha(moved)}],naturalExpected));
});
test('v2 missing/changed/running original watchdog task is rejected before installer', () => {
  const expected={taskXmlSha256:h('a'),configurationSha256:h('b')}, value={...expected,taskName:'TERUISI Operations Watchdog',exists:true,enabled:true,state:'Ready'};
  validateWatchdogTask(value,expected);
  for(const patch of [{exists:false},{state:'Running'},{taskXmlSha256:h('f')},{configurationSha256:h('f')}])assert.throws(()=>validateWatchdogTask({...value,...patch},expected));
});
