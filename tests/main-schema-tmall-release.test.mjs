import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tmallSchema,tmall148Schema,tmallMigration,monitoringMigration,readSchemaRecipe,prepareMainSchemaRelease,verifyMainSchemaRelease,schemaForRequest} from '../tools/main-schema-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
for(const schema of [tmallSchema,tmall148Schema])test('finite '+schema.fromGeneration+' to149 binds its own exact recipe, proof and read-only binder',async t=>{
 const packet=await fs.mkdtemp(path.join(os.tmpdir(),'tmall-schema-')),source=path.join(packet,'source');t.after(()=>fs.rm(packet,{recursive:true,force:true}));
 const recipeFile='config/main-schema-releases/'+(schema.fromGeneration===147?'inventory-0017.json':'inventory-0017-from148.json');
 const recipe=JSON.parse(await fs.readFile(path.join(root,recipeFile),'utf8'));
 const migrations=schema.fromGeneration===147?[monitoringMigration,tmallMigration]:[tmallMigration];
 for(const name of [recipeFile,recipe.validation,...migrations]){const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,name),target);}
 const plan={headSha:'a'.repeat(40),baseSha:'b'.repeat(40),migrate:true,changes:migrations.map(path=>({status:'A',path}))};
 const calls=[];const run=async(exe,args,options)=>{
  calls.push(args);assert.equal(options.env.TERUISI_DJANGO_DATABASE_URL,undefined);assert.ok(args[0].endsWith('tmall_warehouse_candidate.py'));assert.ok(args.includes(path.join(source,recipeFile)));
  const file=args[args.indexOf(args.includes('--check')?'--check':'--output')+1];if(args.includes('--output'))await fs.writeFile(file,'{}');
  return {stdout:JSON.stringify({status:'bound',generation:149,evidenceSha256:sha(await fs.readFile(file))})};
 };
 assert.deepEqual((await readSchemaRecipe(source,plan)).recipe.steps,schema.steps);
 const release=await prepareMainSchemaRelease({source,packet,plan},{run});
 const request={migrate:true,releasePlan:plan,components:['django'],schemaRelease:release};
 assert.equal(schemaForRequest(request).fromGeneration,schema.fromGeneration);await verifyMainSchemaRelease(request,source,{run});
 assert.equal(calls.length,2);assert.ok(calls[1].includes('--check'));
 await assert.rejects(verifyMainSchemaRelease({...request,schemaRelease:{...release,fromGeneration:150}},source,{run}));
 await assert.rejects(readSchemaRecipe(source,{...plan,changes:[...plan.changes,{status:'M',path:'backend/sales/migrations/0001_initial.py'}]}));
 await fs.appendFile(path.join(source,tmallMigration),'# drift');await assert.rejects(verifyMainSchemaRelease(request,source,{run}),/迁移字节/);assert.equal(calls.length,2);
});
