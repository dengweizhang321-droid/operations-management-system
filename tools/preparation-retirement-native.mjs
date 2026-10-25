/** Exact adopted native closure and ordinary control context for R1b. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {sha,canonical} from './main-prebuild-queue.mjs';
import {safeDirectory,stableBytes,censusScript} from './preparation-resolution.mjs';
import {readAdoptedControl,assertControlGeneration} from './main-control-dispatch.mjs';
import {currentPreparationIdentity,assertOrdinaryIdentity,taskPowerShell,readPreparationTask,preparationTaskState} from './main-prebuild-task.mjs';
import {collectFullBootObservation} from './preparation-retirement-boot.mjs';
import {hashRetirementFile,retirementGit} from './preparation-retirement-fs.mjs';
import {retirementRefProtocol} from './preparation-retirement-ref.mjs';
import {retirementIntentVersion} from './preparation-retirement-admission.mjs';
import {hashRetirementSourceInventory,retirementSourceAlgorithm} from './preparation-retirement-source.mjs';
export const retirementNativeFiles=Object.freeze({
 'tools/worker-local-release.mjs':'aa1be03ebde6fc5b5f9a50fc986a12756ba8eda69e0549ef111f23d5b9439bd2',
 'tools/worker-local-release-rotation.mjs':'778c136602cf1ebb44fd2fbed1ee67a3cf24fbd78a2cc52b8541db5be114b556',
 'tools/d1-retirement-proof.mjs':'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76'
});
export async function loadRetirementNativeTools(config){
 const expected=path.resolve(config.stateDirectory,'native-tools',sha(Buffer.from(canonical(retirementNativeFiles))));assert.equal(path.resolve(config.nativeToolsSource),expected,'R1b requires the qualified adopted successor512 native closure');await safeDirectory(expected);await safeDirectory(path.join(expected,'tools'));assert.deepEqual((await fs.readdir(expected)).sort(),['tools']);assert.deepEqual((await fs.readdir(path.join(expected,'tools'))).sort(),Object.keys(retirementNativeFiles).map(x=>x.slice(6)).sort());
 for(const[name,digest]of Object.entries(retirementNativeFiles))assert.equal(sha(await stableBytes(path.join(expected,name))),digest,'Retirement native tool changed');
 const api=await import(pathToFileURL(path.join(expected,'tools/worker-local-release.mjs'))),rotation=await import(pathToFileURL(path.join(expected,'tools/worker-local-release-rotation.mjs')));for(const name of ['validateWorkerSourceBinding','hashRelativeFiles','windowsPathSha256'])assert.equal(typeof api[name],'function','Qualified native ABI missing: '+name);assert.equal(typeof rotation.resolveEffectiveReleaseChain,'function');assert.equal(api.treeHashAlgorithm,retirementSourceAlgorithm);for(const [name,value] of Object.entries({workerRuntimeRoot:'D:/teruisi-runtime/teruisi-worker-sales',workerSourceRoot:'D:/运营管理系统-sales-django-release',workerLegacySourceRoot:'D:/运营管理系统-django-sales-combined',workerDevVarsSource:'D:/运营管理系统/.dev.vars'}))assert.equal(path.resolve(api[name]??'').toLowerCase(),path.resolve(value).toLowerCase(),'Qualified native root ABI changed: '+name);assert.equal(path.resolve(rotation.djangoSalesRuntimeRoot??'').toLowerCase(),path.resolve('D:/teruisi-runtime/django-sales').toLowerCase());return {api,rotation,sourceDigest:hashRetirementSourceInventory,root:expected,files:retirementNativeFiles};
}
export async function retirementIdentity(){return taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Retirement identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=[string]$p.CommandLine;executablePath=[string]$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid});}
async function contextForToken(configFile,observer){
 assert.ok(path.isAbsolute(configFile));const bundleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),adopted=await readAdoptedControl(configFile,bundleRoot),actual=await currentPreparationIdentity(),token=observer?actual:assertOrdinaryIdentity(actual,adopted.state.preparationTask.sid);assert.equal(token.sid,adopted.state.preparationTask.sid);if(observer){assert.equal(token.elevated,true,'Independent observation needs a complete high-token census');assert.ok(token.integrityRid>=12288);}const writer=await retirementIdentity();assert.equal(writer.processId,process.pid);const native=await loadRetirementNativeTools(adopted.config),gitExecutable=path.join(adopted.config.gitDirectory,'git.exe');assert.ok(path.isAbsolute(gitExecutable));const git={executable:gitExecutable,sha256:(await hashRetirementFile(gitExecutable)).sha256};
 return {configFile:path.resolve(configFile),config:adopted.config,adopted,bundleRoot,token,writer,native,git,privateTestTopology:false,writeAuthority:!observer};
}
export async function retirementControlContext(configFile){return contextForToken(configFile,false);}
export async function retirementObservationContext(configFile){return contextForToken(configFile,true);}
/** Pre-adoption compatibility read. It cannot be used by a retirement writer. */
export async function retirementInspectionContext(configFile){assert.ok(path.isAbsolute(configFile));const adopted=await readAdoptedControl(configFile),token=await currentPreparationIdentity();assert.equal(token.sid,adopted.state.preparationTask.sid);const native=await loadRetirementNativeTools(adopted.config),gitExecutable=path.join(adopted.config.gitDirectory,'git.exe');return {configFile:path.resolve(configFile),config:adopted.config,adopted,token,native,git:{executable:gitExecutable,sha256:(await hashRetirementFile(gitExecutable)).sha256},privateTestTopology:false,writeAuthority:false};}
async function namedLock(pipe,deadline){
 for(;;){let unlock;try{unlock=await new Promise((resolve,reject)=>{const server=createServer(c=>c.destroy());server.once('error',reject);server.listen(pipe,()=>resolve(()=>new Promise((done,fail)=>server.close(e=>e?fail(e):done()))));});}catch(error){if(error.code!=='EADDRINUSE')throw error;assert.ok(Date.now()<deadline,'Retirement lock wait expired');await new Promise(resolve=>setTimeout(resolve,250));continue;}return unlock;}
}
export async function acquireRetirementLocks(context,deadline=Date.now()+30000){
 const state=path.resolve(context.config.stateDirectory),pipes=['\\\\.\\pipe\\TERUISI.MainPrebuild.'+sha(path.resolve(state,'prebuild-queue').toLowerCase()),'\\\\.\\pipe\\TERUISI.MainPrebuild.v2.'+sha(path.resolve(state,'prebuild-queue-v2').toLowerCase()),'\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'];assert.equal(context.privateTestTopology,false);assert.equal(context.writeAuthority,true,'Read-only inspection/observation has no writer authority');const unlocks=[];
 try{for(const pipe of pipes)unlocks.push(await namedLock(pipe,deadline));await assertControlGeneration(context.adopted);assertOrdinaryIdentity(await currentPreparationIdentity(),context.adopted.state.preparationTask.sid);return async()=>{while(unlocks.length)await unlocks.pop()();};}catch(error){while(unlocks.length)await unlocks.pop()();throw error;}
}
export async function assertRetirementTaskIdle(context){const task=context.adopted.state.preparationTask;assert.deepEqual(await readPreparationTask(task),task.definition);const state=await preparationTaskState(task);assert.equal(state.state,3);assert.equal(state.instances,0);return {definitionSha256:sha(Buffer.from(canonical(task.definition))),...state};}
export async function assertRetirementGitFence(context){
 const manifest=JSON.parse(await stableBytes(path.join(context.adopted.bundleRoot,'MANIFEST.json')));assert.equal(manifest.preparationRetirementProtocol,retirementIntentVersion);assert.equal(manifest.preparationRetirementRefProtocol,retirementRefProtocol,'Control no longer supplies the prepared native ref fence');let custom='';try{custom=await retirementGit(context.config.repository,['config','--get','core.hooksPath'],context.git);}catch(error){if(error.code!==1)throw error;}const common=await retirementGit(context.config.repository,['rev-parse','--path-format=absolute','--git-common-dir'],context.git),expected=path.join(common,'hooks');assert.equal(custom,expected,'Effective hooksPath bypasses the prepared retirement fence');assert.equal(await retirementGit(context.config.repository,['config','--local','--get-all','core.hooksPath'],context.git),expected,'Local hooksPath no longer blocks old installers');assert.equal(path.resolve(context.adopted.state.hook).toLowerCase(),path.resolve(common,'hooks/reference-transaction').toLowerCase());assert.equal(sha(await stableBytes(context.adopted.state.hook)),context.adopted.state.hookSha256,'Native reference hook changed');return {protocol:retirementRefProtocol,commonDirectory:path.resolve(common),hookSha256:context.adopted.state.hookSha256};
}
export async function freshRetirementContext(context){await assertControlGeneration(context.adopted);assert.deepEqual((await loadRetirementNativeTools(context.config)).files,context.native.files);assertOrdinaryIdentity(await currentPreparationIdentity(),context.adopted.state.preparationTask.sid);return {boot:await collectFullBootObservation(),task:await assertRetirementTaskIdle(context),refFence:await assertRetirementGitFence(context)};}
export async function retirementCensus(){return taskPowerShell(censusScript);}
