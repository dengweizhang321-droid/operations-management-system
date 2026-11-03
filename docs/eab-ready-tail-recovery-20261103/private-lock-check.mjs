/** Child-only: actual fixed exports; the sole transport replacement is net.listen. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {withQueueRotation} from './recover-ready-tail.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),r=JSON.parse(await fs.readFile(new URL('./EVIDENCE.json',import.meta.url),'utf8'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'eab-lock-private-')),native=path.join(root,'native'),productionPipe='\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',privatePipe='\\\\.\\pipe\\TERUISI.Test.EabTail.'+randomUUID();
let forwardedProduction=0,mapped=0,held;
const originalListen=net.Server.prototype.listen;
try{
 await fs.mkdir(path.join(native,'tools'),{recursive:true});
 for(const leaf of ['worker-local-release-rotation.mjs','worker-local-release.mjs','d1-retirement-proof.mjs']){const source=path.join(r.nativeRoot,'tools',leaf),pin=r.codePins.find(x=>path.resolve(x.path)===path.resolve(source));assert.ok(pin);const b=await fs.readFile(source);assert.equal(sha(b),pin.sha256);await fs.writeFile(path.join(native,'tools',leaf),b,{flag:'wx'});}
 // Fixed bundle files are read-only; private binding below prevents registry access.
 for(const pin of r.codePins.filter(x=>path.resolve(x.path).startsWith(path.resolve(r.bundleRoot)+path.sep)))assert.equal(sha(await fs.readFile(pin.path)),pin.sha256);
 const publisher=await import(pathToFileURL(path.join(r.bundleRoot,'tools/publish-latest-main.mjs'))),queue=await import(pathToFileURL(path.join(r.bundleRoot,'tools/main-prebuild-queue.mjs'))),rotation=await import(pathToFileURL(path.join(native,'tools/worker-local-release-rotation.mjs')));
 assert.equal(rotation.withRotationLock.length,1);const binding={config:{stateDirectory:root}},queueRoot=path.join(root,'prebuild-queue-v2'),allowed=new Set([queue.queuePipe(queueRoot),privatePipe]);
 net.Server.prototype.listen=function(...args){const requested=args[0];assert.equal(typeof requested,'string');if(requested===productionPipe){mapped++;args[0]=privatePipe;}else assert.ok(allowed.has(requested),'Unknown private test transport: '+requested);if(args[0]===productionPipe)forwardedProduction++;assert.notEqual(args[0],productionPipe);return Reflect.apply(originalListen,this,args);};
 const listen=p=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(p,()=>resolve(server));}),close=s=>new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));
 const options={assertGeneration:async()=>{}},run=f=>withQueueRotation(binding,publisher,rotation,f,options);
 let entered=0;
 const callback=async()=>{entered++;assert.equal(await queue.acquireQueueLock(queueRoot),null);await assert.rejects(listen(privatePipe),{code:'EADDRINUSE'});};
 await run(callback);
 const queueRelease=await queue.acquireQueueLock(queueRoot);await assert.rejects(run(callback),/准备队列正在处理/);await queueRelease();assert.equal(entered,1);
 held=await listen(privatePipe);await assert.rejects(run(callback),/EADDRINUSE/);assert.equal(entered,1);await close(held);held=null;
 const release=await queue.acquireQueueLock(queueRoot);assert.equal(typeof release,'function','Queue leaked on native busy');await release();
 await assert.rejects(run(async()=>{await callback();throw Error('private callback');}),/private callback/);
 await run(callback);const after=await queue.acquireQueueLock(queueRoot);assert.equal(typeof after,'function');await after();await rotation.withRotationLock(async()=>{});
 assert.ok(mapped>=5);assert.equal(forwardedProduction,0);
 const source=path.join(root,'consumer-source'),workerRoot=path.join(root,'consumer-worker'),stateDirectory=path.join(root,'consumer-state'),djangoRoot=path.join(root,'consumer-django');await fs.mkdir(source);await fs.mkdir(stateDirectory);await fs.mkdir(djangoRoot);
 const git=args=>execFileSync('git',['-C',source,...args],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();git(['init','-q']);await fs.writeFile(path.join(source,'sample.txt'),'private consumer source\n');await fs.writeFile(path.join(source,'package.json'),'{"name":"private-consumer","version":"1.0.0"}\n');await fs.writeFile(path.join(source,'package-lock.json'),'{"name":"private-consumer","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');git(['add','.']);git(['-c','user.name=Codex','-c','user.email=codex@example.invalid','commit','-qm','private consumer fixture']);const commit=git(['rev-parse','HEAD']);
 const api=await import(pathToFileURL(path.join(native,'tools/worker-local-release.mjs'))),tree=await api.hashRelativeFiles(source,await api.listGitSourceFiles(source));
 const consumerRelease='private-release',manifestFile=path.join(workerRoot,'releases',consumerRelease,'deployment-manifest.json');await fs.mkdir(path.dirname(manifestFile),{recursive:true});const manifestRaw=JSON.stringify({source:{tree}})+'\n';await fs.writeFile(manifestFile,manifestRaw);
 const djangoRaw=Buffer.from(JSON.stringify({sourceRoot:source})),head={releaseId:consumerRelease,manifestSha256:sha(manifestRaw)},receiptPath=path.join(stateDirectory,'RECOVERED-SUCCESS.json');
 const receipt={status:'deployed_and_ready',mainCommit:commit,workerRelease:consumerRelease,workerManifestSha256:head.manifestSha256,djangoManifestSha256:sha(djangoRaw),manualRecovery:true,automatedPublisherSuccess:false,publicationPerformed:false,applicationActionsPerformed:[]},receiptRaw=JSON.stringify(receipt)+'\n';await fs.writeFile(receiptPath,receiptRaw);await fs.writeFile(path.join(stateDirectory,'PUBLISHED-MAIN.json'),JSON.stringify({...receipt,source,sourceTree:tree,receiptPath,receiptSha256:sha(receiptRaw)})+'\n');
 const accepted=await publisher.readLivePublication({stateDirectory},{loadApi:async()=>({workerRuntimeRoot:workerRoot,listGitSourceFiles:api.listGitSourceFiles,hashRelativeFiles:api.hashRelativeFiles}),loadRotation:async()=>({resolveEffectiveReleaseChain:async()=>({head,chainStateSha256:'private-chain'})}),readDjango:async()=>djangoRaw,runtimeRoot:djangoRoot,fetchReady:async()=>new Response(JSON.stringify({ok:true,status:'ready'}),{status:200})});assert.equal(accepted.completedReceiptPath,receiptPath);assert.equal(accepted.mainCommit,commit);assert.equal(accepted.resolvedOriginalAttempt,true);
 console.log(JSON.stringify({rotationArity:rotation.withRotationLock.length,mappedNativeListens:mapped,forwardedProduction,callbacks:entered,allReleased:true,fixedConsumerAccepted:true}));
}finally{if(held)await new Promise(resolve=>held.close(resolve));net.Server.prototype.listen=originalListen;await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:30});}
