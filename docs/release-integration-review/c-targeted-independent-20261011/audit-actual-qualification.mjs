// Bind the actual declared qualify output; no executable product import or action.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-first-adoption-targeted-20261011',hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const fingerprints=new Map(),fp=s=>[s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function read(name){const target=path.join(root,name),before=fs.lstatSync(target,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<6n*1024n*1024n);const raw=fs.readFileSync(target);assert.equal(fp(fs.lstatSync(target,{bigint:true})),fp(before));fingerprints.set(target,fp(before));return raw;}
const specRaw=read('ADOPTION_BATCH_FRESH_V1.json'),spec=JSON.parse(specRaw);
assert.equal(hash(specRaw),'eec240464811a6e954f489d8504aa6b77880f99187340b5899509a2093a5d639');
const recordRaw=read('FRESH_ENTRY_ACTUAL_QUALIFICATION.json'),record=JSON.parse(recordRaw);
assert.equal(hash(recordRaw),'3e67a664bf654bbb34d1aa1ca3c7420b478a20f6b5e7b1c905c2e1c9245fffc0');
const stdout=read('FRESH_ENTRY_ACTUAL_QUALIFY_STDOUT.json'),stderr=read('FRESH_ENTRY_ACTUAL_QUALIFY_STDERR.log'),current=JSON.parse(stdout);
assert.equal(hash(stdout),'3253de13a89fedab1f79fb8d0f3569c186cb0247d1709a8ffd651c1ec0155ef0');assert.equal(stderr.length,0);
assert.equal(record.status,'passed');assert.equal(record.exitCode,0);assert.equal(record.productionMaintenanceSwitchBackupRestore,0);assert.equal(record.referenceGuardRemainsSeparate,true);
assert.deepEqual(record.argv,spec.execution.qualifyArgs);assert.ok(!record.argv.includes('execute'));
assert.equal(record.entryPath,spec.execution.entryPath);assert.equal(record.entrySha256,spec.execution.entrySha256);assert.equal(record.entrySha256,'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99');
assert.equal(hash(read('fresh-adoption-entry-v2.mjs')),record.entrySha256);
assert.equal(record.batchSha256,spec.batch.batchSha256);assert.equal(record.sourceSha256,spec.batch.binding.sourceSha256);assert.equal(record.candidateManifestSha256,spec.batch.binding.artifactSha256);
assert.equal(canonical(current),canonical(record.current));assert.equal(current.executionMode,'fresh-no-reuse-v1');assert.equal(current.batchSha256,record.batchSha256);assert.equal(canonical(current.binding),canonical(spec.batch.binding));
assert.equal(current.admissionStages.length,15);assert.ok(current.admissionStages.every(s=>s.status==='passed'&&Number.isFinite(s.durationMs)&&s.durationMs>=0));
assert.equal(current.statusObservation,null,'No actual retry/status attempt list was returned');
const finished=Date.parse(record.finishedAt),started=Date.parse(record.startedAt),age=finished-current.observedAtMs;
assert.ok(Number.isSafeInteger(current.observedAtMs)&&Number.isFinite(age)&&age>=0&&age<=5000);assert.equal((finished-started)/1000,record.durationSeconds);
for(const [target,before]of fingerprints)assert.equal(fp(fs.lstatSync(target,{bigint:true})),before);
const result={version:'teruisi-c-declared-actual-qualification-independent-binding-v1',at:new Date().toISOString(),status:'passed',specRawSha256:hash(specRaw),batchSha256:record.batchSha256,entrySha256:record.entrySha256,qualificationRecordSha256:hash(recordRaw),stdoutSha256:hash(stdout),startedAt:record.startedAt,finishedAt:record.finishedAt,durationSeconds:record.durationSeconds,completionAgeOfActualFinalObservationMs:age,stages:current.admissionStages,stageDurationSumMs:current.admissionStages.reduce((n,s)=>n+s.durationMs,0),fullDurationIncludesBootstrapAndWrapperOverhead:true,statusObservationWasNull:true,originalCachedPathNotQualified:true,productionReferenceAdmissionNotPassed:true,productionActions:0,rootReranHeavyCollector:false};
fs.writeFileSync(new URL('./ACTUAL_QUALIFICATION_AUDIT.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,durationSeconds:result.durationSeconds,observationAgeMs:age,batchSha256:result.batchSha256}));
