import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const digest=raw=>createHash('sha256').update(raw).digest('hex');
const code=await fs.readFile(new URL('../tools/pi150-forward-recovery.mjs',import.meta.url),'utf8');
async function fixture(t,{fail='',badProof=false,started=false,badChain=false,badOriginal=false,badDjango=false,badSource=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi150-forward-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const output=path.join(root,'output'),source=path.join(root,'source'),django=path.join(root,'django'),worker=path.join(root,'worker'),state=path.join(root,'state'),original=path.join(root,'original'),backup=path.join(root,'backup');
 const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
 const oldHash=digest('old'),newHash=digest('new');
 const replacements={'D:/codex-artifacts/pi-publish-recovery-20261017-v3':output,'D:/codex-isolated/main-release-packages/f3748d8e03e2-60dc61d1-622cb632':original,'D:/teruisi-runtime/django-sales':django,'D:/teruisi-runtime/teruisi-worker-sales':worker,'D:/codex-isolated/main-manual-release-20261016':state,'E:/运营管理系统业务数据/daily-20261015T041546Z-e45dddeb5a15':backup,'67696b506801744faf048141b5b4e342e1afa062e48d97669f6e44cf3634fbc2':oldHash,'d027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d':digest('backup')};
 let privateCode=code.replace("from 'node:child_process'","from './fixture-child.mjs'");for(const [a,b] of Object.entries(replacements))privateCode=privateCode.replaceAll(a,b.replaceAll('\\','/'));
 await write(path.join(source,'tools/pi150-forward-recovery.mjs'),privateCode);
 await write(path.join(source,'tools/fixture-child.mjs'),`export const spawn=()=>{throw Error('unexpected spawn')};export const execFileSync=(_e,a)=>a.includes('status')?'':a.some(x=>x.includes('tree'))?'test-tree':'test-commit';`);
 await write(path.join(source,'tools/publish-latest-main.mjs'),`export const publisherEnvironment=()=>({PATH:'fixed'});`);
 await write(path.join(source,'tools/release-scope-plan.mjs'),`export const makeReleasePlan=()=>({components:['worker','django'],migrate:false,databaseProtection:'verified-current'});`);
 await write(path.join(source,'tools/publish-main-command.mjs'),`export const manualStepCommand=({script,action,extra})=>({host:'private',args:[script,action,...extra]});`);
 await write(path.join(source,'tools/release-batch.mjs'),`export const productionCommandArguments=(_e,a)=>a;export const productionCommandEnvironment=()=>({});`);
 await write(path.join(state,'main-publisher-config.json'),{pwshDirectory:'private',gitDirectory:'private',publisherBaseEnvironment:{},npmCacheDirectory:'private'});
 await write(path.join(state,'PUBLISHED-MAIN.json'),{old:true});await write(path.join(django,'app/deployment.json'),badDjango?'changed':'old');await write(path.join(backup,'backup-manifest.json'),'backup');
 const attempt=path.join(original,'publish-f3748d8e03e2'),commit='f3748d8e03e27073af8c7e599036861ae16e46dd',maintenanceId='ca1bc9efd18d4263aeb298353ca93714';
 await write(path.join(attempt,'FAILED.json'),{mainCommit:commit,phase:badOriginal?'other':'启动服务',processEvidence:{engineFailure:{processId:38776,exitCode:1}}});
 await write(path.join(attempt,'STARTED.json'),{maintenanceId,operationId:'ff28fd7d584547dea301b9f3561ae2aa'});
 await write(path.join(attempt,'WorkerApply-result.json'),{status:'activated',releaseId:'20261017T100706Z-1090ea88f6fe3094'});
 await write(path.join(attempt,'完成结构迁移-result.json'),{value:{result:{status:'verified',migrationCount:150}}});await write(path.join(attempt,'退出维护-result.json'),{value:{status:'maintenance_ended'}});
 const predecessor={releaseId:'20261017T100706Z-1090ea88f6fe3094',manifestSha256:'5bc9c99602822aa3342e1548e33a7b2ba2b42bb1a446af381bfdcf6a4203041d'};
 const plan={planSha256:'new-plan',candidateReleaseId:'new-release',candidateManifestSha256:'new-manifest'};
 const facts={originalAttempt:attempt,originalStartedSha256:digest(await fs.readFile(path.join(attempt,'STARTED.json'))),originalFailureSha256:digest(await fs.readFile(path.join(attempt,'FAILED.json'))),schemaOperationId:'ff28fd7d584547dea301b9f3561ae2aa',maintenanceId};
 const ready={version:'pi150-forward-recovery-v1',source,sourceIdentity:{commit:'test-commit',tree:'test-tree'},facts,releasePlan:{components:['worker','django']},backup:{directory:backup,manifestSha256:digest('backup'),result:{status:'completed'}},predecessor,predecessorChainStateSha256:'chain',pkg:{id:'pkg',receiptSha256:'receipt'},plan,djangoManifestSha256:newHash};
 if(badSource)ready.sourceIdentity.commit='other-commit';await write(path.join(output,'READY.json'),ready);await write(path.join(output,'source-binding.json'),'bound');
 const proof=JSON.stringify({operationId:maintenanceId,preparedAppId:'pkg'});await write(path.join(output,'absent-helper-proof.json'),proof);if(started)await write(path.join(output,'RECOVERY-STARTED.json'),{});
 await write(path.join(source,'tools/worker-local-release-rotation.mjs'),`import fs from 'node:fs/promises';const root=${JSON.stringify(root)},p=${JSON.stringify(predecessor)},plan=${JSON.stringify(plan)};let applied=false;export const withRotationLock=f=>f({});export const assertActiveBatchOwnership=async()=>{};export const resolveEffectiveReleaseChain=async()=>({head:applied?{releaseId:plan.candidateReleaseId,manifestSha256:plan.candidateManifestSha256}:p,chainStateSha256:${JSON.stringify(badChain?'changed':'chain')}});export const planWorkerReleaseRotation=async()=>{if(${JSON.stringify(fail)}==='Reuse')throw Error('unknown reuse');return plan};export const applyApprovedRotationPlan=async args=>{await fs.appendFile(root+'/actions','Apply:'+args.approvedPlanSha256+'\\n');if(${JSON.stringify(fail)}==='Apply')throw Error('unknown apply');applied=true;return {status:'activated',releaseId:plan.candidateReleaseId}};`);
 await write(path.join(source,'tools/worker-local-release.mjs'),`import fs from 'node:fs/promises';const root=${JSON.stringify(root)},django=${JSON.stringify(django)},fail=${JSON.stringify(fail)};export const runProcess=async(_e,a)=>{const action=a[1];await fs.appendFile(root+'/actions',action+'\\n');if(action===fail)throw Error('unknown '+action);if(action==='DeployApp')await fs.writeFile(django+'/app/deployment.json','new');const value=action==='VerifyPreparedApp'?{status:'prepared_verified'}:action==='EnterMaintenance'?{status:'maintenance',maintenanceId:'${maintenanceId}',postgresPreserved:true}:action==='ExitMaintenance'?{status:'maintenance_ended'}:action==='Start'?{status:'started',manifestSha256:'new-manifest'}:action==='VerifyStartup'?{startupVerified:true}:{};return {stdout:JSON.stringify(value),stderr:'',processEvidence:{code:'completed'}}};export const hashRelativeFiles=async()=>({sha256:'source'});export const listGitSourceFiles=async()=>[];`);
 await write(path.join(root,'fetch.mjs'),`globalThis.fetch=async()=>({status:${fail==='Ready'?503:200},json:async()=>({ok:true,status:'ready'})});`);
 const run=()=>spawnSync(process.execPath,['--import',pathToFileURL(path.join(root,'fetch.mjs')).href,path.join(source,'tools/pi150-forward-recovery.mjs'),'execute',badProof?'0'.repeat(64):digest(proof),'--fixed-environment'],{encoding:'utf8',windowsHide:true,timeout:20000});
 const result=run();let actions='';try{actions=await fs.readFile(path.join(root,'actions'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 return {root,output,attempt,state,result,actions,run};
}
test('full forward flow binds success and catalog, applies only new plan',async t=>{
 const f=await fixture(t);assert.equal(f.result.status,0,f.result.stderr);assert.equal(f.actions,'VerifyPreparedApp\nEnterMaintenance\nDeployApp\nHardenAcl\nApply:new-plan\nExitMaintenance\nStart\nVerifyStartup\n');
 const receipt=JSON.parse(await fs.readFile(path.join(f.output,'SUCCESS.json'))),catalog=JSON.parse(await fs.readFile(path.join(f.state,'PUBLISHED-MAIN.json')));assert.equal(receipt.mainCommit,'test-commit');assert.equal(catalog.receiptSha256,digest(await fs.readFile(path.join(f.output,'SUCCESS.json'))));assert.equal(JSON.parse(await fs.readFile(path.join(f.attempt,'FAILED.json'))).phase,'启动服务');assert.notEqual(f.run().status,0);
});
for(const fail of ['VerifyPreparedApp','Reuse','EnterMaintenance','DeployApp','HardenAcl','Apply','ExitMaintenance','Start','VerifyStartup','Ready'])test('unknown '+fail+' stops, preserves failure and never creates success',async t=>{
 const f=await fixture(t,{fail});assert.notEqual(f.result.status,0);assert.equal(await fs.stat(path.join(f.output,'SUCCESS.json')).then(()=>true,()=>false),false);if(['VerifyPreparedApp','Reuse'].includes(fail))assert.equal(f.actions.includes('EnterMaintenance'),false);else assert.equal(JSON.parse(await fs.readFile(path.join(f.output,'RECOVERY-FAILED.json'))).automaticRetry,false);if(fail!=='Reuse'&&fail!=='Ready')assert.equal(f.actions.trim().split('\n').at(-1),fail==='Apply'?'Apply:new-plan':fail);assert.notEqual(f.run().status,0);
});
for(const options of [{badProof:true},{badChain:true},{started:true},{badOriginal:true},{badDjango:true},{badSource:true}])test('mismatched or previously started recovery refuses before native action '+JSON.stringify(options),async t=>{
 const f=await fixture(t,options);assert.notEqual(f.result.status,0);assert.equal(f.actions,'');
});
