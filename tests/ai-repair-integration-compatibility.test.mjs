import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {aiRepairIntegrationQualification as qualification,aiRepairIntegrationScopeMatches,
 windowsPowerShellEnvironment} from '../tools/verify-release-candidate.mjs';
import {makeReleasePlan} from '../tools/release-scope-plan.mjs';
import {inspectMainPublication,resumeProtocol} from '../tools/publish-main-resume.mjs';
import {piImageInputsChanged,verifyPreparedPiImageSelection} from '../tools/publish-prepared-main.mjs';
import {pandasArguments,pandasRuntimeChanged} from '../tools/publish-main-pandas.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=(...args)=>execFileSync('git',args,{cwd:source,windowsHide:true,maxBuffer:16*1024*1024});

test('combination qualification accepts only the verifier, new pinned test and topic documents',()=>{
 const raw=(status,file,mode='100644')=>[
  ':'+(status==='A'?'000000':'100644')+' '+mode+' '+'a'.repeat(40)+' '+'b'.repeat(40)+' '+status,file,
 ];
 const verifier=raw('M','tools/verify-release-candidate.mjs');
 const check=raw('A',qualification.test);
 const report=raw('A','docs/ai-repair-integration-20261108/REVIEW-G02.md');
 const index=raw('M','docs/任务记录/README.md');
 const accepts=(records,base=qualification.base)=>aiRepairIntegrationScopeMatches(records,base);
 assert.equal(accepts([...verifier,...check]),true);
 assert.equal(accepts([...verifier,...check,...report,...index]),true);
 assert.equal(accepts([...verifier,...check],'0'.repeat(40)),false);
 for(const records of [
  verifier,check,[...verifier,...check,...check],[...verifier,...check,'truncated'],
  [...verifier,...raw('A',qualification.test,'120000')],
  [...verifier,...raw('A',qualification.test,'100755')],
  [...verifier,...check,...raw('D','docs/ai-repair-integration-20261108/REPORT.md','000000')],
  [...verifier,...check,...raw('M','tools/django-ai.ps1')],
  [...verifier,...check,...raw('A','docs/ai-repair-batch2-20261108/OUTSIDE.md')],
 ])assert.equal(accepts(records),false);
});

async function publisherClosure(read){
 const seen=new Set(),queue=['tools/publish-prepared-main.mjs','tools/publish-main-resume.mjs'];
 while(queue.length){
  const file=queue.shift();
  if(seen.has(file))continue;
  seen.add(file);
  const content=(await read(file)).toString('utf8');
  for(const match of content.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
   const target=path.posix.join(path.posix.dirname(file),match[2]);
   assert.match(target,/^tools\/[^/]+\.mjs$/,'Unexpected publisher import: '+target);
   queue.push(target);
  }
 }
 return [...seen].sort();
}

test('actual combined plan keeps both independent runtime preparations and the frozen publisher closure',async()=>{
 const releasePlan=makeReleasePlan({base:qualification.base,head:'HEAD',cwd:source});
 const request={releasePlan};
 assert.deepEqual(releasePlan.components,['worker','django']);
 assert.equal(releasePlan.migrate,false);
 assert.equal(piImageInputsChanged(request),true);
 assert.equal(pandasRuntimeChanged(request),true);
 await assert.rejects(verifyPreparedPiImageSelection(request,{},source,{}),/镜像/);
 const before=await publisherClosure(file=>git('show',qualification.base+':'+file));
 const after=await publisherClosure(file=>fs.readFile(path.join(source,file)));
 assert.deepEqual(after,[...before,'tools/publish-main-pandas.mjs'].sort());
});

test('Pi resume refuses a combined Pandas change before reading live state',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'g02-integration-resume-'));
 t.after(()=>fs.rm(root,{recursive:true}));
 const commit=qualification.application;
 const out=path.join(root,'publish-'+commit.slice(0,12));
 await fs.mkdir(path.join(out,'preparation'),{recursive:true});
 const write=(file,value)=>fs.writeFile(file,JSON.stringify(value),{flag:'wx'});
 const started={resumeProtocol,mainCommit:commit,maintenanceId:'a'.repeat(32),source:path.join(root,'source')};
 const releasePlan=makeReleasePlan({base:qualification.base,head:'HEAD',cwd:source});
 await Promise.all([
  write(path.join(out,'STARTED.json'),started),
  write(path.join(out,'preparation/PREPARED.json'),{}),
  write(path.join(root,'main-release-request.json'),{releasePlan}),
 ]);
 const context=new Proxy({}, {get(){assert.fail('Resume touched live context before refusing Pandas');}});
 await assert.rejects(inspectMainPublication(out,context),/Pandas轮换保留原intent/);
 assert.deepEqual((await fs.readdir(out)).sort(),['STARTED.json','preparation']);
});

test('actual PS5.1 and PS7 Pandas dispatch preserves binding and rejects invalid owner before effects',async t=>{
 const hosts=[process.env.TERUISI_AI_INTEGRATION_PS5,process.env.TERUISI_AI_INTEGRATION_PS7];
 assert.ok(hosts.every(Boolean),'Run from the fixed combination G02 entry.');
 const runtime=await fs.mkdtemp(path.join(os.tmpdir(),'g02-integration-entry-'));
 t.after(()=>fs.rm(runtime,{recursive:true}));
 const controller=path.join(source,'tools/django-ai.ps1');
 const prepared={preparedAppId:'b'.repeat(32),preparedAppSha256:'d'.repeat(64),sourceCommit:qualification.application,
  registeredPlanSha256:'c'.repeat(64)};
 const owner={maintenanceId:'e'.repeat(32),ownerPid:4321};
 const cases=[
  ['PreparePandasRotation','Invoke-PandasRotationPreparation $false',undefined,false],
  ['PandasRotationCheck','Invoke-PandasRotationPreparation $true',undefined,true],
  ['SwitchPandasRotation','Invoke-PandasRotationSwitch',owner,true],
  ['CompletePandasRotation','Complete-PandasRotation',owner,true],
 ];
 for(const [index,host] of hosts.entries()){
  const environment=index===0?windowsPowerShellEnvironment(process.env):process.env;
  const invoke=(action,args)=>spawnSync(host,['-NoProfile','-NonInteractive','-File',
   path.join(source,'tests/ai-repair-batch2-powershell-entry.ps1'),'-Controller',controller,
   '-PrivateRoot',runtime,'-RequestedAction',action],{cwd:source,windowsHide:true,encoding:'utf8',timeout:30000,
   env:{...environment,TERUISI_AI_BATCH2_PANDAS_ARGS:JSON.stringify(args)}});
  for(const [action,dispatch,operation,configured] of cases){
   const child=invoke(action,pandasArguments({...prepared,configured},operation));
   assert.equal(child.status,17,child.error?.message??child.stderr);
   assert.deepEqual(JSON.parse(child.stdout),{action,runtime,binding:{
    preparedAppId:prepared.preparedAppId,preparedAppSha256:prepared.preparedAppSha256,sourceCommit:prepared.sourceCommit,
    registeredPlanSha256:configured?prepared.registeredPlanSha256:'',maintenanceId:operation?.maintenanceId??'',
    publicationOwnerPid:operation?.ownerPid??0,
   },json:true,dispatch:'Invoke-WithServiceMutex { '+dispatch+' }'});
  }
  const bad=invoke('SwitchPandasRotation',pandasArguments({...prepared,configured:true},{...owner,ownerPid:'invalid'}));
  assert.equal(bad.status,1,bad.error?.message??bad.stderr);
  assert.equal(bad.stdout.trim(),'');
  const diagnostic=bad.stderr.replace(/\r?\n/g,'');
  assert.match(diagnostic,/PandasPublicationOwnerPid/);
  assert.match(diagnostic,/System\.Int32/);
  assert.deepEqual(await fs.readdir(runtime),[]);
 }
});
