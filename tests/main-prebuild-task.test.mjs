import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {publisherEnvironment} from '../tools/publish-latest-main.mjs';
import {makePreparationTask,installPreparationTask,wakePreparationTask,readPreparationTask,taskPowerShell,currentPreparationIdentity,assertOrdinaryIdentity,assertPreparationTask} from '../tools/main-prebuild-task.mjs';
test('ordinary token gate rejects elevated, foreign SID, noninteractive and wrong integrity',()=>{
 const value={sid:'private',sessionId:2,elevated:false,integrityRid:8192};assert.equal(assertOrdinaryIdentity(value,'private'),value);
 for(const change of [{sid:'other'},{sessionId:0},{elevated:true},{integrityRid:12288},{integrityRid:4096}])assert.throws(()=>assertOrdinaryIdentity({...value,...change},'private'));
});
test('real on-demand fixed task launches same SID/session at medium integrity from elevated parent',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-prebuild-')),configFile=path.join(directory,'main-publisher-config.json'),result=path.join(directory,'identity.json'),secondary=path.join(directory,'ordinary-wake.json'),specFile=path.join(directory,'task-spec.json');
 await fs.mkdir(path.join(directory,'control/tools'),{recursive:true});await fs.mkdir(path.join(directory,'prebuild-queue-v2'));await fs.writeFile(configFile,'{}');
 const module=pathToFileURL(path.resolve('tools/main-prebuild-task.mjs')).href;
 await fs.writeFile(path.join(directory,'control/tools/publish-latest-main.mjs'),`import {currentPreparationIdentity,assertOrdinaryIdentity,wakePreparationTask} from ${JSON.stringify(module)};import fs from 'node:fs/promises';const identity=await currentPreparationIdentity();assertOrdinaryIdentity(identity,${JSON.stringify((await currentPreparationIdentity()).sid)});let first=false;try{await fs.access(${JSON.stringify(result)});}catch{first=true;}await fs.writeFile(first?${JSON.stringify(result)}:${JSON.stringify(secondary)},JSON.stringify({identity,args:process.argv.slice(2),environment:process.env}),{flag:'wx'});if(first)await wakePreparationTask({state:{preparationTask:JSON.parse(await fs.readFile(${JSON.stringify(specFile)},'utf8'))}});`);
 const parent=await currentPreparationIdentity(),spec=await makePreparationTask(configFile,{stateDirectory:directory,publisherBaseEnvironment:publisherEnvironment(process.env)});
 const originalAction=Buffer.from(spec.definition.arguments.split(' ').at(-1),'base64').toString('utf16le');spec.definition.arguments=spec.definition.arguments.slice(0,spec.definition.arguments.lastIndexOf(' ')+1)+Buffer.from("$env:NODE_OPTIONS='--require Z:/private-missing-injection.cjs';$env:GIT_DIR='Z:/foreign-repository';$env:GIT_CONFIG_COUNT='1';$env:PSModulePath='Z:/foreign-modules';"+originalAction,'utf16le').toString('base64');
 t.after(async()=>{if(await readPreparationTask(spec)){await assertPreparationTask(spec);await taskPowerShell("$s=New-Object -ComObject Schedule.Service;$s.Connect();$s.GetFolder('\\').DeleteTask($v.name,0);'true'",spec);}await fs.rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
 await installPreparationTask(spec,null);await assertPreparationTask(spec);
 assert.equal(spec.definition.runLevel,0);assert.equal(spec.definition.logonType,3);assert.equal(spec.definition.multipleInstances,0);assert.equal(spec.definition.triggers,0);assert.equal(spec.definition.arguments.includes('$(Arg'),false);
 await assert.rejects(installPreparationTask(spec,null),/unowned/);await installPreparationTask(spec,null,{resume:true});
 await fs.writeFile(specFile,JSON.stringify(spec));await wakePreparationTask({state:{preparationTask:spec}});
 const deadline=Date.now()+30000;while(Date.now()<deadline){try{await fs.access(result);break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const child=JSON.parse(await fs.readFile(result,'utf8'));assertOrdinaryIdentity(child.identity,parent.sid);assert.equal(child.identity.sessionId,parent.sessionId);assert.deepEqual(child.args,['--config',configFile,'--consume-preparation']);
 assert.deepEqual(child.environment,publisherEnvironment(process.env));assert.equal(child.environment.NODE_OPTIONS,undefined);assert.equal(child.environment.GIT_DIR,undefined);
 const secondDeadline=Date.now()+30000;while(Date.now()<secondDeadline){try{await fs.access(secondary);break;}catch{}await new Promise(r=>setTimeout(r,100));}const ordinaryWake=JSON.parse(await fs.readFile(secondary,'utf8'));assertOrdinaryIdentity(ordinaryWake.identity,parent.sid);assert.equal(ordinaryWake.identity.sessionId,parent.sessionId);assert.deepEqual(ordinaryWake.environment,publisherEnvironment(process.env));
 const tampered={...spec,definition:{...spec.definition,enabled:false}};await assert.rejects(assertPreparationTask(tampered),/changed/);
 console.log(JSON.stringify({probe:'actual-windows-task',parent,child:child.identity,fixedAction:true,noBusinessPreparation:true,ordinaryCallerRunExPassed:true,environmentEqualityPassed:true,injectedVariablesExcluded:['NODE_OPTIONS','GIT_DIR','GIT_CONFIG_COUNT','PSModulePath']}));
});
