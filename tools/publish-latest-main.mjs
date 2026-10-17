import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {createReleaseProgress} from './publish-main-progress.mjs';
import {prepareMainSchemaRelease} from './main-schema-release.mjs';

const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export async function gitAt(cwd,args){
 try{return (await execute('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
 catch(error){throw Error('Git '+args[0]+' 失败（'+(error.code??'unknown')+'），未使用旧版本继续发布');}
}
async function writeOnceOrSame(file,value){
 try{await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),value,'已冻结发布请求变化，拒绝覆盖原批次');}
}
export async function readLivePublication(config){
 const api=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release.mjs')));
 const rotation=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release-rotation.mjs')));
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 const manifest=JSON.parse(await fs.readFile(path.join(api.workerRuntimeRoot,'releases',chain.head.releaseId,'deployment-manifest.json'),'utf8'));
 const djangoRaw=await fs.readFile('D:/teruisi-runtime/django-sales/app/deployment.json');
 for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join('D:/teruisi-runtime/django-sales/run',name)),false,'当前仍有维护或排空状态，不能视为已发布完成');
 let source,commit,expectedTree,receiptPath,receiptRaw;
 const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json');
 const catalog=await exists(catalogFile)?JSON.parse(await fs.readFile(catalogFile,'utf8')):null;
 if(catalog&&catalog.workerManifestSha256===chain.head.manifestSha256&&catalog.workerRelease===chain.head.releaseId&&catalog.djangoManifestSha256===sha(djangoRaw)){
  source=catalog.source;commit=catalog.mainCommit;expectedTree=catalog.sourceTree;
  receiptPath=catalog.receiptPath;receiptRaw=await fs.readFile(receiptPath);assert.equal(sha(receiptRaw),catalog.receiptSha256,'发布目录成功回执变化');
 }else{
  source=JSON.parse(manifest.source.sourceBinding.raw).sourceRoot;
  assert.equal(path.resolve(JSON.parse(djangoRaw).sourceRoot),path.resolve(source),'前后台来源不同且没有匹配发布记录，不能推定已发布版本');
  commit=await gitAt(source,['rev-parse','HEAD']);expectedTree=manifest.source.tree;
  receiptPath=path.resolve(source,'..','publish-'+commit.slice(0,12),'SUCCESS.json');
  if(await exists(receiptPath))receiptRaw=await fs.readFile(receiptPath);
  else{
   assert.ok(config.bootstrapSuccess,'缺少与当前实际版本绑定的完成回执，不能把半切换当作已发布');
   receiptPath=config.bootstrapSuccess.path;receiptRaw=await fs.readFile(receiptPath);
   assert.equal(sha(receiptRaw),config.bootstrapSuccess.sha256,'初始成功回执已变化');
  }
 }
 const receipt=JSON.parse(receiptRaw);assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.mainCommit,commit);
 assert.equal(receipt.workerRelease,chain.head.releaseId);assert.equal(receipt.workerManifestSha256,chain.head.manifestSha256);assert.equal(receipt.djangoManifestSha256,sha(djangoRaw));
 assert.equal(await gitAt(source,['status','--porcelain']),'','已部署版本来源存在未提交修改');
 assert.equal(await gitAt(source,['rev-parse','HEAD']),commit);
 const sourceTree=await api.hashRelativeFiles(source,await api.listGitSourceFiles(source));
 assert.deepEqual(sourceTree,expectedTree,'已部署来源与实际运行包不一致');
 const ready=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});
 assert.equal(ready.status,200,'当前运行版本尚未就绪');const health=await ready.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');
 const ordinaryAttempt=path.resolve(source,'..','publish-'+commit.slice(0,12));
 return {mainCommit:commit,source,sourceTree,head:chain.head,djangoManifestSha256:sha(djangoRaw),completedReceiptPath:receiptPath,resolvedOriginalAttempt:path.resolve(path.dirname(receiptPath))!==ordinaryAttempt};
}

export async function prepareLatestMain(config,{git=gitAt,getLive=readLivePublication,log=()=>{},makePlan=makeReleasePlan,prepareSchema=prepareMainSchemaRelease}={}){
 log('获取 origin/main；旧任务 completedTask、旧成功回执和旧续接参数不参与目标选择。');
 await git(config.repository,['fetch','origin','refs/heads/main:refs/remotes/origin/main']);
 const target=await git(config.repository,['rev-parse','--verify','refs/remotes/origin/main^{commit}']);assert.match(target,/^[a-f0-9]{40}$/);
 const live=await getLive(config);assert.match(live.mainCommit,/^[a-f0-9]{40}$/);
 assert.ok(typeof live.source==='string'&&path.isAbsolute(live.source),'缺少当前来源身份');
 const liveAttempt=path.resolve(live.source,'..','publish-'+live.mainCommit.slice(0,12));
 if(await exists(path.join(liveAttempt,'STARTED.json'))&&!await exists(path.join(liveAttempt,'SUCCESS.json'))&&!live.resolvedOriginalAttempt)throw Error('当前目标有STARTED但无成功完成，不能把半切换当作已发布');
 log('本次目标 main：'+target+'；当前线上：'+live.mainCommit);
 if(target===live.mainCommit)return {status:'already-current',targetCommit:target,currentCommit:live.mainCommit,publicationPerformed:false};
 const name=target.slice(0,12)+'-'+live.head.bindingSha256.slice(0,8)+'-'+live.djangoManifestSha256.slice(0,8);
 const packet=path.join(config.releaseDirectory,name),source=path.join(packet,'source');
 await fs.mkdir(packet,{recursive:true});
 if(!await exists(path.join(source,'.git'))){
  await git(config.repository,['worktree','add','-b','codex/manual-main-'+name,source,target]);
  await git(config.repository,['worktree','lock','--reason','Manual latest-main release source; keep while package is in use',source]);
 }
 assert.equal(await git(source,['rev-parse','HEAD']),target,'发布来源不是本次冻结main');
 assert.equal(await git(source,['status','--porcelain']),'','发布来源存在未提交修改');
 const plan=makePlan({base:live.mainCommit,head:target,cwd:source});assert.equal(plan.headSha,target);assert.equal(plan.baseSha,live.mainCommit);
 if(!plan.components.length)return {status:'non-production',targetCommit:target,currentCommit:live.mainCommit,packet,source,publicationPerformed:false};
 const schemaRelease=plan.migrate?await prepareSchema({source,packet,plan}):null;
 const cacheLock=sha(await fs.readFile(path.join(source,'package-lock.json')));
 assert.equal(cacheLock,config.cacheLockSha256,'依赖锁已变化，需要先准备对应离线依赖；本次未部署');
 const modules=path.join(source,'node_modules');
 if(!await exists(modules))await fs.symlink(config.dependenciesDirectory,modules,'junction');
 const link=await fs.realpath(modules);assert.equal(path.resolve(link),path.resolve(config.dependenciesDirectory),'来源依赖目录变化');
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:target,deployedCommit:live.mainCommit,
  predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256,
  pwshDirectory:config.pwshDirectory,pwshSha256:config.pwshSha256,npmCacheDirectory:config.npmCacheDirectory,
  components:plan.components,migrate:plan.migrate,releasePlan:plan,backup:false,fullTests:false,...(schemaRelease?{schemaRelease}:{})};
 await writeOnceOrSame(path.join(packet,'release-scope-plan.json'),plan);
 await writeOnceOrSame(path.join(packet,'main-release-request.json'),request);
 const attempt=path.join(packet,'publish-'+target.slice(0,12));
 if(await exists(path.join(attempt,'STARTED.json'))&&!await exists(path.join(attempt,'SUCCESS.json')))throw Error('这个目标main已有未知结果的执行记录，禁止自动重试；原日志：'+attempt);
 if(await exists(path.join(attempt,'SUCCESS.json')))throw Error('该目标有历史成功记录，但当前线上不是此提交，不能把旧记录显示为本次成功');
 return {status:'prepared',targetCommit:target,currentCommit:live.mainCommit,packet,source,request,publicationPerformed:false};
}

export function publisherEnvironment(environment=process.env,gitDirectory){
 // Both the Git-triggered prepare and manual BAT use this actual environment.
 // No secrets or environment snapshot is written; the native identity still
 // hashes every variable passed to npm/build. Git's local variables never leak.
 const result={};
 if(!gitDirectory)gitDirectory=path.dirname(execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]);
 assert.ok(path.isAbsolute(gitDirectory),'需要本机Git的绝对安装目录');
 const names=['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH','USERNAME','USERDOMAIN','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'];
 for(const name of names){const key=Object.keys(environment).find(k=>k.toUpperCase()===name.toUpperCase());if(key)result[name.toUpperCase()]=environment[key];}
 result.PATH=[path.dirname(process.execPath),'C:/Windows/System32','C:/Windows','C:/Windows/System32/WindowsPowerShell/v1.0',gitDirectory].join(path.delimiter);
 return result;
}
async function runPublisher(source,args=[],gitDirectory){
 const directory=path.resolve(source,'..','invocations');await fs.mkdir(directory,{recursive:true});
 const resultFile=path.join(directory,randomUUID()+'.json'),check=args.includes('--check');
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(source,'tools/publish-main.mjs'),...args,...(check?[]:['--result-file',resultFile])],{cwd:source,env:publisherEnvironment(process.env,gitDirectory),windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>signal||code!==0?reject(Error('本次目标发布未完成，退出码：'+(code??signal))):resolve());
 });
 return check?null:JSON.parse(await fs.readFile(resultFile,'utf8'));
}
async function main(){
 const {values}=parseArgs({options:{config:{type:'string'},check:{type:'boolean',default:false},'prepare-only':{type:'boolean',default:false},'no-pause':{type:'boolean',default:false}}});
 assert.ok(!(values.check&&values['prepare-only']),'检查与打包模式不能同时使用');
 assert.ok(values.config,'需要固定发布入口配置 --config');
 const config=JSON.parse(await fs.readFile(values.config,'utf8'));
 const progress=createReleaseProgress(path.join(config.stateDirectory,'logs'),{taskName:values.check?'发布检查':values['prepare-only']?'打包':'发布'});
 try{
  progress.begin(values.check?'检查最新main（不部署）':'准备本次最新main');
  const prepared=await prepareLatestMain(config,{log:message=>progress.log(message)});
  progress.complete();
  if(prepared.status==='already-current'){
   progress.log('当前线上已经是目标main '+prepared.targetCommit+'；本次没有执行发布。');
   console.log(JSON.stringify(prepared));return;
  }
  if(prepared.status==='non-production'){progress.log('最新main没有生产载荷变更，本次未执行发布。');console.log(JSON.stringify(prepared));return;}
  await fs.writeFile(path.join(config.stateDirectory,'LATEST-PREPARED.json'),JSON.stringify(prepared,null,2)+'\n');
  if(values.check){await runPublisher(prepared.source,['--check'],config.gitDirectory);progress.log('检查通过：有新main待发布；本次未打包、未部署。');console.log(JSON.stringify({status:prepared.status,targetCommit:prepared.targetCommit,currentCommit:prepared.currentCommit,packet:prepared.packet,source:prepared.source,components:prepared.request.components,migrate:prepared.request.migrate,publicationPerformed:false}));return;}
  if(values['prepare-only']){
   progress.begin('准备对应main制品');const result=await runPublisher(prepared.source,['--prepare-only'],config.gitDirectory);assert.equal(result.mainCommit,prepared.targetCommit);progress.complete();
   if(result.status==='already-current'){assert.equal(result.publicationPerformed,false);progress.log('当前线上已经是目标main '+prepared.targetCommit+'；本次没有执行发布。');return;}
   assert.equal(result.status,'prepared-only');assert.equal(result.publicationPerformed,false);
   progress.log('打包完成，等待手动发布。目标main：'+prepared.targetCommit+'；本次未部署。');return;
  }
  progress.begin('发布已准备好的目标main');
  progress.log('开始实际发布目标 '+prepared.targetCommit+'，独立包：'+prepared.packet);
  const result=await runPublisher(prepared.source,['--deploy-only'],config.gitDirectory);progress.complete();
  assert.equal(result.mainCommit,prepared.targetCommit);
  if(result.status==='already-current'){progress.log('当前线上已经是目标main '+prepared.targetCommit+'；本次没有执行发布。');return;}
  assert.equal(result.status,'deployed_and_ready');assert.equal(result.publicationPerformed,true);
  const receiptPath=path.join(prepared.packet,'publish-'+prepared.targetCommit.slice(0,12),'SUCCESS.json');
  const receiptRaw=await fs.readFile(receiptPath),success=JSON.parse(receiptRaw);
  assert.equal(success.mainCommit,prepared.targetCommit,'成功记录不属于本次目标main');
  const rotation=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release-rotation.mjs')));
  const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  assert.equal(after.head.releaseId,success.workerRelease);assert.equal(after.head.manifestSha256,success.workerManifestSha256);
  assert.equal(sha(await fs.readFile('D:/teruisi-runtime/django-sales/app/deployment.json')),success.djangoManifestSha256);
  const api=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release.mjs')));
  const sourceTree=await api.hashRelativeFiles(prepared.source,await api.listGitSourceFiles(prepared.source));
  const catalog={...success,source:prepared.source,sourceTree,receiptPath,receiptSha256:sha(receiptRaw)};
  const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json'),temporary=catalogFile+'.'+process.pid+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,catalogFile);
  progress.success('已确认本次目标main '+prepared.targetCommit+' 已切换，成功记录属于本次发布。');
 }catch(error){progress.fail(error);process.exitCode=1;}finally{progress.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))main().catch(error=>{console.error(error.message);process.exitCode=1;});
