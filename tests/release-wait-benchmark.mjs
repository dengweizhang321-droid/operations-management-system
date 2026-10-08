// A paired mechanism experiment, not a production latency promise. Uses real
// immutable build/hash checks, native pg_dump/pg_restore and a private HTTP
// fixture switch. The fixed production Worker ports are never touched.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { buildWorkerReleaseCandidate, workerPreparationIdentity, verifyPreparedWorkerCandidate, runProcess, windowsPathSha256, canonicalJson } from '../tools/worker-local-release.mjs';
import { d1ProofVersion, d1RetiredDomains, sealProof } from '../tools/d1-retirement-proof.mjs';

const sourceRoot=process.cwd(),root=path.resolve(process.argv[2]??'');
if(!root.startsWith('E:\\codex-artifacts\\release-wait-optimization-20261008\\release-wait-'))throw new Error('Require fresh isolated artifact path');
await mkdir(root,{recursive:false});
const python='D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe';
const pg=(action)=>runProcess(python,[path.join(sourceRoot,'tests','release-wait-pg-fixture.py'),action,root],{label:`isolated ${action}`,timeoutMs:180000});
const runtime=path.join(root,'worker'),persist=path.join(root,'persist'),devVars=path.join(root,'.dev.vars'),sourceD1=path.join(persist,'historical.sqlite');
await mkdir(persist);await writeFile(devVars,'# synthetic fixture, no production credentials\n');
const retirementProof=sealProof({version:d1ProofVersion,verifiedAt:new Date().toISOString(),runtimeRootPathSha256:windowsPathSha256(runtime),sourceD1PathSha256:windowsPathSha256(sourceD1),persistRootPathSha256:windowsPathSha256(persist),bootstrapAuthoritySha256:'a'.repeat(64),adoptionPredecessorManifestSha256:'b'.repeat(64),sourceSchemaSha256:'c'.repeat(64),postgresEvidenceSha256:'d'.repeat(64),retainedEvidenceSha256:'e'.repeat(64),domains:d1RetiredDomains.map(domain=>({domain,cutoverId:`${domain}-isolated-fixture`,migrationSha256:'1'.repeat(64),objectsSha256:'2'.repeat(64),receiptSha256:'3'.repeat(64),viewCount:domain==='finance'?0:1,guardCount:3}))},'proofSha256');
const stages={baseline:{},optimized:{}};
async function measure(mode,phase,fn){const start=performance.now();const value=await fn();stages[mode][phase]=(stages[mode][phase]??0)+performance.now()-start;await writeFile(path.join(root,'timing-partial.json'),JSON.stringify({stagesMs:stages,completed:false}));return value;}
let html='predecessor';let server;let port;
async function startServer(){server=createServer((_,res)=>res.end(html));await new Promise(r=>server.listen(port??0,'127.0.0.1',r));port=server.address().port;}
async function switchFixture(){await new Promise(r=>server.close(r));const stopped=performance.now();html='approved candidate';await startServer();return performance.now()-stopped;}
async function acceptance(){if(await(await fetch(`http://127.0.0.1:${port}`)).text()!=='approved candidate')throw new Error('Private HTTP acceptance failed');}
const verifyPredecessor=async()=>({status:'isolated-fixture-predecessor'});
let initialized=false;
try{
  await pg('init');initialized=true;await startServer();
  const beforeIdentity=await workerPreparationIdentity(sourceRoot,devVars);
  const baselineStart=performance.now();
  const built=await measure('baseline','prepare',()=>buildWorkerReleaseCandidate({sourceRoot,runtimeRoot:runtime,devVarsSource:devVars,persistRoot:persist,sourceD1Path:sourceD1,allowTestRuntimeRoot:true,retirementProof,verifyPreparationPredecessor:verifyPredecessor}));
  const afterIdentity=await workerPreparationIdentity(sourceRoot,devVars);
  if(canonicalJson(beforeIdentity)!==canonicalJson(afterIdentity))throw new Error('Source/config/toolchain changed during isolated build');
  await measure('baseline','backup-pre',()=>pg('backup'));await measure('baseline','restore-pre',()=>pg('restore'));
  const baselineWindow=await measure('baseline','switch',switchFixture);await measure('baseline','acceptance',acceptance);
  await measure('baseline','backup-post',()=>pg('backup'));await measure('baseline','restore-post',()=>pg('restore'));
  await measure('baseline','closeout',()=>acceptance());const baselineTotal=performance.now()-baselineStart;
  // The exact build above is the new workflow's pre-approval prepared package.
  // No second install/build is hidden in the optimized approval interval.
  html='predecessor';const optimizedStart=performance.now();
  await measure('optimized','prepare',async()=>{
    const fresh=await workerPreparationIdentity(sourceRoot,devVars);
    if(canonicalJson(fresh)!==canonicalJson(beforeIdentity))throw new Error('Prepared identity invalidated');
    await verifyPreparedWorkerCandidate({manifestPath:built.manifestPath,approvedManifestSha256:built.manifestSha256,
      expectedSourceD1PathSha256:windowsPathSha256(sourceD1),expectedPersistRootPathSha256:windowsPathSha256(persist),allowTestRuntimeRoot:true,requireSalesRetiredCodeReceipt:true},verifyPredecessor);
  });
  await measure('optimized','recovery-revalidation',async()=>{
    const state=JSON.parse(await readFile(path.join(root,'fixture-private.json')));
    const {createHash}=await import('node:crypto');
    if(createHash('sha256').update(await readFile(path.join(root,'point.dump'))).digest('hex')!==state.dumpSha256)throw new Error('Recovery point changed');
  });
  const optimizedWindow=await measure('optimized','switch',switchFixture);await measure('optimized','acceptance',acceptance);await measure('optimized','closeout',acceptance);
  const optimizedTotal=performance.now()-optimizedStart;
  const report={version:'teruisi-release-wait-isolated-pair-v1',productionOperations:false,conditions:{sameSource:true,sameDependencies:true,sameToolchain:true,sameConfiguration:true,sameCandidate:true,sameFixtureRows:5000,sameAcceptance:true,runs:1,serializedHeavyOperations:true},
    candidate:built,sourceIdentity:beforeIdentity,stagesMs:stages,totalAfterSyntheticApprovalMs:{baseline:baselineTotal,optimized:optimizedTotal},preapprovalWorkMs:stages.baseline.prepare,
    privateHttpSwitchWindowMs:{baseline:baselineWindow,optimized:optimizedWindow},
    limits:['Synthetic recovery catalogue/schedule evidence; not production fast-path admission','Private HTTP fixture switch, not real fixed-port Worker/Django downtime','Small synthetic database; not production backup size or throughput','One paired mechanism observation; build from baseline reused as optimized prepared package; no stable speed or SLA claim']};
  await writeFile(path.join(root,'timing.json'),`${canonicalJson(report)}\n`);console.log(JSON.stringify({status:'passed',timingPath:path.join(root,'timing.json'),totalMs:report.totalAfterSyntheticApprovalMs,privateSwitchWindowMs:report.privateHttpSwitchWindowMs}));
}finally{if(server)await new Promise(r=>server.close(r));if(initialized)await pg('close');}
