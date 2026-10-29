/** Private child only. Execute D08 lock bytes, redirecting just its net.listen pipe. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repository=fileURLToPath(new URL('../../',import.meta.url)),runtime=path.join(repository,'.runtime');
const nativePins={
 'tools/worker-local-release-rotation.mjs':'778c136602cf1ebb44fd2fbed1ee67a3cf24fbd78a2cc52b8541db5be114b556',
 'tools/worker-local-release.mjs':'aa1be03ebde6fc5b5f9a50fc986a12756ba8eda69e0549ef111f23d5b9439bd2',
 'tools/d1-retirement-proof.mjs':'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76'
};
const productionPipe='\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',hash=raw=>createHash('sha256').update(raw).digest('hex'),key=file=>path.resolve(file).toLowerCase();
async function snapshot(){
 assert.ok(process.env.TERUISI_NATIVE_LOCK_FIXTURE,'A pinned private native snapshot is required');
 const source=path.resolve(process.env.TERUISI_NATIVE_LOCK_FIXTURE);assert.equal(key(source),key(path.join(runtime,'pinned-native')),'Only the private D08 snapshot may be imported');
 assert.equal(key(await fs.realpath(source)),key(source),'Native fixture redirected');
 const manifest=JSON.parse(await fs.readFile(path.join(source,'SNAPSHOT.json')));assert.equal(path.basename(manifest.source),'d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31');assert.deepEqual(manifest.files,nativePins);
 for(const [name,digest] of Object.entries(nativePins)){const file=path.join(source,...name.split('/')),stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);assert.equal(key(await fs.realpath(file)),key(file));assert.equal(hash(await fs.readFile(file)),digest,'D08 snapshot changed: '+name);}
 return source;
}
async function main(){
 const mode=process.argv[2];assert.ok(['success','throw-before-write','throw-after-record','busy','queue-busy','submission-busy','generation','admission','old-call'].includes(mode));
 const nativeToolsSource=await snapshot();assert.ok(key(os.tmpdir()).startsWith(key(runtime)+path.sep),'Private worktree TEMP/TMP required');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'d08-native-lock-')),queue=path.join(root,'prebuild-queue-v2'),privatePipe='\\\\.\\pipe\\TERUISI.Test.ArtifactLoss.D08.'+randomUUID();
 const {queuePipe,acquireQueueLock,acquireQueueSubmissionLock,submitPreparation,durableCreate,sha,canonical,queueVersion,readPreparationQueueStructure,readPreparationQueueInventory}=await import('../../tools/main-prebuild-queue.mjs');
 const {artifactLossProtocol,artifactLossManifestName,makeArtifactLossManifest,readArtifactLossControlBinding}=await import('../../tools/prepared-artifact-loss.mjs');
 const allowed=new Set([privatePipe,queuePipe(queue),queuePipe(queue)+'.Submission']),originalListen=net.Server.prototype.listen;let mapped=0,forwardedProduction=0,stages=0,busyOwner;
 // No native operation or lock implementation is replaced. Unknown transports fail closed.
 net.Server.prototype.listen=function(...args){
  const requested=args[0];assert.equal(typeof requested,'string','Only private pipe listens are permitted');
  if(requested===productionPipe){mapped++;args[0]=privatePipe;}else assert.ok(allowed.has(requested),'Unexpected pipe/transport in private native check: '+requested);
  if(args[0]===productionPipe)forwardedProduction++;assert.notEqual(args[0],productionPipe,'Production pipe must never be forwarded');return Reflect.apply(originalListen,this,args);
 };
 const listen=pipe=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(pipe,()=>resolve(server));});
 const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 const nativeBusy=async()=>{let server;try{server=await listen(privatePipe);}catch(error){assert.equal(error.code,'EADDRINUSE');return;}await close(server);assert.fail('The real native lock was not held');};
 try{
  const rotation=await import(pathToFileURL(path.join(nativeToolsSource,'tools/worker-local-release-rotation.mjs')));
  assert.equal(typeof rotation.withRotationLock,'function');assert.equal(rotation.withRotationLock.length,1);assert.equal(Object.hasOwn(rotation,'acquirePreparationRotationLock'),false,'Fixture must expose the deployed API, not repository native exports');
  const {retireLostMainArtifacts}=await import('../../tools/publish-latest-main.mjs');
  const generation={configSha256:'1'.repeat(64),bundleSha256:'2'.repeat(64)},target='a'.repeat(40),packet=path.join(root,'packets','aaaaaaaaaaaa-55555555-66666666');await fs.mkdir(path.dirname(packet));
  const ticket=await submitPreparation(queue,{...generation,origin:'manual'}),dispatchId=randomUUID(),live={mainCommit:'b'.repeat(40),head:{bindingSha256:'5'.repeat(64)},djangoManifestSha256:'6'.repeat(64),chainStateSha256:'7'.repeat(64)};
  const dispatch={version:queueVersion,dispatchId,requestId:ticket.requestId,mode:'prepare-only',...generation,selectedTarget:target,selection:{targetCommit:target,packet,live},deadlineUnixMs:Date.now()-3600000,dispatchedAt:new Date().toISOString(),tickets:[{requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}]};
  const dispatchSha256=await durableCreate(path.join(queue,'dispatches',dispatchId+'.json'),dispatch);
  await durableCreate(path.join(queue,'results',ticket.requestId+'.json'),{version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'prepared',at:new Date().toISOString(),...generation,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:ticket.requestId,nativeResult:{status:'prepared-only',mainCommit:target,publicationPerformed:false,preparationFile:path.join(packet,'publish-'+target.slice(0,12),'preparation/PREPARED.json'),preparationSha256:'9'.repeat(64)}});
  await submitPreparation(queue,{...generation,origin:'manual'});
  const manifest=makeArtifactLossManifest(queue,await readPreparationQueueStructure(queue),[packet]),manifestSha256=sha(canonical(manifest)),bundleSha256='8'.repeat(64),bundleRoot=path.join(root,'control-bundles',bundleSha256),installId=randomUUID();await fs.mkdir(bundleRoot,{recursive:true});
  await durableCreate(path.join(bundleRoot,artifactLossManifestName),manifest);
  const bundleManifestSha256=await durableCreate(path.join(bundleRoot,'MANIFEST.json'),{version:'teruisi-main-control-bundle-v2',bundleSha256,files:{'tools/prepared-artifact-loss.mjs':sha(await fs.readFile(path.join(repository,'tools/prepared-artifact-loss.mjs')))},preparedArtifactLossProtocol:artifactLossProtocol,artifactLossManifestSha256:manifestSha256});
  const intentDirectory=path.join(root,'control-upgrades',installId);await fs.mkdir(intentDirectory,{recursive:true});const intentSha256=await durableCreate(path.join(intentDirectory,'INTENT.json'),{bundleSha256,bundleManifestSha256,artifactLossManifestSha256:manifestSha256});await fs.writeFile(path.join(root,'CONTROL-INSTALLATION.json'),JSON.stringify({status:'adopted',bundleRoot,bundleSha256,bundleManifestSha256,installId,intentSha256})+'\n');
  const originals=[];for(const leaf of ['tickets','dispatches','results'])for(const name of await fs.readdir(path.join(queue,leaf))){const file=path.join(queue,leaf,name);originals.push([file,await fs.readFile(file)]);}
  const unchanged=async()=>{for(const [file,raw] of originals)assert.deepEqual(await fs.readFile(file),raw);};
  const noWrites=async()=>{for(const leaf of ['artifact-losses','artifact-loss-results'])await assert.rejects(fs.access(path.join(queue,leaf)),{code:'ENOENT'});await unchanged();};
  const released=async()=>{for(const acquire of [acquireQueueLock,acquireQueueSubmissionLock]){const release=await acquire(queue);assert.equal(typeof release,'function','Queue/submission lock leaked');await release();}let entered=false;await rotation.withRotationLock(async()=>{entered=true;});assert.equal(entered,true,'Real native lock was not reacquired');};
  const inside=async()=>{stages++;assert.equal(await acquireQueueLock(queue),null);assert.equal(await acquireQueueSubmissionLock(queue),null);await nativeBusy();};
  const config={stateDirectory:root,nativeToolsSource},options={assertGeneration:async()=>assert.equal((await readArtifactLossControlBinding(queue)).manifestSha256,manifestSha256),admit:async()=>{},onStage:inside},run=extra=>retireLostMainArtifacts(config,{...options,...extra});
  let result;
  if(mode==='busy'){
   busyOwner=await listen(privatePipe);await assert.rejects(run(),/EADDRINUSE/);assert.equal(stages,0);await noWrites();
   for(const acquire of [acquireQueueLock,acquireQueueSubmissionLock]){const release=await acquire(queue);assert.equal(typeof release,'function');await release();}
   await close(busyOwner);busyOwner=null;result=await run();
  }else if(mode==='queue-busy'||mode==='submission-busy'){
   const release=await (mode==='queue-busy'?acquireQueueLock:acquireQueueSubmissionLock)(queue);await assert.rejects(run(),mode==='queue-busy'?/Queue busy/:/Queue submission busy/);assert.equal(mapped,0);assert.equal(stages,0);await noWrites();await release();result=await run();
  }else if(mode==='throw-before-write'||mode==='throw-after-record'){
   const failure=Error('private native callback failure'),at=mode==='throw-before-write'?'before-records':'after-record';await assert.rejects(run({onStage:async stage=>{await inside();if(stage===at)throw failure;}}),error=>error===failure);
   if(mode==='throw-before-write')await noWrites();else assert.equal((await fs.readdir(path.join(queue,'artifact-losses'))).length,1);
   await released();result=await run();
  }else if(mode==='generation'||mode==='admission'){
   const failure=Error('private admission/generation fence'),extra=mode==='admission'?{admit:async()=>{throw failure;}}:{assertGeneration:async()=>{throw failure;}};await assert.rejects(run(extra),error=>error===failure);assert.equal(mapped,0);assert.equal(stages,0);await noWrites();result=await run();
  }else if(mode==='old-call'){
   // Exact prior production call, against the same immutable deployed exports.
   await assert.rejects(async()=>rotation.acquirePreparationRotationLock(productionPipe),TypeError);assert.equal(mapped,0);await noWrites();result=await run();
  }else result=await run();
  assert.equal(result.status,'retired');assert.equal(result.preparationPerformed,false);assert.equal(result.publicationPerformed,false);assert.ok(stages>=3);await unchanged();
  const inventory=await readPreparationQueueInventory(queue);assert.equal(inventory.artifactLosses.size,1);assert.equal(inventory.tickets.filter(read=>!inventory.terminals.has(read.value.requestId)).length,1);await released();assert.equal(forwardedProduction,0);assert.ok(mapped>=2);await snapshot();
  console.log(JSON.stringify({mode,status:result.status,nativeExport:'withRotationLock',arity:rotation.withRotationLock.length,mappedNativeListens:mapped,forwardedProductionListens:forwardedProduction,stages,pendingUnchanged:true,allLocksReacquired:true}));
 }finally{if(busyOwner)await close(busyOwner);net.Server.prototype.listen=originalListen;await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
