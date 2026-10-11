// One read-only source identity session. No batch execute, service or database call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex'),canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const e='E:/codex-artifacts/release-first-adoption-targeted-20261011',candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749',raw=fs.readFileSync(path.join(e,'ADOPTION_BATCH_FRESH_V1.json'));
assert.equal(hash(raw),'eec240464811a6e954f489d8504aa6b77880f99187340b5899509a2093a5d639');
const spec=JSON.parse(raw),expected=JSON.parse(spec.batch.sourceBinding.raw).identity,sourceRoot='D:/codex-isolated/release-first-adoption-targeted-20261011/adoption-source-v3';
assert.equal(hash(fs.readFileSync(path.join(candidate,'deployment-manifest.json'))),spec.batch.binding.artifactSha256);
// Pin the previously fully audited direct code/parser closure before importing code.
for(const pin of spec.collector.files.filter(p=>!p.path.endsWith('ADOPTION_TESTS_FRESH_V1.json'))) {const stat=fs.lstatSync(pin.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);assert.equal(hash(fs.readFileSync(pin.path)),pin.sha256);}
const helper=path.join(candidate,'tools/release-preparation-evidence.mjs');assert.equal(hash(fs.readFileSync(helper)),'b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6');
const {createPreparationEvidenceSession}=await import(pathToFileURL(helper).href);
const startedAt=new Date().toISOString(),steps=[];let session,status='failed',failure=null,identityMatchingSourceBinding=false;
try {
 session=createPreparationEvidenceSession({batchSha256:spec.batch.batchSha256,sourceRoot});
 const start=performance.now(),first=await session.collect({approvedBatchSha256:spec.batch.batchSha256,full:true});steps.push({name:'full-source-identity',status:'passed',durationMs:performance.now()-start});
 assert.equal(first.sourceTree.sha256,spec.batch.binding.sourceSha256);assert.equal(first.sourceInventorySha256,spec.batch.binding.sourceInventorySha256);assert.equal(first.runtimeConfigurationSha256,expected.runtimeConfigurationSha256);assert.equal(first.nodeExecutableSha256,expected.nodeExecutableSha256);
 identityMatchingSourceBinding=canonical(first)===canonical(expected);
 const reuseStart=performance.now(),reuse=await session.collect({approvedBatchSha256:spec.batch.batchSha256});assert.equal(canonical(reuse),canonical(first));steps.push({name:'reuse-full-byte-observation',status:'passed',durationMs:performance.now()-reuseStart});
 const finalStart=performance.now();await session.recheck();session.assertStable();steps.push({name:'source-session-final-recheck',status:'passed',durationMs:performance.now()-finalStart});status='passed';
}catch(error){const message=String(error.message);failure={type:error.name,knownFixedDiagnostic:message==='Inputs changed while evidence session was held'?message:null,messageSha256:hash(message)};}
finally{session?.dispose();}
assert.equal(hash(fs.readFileSync(helper)),'b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6');
const record={version:'teruisi-c-fixed-source-native-session-one-probe-v1',startedAt,finishedAt:new Date().toISOString(),status,sourceRoot,helperSha256:'b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6',sourceSha256:spec.batch.binding.sourceSha256,batchSha256:spec.batch.batchSha256,steps,failure,identityMatchingSourceBinding,configurationValuesNotExported:true,onlySourceNodeNpmGitConfigurationInputsRead:true,fullBuiltPayloadNotRepeated:true,fullAdmissionOrReadyChecksNotPerformed:true,declaredFreshEntryOrBatchNotChanged:true,original214of215NotRewritten:true,productionActions:0};
fs.writeFileSync(new URL('./FIXED_SOURCE_SESSION_PROBE.json',import.meta.url),JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status,steps:steps.length,identityMatchingSourceBinding,failure}));
if(status!=='passed')process.exitCode=1;
