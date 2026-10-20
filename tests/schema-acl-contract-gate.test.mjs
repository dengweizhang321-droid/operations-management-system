import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSchemaAclContract,schemaAclContractScripts} from '../tools/main-schema-release.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('ACL gate selects the finite scripts and fails before a binder can run',async()=>{
 const calls=[];
 const source='D:\\fixture\\source';
 const scripts=await runSchemaAclContract(source,{schema:{additionKind:'PiBusiness'}},{
  runtime:'D:\\fixture\\runtime',
  runAcl:async(executable,args,options)=>{calls.push({executable,args,options});}
 });
 assert.deepEqual(scripts,schemaAclContractScripts.PiBusiness);
 assert.equal(calls.length,1);
 assert.equal(calls[0].args[0],path.join(source,schemaAclContractScripts.PiBusiness[0]));
 assert.equal(calls[0].options.cwd,source);
 assert.equal(calls[0].options.env.PGPASSWORD,undefined);
 assert.equal(calls[0].options.env.TERUISI_DJANGO_DATABASE_URL,undefined);

 const nativeCalls=[];
 const native=await runSchemaAclContract(source,{schema:{additionKind:'PiNative'}},{
  runtime:'D:\\fixture\\runtime',
  runAcl:async(executable,args)=>{nativeCalls.push(args[0]);}
 });
 assert.deepEqual(native,schemaAclContractScripts.PiNative);
 assert.deepEqual(nativeCalls,[
  path.join(source,schemaAclContractScripts.PiNative[0]),
  path.join(source,schemaAclContractScripts.PiNative[1])
 ]);

 await assert.rejects(
  runSchemaAclContract(source,{schema:{additionKind:'PiNative'}},{
   runtime:'D:\\fixture\\runtime',
   runAcl:async()=>{throw Object.assign(new Error('bad'),{stderr:'append-only UPDATE drift'});}
  }),
  /ACL 契约校验失败[\s\S]*append-only UPDATE drift/
 );
 assert.equal(await runSchemaAclContract(source,{schema:{additionKind:'PiAgent'}},{runAcl:async()=>{throw Error('must not run')}}),null);
});

test('both finite Pi ACL scripts pass on the current source',()=>{
 for(const script of [schemaAclContractScripts.PiBusiness[0],schemaAclContractScripts.PiNative[1]]){
  const result=spawnSync('python',[script],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});
  assert.equal(result.status,0,script+': '+result.stderr);
  assert.match(result.stdout,/PI15[23]_ACL_CONTRACT_PASSED/);
 }
});
