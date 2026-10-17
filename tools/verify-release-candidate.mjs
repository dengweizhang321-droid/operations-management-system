/** Run reviewed release compatibility checks on an exact, isolated candidate.
 * This does not publish, grant a startup permit, or claim a native cold start.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {publisherEnvironment} from './publish-latest-main.mjs';
import {hashTree} from './worker-local-release.mjs';

const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const git=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})).stdout.trim();
const productionRoots=['D:/teruisi-runtime','D:/运营管理系统','D:/运营管理系统-sales-django-release'];
const within=(root,target)=>{const r=path.relative(path.resolve(root),path.resolve(target));return !r||(!r.startsWith('..')&&!path.isAbsolute(r));};

export function candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory}){
 const environment=publisherEnvironment(process.env);
 environment.PATH=[path.dirname(process.execPath),path.dirname(gitExe),path.dirname(shell7),path.dirname(pythonExe),path.join(environment.SYSTEMROOT,'System32'),path.dirname(shell5)].join(';');
 environment.PSModuleAnalysisCachePath=path.join(directory,'module-cache');
 environment.PSModulePath=path.join(path.dirname(shell7),'Modules');
 environment.PYTHONDONTWRITEBYTECODE='1';environment.PYTHONIOENCODING='utf-8';
 return environment;
}

export function candidateCompatibilityProfile(changes){
 const files=changes.flatMap(c=>[c.before,c.path].filter(Boolean));
 const paths=files.filter(f=>!f.startsWith('docs/')&&!f.startsWith('tests/')&&!['README.md','AGENTS.md'].includes(f));
 const supported=new Set(['tools/publish-main.mjs','tools/publish-prepared-main.mjs','tools/publish-latest-main.mjs',
  'tools/main-prebuild-status.mjs','tools/worker-local-release.mjs','tools/django-local-service.ps1','tools/verify-release-candidate.mjs']);
 const unsupported=paths.filter(p=>!supported.has(p));
 return {version:'release-compatibility-profile-v1',paths,unsupported,
  publication:paths.some(p=>/publish-|main-prebuild|manual-maintenance|verify-release-candidate|release-scope-plan/.test(p)),
  worker:paths.some(p=>/worker-local-release/.test(p)),
  django:paths.includes('tools/django-local-service.ps1'),
  nativeColdStartPerformed:false};
}

export async function assertPrivateCandidateLocation(target){
 const absolute=path.resolve(target);
 for(const root of productionRoots)assert.ok(!within(root,absolute),'候选验证不能使用生产根目录：'+absolute);
 // Refuse a path that becomes a different directory through a junction.
 let cursor=absolute;
 for(;;){
  try{assert.equal((await fs.lstat(cursor)).isSymbolicLink(),false,'候选路径不能经过重解析点：'+cursor);}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
 }
 return absolute;
}

async function functionsOf(script,host,environment){
 const code='$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($env:TERUISI_CANDIDATE_PARSE_FILE,[ref]$null,[ref]$e);if($e.Count){throw "parse failed"};$functions=@($a.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{[pscustomobject]@{name=$_.Name;text=$_.Extent.Text}});$other=@([string]$a.ParamBlock.Extent.Text)+@($a.EndBlock.Statements|Where-Object{$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{$_.Extent.Text});[pscustomobject]@{functions=$functions;other=$other}|ConvertTo-Json -Depth 4 -Compress';
 const result=await execute(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',env:{...environment,TERUISI_CANDIDATE_PARSE_FILE:script},windowsHide:true,maxBuffer:8*1024*1024});
 return JSON.parse(result.stdout);
}
export function compareFunctionOnlyChange(before,after){
 const allowed=new Set(['Get-FileSha256','Get-ExistingFileSha256','Get-ApplicationTreeFingerprintEvidence']);
 const normalize=text=>text.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)]));
 const next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 for(const name of new Set([...old.keys(),...next.keys()]))if(old.get(name)!==next.get(name)&&!allowed.has(name))return false;
 return true;
}

export async function verifyReleaseCandidate({sourceRoot,base,head='HEAD',out,dependencies,python='python.exe'}={}){
 const source=await assertPrivateCandidateLocation(sourceRoot??process.cwd());
 const verifierRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 assert.equal((await fs.realpath(source)).toLowerCase(),(await fs.realpath(verifierRoot)).toLowerCase(),'验证器必须来自被验证候选，不能使用其他工作树的旧工具');
 assert.ok(base,'必须指定 --base，不能省略前驱差异');
 assert.equal(await git(source,['status','--porcelain']),'','候选存在未提交修改；先冻结候选提交再验证');
 const commit=await git(source,['rev-parse',head+'^{commit}']);
 assert.equal(await git(source,['rev-parse','HEAD']),commit,'候选必须是当前干净HEAD');
 const baseCommit=await git(source,['rev-parse',base+'^{commit}']);
 await git(source,['merge-base','--is-ancestor',baseCommit,commit]);
 const tree=await git(source,['rev-parse','HEAD^{tree}']);
 const directory=await assertPrivateCandidateLocation(out??path.join(os.tmpdir(),'release-candidate-'+randomUUID()));
 assert.ok(!within(source,directory),'验证输出必须在候选工作树之外');
 await fs.mkdir(directory,{recursive:false});
 const plan=makeReleasePlan({base:baseCommit,head:commit,cwd:source});
 const profile=candidateCompatibilityProfile(plan.changes);
 const report={version:'release-candidate-verification-v1',source,baseCommit,commit,tree,plan,profile,startedAt:new Date().toISOString(),
  status:'running',checks:[],evidence:{packageIntegrity:false,nativeEntryBoundary:false,nativeColdStart:false},publicationPerformed:false};
 const reportFile=path.join(directory,'REPORT.json');
 const write=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
 await write();
 const candidate=path.join(directory,'candidate');let attached=false;
 try{
  assert.equal(profile.unsupported.length,0,'本验证器没有覆盖这些变更，需补受影响兼容适配器：'+profile.unsupported.join(', '));
  const where=async name=>(await execute('C:/Windows/System32/where.exe',[name],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0];
  const shell5='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',shell7=await where('pwsh.exe'),gitExe=await where('git.exe'),pythonExe=path.isAbsolute(python)?python:await where(python);
  const environment=candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory});
  report.environmentSha256=sha(Buffer.from(JSON.stringify(environment)));
  report.tools=await Promise.all([process.execPath,shell5,shell7,pythonExe,gitExe].map(async file=>({path:file,sha256:sha(await fs.readFile(file))})));
  report.powerShellModules={root:environment.PSModulePath,tree:await hashTree(environment.PSModulePath)};
  await git(source,['worktree','add','--detach',candidate,commit]);attached=true;
  assert.ok(dependencies||(!profile.worker&&!profile.django&&!profile.publication),'该profile需要显式的只读依赖目录');
  if(dependencies){
   assert.ok((await fs.stat(path.join(dependencies,'typescript','package.json'))).isFile(),'依赖不完整');
   await fs.symlink(path.resolve(dependencies),path.join(candidate,'node_modules'),'junction');
   const physicalRoot=await fs.realpath(dependencies);
   report.dependencies={physicalRoot,tree:await hashTree(physicalRoot)};
  }
  const members=(await git(candidate,['ls-files','-z'])).split('\0').filter(Boolean);
  report.payload=[];
  for(const name of members){const file=path.join(candidate,name);assert.ok(!(await fs.lstat(file)).isSymbolicLink(),'候选包含链接：'+name);report.payload.push({path:name,sha256:sha(await fs.readFile(file))});}
  report.payloadSha256=sha(Buffer.from(JSON.stringify(report.payload)));
  if(profile.django){
   const old=path.join(directory,'before-django.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-local-service.ps1'],{encoding:'buffer',maxBuffer:8*1024*1024,windowsHide:true})).stdout;
   await fs.writeFile(old,bytes);
   const current=path.join(candidate,'tools/django-local-service.ps1');
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(current,shell7,environment)]);
   report.requiresNativeColdStart=!compareFunctionOnlyChange(a,b);
   assert.equal(report.requiresNativeColdStart,false,'生命周期语义发生变化，需专用隔离冷启动适配器；不能以边界测试代替');
  }
  async function run(name,executable,args,kind){
   const started=Date.now(),item={name,executable,args,kind,startedAt:new Date().toISOString(),status:'running'};report.checks.push(item);await write();
   const output=path.join(directory,name+'.stdout.log'),errors=path.join(directory,name+'.stderr.log');
   try{
    const result=await execute(executable,args,{cwd:candidate,env:environment,encoding:'buffer',windowsHide:true,timeout:900000,maxBuffer:16*1024*1024});
    await fs.writeFile(output,result.stdout);await fs.writeFile(errors,result.stderr);item.exitCode=0;item.status='passed';
   }catch(error){await fs.writeFile(output,error.stdout??Buffer.alloc(0));await fs.writeFile(errors,error.stderr??Buffer.alloc(0));item.error=String(error.message);item.exitCode=error.code??null;item.status='failed';throw error;}
   finally{item.elapsedMs=Date.now()-started;item.stdoutSha256=sha(await fs.readFile(output));item.stderrSha256=sha(await fs.readFile(errors));await write();}
  }
  if(profile.publication)await run('publication',process.execPath,['--test','tests/main-publication-readiness.test.mjs','tests/publish-prepared-main.test.mjs','tests/publish-latest-main.test.mjs','tests/publish-main-command.test.mjs','tests/main-prebuild-status.test.mjs','tests/verify-release-candidate.test.mjs','tests/release-batch-powershell-environment.test.mjs'],'native-entry-boundary');
  if(profile.worker)await run('worker-integrity',process.execPath,['--test','tests/worker-source-read-once.test.mjs','tests/release-source-binding.test.mjs','tests/release-preparation-runtime-config.test.mjs'],'package-integrity');
  if(profile.django)for(const [name,host] of [['ps5',shell5],['ps7',shell7]]){
   for(const file of ['django-lifecycle-tree-reuse','django-local-service-fingerprint','django-orchestrated-start-acl'])await run(name+'-'+file,host,['-NoProfile','-NonInteractive','-File','tests/'+file+'.test.ps1'],'isolated-functions');
  }
  if(profile.publication||profile.django){
   await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1'],'package-integrity');
  }
  assert.equal(await git(candidate,['status','--porcelain']),'','测试修改了候选工作树');
  for(const member of report.payload)assert.equal(sha(await fs.readFile(path.join(candidate,member.path))),member.sha256,'验证期间候选字节变化：'+member.path);
  if(report.dependencies)assert.deepEqual(await hashTree(report.dependencies.physicalRoot),report.dependencies.tree,'验证期间依赖字节发生变化');
  for(const tool of report.tools)assert.equal(sha(await fs.readFile(tool.path)),tool.sha256,'验证期间执行工具发生变化：'+tool.path);
  assert.deepEqual(await hashTree(report.powerShellModules.root),report.powerShellModules.tree,'验证期间PowerShell模块发生变化');
  report.evidence.packageIntegrity=report.checks.some(c=>c.kind==='package-integrity');
  report.evidence.nativeEntryBoundary=report.checks.some(c=>c.kind==='native-entry-boundary');
  report.nativeColdStartReason='Not executed: profiles cover package digests, admission and native command boundaries; no Start/Stop routing semantics changed.';
  report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.message);}
 finally{
  report.completedAt=new Date().toISOString();
  if(attached){
   try{
    const modules=path.join(candidate,'node_modules');try{if((await fs.lstat(modules)).isSymbolicLink())await fs.unlink(modules);}catch(e){if(e.code!=='ENOENT')throw e;}
    await git(source,['worktree','remove',candidate]);report.candidateWorktreeRemoved=true;
   }catch(error){report.candidateWorktreeRemoved=false;report.cleanupError=String(error.message);report.status='failed';}
  }
  await write();
 }
 return {status:report.status,reportFile,tree,commit,evidence:report.evidence};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{source:{type:'string'},base:{type:'string'},head:{type:'string',default:'HEAD'},out:{type:'string'},dependencies:{type:'string'},python:{type:'string'}}});
 verifyReleaseCandidate({sourceRoot:values.source,base:values.base,head:values.head,out:values.out,dependencies:values.dependencies,python:values.python}).then(result=>{console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
