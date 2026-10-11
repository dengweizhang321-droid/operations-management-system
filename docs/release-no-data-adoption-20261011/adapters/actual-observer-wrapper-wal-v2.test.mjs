import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
const evidence='E:/codex-artifacts/release-no-data-adoption-20261011';
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T051645Z-3032ae332a32f1a0';
const tools=path.join(candidate,'tools'),sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.equal(sha(await readFile(path.join(candidate,'deployment-manifest.json'))),'58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f');
const impact=await import(pathToFileURL(path.join(tools,'release-impact.mjs')));
const realBatch=await import(pathToFileURL(path.join(tools,'release-batch.mjs')));
const worker=await import(pathToFileURL(path.join(tools,'worker-local-release.mjs')));
const retry=await import(pathToFileURL(path.join(tools,'release-readonly-retry.mjs')));
const observerPath=path.join(tools,'release-no-data-observation.mjs'),raw=await readFile(observerPath,'utf8');
const rawSourceHash=sha(Buffer.from(raw));
// Load the original full observer source (including perform), removing only
// static imports/exports and replacing dynamic import with the bounded loader.
const transformed=raw.split(/\r?\n/).filter(line=>!line.startsWith('import ')).join('\n').replace(/^export /gm,'').replaceAll('import.meta.url','moduleURL').replaceAll('await import(','await loadModule(');
const cases=[];
for(const bad of [false,true])test(`actual permission performer and wrapper: ${bad?'wrong401body':'successful401'} evidence leaves WAL readable`,async()=>{
 const privateRoot=await mkdtemp(path.join(evidence,'observer-wrapper-private-'));
 const runtime=path.join(privateRoot,'worker'),journals=path.join(privateRoot,'journals'),django=path.join(privateRoot,'django-deployment.json');
 const planRaw=Buffer.from(JSON.stringify({candidate:{releaseId:'private-fixture-release'}})),manifestRaw=Buffer.from('{"privateFixture":true}\n'),djangoRaw=Buffer.from('{"privateDjangoFixture":true}\n');
 const planSha=impact.hash(planRaw),artifactSha=impact.hash(manifestRaw),batch={id:'observer-private-'+randomUUID(),batchSha256:'a'.repeat(64),binding:{workerPlanSha256:planSha,artifactSha256:artifactSha,djangoCandidateSha256:impact.hash(djangoRaw)}};
 await mkdir(path.join(runtime,'state','worker-release-rotation-plans'),{recursive:true});await mkdir(path.join(runtime,'releases','private-fixture-release'),{recursive:true});
 await writeFile(path.join(runtime,'state','worker-release-rotation-plans',planSha+'.json'),planRaw,{flag:'wx'});await writeFile(path.join(runtime,'releases','private-fixture-release','deployment-manifest.json'),manifestRaw,{flag:'wx'});await writeFile(django,djangoRaw,{flag:'wx'});
 const urls=new Map([['http://127.0.0.1:8071/api/customer-service/conversations','/api/customer-service/conversations'],['http://127.0.0.1:8101/api/access-control/users','/api/access-control/users']]);
 const calls=[],served=[];
 const server=http.createServer((req,res)=>{served.push({method:req.method,path:req.url});assert.equal(req.method,'GET');assert.ok([...urls.values()].includes(req.url));res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({code:bad?'wrong_private_fixture_code':'authentication_required'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const safeRead=async p=>{if(p==='D:\\teruisi-runtime\\django-sales\\app\\deployment.json')return impact.safeRead(django);const absolute=path.resolve(p);assert.ok(absolute.startsWith(path.resolve(privateRoot)+path.sep),'Only private fixture reads allowed');return impact.safeRead(absolute);};
 const context={assert,path,randomUUID,fileURLToPath,moduleURL:pathToFileURL(observerPath).href,hash:impact.hash,safeRead,safeFileDigest:()=>{throw Error('Unexpected executable read');},requireHash:impact.requireHash,canonical:impact.canonical,components:retry.readinessComponents,Buffer,Date,AbortSignal,URL,setTimeout,
  loadModule:async name=>{if(name==='./release-batch.mjs')return realBatch;if(name==='./worker-local-release.mjs')return{workerRuntimeRoot:runtime,hashTree:worker.hashTree};throw Error('Unapproved module: '+name);},
  fetch:async(url,options)=>{assert.ok(urls.has(url),'No production/arbitrary request allowed');assert.equal(options.redirect,'manual');assert.equal(options.method,undefined);calls.push(url);return fetch(`http://127.0.0.1:${server.address().port}${urls.get(url)}`,options);}};
 const run=new Function(...Object.keys(context),transformed+';return runNoDataObservation;')(...Object.values(context));
 const state=await realBatch.journalState(journals,batch),core={batchSha256:batch.batchSha256,previous:null,at:new Date().toISOString(),phase:'acceptance',operationId:'prior-private-step',status:'passed'},event={...core,eventSha256:impact.hash(core)};
 const wal=path.join(state.dir,'000000.json');await realBatch.writeOnce(wal,event);const originalWal=await readFile(wal);
 const op={id:'permission-observation',phase:'acceptance',kind:'no-data-observation',mutating:false,observation:{action:'permissions'},covers:['permissions']};
 try {
  let result;if(bad)await assert.rejects(run(op,{batch,state}),e=>e.processEvidence?.code==='no-data-observation-failed');else result=await run(op,{batch,state});
  const dirs=await readdir(path.join(journals,'_observations'));assert.equal(dirs.length,1);const stored=path.join(journals,'_observations',dirs[0]);
  assert.equal(path.dirname(stored),path.join(journals,'_observations'));assert.notEqual(path.dirname(stored),state.dir);
  const started=JSON.parse(await readFile(path.join(stored,'started.json'),'utf8'));assert.equal(started.batchSha256,batch.batchSha256);assert.equal(started.operationId,op.id);
  const leaf=bad?'failure.json':'result.json',receipt=JSON.parse(await readFile(path.join(stored,leaf),'utf8'));
  assert.equal(receipt.status,bad?'failed':'passed');assert.deepEqual((await readdir(stored)).sort(),[leaf,'started.json'].sort());
  if(!bad){assert.equal(result.status,'passed');assert.equal(result.receiptSha256,impact.hash(receipt));assert.equal(result.outputs.observationDirectory,stored);assert.equal(receipt.observation.observations.length,2);assert.deepEqual(receipt.observation.observations.map(v=>v.status),[401,401]);}
  const next=await realBatch.journalState(journals,batch);assert.equal(next.events.length,1);assert.equal(next.previous,event.eventSha256);assert.deepEqual(await readFile(wal),originalWal);
  assert.equal(calls.length,bad?1:2);assert.equal(served.length,calls.length);
  cases.push({case:bad?'wrong401body':'successful401',privateRoot,observationDirectory:stored,receiptSha256:sha(await readFile(path.join(stored,leaf))),walSha256:sha(originalWal),actualLoopbackRequests:served.length,productionRequests:0,walEventsAfter:next.events.length});
 } finally {await new Promise(resolve=>server.close(resolve));server.closeAllConnections();}
});
after(async()=>{
 assert.equal(cases.length,2,'Both actual permission paths must complete their assertions');
 assert.equal(sha(await readFile(observerPath)),rawSourceHash);
 const modules={};for(const name of ['release-no-data-observation.mjs','release-batch.mjs','release-impact.mjs','worker-local-release.mjs','release-readonly-retry.mjs'])modules[name]=sha(await readFile(path.join(tools,name)));
 await writeFile(path.join(evidence,'ACTUAL_OBSERVER_WRAPPER_WAL_RESULT_V2.json'),JSON.stringify({version:'actual-observer-wrapper-wal-test-v1',candidateManifestSha256:'58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f',rawSourceHash,transformedSourceHash:sha(Buffer.from(transformed)),modules,loader:'NewFunction same realm; first VM harness failed array-prototype identity before any fetch, first files/log retained. Assertions unchanged.',sourceTransform:'Removed static imports/export tokens; import.meta.url becomes exact original moduleURL; dynamic await import becomes bounded loadModule. Original wrapper and complete performer unmodified.',injection:'Actual final-candidate writeOnce/journalState/hash/validators; private workerRuntimeRoot, exact Django deployment safeRead mapping; only two fixed permission URLs remapped to isolated HTTP401 loopback. Every other fetch/read/module denied.',fixtureLimit:'Fixture plan is only for this handler internal SHA binding, not a typed production plan, complete admission or production permission acceptance.',cases},null,2)+'\n',{flag:'wx'});
});
