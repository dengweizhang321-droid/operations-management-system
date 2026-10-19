import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertFrozenSource} from '../tools/frozen-main-source.mjs';
import {maintenanceReadiness,piMaintenancePredecessor as k,nativePiWorkspacePredecessor as n} from '../tools/manual-maintenance-continuation.mjs';
import {publishPreparedMain} from '../tools/publish-prepared-main.mjs';
import {controlFiles} from '../tools/install-main-prebuild.mjs';
import {compareFunctionOnlyChange,compareMaintenanceInventoryOnly} from '../tools/verify-release-candidate.mjs';
const hash='a'.repeat(64),commit='b'.repeat(40),tree='c'.repeat(40);
test('approved source ignores advancing origin/main but rejects HEAD/tree/worktree drift',async()=>{
 let head=commit,actualTree=tree,status='',remote='d'.repeat(40);const seen=[];
 const git=async(_,args)=>{seen.push(args);if(args[0]==='status')return status;assert.deepEqual(args,['rev-parse','HEAD','HEAD^{tree}',commit+'^{tree}']);return [head,actualTree,tree].join('\n');};
 const options={source:'private',mainCommit:commit,sourceTree:tree};
 assert.deepEqual(await assertFrozenSource(options,{git}),{commit,tree});remote='e'.repeat(40);await assertFrozenSource(options,{git});
 assert.equal(seen.length,4,'each boundary uses one object observation and one fresh status');
 assert.ok(seen.every(a=>!a.join(' ').includes('origin/main')&&a[0]!=='fetch'));
 head=remote;await assert.rejects(assertFrozenSource(options,{git}));head=commit;actualTree=remote;await assert.rejects(assertFrozenSource(options,{git}));actualTree=tree;status=' M tracked';await assert.rejects(assertFrozenSource(options,{git}));
});
test('real copied control bundle contains and imports frozen source checker',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'preflight-control-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of controlFiles)await fs.copyFile(path.resolve('tools',name),path.join(root,name));
 const {inspectMainPreparation}=await import(pathToFileURL(path.join(root,'publish-latest-main.mjs')));
 const result=await inspectMainPreparation({source:root,packet:root,targetCommit:commit,request:{}},{git:async(_,args)=>args[0]==='status'?'':args.length===4?[commit,tree,tree].join('\n'):args[1]==='HEAD'?commit:tree});assert.equal(result.status,'not-ready');
});
test('Django package exemption permits exactly three dependency entries',()=>{
 const old='function Prepare-Application {\n      "tools\\manual-maintenance-continuation.ps1",\n      "next",\n}';
 const entries='      "tools\\manual-maintenance-process.psm1",\n      "tools\\manual-maintenance-preflight.ps1",\n      "tools\\frozen-main-source.mjs",\n';
 const before={functions:[{name:'Prepare-Application',text:old}],other:['fixed']},after=structuredClone(before);after.functions[0].text=old.replace('      "next",',entries+'      "next",');
 assert.equal(compareFunctionOnlyChange(before,after),true);assert.equal(compareMaintenanceInventoryOnly(before,after),true);after.functions[0].text+=' altered stop';assert.equal(compareFunctionOnlyChange(before,after),false);assert.equal(compareMaintenanceInventoryOnly(before,after),false);
});
test('readiness never rebaselines an AI hash changed after qualification',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'preflight-qualify-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.copyFile('tools/django-ai.ps1',path.join(source,'tools/django-ai.ps1'));
 const pins={'deployment.json':n.djangoManifestSha256,'deployment-manifest.json':n.workerManifestSha256,'worker-local-service.ps1':n.workerScriptSha256,'process-deadline.ps1':n.workerTransportSha256,'django-local-service.ps1':n.djangoScriptSha256};let reads=0;
 const options={source,installed:path.join(root,'django/app'),runtime:path.join(root,'worker'),head:{releaseId:n.releaseId,manifestSha256:n.workerManifestSha256},djangoManifestSha256:n.djangoManifestSha256,sha:async file=>{
  if(path.basename(file)==='django-ai.ps1'){if(file.startsWith(source))return n.candidateAiScriptSha256;return ++reads===1?n.djangoAiScriptSha256:hash;}return pins[path.basename(file)]??hash;
 }};
 await assert.rejects(maintenanceReadiness(options),/资格核验后/);
 reads=0;options.sha=async file=>path.basename(file)==='django-ai.ps1'?(file.startsWith(source)?n.candidateAiScriptSha256:n.djangoAiScriptSha256):pins[path.basename(file)]??hash;
 assert.equal((await maintenanceReadiness(options)).route,'native-exit-observer');
 options.sha=async file=>path.basename(file)==='django-ai.ps1'?(file.startsWith(source)?n.candidateAiScriptSha256:hash):pins[path.basename(file)]??hash;await assert.rejects(maintenanceReadiness(options));
 const file=path.join(source,'tools/django-ai.ps1'),raw=await fs.readFile(file,'utf8');await fs.writeFile(file,raw.replace('    Wait-PiWorkerExit $owned $receiptSha256 (Get-FileSha256 $PiWorkerControlPath) $deadline','    # helper present but not invoked'));
 options.sha=async file=>path.basename(file)==='django-ai.ps1'?n.candidateAiScriptSha256:pins[path.basename(file)]??hash;await assert.rejects(maintenanceReadiness(options),/Pi Stop/);
});
test('preflight rejection happens before STARTED and before native maintenance',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'preflight-before-started-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=[];
 const head={releaseId:'private',manifestSha256:hash},out=path.join(root,'attempt');
 await assert.rejects(publishPreparedMain({mainCommit:commit,components:['django'],predecessorWorker:head,predecessorDjangoSha256:hash},{source:root,out,installedRoot:path.join(root,'app'),workerRuntimeRoot:path.join(root,'worker'),deployOnly:false,sourceIdentity:async()=>({commit,tree}),sha:async()=>hash,api:{},rotation:{withRotationLock:async f=>f({}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head})},maintenanceReadiness:async()=>({route:'native-exit-observer',sourcePins:{}}),runStep:async({action})=>{calls.push(action);if(action==='PrepareApp')return {id:'e'.repeat(32),receiptSha256:hash};throw Error('preflight unknown');}}),/preflight unknown/);
 assert.deepEqual(calls,['PrepareApp','Check']);await assert.rejects(fs.access(path.join(out,'STARTED.json')));await assert.rejects(fs.access(path.join(out,'maintenance-first-actor.json')));
});
for(const unknown of ['worker-local-service.ps1','process-deadline.ps1','django-local-service.ps1'])test('same AI cannot admit an unknown installed '+unknown,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'preflight-unknown-generation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.copyFile('tools/django-ai.ps1',path.join(source,'tools/django-ai.ps1'));
 const options={source,installed:path.join(root,'django/app'),runtime:path.join(root,'worker'),head:{releaseId:'private',manifestSha256:hash},djangoManifestSha256:hash,sha:async file=>!file.startsWith(source)&&path.basename(file)===unknown?'d'.repeat(64):hash};
 await assert.rejects(maintenanceReadiness(options),/控制器代际/);
 options.sha=async()=>hash;assert.equal((await maintenanceReadiness(options)).route,'native-exit-observer');
});
for(const host of ['powershell.exe','pwsh.exe'])test(host+' actual CIM projection and route-specific visibility/dynamic private locks',t=>{
 const executable=host==='powershell.exe'?'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe':host;
 const env=host==='powershell.exe'?{...process.env,PSModulePath:path.join(process.env.SystemRoot??process.env.SYSTEMROOT,'System32/WindowsPowerShell/v1.0/Modules')}:process.env;
 const result=execFileSync(executable,['-NoProfile','-NonInteractive','-File',path.resolve('tests/release-chain-preflight.fixture.ps1')],{encoding:'utf8',windowsHide:true,env});assert.match(result,/PREFLIGHT_PS_PASSED admin=(True|False) actualCim=Win32_Process/);t.diagnostic(result.trim());
});
