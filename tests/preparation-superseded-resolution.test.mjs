import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonical,sha,durableCreate,initializeQueue,submitPreparation,readQueueObject,drainPreparationQueue} from '../tools/main-prebuild-queue.mjs';
import {resolutionVersion,resolutionDecisions,operatorNames,writePreparationResolution,readPreparationResolution,readHistoricalResolution,collectSupersededPreparationState,censusProjection,evidenceInventory,validateResolution} from '../tools/preparation-resolution.mjs';
import history from '../tools/preparation-resolution-history.mjs';

const root=path.resolve(import.meta.dirname,'..'),hash='a'.repeat(64),queueVersion='teruisi-main-prebuild-queue-v2';
const superseded=resolutionDecisions.supersededByLaterPublication;
const iso=ms=>new Date(ms).toISOString();
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();
async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');return value;}

/** Reproduces the e786 shape: preparation completed, the maintenance-predecessor check then drifted. */
async function fixture(t){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'superseded-resolution-'));t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const state=path.join(tmp,'state'),directory=path.join(state,'prebuild-queue-v2'),bundleRoot=path.join(tmp,'bundle'),out=path.join(tmp,'witness'),packet=path.join(tmp,'packet'),artifacts=path.join(tmp,'artifacts');
 await fs.mkdir(path.join(bundleRoot,'tools'),{recursive:true});await initializeQueue(directory);
 const files={};for(const name of [...new Set([...operatorNames,'frozen-main-source.mjs'])]){const raw=await fs.readFile(path.join(root,'tools',name));await fs.writeFile(path.join(bundleRoot,'tools',name),raw);files['tools/'+name]=sha(raw);}
 const manifest={version:'teruisi-main-control-bundle-v2',sourceCommit:'d'.repeat(40),sourceTree:'e'.repeat(40),files,bundleSha256:sha(Buffer.from(canonical(files)))};
 const manifestSha256=await durableCreate(path.join(bundleRoot,'MANIFEST.json'),manifest),task={sid:'S-1-5-21-123',definition:{enabled:true}};
 const adopted={state:{version:'teruisi-main-control-installation-v3',status:'adopted',preparationTask:task,bundleManifestSha256:manifestSha256,bundleSha256:manifest.bundleSha256}};
 const installId=randomUUID(),adoptedAt=iso(Date.now()-7200000),configFile=path.join(state,'main-publisher-config.json'),configSha256=await durableCreate(configFile,{stateDirectory:state});
 Object.assign(adopted.state,{installId,adoptedAt,bundleRoot,configSha256,hook:path.join(state,'hook'),dispatcherSha256:sha(Buffer.from('fixture dispatcher')),hookSha256:sha(Buffer.from('fixture hook')),transitionProofFile:path.join(state,'transition.json')});
 await fs.mkdir(path.join(state,'control/tools'),{recursive:true});await fs.mkdir(path.join(state,'control-upgrades',installId),{recursive:true});
 await fs.writeFile(path.join(state,'control/tools/publish-latest-main.mjs'),'fixture dispatcher');await fs.writeFile(adopted.state.hook,'fixture hook');
 const intent={...adopted.state,version:'teruisi-main-control-upgrade-v2',sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree};
 adopted.state.intentSha256=await durableCreate(path.join(state,'control-upgrades',installId,'INTENT.json'),intent);
 adopted.state.transitionProofSha256=await durableCreate(adopted.state.transitionProofFile,{version:'teruisi-main-control-transition-v2',installId,intentSha256:adopted.state.intentSha256,lockOrder:['v1-queue','v2-queue','native-rotation'],rotationPipeSha256:sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'),productionDeploymentPerformed:false,privateTestTopology:false,legacyWindowConverged:true,frames:[{related:[],at:adoptedAt},{related:[],at:adoptedAt},{related:[],at:adoptedAt}]});
 adopted.configFile=configFile;adopted.stateSha256=await durableCreate(path.join(state,'CONTROL-INSTALLATION.json'),adopted.state);
 const source=path.join(packet,'source');await fs.mkdir(path.join(source,'tools'),{recursive:true});
 for(const name of ['worker-local-release.mjs','worker-local-release-rotation.mjs','publish-prepared-main.mjs'])await fs.writeFile(path.join(source,'tools',name),await fs.readFile(path.join(root,'tools',name)));
 await fs.writeFile(path.join(source,'README.md'),'frozen packet source\n');
 git(source,['init','-q']);git(source,['add','-A']);
 git(source,['-c','user.name=fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-q','-m','frozen source']);
 const target=git(source,['rev-parse','HEAD']),tree=git(source,['rev-parse','HEAD^{tree}']),inventory='2'.repeat(64);
 const live={mainCommit:'f'.repeat(40),chainStateSha256:hash,djangoManifestSha256:hash,head:{bindingSha256:hash,guardReceiptSha256:hash,manifestSha256:hash,releaseId:'20261021T005044Z-3e008fa5cc2bacfe',version:'teruisi-local-worker-release-binding-v1'}};
 const workerPlan={status:'planned',version:'teruisi-local-worker-release-rotation-plan-v1',planSha256:'3'.repeat(64),planPath:path.join(tmp,'plans','3'.repeat(64)+'.json'),predecessorReleaseId:live.head.releaseId,candidateReleaseId:'20261021T050959Z-309bb3d722f0ee47',candidateManifestSha256:'4'.repeat(64),candidateGuardReceiptSha256:'5'.repeat(64),cutoverId:'sales-pg-20260829T204417Z-d9896e904d8092cb'};
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:target,deployedCommit:live.mainCommit,predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256,components:['worker','django'],migrate:false,backup:false,fullTests:false};
 await writeJson(path.join(packet,'main-release-request.json'),request);
 const requestSha256=sha(Buffer.from(JSON.stringify(request))),leaf='publish-'+target.slice(0,12),publication=path.join(packet,leaf),preparation=path.join(publication,'preparation');
 const base=Date.now()-3600000;
 await writeJson(path.join(preparation,'PREPARING.json'),{at:iso(base+600000),requestSha256,sourceIdentity:{commit:target,tree}});
 await writeJson(path.join(preparation,'source-binding.json'),{version:'teruisi-worker-source-binding-v1',sourceRoot:source,sourceRootPathSha256:'1'.repeat(64),predecessor:live.head,predecessorChainStateSha256:live.chainStateSha256,identity:{sourceTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:3,sha256:inventory}}});
 const prepared={version:'teruisi-main-preparation-v1',at:iso(base+900000),requestSha256,sourceIdentity:{commit:target,tree},workerPlan,djangoPackage:{id:'ccf8076f6a17458bbbef7f4b747257c8',receiptSha256:'6'.repeat(64),appFingerprint:'7'.repeat(64)},djangoManifestSha256:'8'.repeat(64)};
 await writeJson(path.join(preparation,'PREPARED.json'),prepared);
 await writeJson(path.join(preparation,'worker-plan.json'),workerPlan);
 await writeJson(path.join(preparation,'verify-tk1iYe','复验已准备后台-result.json'),{status:'ok'});
 const failedFile=path.join(preparation,'FAILED-e1de27e8-fd01-4bb2-8bce-58da93be51f1.json');
 await writeJson(failedFile,{at:iso(base+960000),mainCommit:target,phase:'核对维护前驱资格',error:'维护前驱资格与最初读取字节不一致\n+ actual\n- expected\n',processEvidence:null,maintenanceStarted:false,automaticRetry:false});
 await writeJson(path.join(publication,'STARTED.json'),{at:iso(base+1200000),mainCommit:target,source,sourceTree:tree,requestSha256,predecessorChainStateSha256:live.chainStateSha256,maintenanceId:'e53d9bba2d294b6e9308257a41e94e40',components:['worker','django']});
 await writeJson(path.join(publication,'FAILED.json'),{at:iso(base+1500000),mainCommit:target,phase:'退出维护',error:'exit=1',processEvidence:{version:1,code:'nonzero_exit',stage:'output',processId:39356,exitCode:1,deadlineUnixMs:base+1600000},maintenanceStarted:true,automaticRetry:false});
 const receiptPath=path.join(artifacts,'releases','SUCCESS.json');
 const receipt=await writeJson(receiptPath,{manualRecovery:true,automatedPublisherSuccess:false,originalStartReconciled:true,originalStartExitedSuccessfully:false,originalFailureSha256:sha(await fs.readFile(path.join(publication,'FAILED.json'))),originalStartedSha256:sha(await fs.readFile(path.join(publication,'STARTED.json'))),status:'deployed_and_ready',at:iso(base+1800000),mainCommit:target,components:['worker','django'],workerRelease:workerPlan.candidateReleaseId,workerManifestSha256:workerPlan.candidateManifestSha256,djangoManifestSha256:prepared.djangoManifestSha256,source,sourceTree:tree,djangoPreparedId:prepared.djangoPackage.id,maintenanceId:'e53d9bba2d294b6e9308257a41e94e40',startupVerified:true,readyVerified:true,backupPerformed:false,originalAttempt:publication});
 const receiptRaw=await fs.readFile(receiptPath);
 const published={...receipt,receiptPath,receiptSha256:sha(receiptRaw),sourceTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:3,sha256:inventory}};
 await writeJson(path.join(state,'PUBLISHED-MAIN.json'),published);
 const ticket=await submitPreparation(directory,{origin:'manual',configSha256,bundleSha256:hash}),dispatchId=randomUUID();
 const dispatch={version:queueVersion,dispatchId,requestId:ticket.requestId,tickets:[{requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}],mode:'prepare-only',configSha256,bundleSha256:hash,selectedTarget:target,selection:{targetCommit:target,packet,live},deadlineUnixMs:base+600000,dispatchedAt:iso(base)};
 const dispatchSha256=await durableCreate(path.join(directory,'dispatches',dispatchId+'.json'),dispatch);
 const terminal={version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'unknown',at:iso(base+1000000),configSha256,bundleSha256:hash,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:ticket.requestId,error:'本次目标发布未完成，退出码：1'};
 await durableCreate(path.join(directory,'results',ticket.requestId+'.json'),terminal);
 const writer={processId:process.pid,creationDate:iso(base-60000),commandLine:'node private-writer',executablePath:process.execPath};
 const observer={processId:424242,creationDate:writer.creationDate,commandLine:'node private-observer',executablePath:process.execPath};
 const rows=[{...writer,parentProcessId:1,name:'node.exe'},{...observer,parentProcessId:2,name:'node.exe'}];
 let rotationCalls=0;
 const adapter={acquireRotation:async()=>{rotationCalls++;return async()=>{};},adopted:async()=>adopted,assertAdopted:async()=>{},ordinary:async()=>({sid:task.sid,sessionId:1,elevated:false,integrityRid:8192}),identity:async()=>writer,collect:collectSupersededPreparationState,
  census:async()=>({rows:rows.map(r=>r.processId===observer.processId?{...r,commandLine:null,executablePath:null}:r)}),
  observe:async r=>{const at=new Date().toISOString();return {version:resolutionVersion,requestSha256:sha(Buffer.from(canonical(r))),phase:r.phase,nonce:r.nonce,at,writer,observer,observerCodeSha256:r.operatorFiles['cleaned-preparation-observer.mjs'],elevated:true,completeCensus:true,census:censusProjection(rows),relatedControllers:[],taskState:3,taskInstances:0,taskDefinitionSha256:sha(Buffer.from(canonical(task.definition))),staticEvidence:r.staticEvidence,dynamicStartedAt:at,dynamicCompletedAt:at};}};
 return {tmp,state,directory,bundleRoot,out,packet,publication,preparation,receiptPath,dispatchId,dispatch,terminal,target,tree,adapter,rows,writer,observer,published,failedFile,prepared,workerPlan,
  get rotationCalls(){return rotationCalls;},
  collect:()=>collectSupersededPreparationState(dispatch,terminal,new Map(),{decision:superseded,directory}),
  write:()=>writePreparationResolution({directory,dispatchId,bundleRoot,out,adapter,decision:superseded})};
}
test('superseded-by-later-publication converges the e786 evidence shape and the queue recognises it',async t=>{
 const f=await fixture(t);
 const result=await f.write();
 assert.equal(result.status,'resolved');assert.equal(result.publicationPerformed,false);assert.equal(result.prepared,true);
 assert.equal(f.rotationCalls,1);
 assert.equal(await readPreparationResolution(f.directory,f.dispatch,f.terminal),true);
 const {value}=await readQueueObject(path.join(f.directory,'resolutions',f.dispatchId+'.json'));
 assert.equal(value.decision,'superseded-by-later-publication');assert.equal(value.terminationBasis,'preparation-consumed-by-later-publication');
 assert.equal(value.maintenanceStarted,false);assert.equal(value.publicationPerformed,false);assert.equal(value.retryOriginal,false);
 assert.equal(value.successorPublication.mainCommit,f.target);assert.equal(value.successorPublication.status,'deployed_and_ready');
 assert.equal(value.preparation.workerRelease,f.workerPlan.candidateReleaseId);
 assert.equal(value.originalAttemptTermination.actorProcessId,39356);
 await submitPreparation(f.directory,{origin:'manual',configSha256:f.dispatch.configSha256,bundleSha256:hash});
 let prepared=0;const selection={...f.dispatch.selection,targetCommit:'9'.repeat(40)};
 await drainPreparationQueue(f.directory,{configSha256:f.dispatch.configSha256,bundleSha256:hash,observe:async()=>selection,prepare:async()=>{prepared++;return {status:'non-production',targetCommit:selection.targetCommit,currentCommit:selection.live.mainCommit,publicationPerformed:false,packet:selection.packet,source:root};}});
 assert.equal(prepared,1);
 const before=await fs.readFile(path.join(f.directory,'resolutions',f.dispatchId+'.json'));
 await assert.rejects(f.write(),/second convergence is refused/);
 assert.deepEqual(await fs.readFile(path.join(f.directory,'resolutions',f.dispatchId+'.json')),before);
});

test('a resolved dispatch is never converged twice and its evidence closure is untouched',async t=>{
 const f=await fixture(t);await f.write();
 const evidence=path.join(f.directory,'resolutions',f.dispatchId+'-evidence'),count=(await fs.readdir(path.join(evidence,'objects'))).length;
 await assert.rejects(f.write(),/second convergence is refused/);
 assert.equal((await fs.readdir(path.join(evidence,'objects'))).length,count);
});

test('maintenance that already started, a drifted target and a frontend timeout are refused',async t=>{
 const f=await fixture(t);
 const reject=async(file,transform,pattern)=>{
  const original=await fs.readFile(file,'utf8');
  try{await fs.writeFile(file,JSON.stringify(transform(JSON.parse(original)),null,2)+'\n');await assert.rejects(f.collect(),pattern);}
  finally{await fs.writeFile(file,original);}
 };
 await reject(f.failedFile,v=>({...v,maintenanceStarted:true}),/Maintenance already started/);
 await reject(f.failedFile,v=>({...v,processEvidence:{version:1,code:'process_timeout',stage:'direct-exit',processId:1}}),/retained a live process/);
 await reject(f.failedFile,v=>({...v,phase:'构建前端',processEvidence:{version:1,code:'process_timeout',stage:'direct-exit',processId:1}}),/frontend build timeout cannot be superseded/);
 await reject(f.failedFile,v=>({...v,phase:'构建前端'}),/frontend build timeout cannot be superseded/);
 await reject(path.join(f.state,'PUBLISHED-MAIN.json'),v=>({...v,mainCommit:'0'.repeat(40)}),/deployed another commit/);
 await reject(path.join(f.state,'PUBLISHED-MAIN.json'),v=>({...v,receiptSha256:'0'.repeat(64)}),/receipt digest changed/);
 const publishedRaw=await fs.readFile(path.join(f.state,'PUBLISHED-MAIN.json'),'utf8'),receiptRaw=await fs.readFile(f.receiptPath,'utf8');
 const sync=async(transform,pattern)=>{
  try{
   const receipt=transform(JSON.parse(receiptRaw)),next=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
   await fs.writeFile(f.receiptPath,next);await writeJson(path.join(f.state,'PUBLISHED-MAIN.json'),transform({...JSON.parse(publishedRaw),receiptSha256:sha(next)}));
   await assert.rejects(f.collect(),pattern);
  }finally{await fs.writeFile(f.receiptPath,receiptRaw);await fs.writeFile(path.join(f.state,'PUBLISHED-MAIN.json'),publishedRaw);}
 };
 await sync(v=>({...v,originalAttempt:path.join(f.packet,'publish-'+'0'.repeat(12))}),/resumed another packet/);
 await sync(v=>({...v,originalStartReconciled:false}),/was not reconciled/);
});

test('a successor publication that consumed another candidate is refused before any evidence is written',async t=>{
 const f=await fixture(t);
 const publishedRaw=await fs.readFile(path.join(f.state,'PUBLISHED-MAIN.json'),'utf8'),receiptRaw=await fs.readFile(f.receiptPath,'utf8');
 try{
  const receipt=JSON.parse(receiptRaw);receipt.workerManifestSha256='b'.repeat(64);
  const next=Buffer.from(JSON.stringify(receipt,null,2)+'\n');await fs.writeFile(f.receiptPath,next);
  await writeJson(path.join(f.state,'PUBLISHED-MAIN.json'),{...JSON.parse(publishedRaw),receiptSha256:sha(next)});
  await assert.rejects(f.collect(),/another worker manifest/);
  await assert.rejects(f.write(),/another worker manifest/);
  assert.equal(await fs.stat(path.join(f.directory,'resolutions',f.dispatchId+'.json')).then(()=>true,()=>false),false);
  assert.equal(await fs.stat(path.join(f.directory,'resolutions',f.dispatchId+'-evidence')).then(()=>true,()=>false),false);
 }finally{await fs.writeFile(f.receiptPath,receiptRaw);await fs.writeFile(path.join(f.state,'PUBLISHED-MAIN.json'),publishedRaw);}
});

test('unreconciled interrupted maintenance and unknown packet artifacts are refused',async t=>{
 const f=await fixture(t);
 const publishedRaw=await fs.readFile(path.join(f.state,'PUBLISHED-MAIN.json'),'utf8'),receiptRaw=await fs.readFile(f.receiptPath,'utf8');
 try{
  const receipt=JSON.parse(receiptRaw);receipt.originalStartReconciled=false;
  const next=Buffer.from(JSON.stringify(receipt,null,2)+'\n');await fs.writeFile(f.receiptPath,next);
  await writeJson(path.join(f.state,'PUBLISHED-MAIN.json'),{...JSON.parse(publishedRaw),receiptSha256:sha(next),originalStartReconciled:false});
  await assert.rejects(f.collect(),/was not reconciled/);
 }finally{await fs.writeFile(f.receiptPath,receiptRaw);await fs.writeFile(path.join(f.state,'PUBLISHED-MAIN.json'),publishedRaw);}
 await writeJson(path.join(f.preparation,'unexpected.json'),{whatever:true});
 try{await assert.rejects(f.collect(),/Unknown preparation artifact/);}finally{await fs.rm(path.join(f.preparation,'unexpected.json'));}
 await fs.mkdir(path.join(f.preparation,'notes'));
 try{await assert.rejects(f.collect(),/Unknown preparation artifact/);}finally{await fs.rm(path.join(f.preparation,'notes'),{recursive:true});}
 assert.ok(await f.collect());
});

test('the legacy decision reader refuses a superseded resolution',async t=>{
 const f=await fixture(t);await f.write();
 const {value}=await readQueueObject(path.join(f.directory,'resolutions',f.dispatchId+'.json'));
 await assert.rejects(validateResolution(value,{dispatch:f.dispatch,terminal:f.terminal,objects:new Map()}));
});

test('the historical catalog reads a superseded resolution back and refuses any later change',async t=>{
 const f=await fixture(t);await f.write();
 const file=path.join(f.directory,'resolutions',f.dispatchId+'.json'),{value}=await readQueueObject(file),raw=Buffer.from(canonical(value));
 const evidence=path.join(f.directory,'resolutions',f.dispatchId+'-evidence');
 const pin={decision:'superseded-by-later-publication',dispatchId:f.dispatchId,dispatchSha256:sha(Buffer.from(canonical(f.dispatch))),evidenceTreeSha256:sha(Buffer.from(canonical(await evidenceInventory(evidence)))),forbidTargetReplay:true,requestId:f.terminal.requestId,resolutionSha256:sha(raw),selectedTarget:f.target,successorPublication:{mainFileSha256:value.successorPublication.mainFileSha256,preparationSha256:value.preparation.sha256,receiptSha256:value.successorPublication.receiptSha256},terminalSha256:sha(Buffer.from(canonical(f.terminal))),version:'teruisi-superseded-by-later-publication-fixture-v1'};
 const catalog={...history,records:[...history.records,pin]};
 assert.equal(await readHistoricalResolution(f.directory,f.dispatch,f.terminal,value,raw,catalog),true);
 await assert.rejects(readHistoricalResolution(f.directory,f.dispatch,f.terminal,{...value,decision:'failed-cleaned-before-plan'},raw,catalog),/decision changed/);
 await assert.rejects(readHistoricalResolution(f.directory,f.dispatch,f.terminal,{...value,maintenanceStarted:true},raw,catalog));
 await assert.rejects(readHistoricalResolution(f.directory,f.dispatch,f.terminal,value,Buffer.from(canonical({...value,at:iso(Date.now())})),catalog),/Historical resolution changed/);
 await assert.rejects(readHistoricalResolution(f.directory,f.dispatch,f.terminal,{...value,successorPublication:{...value.successorPublication,receiptSha256:'0'.repeat(64)}},raw,catalog),/Historical successor receipt changed/);
 const rebound={...value,preparation:{...value.preparation,sha256:'0'.repeat(64)}},reboundRaw=Buffer.from(canonical(rebound));
 const reboundCatalog={...history,records:[...history.records,{...pin,resolutionSha256:sha(reboundRaw)}]};
 await assert.rejects(readHistoricalResolution(f.directory,f.dispatch,f.terminal,rebound,reboundRaw,reboundCatalog),/Historical preparation receipt changed/);
 await fs.writeFile(file,JSON.stringify(value));
 await assert.rejects(readPreparationResolution(f.directory,f.dispatch,f.terminal),/Noncanonical/);
});

test('an unknown decision and a tampered evidence object are refused on read',async t=>{
 const f=await fixture(t);await f.write();
 const file=path.join(f.directory,'resolutions',f.dispatchId+'.json'),{value}=await readQueueObject(file);
 const original=await fs.readFile(file,'utf8');
 try{
  await fs.writeFile(file,canonical({...value,decision:'made-up-decision'}));
  await assert.rejects(readPreparationResolution(f.directory,f.dispatch,f.terminal),/Unknown resolution decision/);
 }finally{await fs.writeFile(file,original);}
 const objectFile=path.join(value.evidenceDirectory,'objects',value.successorPublication.receiptSha256+'.bin'),objectRaw=await fs.readFile(objectFile);
 try{
  await fs.writeFile(objectFile,Buffer.concat([objectRaw,Buffer.from(' ')]));
  await assert.rejects(readPreparationResolution(f.directory,f.dispatch,f.terminal),/digest mismatch/);
 }finally{await fs.writeFile(objectFile,objectRaw);}
 assert.equal(await readPreparationResolution(f.directory,f.dispatch,f.terminal),true);
});

test('the frozen bundle CLI advertises both decisions and never touches production',async t=>{
 const f=await fixture(t);
 for(const name of ['cleaned-preparation-writer.mjs','cleaned-preparation-observer.mjs']){
  const output=execFileSync(process.execPath,[path.join(f.bundleRoot,'tools',name),'--help'],{encoding:'utf8',windowsHide:true});
  assert.match(output,/Usage:/);
  if(name==='cleaned-preparation-writer.mjs'){assert.match(output,/superseded-by-later-publication/);assert.match(output,/failed-cleaned-before-plan/);}
 }
 assert.equal(await fs.stat(f.out).then(()=>true,()=>false),false);
});
