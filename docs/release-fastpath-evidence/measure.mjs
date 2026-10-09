// Isolated, sequential content/identity and native-process measurements.
// Does not call production lifecycle, backups, apply or business APIs.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { readSourceTree, safeRead, sourceTreeDigest, sourceInventory, hash, canonical, classifyImpact, backupReuseDecision } from '../../tools/release-impact.mjs';
import { workerPreparationIdentity, resolveBundledNpmToolchain, hashTree, runProcess } from '../../tools/worker-local-release.mjs';
import { createPreparationEvidenceSession } from '../../tools/release-preparation-evidence.mjs';
import { admissionTimer } from '../../tools/release-admission-timing.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const output=path.resolve(process.argv[2]??path.join(root,'docs','release-fastpath-evidence','timing.json'));
const scratch=await mkdtemp(path.join(tmpdir(),'teruisi-fastpath-measure-'));
const source=path.join(scratch,'source'),runtime=path.join(scratch,'runtime.vars');
const result={version:1,scope:'isolated content/derived-identity and private native-process fixtures; not production release time',startedAt:new Date().toISOString(),completed:false,stages:[],samples:[]};
const children=new Set();let session=null;
try {
  const files=await readSourceTree(root);
  for(const [name,value] of Object.entries(files)) {
    const target=path.join(source,...name.split('/'));await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,value.startsWith('\u0000binary:')?Buffer.from(value.slice(8),'base64'):value);
  }
  await writeFile(runtime,'TERUISI_RUNTIME_ENV=development\nSYNTHETIC_RELEASE_MEASUREMENT=1\n');
  await runProcess('git.exe',['init',source],{label:'private source fixture'});
  await runProcess('git.exe',['-C',source,'add','--force','--all'],{label:'freeze complete private source inventory'});
  result.sourceSha256=sourceTreeDigest(files);result.sourceInventorySha256=hash(sourceInventory(files));result.fileCount=Object.keys(files).length;
  const timed=async(stage,action)=>{const start=performance.now();const value=await action();result.stages.push({stage,durationMs:performance.now()-start});return value;};
  const classification=await timed('classification',async()=>classifyImpact({before:files,after:{...files,'README.md':files['README.md']+'\n'}}));
  result.classification=classification.level;
  const ordered=Object.keys(files).sort();
  await timed('source-content-sequential',async()=>{const read={};for(const name of ordered)read[name]=hash(await safeRead(path.join(source,...name.split('/'))));if(hash(read)!==result.sourceInventorySha256)throw Error('Sequential source content differs');});
  await timed('source-content-bounded',async()=>{const read=await readSourceTree(source);if(hash(sourceInventory(read))!==result.sourceInventorySha256)throw Error('Bounded source content differs');});
  await timed('toolchain-content-and-version',()=>resolveBundledNpmToolchain());
  const artifact=await timed('build-and-dependencies-content',async()=>({dist:await hashTree(path.join(root,'dist')),dependencies:await hashTree(path.join(root,'node_modules'))}));
  result.buildPayloadSha256=hash(artifact);result.buildPayload=artifact;
  // Each path sees the same frozen source, actual Node/npm, synthetic runtime,
  // environment and artifact. Two paired runs reverse order to expose cache
  // warming; these measurements isolate identity, not full admission.
  const phases=['admission','prepare','closeout'];result.identityPhases=phases;
  for(const order of [['baseline','optimized'],['optimized','baseline']]) {
    for(const mode of order) {
      const timer=admissionTimer(),start=performance.now();let identity;
      session=mode==='optimized'?createPreparationEvidenceSession({batchSha256:hash({source:result.sourceSha256,buildPayload:result.buildPayloadSha256}),sourceRoot:source,devVarsSource:runtime}):null;
      const fulls=new Set(['admission','drain','apply','start','closeout']);
      for(const phase of phases) {
        if(session) {
          identity=await session.collect({approvedBatchSha256:hash({source:result.sourceSha256,buildPayload:result.buildPayloadSha256}),full:fulls.has(phase),measure:timer.measure});
          await session.recheck({measure:timer.measure});session.assertStable();
        } else {
          const before=await timer.measure('full-preparation-identity','mutable-input',()=>workerPreparationIdentity(source,runtime));
          identity=await timer.measure('full-preparation-identity','mutable-input',()=>workerPreparationIdentity(source,runtime));
          if(canonical(before)!==canonical(identity))throw Error('Baseline fixture input changed');
        }
        if(identity.sourceTree.sha256!==result.sourceSha256)throw Error('Measurement source changed');
      }
      result.samples.push({mode,durationMs:performance.now()-start,identitySha256:hash(identity),stages:timer.result()});
      console.log(canonical({stage:'identity-pair',mode,durationMs:result.samples.at(-1).durationMs}));
      session?.dispose();session=null;
    }
  }
  const childScript=path.join(scratch,'private-service.mjs');
  await writeFile(childScript,`import {createServer} from 'node:http';const server=createServer((q,r)=>{r.end(process.argv[2])});server.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port,role:process.argv[2]}));process.on('message',()=>server.close(()=>process.exit(0)));`);
  async function launch(role) {
    const child=spawn(process.execPath,[childScript,role],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});children.add(child);
    const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Private process readiness timeout')),5000);child.once('message',value=>{clearTimeout(timeout);resolve(value);});child.once('error',reject);});
    return {child,ready};
  }
  async function stop(service) {
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Private process cleanup timeout')),5000);service.child.once('exit',code=>{clearTimeout(timeout);if(code===0)resolve();else reject(Error('Private process nonzero exit'));});service.child.send('stop');});children.delete(service.child);
  }
  result.switchSamples=[];
  for(const mode of ['full-fixture','worker-only-fixture','worker-only-fixture','full-fixture']) {
    let backend=await launch('backend'),worker=await launch(result.buildPayloadSha256);const originalBackend=backend.ready.pid;const start=performance.now();
    await stop(worker);if(mode==='full-fixture'){await stop(backend);backend=await launch('backend');}worker=await launch(result.buildPayloadSha256);
    const response=await fetch(`http://127.0.0.1:${worker.ready.port}/`);if(await response.text()!==result.buildPayloadSha256)throw Error('Private candidate mismatch');
    result.switchSamples.push({mode,durationMs:performance.now()-start,backendPreserved:backend.ready.pid===originalBackend});
    await stop(worker);await stop(backend);
  }
  await timed('recovery-eligibility-fixture',async()=>backupReuseDecision({impact:{level:'display'},evidence:null,current:null}));
  result.completed=true;result.completedAt=new Date().toISOString();
} finally {
  session?.dispose();let cleanupPassed=true;
  for(const child of children) {
    if(child.exitCode!==null)continue;
    const exited=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),5000);child.once('exit',()=>{clearTimeout(timer);resolve(true);});child.kill();});
    if(!exited)cleanupPassed=false;
  }
  const canonicalScratch=path.resolve(scratch),tempRoot=path.resolve(tmpdir());
  if(path.dirname(canonicalScratch)!==tempRoot||!path.basename(canonicalScratch).startsWith('teruisi-fastpath-measure-'))throw Error('Unsafe fixture cleanup');
  if(cleanupPassed)await rm(canonicalScratch,{recursive:true,force:true});
  else {result.completed=false;result.retainedScratch=canonicalScratch;}
  result.isolatedCleanup=cleanupPassed?'passed':'unknown';await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
}
console.log(canonical({completed:result.completed,sourceSha256:result.sourceSha256,buildPayloadSha256:result.buildPayloadSha256,samples:result.samples.map(({mode,durationMs})=>({mode,durationMs})),switchSamples:result.switchSamples}));
