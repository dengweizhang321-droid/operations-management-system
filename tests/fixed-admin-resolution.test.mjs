import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const source=await fs.readFile(new URL('../tools/main-prebuild-queue.mjs',import.meta.url),'utf8');
const capture=JSON.parse(await fs.readFile(new URL('./fixtures/fixed-admin-e2-evidence.json',import.meta.url),'utf8'));
const gitRaw=(commit,name)=>execFileSync('git',['show',commit+':'+name],{windowsHide:true,maxBuffer:4*1024*1024});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fixed-e2-test-'));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('fixed-e2-test-'));await fs.rm(root,{recursive:true,force:true,maxRetries:15,retryDelay:30});});
 const state=path.join(root,'state'),packet=path.join(root,'packet');
 const code=source.replaceAll('D:/codex-isolated/main-manual-release-20261016',state.replaceAll('\\','/')).replaceAll('D:/codex-isolated/main-release-packages/4b733d1aed4b-c5d5bb6f-a9e3fdb9',packet.replaceAll('\\','/'))+
 '\nexport const fixtureOnly={fixed:adminFixed,actors:adminActors,files:adminOriginalFiles,sources:adminSourceFiles,verify:adminVerifyOriginals,observerSha:adminApprovedObserverSha256};\n';
 const moduleFile=path.join(root,'queue.mjs');await fs.writeFile(moduleFile,code);const queue=await import(pathToFileURL(moduleFile));const f=queue.fixtureOnly;
 const objects=new Map(Object.entries(capture.objects).map(([digest,raw])=>[digest,Buffer.from(raw,'base64')]));
 const manifest=JSON.parse(objects.get(f.fixed.bundleManifestSha256));
 for(const [name,digest] of Object.entries(f.sources)){const raw=gitRaw(f.fixed.target,name);assert.equal(sha(raw),digest);objects.set(digest,raw);}
 for(const [name,digest] of Object.entries(manifest.files)){const raw=gitRaw(manifest.sourceCommit,name);assert.equal(sha(raw),digest);objects.set(digest,raw);}
 const write=async(file,raw)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,raw);};
 for(const [file,digest] of f.files())await write(file,objects.get(digest));
 for(const [name,digest] of Object.entries(f.sources))await write(path.join(packet,'source',name),objects.get(digest));
 for(const [name,digest] of Object.entries(manifest.files))await write(path.join(state,'control-bundles',f.fixed.bundleSha256,name),objects.get(digest));
 const originals=await f.verify();
 const names=Object.keys(manifest.files).sort(),bundleFiles=Object.fromEntries(names.map(name=>{const raw=Buffer.from('export const name='+JSON.stringify(name)+';\n');const digest=sha(raw);objects.set(digest,raw);return [name,digest];}));
 const bundleSha=sha(Buffer.from(queue.canonical(bundleFiles))),installId=randomUUID(),config={controlProtocol:'teruisi-main-control-v2',stateDirectory:state};
 const put=value=>{const raw=Buffer.from(queue.canonical(value));objects.set(sha(raw),raw);return sha(raw);};
 const configSha=put(config),shimSha=put({shim:true}),hookSha=put({hook:true});
 const adoptedAt='2026-10-18T10:30:00.000Z',observedAt='2026-10-18T10:40:00.000Z';
 const newManifest={version:'teruisi-main-control-bundle-v2',bundleSha256:bundleSha,sourceCommit:'aaca18485021b6f98107fe168b69c8f57d55ee46',sourceTree:'e'.repeat(40),files:bundleFiles};const manifestSha=put(newManifest);
 const common={installId,bundleRoot:path.join(state,'control-bundles',bundleSha),bundleSha256:bundleSha,bundleManifestSha256:manifestSha,dispatcherSha256:shimSha,hook:path.join(root,'reference-transaction'),hookSha256:hookSha,configSha256:configSha};
 const intent={version:'teruisi-main-control-upgrade-v2',...common,stateDirectory:state,configFile:path.join(state,'main-publisher-config.json'),sourceCommit:newManifest.sourceCommit,sourceTree:newManifest.sourceTree};const intentSha=put(intent);
 const transition={version:'teruisi-main-control-transition-v2',installId,intentSha256:intentSha,lockOrder:['v1-queue','v2-queue','native-rotation'],privateTestTopology:false,rotationPipeSha256:sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'),legacyWindowConverged:true,productionDeploymentPerformed:false,frames:[0,1,2].map(n=>({at:'2026-10-18T10:29:5'+n+'.000Z',related:[]}))};const transitionSha=put(transition);
 const adoption={version:'teruisi-main-control-installation-v2',status:'adopted',...common,intentSha256:intentSha,transitionProofSha256:transitionSha,transitionProofFile:path.join(state,'control-upgrades',installId,'TRANSITION-'+randomUUID()+'.json'),adoptedAt};const adoptionSha=put(adoption);
 const observation={version:'teruisi-admin-rejection-observation-e2-v1',dispatchId:f.fixed.dispatchId,at:observedAt,originalsSha256:sha(Buffer.from(queue.canonical(originals))),observerPid:100002,writerPid:100001,observerCreationDate:observedAt,observerCommandLineSha256:'f'.repeat(64),observerCodeSha256:f.observerSha,actors:f.actors.map(actor=>({pid:actor.pid,originalBirth:actor.birth,state:'absent'})),relatedControllers:[],packetPublishDirectoryAbsent:true,invocationsEmpty:true};
 observation.actors[3]={...observation.actors[3],state:'reused-unrelated-pid',currentBirth:'2026-10-18T10:01:00.0000000Z',currentName:'conhost.exe'};
 const observationSha=put(observation),evidenceDirectory=path.join(state,'prebuild-queue-v2/resolutions',f.fixed.dispatchId+'-evidence');
 for(const [digest,raw] of objects)await write(path.join(evidenceDirectory,'objects',digest+'.bin'),raw);
 const resolution={version:f.fixed.version,decision:f.fixed.decision,at:'2026-10-18T10:40:01.000Z',dispatchId:f.fixed.dispatchId,dispatchSha256:f.fixed.dispatchSha256,requestId:f.fixed.requestId,targetCommit:f.fixed.target,originalResultSha256:f.fixed.resultSha256,originals:originals.originals,evidenceDirectory,observationSha256:observationSha,adoptionSha256:adoptionSha,historicalAdoption:{intentSha256:intentSha,transitionProofSha256:transitionSha,bundleManifestSha256:manifestSha},nativePreparationStarted:false,prepared:false,publicationPerformed:false,retryOriginal:false,writerPid:100001};
 const directory=path.join(state,'prebuild-queue-v2'),file=path.join(directory,'resolutions',f.fixed.dispatchId+'.json');await write(file,queue.canonical(resolution));
 const dispatch=JSON.parse(await fs.readFile(path.join(directory,'dispatches',f.fixed.dispatchId+'.json'))),terminal=JSON.parse(await fs.readFile(path.join(directory,'results',f.fixed.requestId+'.json')));
 return {root,state,packet,queue,f,directory,file,resolution,dispatch,terminal,objects,observation,adoption,transition,put,write};
}
test('writer-shaped original actors record is accepted by the actual finite reader; unknown stays unknown',async t=>{
 const f=await fixture(t);assert.equal(await f.queue.readFixedAdminRejectionResolution(f.directory,f.dispatch,f.terminal),true);
 assert.equal((await f.queue.ticketResult(f.directory,f.f.fixed.requestId,f.f.fixed.ticketSha256)).status,'unknown');
 assert.equal((await f.queue.ticketResult(f.directory,f.f.fixed.blockedRequestId,f.f.fixed.blockedTicketSha256)).status,'blocked');
 await f.queue.assertFixedAdminResolutionInventory(f.directory);
});
test('historical evidence survives old packet cleanup and later control generation',async t=>{
 const f=await fixture(t);assert.ok(path.relative(f.root,f.packet)&&!path.relative(f.root,f.packet).startsWith('..'));await fs.rm(f.packet,{recursive:true});
 await f.write(path.join(f.state,'CONTROL-INSTALLATION.json'),JSON.stringify({status:'adopted',bundleSha256:'9'.repeat(64)}));
 assert.equal(await f.queue.readFixedAdminRejectionResolution(f.directory,f.dispatch,f.terminal),true);
});
test('new target proceeds once without replaying original 4b preparation; additional blocked tickets remain original',async t=>{
 const f=await fixture(t),configSha256='a'.repeat(64),bundleSha256='b'.repeat(64),target='c'.repeat(40),binding={configSha256,bundleSha256};
 const ticket=await f.queue.submitPreparation(f.directory,{...binding,origin:'manual'});let calls=0;
 await f.queue.drainPreparationQueue(f.directory,{...binding,observe:async()=>({targetCommit:target,packet:path.join(f.root,'new-packet'),live:{mainCommit:target,head:{bindingSha256:'d'.repeat(64)},djangoManifestSha256:'e'.repeat(64),chainStateSha256:'f'.repeat(64)}}),prepare:async selected=>{calls++;assert.notEqual(selected.targetCommit,f.f.fixed.target);return {status:'already-current',targetCommit:target,currentCommit:target,publicationPerformed:false};}});
 assert.equal(calls,1);assert.equal((await f.queue.ticketResult(f.directory,ticket.requestId,ticket.ticketSha256)).status,'current');assert.equal((await f.queue.ticketResult(f.directory,f.f.fixed.requestId,f.f.fixed.ticketSha256)).status,'unknown');
});
test('absence of this exact resolution retains original blocker',async t=>{
 const f=await fixture(t);await fs.unlink(f.file);assert.equal(await f.queue.readFixedAdminRejectionResolution(f.directory,f.dispatch,f.terminal),false);
});
test('new-generation blocked ticket can bind the exact old e2 dependency without changing either generation',async t=>{
 const f=await fixture(t);await fs.unlink(f.file);const original=await fs.readFile(path.join(f.directory,'results',f.f.fixed.requestId+'.json'));
 const binding={configSha256:'6'.repeat(64),bundleSha256:'7'.repeat(64)},ticket=await f.queue.submitPreparation(f.directory,{...binding,origin:'manual'});let native=0;
 await f.queue.drainPreparationQueue(f.directory,{...binding,observe:async()=>assert.fail('No observe while original dispatch unresolved'),prepare:async()=>{native++;}});
 const blocked=await f.queue.ticketResult(f.directory,ticket.requestId,ticket.ticketSha256);assert.equal(blocked.status,'blocked');assert.equal(blocked.configSha256,binding.configSha256);assert.equal(blocked.bundleSha256,binding.bundleSha256);assert.equal(blocked.blockedDispatchId,f.f.fixed.dispatchId);assert.equal(blocked.dispatchId,undefined);assert.equal(native,0);
 await f.queue.assertFixedAdminResolutionInventory(f.directory);assert.deepEqual(await fs.readFile(path.join(f.directory,'results',f.f.fixed.requestId+'.json')),original);
 const file=path.join(f.directory,'results',ticket.requestId+'.json'),raw=await fs.readFile(file);
 for(const mutation of [{...blocked,blockedDispatchSha256:'0'.repeat(64)},{...blocked,configSha256:'8'.repeat(64)}]){await f.write(file,f.queue.canonical(mutation));await assert.rejects(f.queue.ticketResult(f.directory,ticket.requestId,ticket.ticketSha256));}
 await f.write(file,raw);
});
for(const change of ['missing-archive','changed-original','wrong-target','prepared-claim','replay-claim','wrong-observer','bad-transition','extra-member'])test(change+' fails closed',async t=>{
 const f=await fixture(t),r=f.resolution;
 if(change==='missing-archive')await fs.unlink(path.join(r.evidenceDirectory,'objects',f.f.fixed.publisherSha256+'.bin'));
 if(change==='changed-original')await fs.appendFile(path.join(f.directory,'results',f.f.fixed.requestId+'.json'),' ');
 if(change==='wrong-target')r.targetCommit='1'.repeat(40);
 if(change==='prepared-claim')r.prepared=true;
 if(change==='replay-claim')r.retryOriginal=true;
 if(change==='wrong-observer'){f.observation.observerCodeSha256='0'.repeat(64);r.observationSha256=f.put(f.observation);await f.write(path.join(r.evidenceDirectory,'objects',r.observationSha256+'.bin'),f.objects.get(r.observationSha256));}
 if(change==='bad-transition'){f.transition.legacyWindowConverged=false;const digest=f.put(f.transition);r.historicalAdoption.transitionProofSha256=digest;f.adoption.transitionProofSha256=digest;r.adoptionSha256=f.put(f.adoption);for(const h of [digest,r.adoptionSha256])await f.write(path.join(r.evidenceDirectory,'objects',h+'.bin'),f.objects.get(h));}
 if(change==='extra-member')r.fakePassed=true;
 await f.write(f.file,f.queue.canonical(r));await assert.rejects(f.queue.readFixedAdminRejectionResolution(f.directory,f.dispatch,f.terminal));
});
test('other unknowns and empty dispatch fragments cannot borrow this resolution',async t=>{
 const f=await fixture(t);assert.equal(await f.queue.readFixedAdminRejectionResolution(f.directory,{...f.dispatch,dispatchId:randomUUID()},f.terminal),false);
 const name=randomUUID()+'.json';await f.write(path.join(f.directory,'dispatches',name),f.queue.canonical({...f.dispatch,dispatchId:name.slice(0,-5),tickets:[]}));await assert.rejects(f.queue.assertFixedAdminResolutionInventory(f.directory));
});
test('new fully bound blocked terminals stay untouched; real pending still refuses finite writer admission',async t=>{
 const f=await fixture(t),binding={configSha256:f.f.fixed.configSha256,bundleSha256:f.f.fixed.bundleSha256};
 const added=await f.queue.submitPreparation(f.directory,{...binding,origin:'hook',observedTarget:'a'.repeat(40)});
 await assert.rejects(f.queue.assertFixedAdminResolutionInventory(f.directory),/Pending/);
 const terminal={version:'teruisi-main-prebuild-queue-v2',requestId:added.requestId,ticketSha256:added.ticketSha256,status:'blocked',at:new Date().toISOString(),...binding,blockedDispatchId:f.f.fixed.dispatchId,blockedDispatchSha256:f.f.fixed.dispatchSha256,error:'Original dispatch unresolved'};
 const file=path.join(f.directory,'results',added.requestId+'.json'),raw=f.queue.canonical(terminal);await f.write(file,raw);
 await f.queue.assertFixedAdminResolutionInventory(f.directory);assert.equal(await fs.readFile(file,'utf8'),raw);
});
for(const host of ['powershell.exe','pwsh.exe'])test(host+' qualified observer rejects live actors, metadata ambiguity and late controllers without killing PID reuse',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fixed-e2-observer-'));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const observer=Buffer.from(capture.objects['5b3f2d4d4c19f7392ae4ec989d28800b01787ba2c5522e9bd84f80eaa2b7f973'],'base64');
 assert.equal(sha(observer),'5b3f2d4d4c19f7392ae4ec989d28800b01787ba2c5522e9bd84f80eaa2b7f973');assert.doesNotMatch(observer.toString(),/Stop-Process|\.Kill\(|Invoke-CimMethod/);assert.equal(observer.toString().split('\n Assert-OriginalPacketNotStarted\n').length-1,2);
 const file=path.join(root,'observer.ps1');await fs.writeFile(file,observer);
 const code=`$ErrorActionPreference='Stop';$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($env:FIXED_E2_OBSERVER,[ref]$null,[ref]$e);if($e.Count){throw 'parse'};foreach($n in $a.EndBlock.Statements){if($n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -cin @('Assert-OriginalActorsExited','Assert-NoRelatedControllers')){. ([scriptblock]::Create($n.Extent.Text))}};function Reject([scriptblock]$Check){$bad=$false;try{& $Check}catch{$bad=$true};if(-not $bad){throw 'unsafe observer accepted'}};$rows=@([pscustomobject]@{ProcessId=34284;ParentProcessId=1;Name='conhost.exe';CreationDate=[DateTime]::Parse('2026-10-18T10:01:00Z')});$out=@(Assert-OriginalActorsExited $rows);if($out.Count -ne 4 -or $out[3].state -cne 'reused-unrelated-pid'){throw 'reuse not proved'};$rows[0].CreationDate=[DateTime]::Parse('2026-10-18T09:44:12.7474900Z');Reject {Assert-OriginalActorsExited $rows};$rows[0].CreationDate=$null;Reject {Assert-OriginalActorsExited $rows};$late=[pscustomobject]@{ProcessId=91234;ParentProcessId=1;Name='node.exe';CreationDate=[DateTime]::UtcNow;ExecutablePath='C:\\private\\node.exe';CommandLine='node D:/private/4b733d1aed4b-c5d5bb6f-a9e3fdb9/source/tools/publish-main.mjs --prepare-only'};Reject {Assert-NoRelatedControllers @($late)};$late.CommandLine=$null;Reject {Assert-NoRelatedControllers @($late)};Write-Output 'FINITE_OBSERVER_PRIVATE_PASSED'`;
 const env={...process.env,FIXED_E2_OBSERVER:file};if(host==='powershell.exe')env.PSModulePath=path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
 assert.match(execFileSync(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{env,windowsHide:true,encoding:'utf8'}),/FINITE_OBSERVER_PRIVATE_PASSED/);
});
