/** Validate original private-native receipts. Never starts a service or grants publication. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {assertNoReparsePoint,hashTree,hashRelativeFilesWithInventory,listGitSourceFiles,windowsPathSha256} from './worker-local-release.mjs';

export const nativeControlApplication=Object.freeze({
 commit:'b7280770fa5ff81e3939d6516f021c9f50b496a3',tree:'0428e06fd80a20b808bb3ee5be0ce65f06b131dd',
 evidenceSha256:'e50774004ea98e01c9fdd3813c316e8159b19ab74c1ee701ac120a7d7cfa7114',
 evidencePath:'D:/codex-artifacts/ai-native-control-isolation-20261108/NATIVE-LIFECYCLE-EVIDENCE.json',
 helperBeforeSha256:'2efe6738d9c0d963ad6d2dbc45584d702511889339b38fc82d8250f79db478c1',
 helperAfterSha256:'a5499003d2e269b8a3d6cdb6bce70fcd2f02434c541620ccdaa151f0c7f52343',
 typeScriptVersion:'5.9.3',
 typeScriptTree:Object.freeze({algorithm:'sha256-ordinal-path-length-content-v1',fileCount:132,sha256:'5c4c3948060056c3cc4ce57222e7957ccef438c108791352af19c666a4c2a1a9'}),
});
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const normalized=value=>path.win32.normalize(value).toLowerCase();
const hex=/^[a-f0-9]{64}$/;
const services=[...['sales','finance','netshop','market','products','inventory','workflow','customer_service','erp_reference','access_control','ai']
 .flatMap(domain=>['reader','writer'].map(role=>domain+'.'+role)),'bi.reader'].sort();
const forbiddenNames=/OPENAI|ANTHROPIC|DEEPSEEK|DINGTALK|CLOUDFLARE_API|DATABASE_URL|LIBRARY_ONLY/i;
const noTestBypass=value=>assert.ok(!/-AllowTestRuntimeRoot|--allow-test-runtime-root|-FunctionsOnly|LIBRARY_ONLY/i.test(value),'Synthetic lifecycle bypass is forbidden');
function lastJson(raw){
 for(const line of raw.toString('utf8').trim().split(/\r?\n/).reverse())if(line.trim().startsWith('{'))return JSON.parse(line);
 assert.fail('Original native JSON completion is missing');
}
async function bounded(file,maximum=8*1024*1024){
 const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=maximum,'Evidence must be a bounded ordinary file');
 const raw=await fs.readFile(file);assert.equal(raw.length,stat.size);return raw;
}
function sourceFile(root,relative){
 assert.ok(!path.posix.isAbsolute(relative)&&!relative.split('/').includes('..'));
 return path.join(root,...relative.split('/'));
}

export async function bindNativeTypeScript({dependencies,sourceRoot}={}){
 assert.ok(dependencies,'Native compatibility checks require an explicit dependency root');
 const proofRaw=await bounded(nativeControlApplication.evidencePath,128*1024);
 assert.equal(sha(proofRaw),nativeControlApplication.evidenceSha256);
 const proof=JSON.parse(proofRaw);
 assert.equal(normalized(proof.runtimeRoot),normalized('D:/codex-isolated/native-control-ai-20261108'));
 assert.match(proof.releaseId,/^\d{8}T\d{6}Z-[a-f0-9]{16}$/);
 const release=path.join(proof.runtimeRoot,'worker','releases',proof.releaseId);
 const rawManifest=await bounded(path.join(release,'deployment-manifest.json'));
 assert.equal(sha(rawManifest),proof.manifestSha256,'Native dependency origin manifest changed');
 const manifest=JSON.parse(rawManifest),lockRaw=await fs.readFile(path.join(sourceRoot,'package-lock.json'));
 assert.equal(sha(lockRaw),manifest.source.packageLockSha256,'Check dependencies belong to a different lock');
 const lock=JSON.parse(lockRaw),physicalRoot=await fs.realpath(path.join(dependencies,'typescript'));
 const nativePackageRoot=path.join(release,'node_modules','typescript');
 await assertNoReparsePoint(nativePackageRoot,{label:'private native TypeScript package'});
 const packageJson=JSON.parse(await bounded(path.join(physicalRoot,'package.json'),65536));
 assert.equal(packageJson.name,'typescript');assert.equal(packageJson.version,lock.packages['node_modules/typescript'].version);
 assert.equal(packageJson.version,nativeControlApplication.typeScriptVersion);
 assert.equal(Object.keys(packageJson.dependencies??{}).length,0,'Unexpected transitive TypeScript check dependency');
 const [tree,nativeTree]=await Promise.all([hashTree(physicalRoot),hashTree(nativePackageRoot)]);
 assert.deepEqual(tree,nativeTree,'TypeScript check bytes differ from the native verified package');
 assert.deepEqual(tree,nativeControlApplication.typeScriptTree,'TypeScript check package is outside its reviewed exact byte qualification');
 return {scope:'typescript-package-only',physicalRoot,tree,version:packageJson.version,nativePackageRoot,
  nativeManifestSha256:proof.manifestSha256,packageLockSha256:sha(lockRaw)};
}

export async function verifyNativeControlEvidence({applicationRoot,candidateRoot,evidenceFile=nativeControlApplication.evidencePath}={}){
 assert.ok(applicationRoot&&candidateRoot,'Both frozen application and candidate roots are required');
 const q=nativeControlApplication;
 const evidenceRaw=await bounded(evidenceFile,128*1024);assert.equal(sha(evidenceRaw),q.evidenceSha256,'Native evidence anchor changed');
 const proof=JSON.parse(evidenceRaw);assert.equal(proof.version,'teruisi-native-isolation-evidence-v1');
 assert.equal(proof.applicationCommit,q.commit);assert.equal(proof.applicationTree,q.tree);
 assert.equal(proof.syntheticHistoricalPreconditions,true);assert.equal(proof.historicalMigrationExecuted,false);
 assert.equal(proof.formalArtifacts,false);assert.equal(proof.publicationPerformed,false);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:applicationRoot,windowsHide:true}).toString().trim(),q.commit);
 assert.equal(execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:applicationRoot,windowsHide:true}).toString().trim(),q.tree);
 const directory=path.dirname(path.resolve(evidenceFile));assert.equal((await fs.realpath(directory)).toLowerCase(),directory.toLowerCase());
 const contents=new Map();
 assert.ok(Array.isArray(proof.members)&&proof.members.length<=100);
 for(const member of proof.members){
  assert.match(member.path,/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/);assert.ok(!contents.has(member.path));assert.match(member.sha256,hex);
  const raw=await bounded(path.join(directory,member.path));assert.equal(raw.length,member.bytes);assert.equal(sha(raw),member.sha256,'Original evidence changed: '+member.path);contents.set(member.path,raw);
 }
 const bytes=name=>{assert.ok(contents.has(name),'Missing required original: '+name);return contents.get(name);};
 const json=name=>JSON.parse(bytes(name));
 const log=name=>lastJson(bytes(name));
 const profile=json('PROVEN-ISOLATION-PROFILE.json');
 assert.equal(profile.version,1);assert.equal(profile.id,'ai-20261108');assert.equal(profile.root,proof.runtimeRoot);
 assert.equal(normalized(profile.root),normalized('D:/codex-isolated/native-control-ai-20261108'));
 assert.equal(profile.wslDistribution,'Codex-AI-Batch2-20261108');
 const profileSha=sha(bytes('PROVEN-ISOLATION-PROFILE.json'));
 const manifest=json('PROVEN-WORKER-MANIFEST.json');assert.equal(sha(bytes('PROVEN-WORKER-MANIFEST.json')),proof.manifestSha256);
 assert.equal(manifest.releaseId,proof.releaseId);assert.equal(manifest.runtime.nativeIsolationSha256,profileSha);
 assert.equal(manifest.runtime.port,23000);assert.equal(manifest.runtime.helperPort,25791);
 assert.equal(manifest.runtime.runtimeRootPathSha256,windowsPathSha256(path.win32.join(profile.root,'worker')));
 const inventory=await hashRelativeFilesWithInventory(applicationRoot,await listGitSourceFiles(applicationRoot));
 assert.deepEqual(inventory.tree,manifest.source.tree,'Native package was not built from the frozen Git materialization');
 assert.equal(inventory.tree.sha256,manifest.source.sourceFingerprint);
 // The current candidate changes only the separately qualified denial of an
 // unused credential action. Do not claim the sealed native package contains it.
 const before=await fs.readFile(path.join(applicationRoot,'tools/native-isolation.ps1'));
 const after=await fs.readFile(path.join(candidateRoot,'tools/native-isolation.ps1'));
 assert.equal(sha(before),q.helperBeforeSha256);assert.equal(sha(after),q.helperAfterSha256);
 const token="'Configure','ConfigureCredentials','ProvisionRoles'";
 assert.equal(before.toString('utf8').split(token).length,2);
 assert.deepEqual(after,Buffer.from(before.toString('utf8').replace(token,"'Configure','ProvisionRoles'")));
 const frozen=json('FROZEN-BYTE-BINDING.json');assert.equal(frozen.applicationCommit,q.commit);
 assert.equal(frozen.djangoDeploymentManifestSha256,sha(bytes('PROVEN-DJANGO-MANIFEST.json')));
 const seen=new Set();
 for(const row of frozen.djangoDeployedSourceFiles){
  assert.match(row.path,/^(backend|tools|config|drizzle)\//);assert.ok(!seen.has(row.path));seen.add(row.path);
  assert.equal(sha(await fs.readFile(sourceFile(applicationRoot,row.path))),row.sha256,'Deployed Django source differs from frozen application: '+row.path);
 }
 assert.equal(seen.size,frozen.djangoDeployedSourceFileCount);assert.equal(seen.size,1655);
 const runner=json('WSL-INSTALL.json');
 for(const [relative,digest] of Object.entries(runner.manifest))assert.equal(sha(await fs.readFile(sourceFile(applicationRoot,relative))),digest,'Runner source changed');
 const readCommand=(label,exitCode=0)=>{
  const record=json(label+'.json');assert.equal(record.label,label);assert.equal(record.exitCode,exitCode,'Native command did not complete: '+label);
  assert.equal(sha(bytes(label+'.stdout.log')),record.stdoutSha256);assert.equal(sha(bytes(label+'.stderr.log')),record.stderrSha256);
  assert.ok(record.elapsedSeconds>=0&&record.elapsedSeconds<1800);
  if(record.environmentNames){assert.ok(record.environmentNames.includes('TERUISI_NATIVE_ISOLATION_FILE')&&record.environmentNames.includes('TERUISI_NATIVE_ISOLATION_SHA256'));assert.ok(record.environmentNames.every(name=>!forbiddenNames.test(name)));}
  if(record.arguments)noTestBypass(record.arguments.join(' '));
  return {record,payload:log(label+'.stdout.log')};
 };
 const plan=readCommand('adoption-plan-03').payload,adoption=readCommand('adoption-apply-01').payload;
 assert.equal(plan.status,'planned');assert.equal(adoption.status,'activated');assert.equal(plan.planSha256,proof.adoptionPlanSha256);
 assert.equal(adoption.planSha256,plan.planSha256);assert.equal(adoption.manifestSha256,proof.manifestSha256);
 assert.equal(plan.candidateManifestSha256,proof.manifestSha256);assert.equal(sha(bytes('PROVEN-ADOPTION-PLAN.json')),plan.planSha256);
 assert.equal(sha(bytes('PROVEN-ADOPTION-CONSUMPTION.json')),adoption.consumptionSha256);
 const consumption=json('PROVEN-ADOPTION-CONSUMPTION.json');assert.equal(consumption.status,'activated');
 assert.equal(consumption.approvedPlanSha256,plan.planSha256);assert.equal(consumption.startupBinding.status,'verified');
 assert.equal(consumption.startupBinding.manifestSha256,proof.manifestSha256);assert.equal(consumption.startupBinding.bindingSha256,adoption.startupBindingSha256);
 assert.equal(consumption.startupBinding.serviceEntrypointSha256,sha(await fs.readFile(path.join(applicationRoot,'tools/worker-local-service.ps1'))));
 const original=json('NATIVE-CONTROL-RECEIPTS.json'),completed=[];
 assert.equal(proof.cycles.length,2);
 for(const cycle of proof.cycles){
  assert.equal(cycle.number,completed.length+1);
  const start=readCommand(cycle.start),status=readCommand(cycle.status),stop=readCommand(cycle.stop);
  for(const [call,action] of [[start,'Start'],[status,'Status'],[stop,'Stop']]){
   assert.equal(call.record.action,action);assert.equal(call.record.isolationSha256,profileSha);
   assert.equal(call.record.scriptSha256,sha(await fs.readFile(path.join(applicationRoot,'tools/operations-system-service.ps1'))));
   assert.equal(normalized(call.record.script),normalized(path.win32.join(profile.sourceRoot,'tools/operations-system-service.ps1')));
  }
  assert.equal(start.payload.status,'started');assert.equal(start.payload.state,'Running');
  assert.equal(status.payload.state,'Running');assert.equal(status.payload.backendState,'Ready');assert.equal(status.payload.workerState,'exact_release');
  assert.equal(stop.payload.status,'stopped');assert.equal(stop.payload.workerStatus,'stopped');assert.equal(stop.payload.backendStopped,true);
  const native={};
  for(const kind of ['start','status','stop']){
   const item=original['cycle'+cycle.number+'-'+kind];assert.equal(sha(bytes(item.archived)),item.sha256);native[kind]=log(item.archived);
   assert.equal(native[kind].releaseId,proof.releaseId);
  }
  assert.equal(native.start.state,'Running');assert.equal(native.start.workerState,'exact_release');assert.equal(native.start.backendState,'Ready');
  assert.equal(native.stop.status,'stopped');assert.equal(native.stop.backendStopped,true);assert.equal(native.stop.manifestSha256,proof.manifestSha256);
  const running=json(cycle.running),stopped=json(cycle.stopped);
  assert.equal(running.http.length,3);
  for(const check of running.http){assert.equal(check.status,200);assert.equal(sha(Buffer.from(JSON.stringify(check.payload))),check.bodySha256);}
  const ready=running.http.find(row=>row.path==='/_teruisi/local/health/ready').payload;
  assert.equal(ready.ok,true);assert.equal(ready.status,'ready');assert.equal(ready.backend,'django-postgresql');assert.deepEqual(ready.unavailableServices,[]);
  assert.deepEqual(ready.serviceChecks.map(row=>row.service).sort(),services);assert.ok(ready.serviceChecks.every(row=>row.state==='ready'&&row.httpStatus===200));
  const helper=running.http.find(row=>row.port===25791).payload;assert.equal(helper.ok,true);assert.equal(helper.busy,false);assert.deepEqual(helper.storeExecutions,[]);
  const supervisor=running.windows.processes.find(row=>row.pid===native.start.supervisorProcessId);
  assert.ok(supervisor&&supervisor.createdAt&&hex.test(supervisor.commandSha256));
  assert.ok(running.windows.listeners.some(row=>row.port===23000&&row.pid===native.start.portProcessId));
  assert.equal(running.windows.listeners.length,26);assert.ok(running.windows.listeners.every(row=>row.address==='127.0.0.1'));
  assert.deepEqual(stopped.windows.listeners,[]);
  const current=new Map(stopped.windows.processes.map(row=>[row.pid,row]));
  assert.ok(running.windows.processes.every(row=>!current.has(row.pid)||current.get(row.pid).createdAt!==row.createdAt),'A prior exact native process remains');
  const units=Object.entries(running.linux.units);assert.equal(units.length,2);
  for(const [name,value] of units){
   assert.ok(name.startsWith('codex-native-ai-20261108-'));assert.equal(value.ActiveState,'active');assert.ok(Number(value.MainPID)>0);assert.match(value.InvocationID,/^[a-f0-9]{32}$/);assert.match(value.startTicks,/^[0-9]+$/);
   assert.equal(stopped.linux.units[name].ActiveState,'inactive');assert.equal(stopped.linux.units[name].MainPID,'0');
   assert.ok(runner.units.some(unit=>unit.name===name&&value.WorkingDirectory===unit.release+'/backend'));
  }
  const pi=readCommand(cycle.pi).payload,pandas=readCommand(cycle.pandas).payload;
  assert.equal(pi.image,runner.images.pi);assert.equal(pi.sourceSha256,runner.digests.pi);assert.equal(pi.namespace,'pi-native-ai-20261108');assert.equal(pi.closing,false);
  for(const field of ['activeCount','unresolvedCount','unsafeUnknownCount'])assert.equal(pi[field],0);
  assert.equal(pandas.status,'ready');assert.equal(pandas.image,runner.images.pandas);assert.equal(pandas.cleanupVerified,true);
  const startedAt=Date.parse(start.payload.checkedAt),stoppedAt=Date.parse(stop.payload.checkedAt);
  assert.ok(Number.isFinite(startedAt)&&Number.isFinite(stoppedAt)&&stoppedAt>startedAt);
  const prior=json(cycle.number===1?'cycle1-failed-stopped.json':'cycle1-stopped.json');
  assert.deepEqual(prior.windows.listeners,[]);assert.ok(Object.values(prior.linux.units).every(row=>row.ActiveState==='inactive'&&row.MainPID==='0'));
  const invocationAt=startedAt-start.record.elapsedSeconds*1000;
  assert.ok(invocationAt>=Date.parse(prior.windows.observedAt)-2000,'Start did not follow the independently stopped state');
  assert.ok(Date.parse(supervisor.createdAt)>=invocationAt-2000&&Date.parse(supervisor.createdAt)<=startedAt);
  assert.ok(Date.parse(running.windows.observedAt)>=startedAt-1000);assert.ok(Date.parse(stopped.windows.observedAt)>=stoppedAt-1000);
  if(completed.length){assert.ok(startedAt>completed[0].stoppedAt);assert.notEqual(supervisor.createdAt,completed[0].supervisor.createdAt);for(const [name,value] of units)assert.notEqual(value.InvocationID,completed[0].units[name].InvocationID);}
  completed.push({number:cycle.number,startedAt,stoppedAt,supervisor,units:running.linux.units,startSeconds:start.record.elapsedSeconds,stopSeconds:stop.record.elapsedSeconds});
 }
 // Failures remain failures, even though the existing stale-receipt path later
 // reconciled remaining cleanup. They never count toward the two normal cycles.
 assert.equal(readCommand('native-cycle1-start',1).payload.status,'failed');
 assert.equal(readCommand('native-cycle1-failed-stop',1).payload.status,'failed');
 const reconciled=readCommand('native-cycle1-stop-reconcile').payload;assert.equal(reconciled.workerStatus,'stale_receipt_cleared');assert.equal(reconciled.backendStopped,true);
 assert.equal(json('SYNTHETIC-PRECONDITIONS.json').historicalMigrationExecuted,false);
 assert.equal(json('SYNTHETIC-BOOTSTRAP-LINEAGE.json').lineage.historicalCutoverExecuted,false);
 assert.equal(json('D1-TERMINAL-OBSERVED.json').inspectedByOriginalCollector,true);
 return {version:'teruisi-native-control-evidence-verification-v1',evidenceSha256:q.evidenceSha256,
  executedApplicationCommit:q.commit,executedApplicationTree:q.tree,sourceFingerprint:inventory.tree.sha256,
  manifestSha256:proof.manifestSha256,releaseId:proof.releaseId,cycles:completed.map(({number,startSeconds,stopSeconds})=>({number,startSeconds,stopSeconds})),
  nativeColdStart:true,packageIntegrity:true,nativeEntryBoundary:true,syntheticHistoricalPreconditions:true,historicalMigrationExecuted:false,
  finalHelperChange:{kind:'exact-unused-credential-action-denial',beforeSha256:q.helperBeforeSha256,afterSha256:q.helperAfterSha256,executedInSealedPackage:false},
  nativeDependencyEvidence:{nodeVersion:manifest.build.nodeVersion,nodeModulesTree:manifest.build.nodeModulesTree,packageLockSha256:manifest.source.packageLockSha256},
  originalFailuresRetained:true,productionPublicationPerformed:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{'application-root':{type:'string'},'candidate-root':{type:'string'},evidence:{type:'string'},out:{type:'string'}}});
 verifyNativeControlEvidence({applicationRoot:values['application-root'],candidateRoot:values['candidate-root'],evidenceFile:values.evidence}).then(async result=>{
  if(values.out)await fs.writeFile(values.out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }).catch(error=>{console.error(error.stack);process.exitCode=1;});
}
