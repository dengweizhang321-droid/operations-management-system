import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mainRefEvents,drainPrebuildQueue} from '../tools/main-prebuild-hook.mjs';
import {publisherEnvironment} from '../tools/publish-latest-main.mjs';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const a='a'.repeat(40),b='b'.repeat(40);
test('only committed remote main changes trigger; deletion and unrelated refs do not',()=>{
 const line=a+' '+b+' refs/remotes/origin/main\n';assert.deepEqual(mainRefEvents('committed',line),[b]);
 for(const phase of ['prepared','aborted'])assert.deepEqual(mainRefEvents(phase,line),[]);
 for(const line of [a+' '+b+' refs/heads/main',a+' '+b+' refs/remotes/origin/other',a+' '+'0'.repeat(40)+' refs/remotes/origin/main',a+' '+a+' refs/remotes/origin/main'])assert.deepEqual(mainRefEvents('committed',line),[]);
});
async function queue(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-queue-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));return root;}
const enqueue=(root,id)=>fs.writeFile(path.join(root,id+'.pending.json'),'{}',{flag:'wx'});
test('coalesces queued events, keeps new arrivals and excludes parallel runners',async t=>{
 const root=await queue(t);await enqueue(root,'a');await enqueue(root,'b');let calls=0;
 const result=await drainPrebuildQueue(root,async()=>{
  calls++;if(calls===1){await enqueue(root,'c');const other=await drainPrebuildQueue(root,()=>assert.fail('parallel preparation'));assert.equal(other.status,'queued');}
 });assert.equal(result.handled,3);assert.equal(calls,2);assert.equal((await fs.readdir(root)).filter(n=>n.includes('.pending.')).length,0);
});
test('an event arriving at unlock is not lost',async t=>{
 const root=await queue(t);await enqueue(root,'a');let calls=0,injected=false;
 await drainPrebuildQueue(root,async()=>{calls++;},{afterUnlock:async()=>{if(!injected){injected=true;await enqueue(root,'b');}}});assert.equal(calls,2);
});
test('failed preparation is recorded once, without an automatic retry',async t=>{
 const root=await queue(t);await enqueue(root,'a');let calls=0;
 await drainPrebuildQueue(root,async()=>{calls++;throw Error('original unknown retained');});
 assert.equal(calls,1);assert.equal(JSON.parse(await fs.readFile(path.join(root,'a.result.json'),'utf8')).status,'failed');
 await drainPrebuildQueue(root,()=>assert.fail('unexpected replay'));
});
test('a crash after terminal result but before pending cleanup never replays preparation',async t=>{
 const root=await queue(t);await enqueue(root,'a');
 await fs.writeFile(path.join(root,'a.result.json'),JSON.stringify({status:'failed',ticketSha256:createHash('sha256').update('{}').digest('hex')}));
 await enqueue(root,'b');let calls=0;await drainPrebuildQueue(root,async()=>{calls++;});assert.equal(calls,1);
 await assert.rejects(fs.access(path.join(root,'a.pending.json')));
});
test('hook and BAT pass exactly the same explicit environment; no Git locals or secrets',()=>{
 const base={SystemRoot:'C:/Windows',TEMP:'C:/Temp',USERPROFILE:'C:/User',PATH:'shell path'};
 const hook={...base,GIT_DIR:'different-repo',GIT_WORK_TREE:'wrong',SHLVL:'3',PATH:'git path',SECRET_TOKEN:'hidden'};
 assert.deepEqual(publisherEnvironment(base),publisherEnvironment(hook));assert.equal(publisherEnvironment(hook).SECRET_TOKEN,undefined);
});
test('actual Windows children use the frozen base despite different parent shells',()=>{
 const frozen=publisherEnvironment(process.env);
 const sample=`import {publisherEnvironment} from ${JSON.stringify(new URL('../tools/publish-latest-main.mjs',import.meta.url).href)};
 import {spawnSync} from 'node:child_process';
 const base=JSON.parse(process.argv[1]);const env=publisherEnvironment(process.env,undefined,base);
 const child=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env))'],{env,encoding:'utf8',windowsHide:true});
 if(child.status!==0)throw Error(child.stderr);process.stdout.write(child.stdout);`;
 const actual=[];
 for(const label of ['automatic','manual']){
  const result=execFileSync(process.execPath,['--input-type=module','-e',sample,JSON.stringify(frozen)],{env:{...process.env,LOGONSERVER:'fixture-'+label,TEMP:'C:\\fixture-'+label,TMP:'C:\\fixture-'+label,USERDOMAIN:'fixture-'+label,SECRET_TOKEN:'must-not-leak',NODE_OPTIONS:''},encoding:'utf8',windowsHide:true});
  const child=JSON.parse(result);assert.deepEqual(child,frozen);assert.equal(child.SECRET_TOKEN,undefined);assert.equal(child.NODE_OPTIONS,undefined);actual.push(child);
 }
 assert.deepEqual(actual[0],actual[1]);
});
test('an explicitly empty LOGONSERVER cannot be injected again by Windows',()=>{
 const frozen={...publisherEnvironment(process.env),LOGONSERVER:''};
 const child=execFileSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env.LOGONSERVER))'],{env:publisherEnvironment(process.env,undefined,frozen),encoding:'utf8',windowsHide:true});
 assert.equal(JSON.parse(child),'');
});
test('frozen base rejects extra executable inputs, ambiguous keys and missing Windows essentials',()=>{
 const base=publisherEnvironment(process.env);
 for(const invalid of [{...base,NODE_OPTIONS:'--require untrusted'},{...base,SECRET_TOKEN:'hidden'},{...base,Path:'other'},[],{LOGONSERVER:''}])assert.throws(()=>publisherEnvironment(process.env,undefined,invalid),/固定发布环境/);
 assert.throws(()=>publisherEnvironment(process.env,undefined,{...base,LOGONSERVER:undefined}),/固定发布环境/);
});
test('kernel queue lock is released when its owner terminates',async t=>{
 const root=await queue(t);await enqueue(root,'a');const signal=path.join(root,'owner-ready');
 const moduleUrl=new URL('../tools/main-prebuild-hook.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import fs from 'node:fs/promises';import {drainPrebuildQueue} from ${JSON.stringify(moduleUrl)};await drainPrebuildQueue(${JSON.stringify(root)},async()=>{await fs.writeFile(${JSON.stringify(signal)},'ready');await new Promise(()=>{});});`],{windowsHide:true,stdio:'ignore'});
 const done=new Promise(resolve=>child.once('exit',resolve));t.after(()=>child.kill());
 for(let n=0;n<100;n++){try{await fs.access(signal);break;}catch{await new Promise(r=>setTimeout(r,25));}}
 await fs.access(signal);assert.equal((await drainPrebuildQueue(root,()=>assert.fail('concurrent owner'))).status,'queued');
 child.kill();await done;let calls=0;await drainPrebuildQueue(root,async()=>{calls++;});assert.equal(calls,1);
});
test('fixed environment can execute the actual installed Git outside the default Program Files location',()=>{
 const gitExecutable=execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
 const env=publisherEnvironment(process.env,path.dirname(gitExecutable));
 assert.match(execFileSync('git',['--version'],{env,encoding:'utf8',windowsHide:true}),/^git version /);
});
test('installed real Git reference hook automatically starts only prepare-only mode',async t=>{
 const root=await queue(t),repo=path.join(root,'repo'),state=path.join(root,'state');await fs.mkdir(repo);await fs.mkdir(state);
 const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
 git(['init','--quiet']);await fs.writeFile(path.join(repo,'file'),'fixture');git(['add','.']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture']);
 const configFile=path.join(state,'main-publisher-config.json');await fs.writeFile(configFile,JSON.stringify({repository:repo,stateDirectory:state}));
 execFileSync(process.execPath,[fileURLToPath(new URL('../tools/install-main-prebuild.mjs',import.meta.url)),'--config',configFile],{windowsHide:true});
 const installedBase=JSON.parse(await fs.readFile(configFile,'utf8')).publisherBaseEnvironment;
 assert.deepEqual(publisherEnvironment(process.env,undefined,installedBase),installedBase);
 execFileSync(process.execPath,[fileURLToPath(new URL('../tools/install-main-prebuild.mjs',import.meta.url)),'--config',configFile],{windowsHide:true,env:{...process.env,LOGONSERVER:'fixture-new-install-shell'}});
 assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')).publisherBaseEnvironment,installedBase,'installer upgrades must preserve the original build environment');
 const marker=path.join(root,'called.json'),publisher=path.join(state,'control/tools/publish-latest-main.mjs');
 await fs.writeFile(publisher,`import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';export const publisherEnvironment=()=>process.env;if(path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await fs.writeFile(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));`);
 const remote=path.join(root,'remote.git');execFileSync('git',['init','--bare','--quiet',remote],{windowsHide:true});
 git(['remote','add','origin',remote]);git(['push','--quiet','origin','HEAD:refs/heads/main']);
 for(let n=0;n<200;n++){try{await fs.access(marker);break;}catch{await new Promise(r=>setTimeout(r,25));}}
 const args=JSON.parse(await fs.readFile(marker,'utf8'));assert.ok(args.includes('--prepare-only'));assert.ok(!args.includes('--deploy-only'));
 await fs.access(path.join(state,'查看打包状态.bat'));
 const observation=execFileSync(process.execPath,[path.join(state,'control/tools/main-prebuild-status.mjs'),'--config',configFile,'--once'],{encoding:'utf8',windowsHide:true});
 assert.equal(JSON.parse(observation.trim().split(/\r?\n/).at(-1)).status,'waiting');
 // Wait for the fixture runner's result so cleanup never races its writes.
 const queueDir=path.join(state,'prebuild-queue');for(let n=0;n<200;n++){if((await fs.readdir(queueDir)).some(n=>n.includes('.result.')))break;await new Promise(r=>setTimeout(r,25));}
});
