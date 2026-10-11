import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const target='E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',bytes=readFileSync(target),source=bytes.toString('utf8');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
assert.equal(hash(bytes),'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99');
const snapshot=new URL('./fresh-entry-reviewed-v2.mjs.txt',import.meta.url);
try{writeFileSync(snapshot,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.ok(readFileSync(snapshot).equals(bytes));}
async function fixture(fault){
 const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749',runtime='D:\\teruisi-runtime\\teruisi-worker-sales',specPath='E:\\private-model\\spec.json',testsPath='E:\\private-model\\tests.json';
 const imports=[],checks=[],writes=[],wal=[];let returned=false,treeVerified=false;
 const names=['release-batch.mjs','release-batch-admission.mjs','release-impact.mjs','release-no-data-observation.mjs','release-preparation-evidence.mjs','release-admission-timing.mjs','release-daily-backup.mjs','release-readonly-retry.mjs','worker-local-release.mjs','worker-local-release-rotation.mjs','d1-retirement-proof.mjs','collect-d1-retirement-proof.mjs'];
 const modulePins=names.map(n=>({path:path.join(candidate,'tools',n),sha256:hash(n)}));
 const tree={algorithm:'sha256-ordinal-path-length-content-v1',fileCount:2,sha256:hash('synthetic tree')};
 const manifest={artifacts:{keyFiles:names.map(n=>({relativePath:'tools/'+n,sha256:hash(n)}))},build:{nodeModulesTree:tree}};
 const batch={id:'private-fixture',version:'teruisi-release-batch-v4',binding:{artifactSha256:'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',workerPlanSha256:'0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881'},tests:{evidence:[{kind:'first-adoption-execution',mode:'fresh-no-reuse-v1',path:target,sha256:hash(bytes)}]},operations:[]};
 const files=[...modulePins,{path:path.join(candidate,'node_modules/typescript/lib/typescript.js'),sha256:hash('ts')},{path:path.join(candidate,'node_modules/typescript/package.json'),sha256:hash('ts pkg')},{path:'C:\\private-host\\node.exe',sha256:hash('node')},{path:testsPath,sha256:hash('tests raw')}];
 const collector={transport:'in-process-content-evidence-v1',executable:'C:\\private-host\\node.exe',args:[path.join(candidate,'tools/release-batch-admission.mjs'),'collect',specPath,testsPath],files};batch.binding.testsSha256=hash(batch.tests);batch.collectorSha256=hash(collector);batch.batchSha256=hash(batch);
 const spec={batch,collector,journalRoot:path.join(runtime,'state','release-batches')},raw=Buffer.from(JSON.stringify(spec));
 const current={batchSha256:batch.batchSha256,observedAtMs:['stale','write-fail'].includes(fault)?0:10000,admissionStages:[{stage:'complete-status',category:'dynamic-state',status:'passed',durationMs:42}],statusObservation:{attempts:[{stage:'admission-status',attempt:1,status:'passed',at:'2026-10-11T00:00:00.000Z',durationMs:42,error:null}]}};
 const checked=async(p,o={})=>{checks.push(p);if(fault==='input-after'&&returned&&path.resolve(p)===path.resolve(target))throw Object.assign(Error('private EACCES'),{code:'EACCES'});
  if(path.resolve(p)===path.resolve(target))return{sha256:hash(bytes),raw:bytes};
  if(p===specPath)return{sha256:hash(raw),raw};if(p===testsPath)return{sha256:hash('tests raw'),raw:Buffer.from(JSON.stringify(batch.tests))};
  if(p===path.join(candidate,'deployment-manifest.json'))return{sha256:batch.binding.artifactSha256,raw:Buffer.from(JSON.stringify(manifest))};
  const f=files.find(f=>f.path===p);assert.ok(f);return{sha256:fault==='drift'&&p.endsWith('release-impact.mjs')?hash('drift'):f.sha256,raw:p.replaceAll('\\','/').endsWith('typescript/package.json')?Buffer.from('{"main":"./lib/typescript.js"}'):null};};
 const libs={batch:{verifyBatch:()=>{},validateNoDataCollector:()=>{},runApprovedOperation:()=>{throw Error('Native operation prohibited');},writeOnce:async(p,v)=>{if(fault==='write-fail')throw Object.assign(Error('private write EACCES'),{code:'EACCES'});writes.push({p,v});},executeBatch:async args=>{
   const value=await args.collectCurrent();wal.push({status:'admission',admissionStages:value.admissionStages,observationAttempts:value.statusObservation.attempts});await args.beforeOperation();return 'synthetic';}},
  admission:{collectBatchAdmission:async()=>{returned=true;return current;}},worker:{processDeadline:()=>100000}};
 const importModule=async u=>{imports.push({u,treeVerified,checks:checks.length});return u.includes('release-batch-admission.mjs')?libs.admission:u.includes('release-batch.mjs')?libs.batch:libs.worker;};
 const body=source.slice(source.indexOf('const candidate='),source.indexOf('if(process.argv[1]')).replaceAll('await import(','await importModule(').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(target).href)).replace('export async function','async function');
 const execute=await vm.runInNewContext('(async()=>{'+body+';checkedFile=checked;completeTree=async()=>{treeVerifiedCallback();return JSON.parse(treeFixtureJson);};return executeFreshAdoption;})()',
  {assert,path,fileURLToPath,pathToFileURL,randomUUID:()=> 'fixture',createHash,Buffer,importModule,checked,treeFixtureJson:JSON.stringify(tree),treeVerifiedCallback:()=>{treeVerified=true;},Date:{now:()=>10000},process:{execPath:collector.executable,cwd:()=> 'E:\\private-model'}});
 return {execute,imports,writes,wal,current,specPath,approved:batch.batchSha256};
}
test('bootstrap validates modeled closed bundle before imports and module drift rejects before imports',async()=>{
 const good=await fixture('ok');await good.execute('qualify',good.specPath,good.approved);assert.equal(good.imports.length,3);assert.ok(good.imports.every(i=>i.treeVerified&&i.checks>0));
 const bad=await fixture('drift');await assert.rejects(bad.execute('qualify',bad.specPath,bad.approved));assert.equal(bad.imports.length,0);
});
test('ordinary stale result retains actual returned stages/attempts and writes fixed evidence before throwing',async()=>{
 const f=await fixture('stale');let error;try{await f.execute('qualify',f.specPath,f.approved);}catch(e){error=e;}assert.equal(error.code,'STALE_ADMISSION_SNAPSHOT');assert.deepEqual(error.admissionStages,f.current.admissionStages);assert.deepEqual(error.observationAttempts,f.current.statusObservation.attempts);assert.equal(f.writes.length,1);
});
test('freshness evidence write failure must preserve already returned collector metadata',async()=>{
 const f=await fixture('write-fail');let error;try{await f.execute('qualify',f.specPath,f.approved);}catch(e){error=e;}assert.equal(error.code,'STALE_ADMISSION_SNAPSHOT');assert.equal(error.evidenceSaveFailure.code,'EACCES');assert.deepEqual(error.admissionStages,f.current.admissionStages);assert.deepEqual(error.observationAttempts,f.current.statusObservation.attempts);
});
test('beforeOperation input rejection follows already persisted admission, not total loss of sampling WAL',async()=>{
 const f=await fixture('input-after');await assert.rejects(f.execute('execute',f.specPath,f.approved,'2026-10-11T00:00:00Z'),e=>e.code==='EACCES');assert.equal(f.wal.length,1);assert.deepEqual(f.wal[0].admissionStages,f.current.admissionStages);assert.deepEqual(f.wal[0].observationAttempts,f.current.statusObservation.attempts);
});
