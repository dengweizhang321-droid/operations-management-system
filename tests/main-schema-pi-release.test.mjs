import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {piAgentSchema,piAgentMigration,schemaForRequest,readSchemaRecipe,prepareMainSchemaRelease,verifyMainSchemaRelease} from '../tools/main-schema-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Pi requires its exact149-to150 finite structure contract',()=>{
 const request={migrate:true,releasePlan:{migrate:true},components:['worker','django'],schemaRelease:{...piAgentSchema,recipeSha256:'a'.repeat(64),evidencePath:path.resolve('fixture'),evidenceSha256:'b'.repeat(64),validationSha256:'c'.repeat(64),codeSha256:'d'.repeat(64)}};
 assert.equal(schemaForRequest(request).additionKind,'PiAgent');
 for(const schema of [{...request.schemaRelease,fromGeneration:148},{...request.schemaRelease,toGeneration:151},{...request.schemaRelease,steps:['ai_assistant.0084_other']},{...request.schemaRelease,allowUnknown:true}])assert.throws(()=>schemaForRequest({...request,schemaRelease:schema}));
});

test('Pi preparation and recheck bind migration, isolated proof and original evidence without database credentials',async t=>{
 const packet=await fs.mkdtemp(path.join(os.tmpdir(),'pi-schema-')),source=path.join(packet,'source');
 t.after(()=>fs.rm(packet,{recursive:true,force:true}));
 const recipeFile='config/main-schema-releases/ai-0084.json';
 const recipe=JSON.parse(await fs.readFile(path.join(root,recipeFile),'utf8'));
 for(const name of [piAgentMigration,recipeFile,recipe.validation]){const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,name),target);}
 const plan={headSha:'e'.repeat(40),baseSha:'f'.repeat(40),migrate:true,changes:[{status:'A',path:piAgentMigration}]};
 assert.equal((await readSchemaRecipe(source,plan)).recipe.toGeneration,150);
 let calls=0;
 const run=async(exe,args,options)=>{
  calls++;assert.equal(options.env.TERUISI_DJANGO_DATABASE_URL,undefined);assert.equal(options.env.PGPASSWORD,undefined);
  assert.ok(args[0].endsWith('pi_agent_candidate.py'));
  const output=args.includes('--output')?args[args.indexOf('--output')+1]:args[args.indexOf('--check')+1];
  if(args.includes('--output'))await fs.writeFile(output,'{"status":"reviewed"}\n');
  return {stdout:JSON.stringify({status:'bound',generation:150,evidenceSha256:sha(await fs.readFile(output))})};
 };
 const schema=await prepareMainSchemaRelease({source,packet,plan},{run});
 await verifyMainSchemaRelease({migrate:true,releasePlan:plan,components:['django'],schemaRelease:schema},source,{run});
 assert.equal(calls,2);
 await assert.rejects(readSchemaRecipe(source,{...plan,changes:[...plan.changes,{status:'A',path:'backend/ai_assistant/migrations/0085_unreviewed.py'}]}));
 await assert.rejects(readSchemaRecipe(source,{...plan,changes:[{status:'M',path:piAgentMigration}]}));
 await fs.appendFile(path.join(source,recipe.validation),' ');
 await assert.rejects(readSchemaRecipe(source,plan),/验证记录已变化/);
});
