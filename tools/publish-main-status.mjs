/** Read original status by default; explicitly resume only the supported tail. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertPublicationReady,publicationDeadline} from './publication-readiness.mjs';
import {inspectMainPublication,resumeMainPublication} from './publish-main-resume.mjs';
import {readAdoptedControl,assertControlGeneration} from './main-control-dispatch.mjs';
import {currentPreparationIdentity,assertOrdinaryIdentity} from './main-prebuild-task.mjs';
import {acquireMainPublicationQueue,publisherEnvironment} from './publish-latest-main.mjs';
import {manualStepCommand} from './publish-main-command.mjs';
import {assertFrozenSource} from './frozen-main-source.mjs';
const controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};

export async function runMainStatusCli(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{config:{type:'string'},attempt:{type:'string'},resume:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
 if(values.help){console.log('node tools/publish-main-status.mjs --config <adopted-config> --attempt <original-publish-directory> [--resume]\nDefault: read-only status. --resume: original no-migration Runner upgrade and unstarted native tail only.');return;}
 assert.ok(values.config&&values.attempt,'需要 --config 和原 --attempt，不能选择新操作ID');
 const deadlineUnixMs=publicationDeadline();
 if(deadlineUnixMs!==undefined&&deadlineUnixMs<=Date.now())throw Error('publication_deadline_exhausted_before_status');
 const binding=await readAdoptedControl(path.resolve(values.config)),config=binding.config;
 assert.equal(binding.state.version,'teruisi-main-control-installation-v3');
 const token=await currentPreparationIdentity();assert.equal(token.sid,binding.state.preparationTask.sid);
 if(values.resume){assertOrdinaryIdentity(token,binding.state.preparationTask.sid);assert.equal(sha(await fs.readFile(process.execPath)),binding.state.preparationTask.nodeSha256,'Node身份不匹配');}
 const out=path.resolve(values.attempt),started=await read(path.join(out,'STARTED.json')),source=path.resolve(started.source),packet=path.dirname(source);
 const releaseRoot=path.resolve(config.releaseDirectory);assert.equal(path.dirname(packet),releaseRoot,'原发布包不属于固定入口');
 assert.equal(path.basename(source),'source');assert.equal(out,path.join(packet,'publish-'+started.mainCommit.slice(0,12)));
 assert.equal(controlRoot,source,'续接必须从原冻结包的入口运行，不能套用另一检出的工具');
 const request=await read(path.join(packet,'main-release-request.json'));
 assert.equal(sha(Buffer.from(JSON.stringify(request))),started.requestSha256,'原请求已变化');
 await assertFrozenSource({source,mainCommit:started.mainCommit,sourceTree:request.sourceTree});
 assert.equal(sha(await fs.readFile(path.join(request.pwshDirectory,'pwsh.exe'))),request.pwshSha256,'原PowerShell身份不一致');
 const fixed=publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,fixed);process.env.PATH=request.pwshDirectory+';'+fixed.PATH;
 if(deadlineUnixMs!==undefined)process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(deadlineUnixMs);
 const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs'))),rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs'))),transport=await import(pathToFileURL(path.join(source,'tools/release-batch.mjs')));
 const installed='D:/teruisi-runtime/django-sales/app';
 const ready=()=>assertPublicationReady({deadlineUnixMs}); // Explicit status/resume remains a single probe.
 const observePi=async prepared=>{
  const command=manualStepCommand({systemHost:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',powerShellDirectory:request.pwshDirectory,script:path.join(installed,'tools/django-ai.ps1'),action:'PiUpgradeStatus',extra:['-PiUpgradePlanSha256',prepared.registeredPlanSha256]});
  const result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,command.args),{cwd:path.dirname(command.args[3]),env:transport.productionCommandEnvironment(command.host),timeoutMs:240000,outputProtocol:'direct-exit-files',cleanup:'preserve',captureOutputBuffers:true,label:'read-only original Pi upgrade status'});
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.rawOutput.stdout));
 };
 const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json'),expectedFile=path.join(out,'resume/CATALOG-EXPECTED.json');
 const publishCatalog=async(result,state)=>{
  await assertControlGeneration(binding);
  const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(chain.head.releaseId,result.workerRelease);assert.equal(chain.head.manifestSha256,result.workerManifestSha256);
  assert.equal(sha(await fs.readFile(path.join(installed,'deployment.json'))),result.djangoManifestSha256);
  const receiptRaw=await fs.readFile(result.receiptPath),receipt=JSON.parse(receiptRaw);assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.mainCommit,state.request.mainCommit);assert.equal(receipt.startupVerified,true);assert.equal(receipt.readyVerified,true);
  for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join(path.dirname(installed),'run',name)),false,'维护未退出');
  await ready();
  const sourceTree=await api.hashRelativeFiles(source,await api.listGitSourceFiles(source));
  const rawBefore=await fs.readFile(catalogFile),previous=JSON.parse(rawBefore),receiptSha256=sha(receiptRaw);
  if(previous.receiptPath===result.receiptPath&&previous.receiptSha256===receiptSha256)return;
  const expected=await read(expectedFile);assert.equal(sha(rawBefore),expected.sha256,'发布目录CAS已变化；只协调索引，不重做发布步骤');
  const catalog={...receipt,source,sourceTree,receiptPath:result.receiptPath,receiptSha256};
  const temp=catalogFile+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});
  assert.equal(sha(await fs.readFile(catalogFile)),expected.sha256);await fs.rename(temp,catalogFile);
  assert.deepEqual(await read(catalogFile),catalog);
 };
 const beforeResume=async()=>{
  if(!await exists(expectedFile)){
   await fs.mkdir(path.dirname(expectedFile),{recursive:true});const bytes=await fs.readFile(catalogFile);
   await fs.writeFile(expectedFile,JSON.stringify({at:new Date().toISOString(),sha256:sha(bytes),originalStartedSha256:sha(await fs.readFile(path.join(out,'STARTED.json')))})+'\n',{flag:'wx'});
  }else assert.equal((await read(expectedFile)).originalStartedSha256,sha(await fs.readFile(path.join(out,'STARTED.json'))));
 };
 const context={api,rotation,transport,installedRoot:installed,observePi,ready,publishCatalog,beforeResume};
 if(!values.resume){
  const observed=await inspectMainPublication(out,context);
  console.log(JSON.stringify({status:observed.status,mainCommit:observed.mainCommit,canResume:observed.canResume,reason:observed.reason??null,steps:observed.steps?Object.fromEntries(Object.entries(observed.steps).map(([name,r])=>[name,r.state])):undefined,piStatus:observed.pi?.status,receiptPath:observed.receiptPath,publicationPerformed:false}));return;
 }
 let unlock;
 try{
  unlock=await acquireMainPublicationQueue(binding);
  const result=await resumeMainPublication(out,context);console.log(JSON.stringify({status:result.status,mainCommit:result.mainCommit,receiptPath:result.receiptPath,publicationPerformed:result.status==='deployed_and_ready'}));
 }finally{await unlock?.();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runMainStatusCli().catch(error=>{console.error(JSON.stringify({status:'blocked',canResume:false,reason:String(error.message),processEvidence:error.processEvidence??null,publicationPerformed:false}));process.exitCode=1;});
