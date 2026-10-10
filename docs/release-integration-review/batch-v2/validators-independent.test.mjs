// Non-author pure negative probes. No filesystem, runtime, DB or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFullManifest, validateHistoricalAudit,
  validateNaturalObservation, sha, canonical, components } from './validators.mjs';
const h=c=>c.repeat(64),hash=x=>sha(canonical(x));
function fixture() {
  const software=Object.fromEntries(['deploymentManifestSha256','serviceConfigSha256','serviceScriptSha256','operatorScriptSha256','evidenceToolSha256','pgDumpSha256','pgRestoreSha256'].map(key=>[key,h('a')]));
  const contract={djangoManifestSha256:h('a'),software,profile:'teruisi-postgres-no-new-keys-v1',database:{name:'fixture'},evidenceTables:['owned'],profileTables:['owned'],catalogKeys:['relations','policies'],roleKeys:['roles','settings']};
  const profile={profile:contract.profile,newRecoveryKeyGenerated:false,archiveEncrypted:false,privateKeyRows:0,
    roles:{roles:[['teruisi_fixture',false]],settings:[]},catalog:{relations:h('b'),policies:h('c')},tables:{owned:{rows:1,sha256:h('d')}},sequenceLowerBounds:{owned_id:{minimumLastValue:2,isCalled:true}}};
  profile.contentSha256=hash(Object.fromEntries(['profile','roles','tables','catalog'].map(key=>[key,profile[key]])));
  const value={version:'teruisi-postgres-daily-backup-v2-no-keys',status:'completed',backupId:'daily-20261010T020000Z-111111111111',completedAt:'2026-10-10T02:00:00Z',software,database:contract.database,
    dump:{sha256:h('e')},evidence:{tables:{owned:{rows:1}},migrations:[{app:'fixture',name:'0001'}],contentSha256:h('f')},profileEvidence:profile};
  return {value,contract};
}
test('independent v2: incomplete software identity cannot use only the Django manifest label',()=>{
  const {value,contract}=fixture();assertFullManifest(value,contract);delete value.software.pgDumpSha256;
  assert.throws(()=>assertFullManifest(value,contract));
});
test('independent v2: profile content checksum must bind its actual roles/tables/catalog',()=>{
  const {value,contract}=fixture();assertFullManifest(value,contract);
  value.profileEvidence.roles.roles=[['teruisi_fixture',true]];
  assert.throws(()=>assertFullManifest(value,contract));
});
test('independent v2: digest catalogue cannot be replaced by arbitrary matching arrays',()=>{
  const {value,contract}=fixture();value.profileEvidence.catalog.relations=[];
  value.profileEvidence.contentSha256=hash(Object.fromEntries(['profile','roles','tables','catalog'].map(key=>[key,value.profileEvidence[key]])));
  assert.throws(()=>assertFullManifest(value,contract));
});
test('independent v2: historical files cannot claim an undeclared audit root',()=>{
  const files=[{root:'D:\\fixed',path:'D:\\fixed\\one.json',bytes:1,sha256:h('a')},{root:'E:\\undeclared',path:'E:\\undeclared\\other.json',bytes:1,sha256:h('b')}];
  const baseline={version:'task-d-complete-audit-baseline-v2',capturedAt:'2026-10-10T02:00:00Z',completeRootInventory:true,roots:[{path:'D:\\fixed',fileCount:1}],files,fileCount:2,inventorySha256:hash(files)};
  assert.throws(()=>validateHistoricalAudit(baseline,files,hash(baseline)));
});
test('independent v2: natural health needs the original named probes, not four arbitrary true keys',()=>{
  const value={at:'2026-10-10T02:01:00Z',releaseId:'fixture',admission:{mode:'running',fence:h('a')},healthy:true,probeError:false,system:'Running',backend:'Ready',worker:'exact_release',supervisor:'running',supervisorHealth:'healthy',
    components:Object.fromEntries(components.map(name=>[name,true])),workerPid:1,supervisorPid:2,probes:Object.fromEntries(['wrong1','wrong2','wrong3','wrong4'].map(name=>[name,{ok:true}]))};
  assert.throws(()=>validateNaturalObservation(value,{releaseId:'fixture',fence:h('a'),after:Date.parse('2026-10-10T02:00:00Z')}));
});
