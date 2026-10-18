import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareControlUpgrade,adoptControlUpgradeForTest as adoptControlUpgrade,controlFiles,normalizeControlPath} from '../tools/install-main-prebuild.mjs';
import {readAdoptedControl} from '../tools/main-control-dispatch.mjs';
import {manualStepCommand} from '../tools/publish-main-command.mjs';
import {productionCommandArguments} from '../tools/release-batch.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),installer=new URL('../tools/install-main-prebuild.mjs',import.meta.url).href;
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});
const psEnvironment={...process.env,PSModulePath:path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
function cleanupPrivateProcess(pid,expected){
 if(!Number.isSafeInteger(pid)||pid<=0)return;
 const literal="'"+expected.replaceAll("'","''")+"'",code=`$ProgressPreference='SilentlyContinue';try{$h=[Diagnostics.Process]::GetProcessById(${pid});[void]$h.Handle}catch{return};$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($null -eq $p){return};if(-not $p.CommandLine.Contains(${literal})){throw 'Private cleanup command identity changed'};$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or $o.Sid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Private cleanup owner changed'};$h.Kill();$h.WaitForExit()`;
 execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore',env:psEnvironment});
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'control-upgrade-')),source=path.join(directory,'candidate'),repository=path.join(directory,'repo'),state=path.join(directory,'state');
 const cleanup=[];t.after(async()=>{for(const close of cleanup.reverse())await close();await fs.rm(directory,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
 await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.mkdir(repository);await fs.mkdir(path.join(state,'control/tools'),{recursive:true});
 for(const name of controlFiles)await fs.copyFile(path.join(root,'tools',name),path.join(source,'tools',name));
 git(source,['init','-q']);git(source,['add','.']);git(source,['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','frozen candidate']);
 git(repository,['init','-q']);await fs.writeFile(path.join(repository,'file'),'private');git(repository,['add','.']);git(repository,['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','private']);
 const configFile=path.join(state,'main-publisher-config.json');await fs.writeFile(configFile,JSON.stringify({repository,stateDirectory:state,releaseDirectory:path.join(directory,'packets')}));
 const oldHook=execFileSync('git',['-C',root,'show','7ca85e40:tools/main-prebuild-hook.mjs'],{windowsHide:true});
 await fs.writeFile(path.join(state,'control/tools/main-prebuild-hook.mjs'),oldHook);
 // A bounded legacy CLI placeholder is only used in process-window tests.
 await fs.writeFile(path.join(state,'control/tools/publish-latest-main.mjs'),'export const publisherEnvironment=()=>process.env;\n');
 const hook=path.join(repository,'.git/hooks/reference-transaction');
 const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
 const originalShell='#!/bin/sh\n# TERUISI main-prebuild v1: prepare only, never deploy.\n'+quote(process.execPath)+' '+quote(path.join(state,'control/tools/main-prebuild-hook.mjs'))+' event '+quote(configFile)+' "$1"\n';
 await fs.writeFile(hook,originalShell);
 const out=path.join(directory,'materials'),prepared=await prepareControlUpgrade({configFile,out,sourceRoot:source});
 return {directory,source,repository,state,configFile,hook,originalShell,out,prepared,cleanup};
}
const cli=(f,args=[])=>spawnSync(process.execPath,[path.join(f.state,'control/tools/publish-latest-main.mjs'),'--config',f.configFile,...args],{encoding:'utf8',windowsHide:true,timeout:20000});
test('control path normalization never appends command decode separators',()=>{
 assert.equal(normalizeControlPath('C:\\private\\packet\\source\\tools'), 'c:/private/packet/source/tools');
 assert.equal(normalizeControlPath('C:/private/packet/source/tools').includes('\n'),false);
});
test('materials preserve frozen environment; private adoption binds one whole immutable closure',async t=>{
 const f=await fixture(t);assert.equal(f.prepared.status,'bundle-prepared');await assert.rejects(fs.access(path.join(f.state,'CONTROL-INSTALLATION.json')));
 const result=await adoptControlUpgrade({directory:f.out});assert.equal(result.status,'adopted');
 const binding=await readAdoptedControl(f.configFile);assert.equal(binding.state.installId,f.prepared.installId);
 const proof=JSON.parse(await fs.readFile(binding.state.transitionProofFile,'utf8'));assert.equal(proof.privateTestTopology,true);
 const config=JSON.parse(await fs.readFile(f.configFile,'utf8'));assert.ok(config.publisherBaseEnvironment.LOGONSERVER!==undefined);
 assert.equal(cli(f,['--control-status']).status,0);
 assert.equal((await adoptControlUpgrade({directory:f.out})).status,'already-adopted');
 const gate=path.join(f.state,'control/tools/publish-latest-main.mjs');assert.match(await fs.readFile(gate,'utf8'),/const legacyBridge = \{/);
 await fs.appendFile(path.join(binding.bundleRoot,'tools/main-prebuild-queue.mjs'),'\n// private tamper');
 await assert.rejects(readAdoptedControl(f.configFile),/bundle changed/);assert.equal(cli(f,['--check']).status,75);
});
test('actual candidate shim keeps legacy Git phases zero-effect and refuses committed/run before old main',async t=>{
 const f=await fixture(t);await fs.copyFile(path.join(f.out,'SHIM.mjs'),path.join(f.state,'control/tools/publish-latest-main.mjs'));
 // Deliberately invalid config proves legacy phase exits occur before reads.
 await fs.writeFile(f.configFile,'{broken');
 const oldEntry=path.join(f.state,'control/tools/main-prebuild-hook.mjs');
 for(const action of ['preparing','prepared','aborted']){
  const result=spawnSync(process.execPath,[oldEntry,'event',f.configFile,action],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
 }
 for(const args of [['event',f.configFile,'committed'],['run',f.configFile],['event',f.configFile,'prepared','extra'],['event',f.configFile+'.wrong','prepared']]){
  const result=spawnSync(process.execPath,[oldEntry,...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,75,result.stderr);
 }
 await assert.rejects(fs.access(path.join(f.state,'prebuild-queue')));
 const head=git(f.repository,['rev-parse','HEAD']).trim(),result=spawnSync('git',['-C',f.repository,'update-ref','refs/remotes/origin/main',head],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(git(f.repository,['rev-parse','refs/remotes/origin/main']).trim(),head);
 await assert.rejects(fs.access(path.join(f.state,'prebuild-queue')));
});
test('adopted real Git hook and manual CLI share only v2 tickets; failed fetch cannot reach native preparation',async t=>{
 const f=await fixture(t);await adoptControlUpgrade({directory:f.out});
 const head=git(f.repository,['rev-parse','HEAD']).trim();git(f.repository,['update-ref','refs/remotes/origin/main',head]);
 const queue=path.join(f.state,'prebuild-queue-v2');
 for(let n=0;n<400;n++){try{if((await fs.readdir(path.join(queue,'results'))).length)break;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
 const before=(await fs.readdir(path.join(queue,'tickets'))).length;assert.ok(before>=1);
 const manual=cli(f,['--prepare-only','--no-pause']);assert.equal(manual.status,1,manual.stderr);
 const tickets=await Promise.all((await fs.readdir(path.join(queue,'tickets'))).map(async name=>JSON.parse(await fs.readFile(path.join(queue,'tickets',name),'utf8'))));
 assert.ok(tickets.some(ticket=>ticket.origin==='hook'));assert.ok(tickets.some(ticket=>ticket.origin==='manual'));
 assert.deepEqual(await fs.readdir(path.join(queue,'dispatches')),[]);await assert.rejects(fs.access(path.join(f.state,'prebuild-queue')));
 await new Promise(resolve=>setTimeout(resolve,500));
});
test('partial adoption rejects all effect modes, resumes same intent, and never changes legacy tickets',async t=>{
 const f=await fixture(t),v1=path.join(f.state,'prebuild-queue');await fs.mkdir(v1);await fs.writeFile(path.join(v1,'a.pending.json'),'original pending');await fs.writeFile(path.join(v1,'b.result.json'),'original result');
 await assert.rejects(adoptControlUpgrade({directory:f.out,onStage:stage=>{if(stage==='S3')throw Error('private interrupted');}}),/private interrupted/);
 for(const mode of [['--check'],['--prepare-only'],[]])assert.equal(cli(f,mode).status,75);
 assert.equal(await fs.readFile(path.join(v1,'a.pending.json'),'utf8'),'original pending');assert.equal(await fs.readFile(path.join(v1,'b.result.json'),'utf8'),'original result');
 await assert.rejects(adoptControlUpgrade({directory:f.out}),/resume/);
 assert.equal((await adoptControlUpgrade({directory:f.out,resume:true})).status,'adopted');
});
test('resume never overrides a foreign installation pointer or unknown state/version',async t=>{
 const f=await fixture(t);await assert.rejects(adoptControlUpgrade({directory:f.out,onStage:stage=>{if(stage==='S3')throw Error('partial');}}),/partial/);
 const file=path.join(f.state,'CONTROL-INSTALLATION.json'),original=await fs.readFile(file),own=JSON.parse(original);
 for(const changed of [{...own,status:'unknown'},{...own,version:'unknown-version'},{...own,installId:'00000000-0000-4000-8000-000000000000'},{...own,status:'adopted',installId:'00000000-0000-4000-8000-000000000000'}]){
  const raw=JSON.stringify(changed)+'\n';await fs.writeFile(file,raw);await assert.rejects(adoptControlUpgrade({directory:f.out,resume:true}));assert.equal(await fs.readFile(file,'utf8'),raw);
 }
 await fs.writeFile(file,original);assert.equal((await adoptControlUpgrade({directory:f.out,resume:true})).status,'adopted');
});
test('S3/S4/S5 foreign pointer writes cannot be overwritten by the final adopted publication',async t=>{
 for(const at of ['S3','S4','S5']){
  const f=await fixture(t),file=path.join(f.state,'CONTROL-INSTALLATION.json'),foreign=JSON.stringify({version:'foreign-installation',status:'unknown'})+'\n';
  await assert.rejects(adoptControlUpgrade({directory:f.out,onStage:async stage=>{if(stage===at)await fs.writeFile(file,foreign);}}),/pointer drifted/);
  assert.equal(await fs.readFile(file,'utf8'),foreign);
 }
});
test('actual already-linked legacy hook consumer retains its own v1 lock and is never adopted as new code',async t=>{
 const f=await fixture(t),v1=path.join(f.state,'prebuild-queue');await fs.mkdir(v1);await fs.writeFile(path.join(v1,'a.pending.json'),'{}');
 const linked=path.join(f.directory,'linked'),release=path.join(f.directory,'release'),entry=path.join(f.state,'control/tools/main-prebuild-hook.mjs');
 const code=`import fs from'node:fs/promises';import{drainPrebuildQueue}from ${JSON.stringify(new URL('file:///'+entry.replaceAll('\\','/')).href)};await drainPrebuildQueue(${JSON.stringify(v1)},async()=>{await fs.writeFile(${JSON.stringify(linked)},'old callback entered');for(;;){try{await fs.access(${JSON.stringify(release)});break;}catch{await new Promise(r=>setTimeout(r,20));}}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'}),done=new Promise(resolve=>child.once('exit',resolve));t.after(()=>child.kill());
 for(let n=0;n<100;n++){try{await fs.access(linked);break;}catch{await new Promise(r=>setTimeout(r,25));}}await fs.access(linked);
 const originalGate=await fs.readFile(path.join(f.state,'control/tools/publish-latest-main.mjs'));
 await assert.rejects(adoptControlUpgrade({directory:f.out,timeoutMs:1000}),error=>error.code==='ROTATION_WAIT_EXPIRED_NO_CALLBACK');
 assert.deepEqual(await fs.readFile(path.join(f.state,'control/tools/publish-latest-main.mjs')),originalGate);
 await fs.writeFile(release,'continue');assert.equal(await done,0);
 const oldResult=await fs.readFile(path.join(v1,'a.result.json'));assert.equal((await adoptControlUpgrade({directory:f.out})).status,'adopted');assert.deepEqual(await fs.readFile(path.join(v1,'a.result.json')),oldResult);
});
test('third-party hook/config drift and missing bundle refuse before fixed entry changes',async t=>{
 for(const mode of ['hook','config','bundle']){
  const f=await fixture(t),before=await fs.readFile(path.join(f.state,'control/tools/publish-latest-main.mjs'));
  if(mode==='hook')await fs.writeFile(f.hook,'third-party hook');
  else if(mode==='config')await fs.appendFile(f.configFile,' ');
  else await fs.unlink(path.join(f.out,'bundle/tools/main-prebuild-queue.mjs'));
  await assert.rejects(adoptControlUpgrade({directory:f.out}));assert.deepEqual(await fs.readFile(path.join(f.state,'control/tools/publish-latest-main.mjs')),before);
 }
});
test('legacy real process window prevents adopted until exact process exits, without killing it',async t=>{
 const f=await fixture(t),entry=path.join(f.state,'control/tools/publish-latest-main.mjs'),marker=path.join(f.directory,'legacy-ready');
 await fs.writeFile(entry,`import fs from 'node:fs/promises';export const publisherEnvironment=()=>process.env;await fs.writeFile(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`);
 // Freeze this actual predecessor in a fresh same-source material set.
 const out=path.join(f.directory,'legacy-materials');await prepareControlUpgrade({configFile:f.configFile,out,sourceRoot:f.source});
 const child=spawn(process.execPath,[entry,'--config',f.configFile],{windowsHide:true,stdio:'ignore'});const done=new Promise(resolve=>child.once('exit',resolve));t.after(()=>child.kill());
 for(let n=0;n<100;n++){try{await fs.access(marker);break;}catch{await new Promise(r=>setTimeout(r,20));}}
 await fs.access(marker);
 await assert.rejects(adoptControlUpgrade({directory:out,timeoutMs:1800}),/not converged/);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.state,'CONTROL-INSTALLATION.json'),'utf8')).status,'installing');
 assert.equal(child.exitCode,null,'installer killed the legacy process');child.kill();await done;
 assert.equal((await adoptControlUpgrade({directory:out,resume:true})).status,'adopted');
});
test('hard exit at each adoption boundary keeps S2-S5 blocked and S6 authoritative',async t=>{
 for(const stage of ['S1a','S2','S3','S4','S5','S6']){
  const f=await fixture(t),code=`import{adoptControlUpgradeForTest as adoptControlUpgrade}from ${JSON.stringify(installer)};await adoptControlUpgrade({directory:${JSON.stringify(f.out)},onStage:stage=>{if(stage===${JSON.stringify(stage)})process.exit(19);}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});assert.equal(await new Promise(resolve=>child.once('exit',resolve)),19);
  if(['S2','S3','S4','S5'].includes(stage))for(const mode of [['--check'],['--prepare-only'],[]])assert.equal(cli(f,mode).status,75);
  if(stage==='S6')assert.equal((await adoptControlUpgrade({directory:f.out,resume:true})).status,'already-adopted');
  else assert.equal((await adoptControlUpgrade({directory:f.out,resume:true})).status,'adopted');
 }
});
test('orphan native PrepareApp and encoded installed HardenAcl block S5 through exact packet operation evidence',async t=>{
 for(const mode of ['PrepareApp','HardenAcl']){
  const f=await fixture(t),packet=path.join(f.directory,'packets','private-packet'),marker=path.join(f.directory,'native-ready'),pidFile=path.join(f.directory,'native-pid');
  const script=mode==='PrepareApp'?path.join(packet,'source/tools/django-local-service.ps1'):path.join(f.directory,'installed/tools/django-local-service.ps1');
  await fs.mkdir(path.dirname(script),{recursive:true});await fs.writeFile(script,`param([string]$Action)\n[IO.File]::WriteAllText('${marker.replaceAll("'","''")}','ready')\nStart-Sleep -Seconds 90\n`);
  const operation=path.join(packet,'publish-111111111111');await fs.mkdir(operation,{recursive:true});
  await fs.writeFile(path.join(operation,mode+'-started.json'),JSON.stringify({at:new Date().toISOString(),script,action:mode,extra:[]}));
  const systemHost='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',native=manualStepCommand({systemHost,powerShellDirectory:'unused-private',script,action:mode,addJson:false});
  const transportArgs=mode==='PrepareApp'?native.args:productionCommandArguments(native.host,native.args);
  const nativeArgs=[...transportArgs.slice(0,2),'-ExecutionPolicy','Bypass',...transportArgs.slice(2)];
  const parentReady=path.join(f.directory,'parent-ready'),parentGo=path.join(f.directory,'parent-go'),parentFile=path.join(f.directory,'private-parent.mjs');
  const psQuote=value=>"'"+value.replaceAll("'","''")+"'",windowsQuote=value=>'"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
  const launchNative=`$ProgressPreference='SilentlyContinue';$p=Start-Process -FilePath 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' -ArgumentList ${psQuote(nativeArgs.map(windowsQuote).join(' '))} -WindowStyle Hidden -PassThru -RedirectStandardOutput ${psQuote(path.join(f.directory,'native.log'))} -RedirectStandardError ${psQuote(path.join(f.directory,'native.stderr.log'))};[IO.File]::WriteAllText(${psQuote(pidFile)},(@{pid=$p.Id;parentPid=$PID;created=$p.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress))`;
  const parentCode=`import{spawnSync}from'node:child_process';import fs from'node:fs';fs.writeFileSync(${JSON.stringify(parentReady)},'ready');for(let n=0;!fs.existsSync(${JSON.stringify(parentGo)});n++){if(n>1200)throw Error('parent not released');await new Promise(resolve=>setTimeout(resolve,25));}const fd=fs.openSync(${JSON.stringify(path.join(f.directory,'launcher.log'))},'wx');const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',${JSON.stringify(Buffer.from(launchNative,'utf16le').toString('base64'))}],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.status!==0)throw Error('private launcher failed');`;
  await fs.writeFile(parentFile,parentCode);
  // WMI starts a hidden, same-user private parent outside the exec job. This
  // permits its child to outlive it; no service, elevation or formal path.
  const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',cmd='"'+process.execPath+'" "'+parentFile+'"',quote=value=>"'"+value.replaceAll("'","''")+"'";
  const launchCode=`$s=([wmiclass]'Win32_ProcessStartup').CreateInstance();$s.ShowWindow=0;$r=([wmiclass]'Win32_Process').Create(${quote(cmd)},${quote(f.directory)},$s);@{pid=$r.ProcessId;code=$r.ReturnValue}|ConvertTo-Json -Compress`;
  const launch=JSON.parse(execFileSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launchCode,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env:psEnvironment}));assert.equal(launch.code,0);
  let childCleaned=false,parentExited=false;
  f.cleanup.push(async()=>{if(!childCleaned)try{const value=JSON.parse(await fs.readFile(pidFile,'utf8'));cleanupPrivateProcess(value.pid,mode==='PrepareApp'?script:nativeArgs.at(-1));}catch(error){if(error.code!=='ENOENT')throw error;}if(!parentExited)cleanupPrivateProcess(launch.pid,parentFile);});
  for(let n=0;n<400;n++){try{await fs.access(parentReady);break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}await fs.access(parentReady);
  const ownerCheck="$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or $o.Sid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Private launch owner changed'};";
  const parentIdentityCode=`$ProgressPreference='SilentlyContinue';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${launch.pid}';${ownerCheck}@{created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress`;
  const parentIdentity=JSON.parse(execFileSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(parentIdentityCode,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env:psEnvironment}));assert.ok(parentIdentity.command.includes(parentFile));
  await fs.writeFile(parentGo,'continue');
  for(let n=0;n<200;n++){try{await fs.access(marker);break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
  try{await fs.access(marker);}catch{throw Error('Private native command did not start: '+await fs.readFile(path.join(f.directory,'native.log'),'utf8'));}const launchedNative=JSON.parse(await fs.readFile(pidFile,'utf8')),pid=launchedNative.pid;
  const identityCode=`$ProgressPreference='SilentlyContinue';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';${ownerCheck}@{pid=$p.ProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress`;
  const identity=JSON.parse(execFileSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(identityCode,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,env:psEnvironment}));
  assert.ok(identity.command.includes(mode==='PrepareApp'?script:nativeArgs.at(-1)),'Private child command changed');
  const parentGone=execFileSync(shell,['-NoProfile','-NonInteractive','-Command',`if(Get-CimInstance Win32_Process -Filter 'ProcessId=${launch.pid}'){throw 'Private request parent has not exited'};if(Get-CimInstance Win32_Process -Filter 'ProcessId=${launchedNative.parentPid}'){throw 'Actual native parent has not exited'};'parent-exited'`],{encoding:'utf8',windowsHide:true,env:psEnvironment});assert.match(parentGone,/parent-exited/);
  parentExited=true;
  try{
   await assert.rejects(adoptControlUpgrade({directory:f.out,timeoutMs:1500}),/not converged/);
   const installation=JSON.parse(await fs.readFile(path.join(f.state,'CONTROL-INSTALLATION.json'),'utf8'));assert.equal(installation.status,'installing');
   const evidenceDirectory=path.join(f.state,'control-upgrades',installation.installId),blocked=[];
   for(const name of await fs.readdir(evidenceDirectory))if(name.startsWith('BLOCKED-'))blocked.push(JSON.parse(await fs.readFile(path.join(evidenceDirectory,name),'utf8')));
   const observed=blocked.flatMap(item=>item.frames.flatMap(frame=>frame.related)).find(item=>item.pid===pid&&item.createdAt===identity.created);
   assert.ok(observed,'S5 did not identify the actual owned child PID and creation');
   if(mode==='HardenAcl')assert.equal(observed.operationSha256,createHash('sha256').update(await fs.readFile(path.join(operation,mode+'-started.json'))).digest('hex'));
   process.kill(pid,0);
   console.log(JSON.stringify({fixture:'actual-private-orphan-classification',mode,childPid:pid,createdAt:identity.created,requestParentPid:launch.pid,nativeParentPid:launchedNative.parentPid,parentExited:true,nativeParentExited:true,sameUserOwnerVerified:true,selectedFrame:observed,commandLineSha256:createHash('sha256').update(identity.command).digest('hex'),adoptionBlocked:true}));
  }finally{
   const killCode=`$h=[Diagnostics.Process]::GetProcessById(${pid});[void]$h.Handle;$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($p.CreationDate.ToUniversalTime().ToString('o') -cne '${identity.created}'){throw 'Private native process identity changed'};$h.Kill();$h.WaitForExit()`;
   execFileSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(killCode,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore',env:psEnvironment});
   childCleaned=true;
  }
  assert.equal((await adoptControlUpgrade({directory:f.out,resume:true})).status,'adopted');
 }
});
