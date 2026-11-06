import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {monitoringSchema,monitoringMigration,monitoringRecipe,schemaForRequest,readSchemaRecipe,prepareMainSchemaRelease,verifyMainSchemaRelease,schemaPreparationEnvironment,aiTaskFeedbackCandidatesSchema,aiTaskFeedbackCandidatesMigrations,aiUnifiedTasksSchema,assertMainSchemaPlanSupported} from '../tools/main-schema-release.mjs';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
 const packet=await fs.mkdtemp(path.join(os.tmpdir(),'main-schema-')),source=path.join(packet,'source');
 t.after(()=>fs.rm(packet,{recursive:true,force:true}));
 const recipe=JSON.parse(await fs.readFile(path.join(sourceRoot,monitoringRecipe),'utf8'));
 for(const name of [monitoringMigration,monitoringRecipe,recipe.validation]){const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(sourceRoot,name),target);}
 const plan={headSha:'e'.repeat(40),baseSha:'f'.repeat(40),migrate:true,changes:[{status:'A',path:monitoringMigration}]};let calls=[];
 const run=async(exe,args,options)=>{
  calls.push({exe,args,options});assert.equal(options.env.TERUISI_DJANGO_DATABASE_URL,undefined);
  const output=args[args.indexOf('--output')+1];
  if(args.includes('--output'))await fs.writeFile(output,'{"status":"reviewed"}\n');
  const file=args.includes('--check')?args[args.indexOf('--check')+1]:output;
  return {stdout:JSON.stringify({status:'bound',generation:148,evidenceSha256:sha(await fs.readFile(file))})};
 };
 return {source,packet,recipe,plan,run,calls};
}
test('only the finite148 descriptor permits a migration request',()=>{
 const request={migrate:true,releasePlan:{migrate:true},components:['django'],schemaRelease:{...monitoringSchema,recipeSha256:'a'.repeat(64),evidencePath:path.resolve('fixture'),evidenceSha256:'b'.repeat(64),validationSha256:'c'.repeat(64),codeSha256:'d'.repeat(64)}};
 assert.equal(schemaForRequest(request).toGeneration,148);
 for(const mutation of [{schemaRelease:undefined},{schemaEvidencePath:'OLD147'},{schemaRelease:{...request.schemaRelease,toGeneration:147}},{components:['worker']},{migrate:false},{schemaRelease:{...request.schemaRelease,extra:true}}])assert.throws(()=>schemaForRequest({...request,...mutation}));
 assert.equal(schemaForRequest({migrate:false,components:['worker']}),null);
});
test('recipe refuses rewritten/extra migrations, changed proof and changed0016 bytes',async t=>{
 const f=await fixture(t);assert.equal((await readSchemaRecipe(f.source,f.plan)).recipe.toGeneration,148);
 for(const changes of [[{status:'M',path:monitoringMigration}],[...f.plan.changes,{status:'A',path:'backend/inventory/migrations/0017_unknown.py'}]])await assert.rejects(readSchemaRecipe(f.source,{...f.plan,changes}));
 await fs.appendFile(path.join(f.source,f.recipe.validation),' ');await assert.rejects(readSchemaRecipe(f.source,f.plan),/验证记录已变化/);
 await fs.copyFile(path.join(sourceRoot,f.recipe.validation),path.join(f.source,f.recipe.validation));
 await fs.appendFile(path.join(f.source,monitoringMigration),'# changed');await assert.rejects(readSchemaRecipe(f.source,f.plan),/迁移字节/);
});
test('freeze binds exact evidence and publisher rechecks the same bytes through the read-only binder',async t=>{
 const f=await fixture(t),schema=await prepareMainSchemaRelease(f,{run:f.run});
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].args.includes('--output'));assert.equal(schema.toGeneration,148);
 const request={migrate:true,releasePlan:f.plan,components:['django'],schemaRelease:schema};
 await verifyMainSchemaRelease(request,f.source,{run:f.run});assert.equal(f.calls.length,2);assert.ok(f.calls[1].args.includes('--check'));
 await fs.appendFile(schema.evidencePath,' ');await assert.rejects(verifyMainSchemaRelease(request,f.source,{run:f.run}),/证据已变化/);assert.equal(f.calls.length,2);
});
test('binder children never inherit production connection, library or channel variables',()=>{
 const env=schemaPreparationEnvironment({PATH:'fixture',SystemRoot:'C:/Windows',TERUISI_DJANGO_DATABASE_URL:'sensitive',DJANGO_SETTINGS_MODULE:'wrong',PGPASSWORD:'sensitive',DINGTALK_WEBHOOK:'wrong',PYTHONPATH:'wrong'});
 assert.deepEqual(Object.keys(env).sort(),['PATH','PYTHONDONTWRITEBYTECODE','PYTHONUTF8','SystemRoot'].sort());
});
test('an independently frozen request reuses its approved evidence SHA through check, never another output',async t=>{
 const f=await fixture(t),schema=await prepareMainSchemaRelease(f,{run:f.run});
 const request={mainCommit:f.plan.headSha,deployedCommit:f.plan.baseSha,migrate:true,releasePlan:f.plan,components:['django'],schemaRelease:schema};
 await fs.writeFile(path.join(f.packet,'main-release-request.json'),JSON.stringify(request));
 const again=await prepareMainSchemaRelease(f,{run:f.run});assert.deepEqual(again,schema);
 assert.equal(f.calls.length,2);assert.ok(f.calls[1].args.includes('--check'));assert.ok(!f.calls[1].args.includes('--output'));
 await fs.appendFile(schema.evidencePath,' ');await assert.rejects(prepareMainSchemaRelease(f,{run:f.run}),/证据已变化/);assert.equal(f.calls.length,2);
});

test('Ai158 requires both exact additions; change ordering is irrelevant and157 is never a completion',()=>{
 const changes=aiTaskFeedbackCandidatesMigrations.map(path=>({status:'A',path}));
 const plan={migrate:true,changes};
 assert.deepEqual(assertMainSchemaPlanSupported(plan),aiTaskFeedbackCandidatesSchema);
 assert.deepEqual(assertMainSchemaPlanSupported({...plan,changes:[...changes].reverse()}),aiTaskFeedbackCandidatesSchema);
 for(const bad of [changes.slice(0,1),changes.slice(1),[...changes,{status:'A',path:'backend/ai_assistant/migrations/0090_unknown.py'}],changes.map((row,i)=>i?row:{...row,status:'M'})])
  assert.throws(()=>assertMainSchemaPlanSupported({...plan,changes:bad}));
 const schema={...aiTaskFeedbackCandidatesSchema,recipeSha256:'a'.repeat(64),evidencePath:path.resolve('fixture158'),evidenceSha256:'b'.repeat(64),validationSha256:'c'.repeat(64),codeSha256:'d'.repeat(64)};
 assert.equal(schemaForRequest({migrate:true,releasePlan:plan,components:['worker','django'],schemaRelease:schema}).toGeneration,158);
 for(const descriptor of [{...schema,toGeneration:157},{...schema,fromGeneration:154},{...schema,steps:[...schema.steps].reverse()}])
  assert.throws(()=>schemaForRequest({migrate:true,releasePlan:plan,components:['django'],schemaRelease:descriptor}));
});

test('Ai158 ACL contract runs before the fixed binder; failures produce no schema evidence',async t=>{
 const packet=await fs.mkdtemp(path.join(os.tmpdir(),'main-schema158-')),source=path.join(packet,'source');
 t.after(()=>fs.rm(packet,{recursive:true,force:true}));
 const recipeName='config/main-schema-releases/ai-0088-0089.json';
 const recipe=JSON.parse(await fs.readFile(path.join(sourceRoot,recipeName),'utf8'));
 for(const name of [...aiTaskFeedbackCandidatesMigrations,recipeName,recipe.validation]){
  const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(sourceRoot,name),target);
 }
 const plan={headSha:'e'.repeat(40),baseSha:'f'.repeat(40),migrate:true,changes:aiTaskFeedbackCandidatesMigrations.map(path=>({status:'A',path}))};
 let bindCalls=0,aclCalls=0;
 const run=async(exe,args)=>{bindCalls++;assert.ok(args[0].endsWith('ai_task_feedback_candidates_candidate.py'));const file=args[args.indexOf('--output')+1];await fs.writeFile(file,'{"fixture":true}');return {stdout:JSON.stringify({status:'bound',generation:158,evidenceSha256:sha(await fs.readFile(file))})};};
 await assert.rejects(prepareMainSchemaRelease({source,packet,plan},{run,runAcl:async()=>{throw Error('private ACL refusal');}}),/ACL/);
 assert.equal(bindCalls,0);await assert.rejects(fs.access(path.join(packet,'schema/ai-0088-0089-evidence.json')));
 const descriptor=await prepareMainSchemaRelease({source,packet,plan},{run,runAcl:async(exe,args)=>{aclCalls++;assert.ok(args[0].endsWith('ai158-acl-catalog-boundary.py'));}});
 assert.equal(descriptor.toGeneration,158);assert.equal(bindCalls,1);assert.equal(aclCalls,1);
});

test('Ai159 supports only the exact0090 addition and rejects rewritten or combined migrations',()=>{
 const change={status:'A',path:'backend/ai_assistant/migrations/0090_unified_tasks.py'};
 assert.deepEqual(assertMainSchemaPlanSupported({migrate:true,changes:[change]}),aiUnifiedTasksSchema);
 for(const changes of [[{...change,status:'M'}],[change,{status:'A',path:'backend/ai_assistant/migrations/0091_unknown.py'}]])
  assert.throws(()=>assertMainSchemaPlanSupported({migrate:true,changes}));
});
