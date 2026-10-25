// Virtual I/O counterexamples only. Never import candidate modules or call product CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const target='E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry.mjs';
const bytes=readFileSync(target),text=bytes.toString('utf8');
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
assert.equal(hash(bytes),'b7c1edb6b05da5dac5791e1474ca0e01047d216e8e9763c2aa80d05012ed72c2');
writeFileSync(new URL('./fresh-entry-reviewed-first.mjs.txt',import.meta.url),bytes,{flag:'wx'});
async function subject(){
 const imports=[],reads=[],runtime='D:\\teruisi-runtime\\teruisi-worker-sales',specPath='E:\\private-fixture\\batch.json',testsPath='E:\\private-fixture\\tests.json',approved='a'.repeat(64);
 const batch={version:'teruisi-release-batch-v4',binding:{artifactSha256:'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',workerPlanSha256:'0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881'},operations:[],tests:{evidence:[{kind:'first-adoption-execution',mode:'fresh-no-reuse-v1',path:target,sha256:hash(bytes)}]}};
 const collector={args:['unused','collect',specPath,testsPath],files:[{path:testsPath,sha256:'b'.repeat(64)}]};batch.collectorSha256=hash(collector);
 const spec={batch,collector,journalRoot:path.join(runtime,'state','release-batches')},raw=Buffer.from(JSON.stringify(spec));
 const observed={batchSha256:approved,observedAtMs:0,admissionStages:[{stage:'complete-status',durationMs:42}],statusObservation:{attempts:[{stage:'admission-status',attempt:1,status:'passed',at:'2026-10-11T00:00:00.000Z',durationMs:42,error:null}]}};
 const safeRead=async p=>{reads.push(p);return p===specPath?raw:Buffer.from('public manifest fixture');};
 const libraries={impact:{hash:v=>v===undefined?null:Buffer.isBuffer(v)&&v.toString()==='public manifest fixture'?batch.binding.artifactSha256:hash(v),canonical,safeRead,safeFileDigest:async p=>path.resolve(p)===path.resolve(target)?hash(bytes):'b'.repeat(64)},
  batch:{verifyBatch:()=>{},validateNoDataCollector:()=>{},executeBatch:()=>{throw Error('Actual execution forbidden');},runApprovedOperation:()=>{throw Error('Actual operation forbidden');},writeOnce:async()=>{}},
  admission:{collectBatchAdmission:async()=>observed},worker:{workerRuntimeRoot:runtime,processDeadline:()=>10000}};
 const importModule=async url=>{imports.push({url,validatedBeforeImport:reads.length>0});return url.includes('release-impact.mjs')?libraries.impact:url.includes('release-batch-admission.mjs')?libraries.admission:url.includes('release-batch.mjs')?libraries.batch:libraries.worker;};
 const body=text.slice(text.indexOf('const candidate='),text.indexOf('if(process.argv[1]')).replaceAll('await import(','await importModule(').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(target).href)).replace('export async function','async function');
 const execute=await vm.runInNewContext('(async()=>{'+body+';return executeFreshAdoption;})()',{assert,path,fileURLToPath,pathToFileURL,randomUUID:()=> 'fixture-uuid',importModule,Date:{now:()=>10000},process:{cwd:()=> 'E:\\private-fixture'}});
 return {execute,imports,specPath,approved,observed};
}
test('candidate imports must occur only after builtin closure/binding validation',async()=>{
 const f=await subject();assert.equal(f.imports.filter(v=>!v.validatedBeforeImport).length,0);
});
test('stale assertion after actual collector return must preserve known stages/attempts on the thrown error',async()=>{
 const f=await subject();let error;try{await f.execute('qualify',f.specPath,f.approved);}catch(e){error=e;}
 assert.ok(error);assert.match(error.message,/Stale live admission/);
 assert.deepEqual(error.admissionStages,f.observed.admissionStages);assert.deepEqual(error.observationAttempts,f.observed.statusObservation.attempts);
});
