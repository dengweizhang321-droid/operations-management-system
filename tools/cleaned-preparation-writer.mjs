/** Generic ordinary-user operator, run from its immutable control bundle. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {readPreparationQueueInventory,readQueueObject} from './main-prebuild-queue.mjs';
import {writePreparationResolution,collectPreparationState,collectSupersededPreparationState,resolutionDecisions,censusScript} from './preparation-resolution.mjs';
import {readAdoptedControl,assertControlGeneration} from './main-control-dispatch.mjs';
import {currentPreparationIdentity,assertOrdinaryIdentity,taskPowerShell} from './main-prebuild-task.mjs';
const {values}=parseArgs({options:{help:{type:'boolean'},inventory:{type:'boolean'},config:{type:'string'},dispatch:{type:'string'},decision:{type:'string'},out:{type:'string'}}});
if(values.help){
 console.log('Usage: node cleaned-preparation-writer.mjs --config <absolute config> --inventory\n       node cleaned-preparation-writer.mjs --config <absolute config> --dispatch <uuid> --out <new private directory> [--decision <name>]\nRun from the adopted frozen control bundle as the ordinary interactive user. Inventory is read-only. Writing requires two independent elevated read-only observations in the same queue/rotation-lock epoch; emits their exact commands. --decision selects the convergence decision ('+Object.values(resolutionDecisions).join(' | ')+'); it defaults to '+resolutionDecisions.cleanedBeforePlan+'. Never retries preparation or changes terminal results.');
}else{
 assert.ok(values.config&&path.isAbsolute(values.config),'Absolute --config required');const config=JSON.parse(await fs.readFile(values.config,'utf8')),directory=path.join(config.stateDirectory,'prebuild-queue-v2');
 const decision=values.decision??resolutionDecisions.cleanedBeforePlan;assert.ok(Object.values(resolutionDecisions).includes(decision),'--decision must be one of: '+Object.values(resolutionDecisions).join(', '));
 if(values.inventory){assert.ok(!values.dispatch&&!values.out&&values.decision===undefined);const inv=await readPreparationQueueInventory(directory);console.log(JSON.stringify({status:'read-only-inventory',dispatches:inv.dispatches.map(r=>({dispatchId:r.value.dispatchId,dispatchSha256:r.sha256,requestId:r.value.requestId,selectedTarget:r.value.selectedTarget,terminalStatus:inv.terminals.get(r.value.requestId)?.status??'absent'})),publicationPerformed:false}));}
 else{
  assert.ok(values.dispatch&&values.out&&path.isAbsolute(values.out),'--dispatch and absolute new --out required');
  assert.ok(path.resolve(values.out).toLowerCase().startsWith('d:\\codex-artifacts\\'),'Private D:/codex-artifacts output required');
  const bundleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const adapter={
   acquireRotation:()=>new Promise((resolve,reject)=>{const s=createServer(c=>c.destroy());s.once('error',reject);s.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise((done,fail)=>s.close(e=>e?fail(e):done()))));}),
   adopted:()=>readAdoptedControl(values.config,bundleRoot),assertAdopted:assertControlGeneration,
   ordinary:async sid=>assertOrdinaryIdentity(await currentPreparationIdentity(),sid),
   identity:()=>taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Writer identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid}),
   collect:(dispatch,terminal,objects,context={})=>(context.decision??decision)===resolutionDecisions.supersededByLaterPublication?collectSupersededPreparationState(dispatch,terminal,objects,context):collectPreparationState(dispatch,terminal,objects),census:()=>taskPowerShell(censusScript),
   observe:async(r,_file,out)=>{const response=path.join(out,'OBSERVATION-'+r.phase+'.json');for(;;){try{return (await readQueueObject(response)).value;}catch(e){if(e.code!=='ENOENT')throw e;assert.ok(Date.now()<r.deadlineUnixMs,'Independent observation deadline expired');await new Promise(done=>setTimeout(done,200));}}}
  };
  console.log(JSON.stringify(await writePreparationResolution({directory,dispatchId:values.dispatch,bundleRoot,out:values.out,adapter,decision,onStage:x=>console.log(JSON.stringify(x))})));
 }
}
