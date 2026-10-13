// Bind the tested exact closure to actual read-only qualification; no production approval.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/',sha=b=>createHash('sha256').update(b).digest('hex');
const finalHandoff='41074be9c8a26b48fac1ea6fe25948b2ea0096d8200acfbd8d77b8f4c551cd7a';
async function load(name){const raw=await readFile(root+name);return {raw,value:JSON.parse(raw)};}
const handoff=await load('ASTRA_LIVE_GUARD_CORE_HANDOFF_V6.json');assert.equal(sha(handoff.raw),finalHandoff);
for(const f of handoff.value.files){const s=await lstat(f.path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);assert.equal(sha(await readFile(f.path)),f.sha256);}
const tests=await load('PRIMARY_FINAL_REGRESSION.json');assert.equal(tests.value.status,'passed');assert.equal(tests.value.failed,0);assert.equal(tests.value.passed,128);assert.equal(tests.value.sourceHandoffSha256,finalHandoff);assert.deepEqual(tests.value.files,handoff.value.files);
for(const f of tests.value.testFiles)assert.equal(sha(await readFile(f.path)),f.sha256);
const actual=await load('PRIMARY_LIVE_REFERENCE_QUALIFICATION_V4.json');
assert.equal(actual.value.status,'passed');assert.equal(actual.value.productionActions,0);
const a=actual.value.audit;assert.equal(a.status,'passed');assert.deepEqual(a.references,[]);assert.deepEqual(a.unknown,[]);
assert.deepEqual(a.classified.map(c=>c.processId).sort((a,b)=>a-b),[236,280,1700,6548,53880]);
assert.ok(a.stages.includes('guest-shape-and-references-checked')&&a.stages.includes('live-host-guest-association-checked'));
const packet=await load('LIVE_REFERENCE_READONLY_QUALIFICATION_V4.json');assert.equal(sha(packet.raw),'de8900edfc9a3216791d59bb5a58a75fb2eac8d8a1186fd265f3e9fd3f66d785');assert.equal(packet.value.productionApproved,false);
for(const f of handoff.value.files)assert.ok(packet.value.entries.some(p=>path.resolve(p.path)===path.resolve(f.path)&&p.sha256===f.sha256));
const old=JSON.parse(await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/ADOPTION_BATCH_FRESH_V1.json'));
const order=['adoption-scope-live-guard.mjs','live-reference-audit.mjs','live-os-instance-policy.mjs','live-wsl-policy.mjs','live-wsl-host-policy.mjs','system-wsl-verifier.mjs','collect-live-wsl.py','Collect-LiveProcessIdentity.ps1','Probe-ResidualProcessMetadataV2.ps1','Collect-SystemWslIdentity.ps1','Collect-LiveWslHostAssociation.ps1'];
const here=path.dirname(fileURLToPath(import.meta.url));
const guardFiles=order.map(n=>({path:path.join(here,n),sha256:handoff.value.files.find(f=>f.name===n).sha256}));
const record={version:'teruisi-final-live-guard-validation-v1',status:'passed-for-declared-live-guard',failed:0,at:new Date().toISOString(),sourceSha256:old.batch.binding.sourceSha256,artifactSha256:old.batch.binding.artifactSha256,sourceHandoffSha256:finalHandoff,guardFiles,evidence:[{path:root+'PRIMARY_FINAL_REGRESSION.json',sha256:sha(tests.raw)},{path:root+'PRIMARY_LIVE_REFERENCE_QUALIFICATION_V4.json',sha256:sha(actual.raw)},{path:root+'LIVE_REFERENCE_READONLY_QUALIFICATION_V4.json',sha256:sha(packet.raw)}],productionApproved:false,limits:'Read-only current reference qualification only; full guard executes after approved Worker apply with real WAL. No production acceptance or whole OS handle proof.'};
await writeFile(root+'FINAL_LIVE_GUARD_VALIDATION_V1.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:record.status,productionApproved:false}));
