import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidateCompatibilityProfile,assertPrivateCandidateLocation,compareFunctionOnlyChange,verifyReleaseCandidate,candidateTestEnvironment,usesGateTimingExemption,readinessStabilityFiles,compareReadinessDjangoCopyOnly,compareReadinessMaintenancePairOnly} from '../tools/verify-release-candidate.mjs';
import {readinessCopyControllerPair,assertMaintenanceControllerGeneration,piNativeCandidateControllerSha256} from '../tools/manual-maintenance-continuation.mjs';
import {execFileSync} from 'node:child_process';

test('readiness stability profile accepts only the complete finite task closure',()=>{
 const files=[...readinessStabilityFiles,'tools/verify-release-candidate.mjs'];
 const profile=candidateCompatibilityProfile([...files,'tests/readiness-entry-compatibility.test.mjs','docs/readiness-stability-20261103/COMPATIBILITY.md'].map(path=>({path})));
 assert.equal(profile.readinessStabilityOnly,true);assert.equal(profile.version,'readiness-stability-v1');
 assert.deepEqual(profile.unsupported,[]);assert.equal(profile.worker,true);assert.equal(profile.django,true);
 assert.equal(profile.piMainResumeOnly,false);assert.equal(profile.applyTimingReceiptOnly,false);assert.equal(profile.nativeColdStartPerformed,false);
 for(const missing of files){
  const partial=candidateCompatibilityProfile(files.filter(p=>p!==missing).map(path=>({path})));
  assert.equal(partial.readinessStabilityOnly,false,missing);assert.ok(partial.unsupported.length,missing);
 }
 for(const extra of ['tools/worker-local-service.ps1','tools/django-ai.ps1','tools/worker-local-release.mjs','tools/new-controller.ps1','lib/sales/new-helper.ts']){
  const wider=candidateCompatibilityProfile([...files,extra].map(path=>({path})));
  assert.equal(wider.readinessStabilityOnly,false,extra);assert.ok(wider.unsupported.length,extra);
 }
 const renamed=candidateCompatibilityProfile([...files.map(path=>({path})),{before:'tools/unknown-controller.ps1',path:'docs/archived.md'}]);
 assert.equal(renamed.readinessStabilityOnly,false);assert.ok(renamed.unsupported.includes('tools/unknown-controller.ps1'));
});

test('readiness stability Django qualification allows only one anchored helper copy item',()=>{
 const before='function Prepare-Application {\r\n      "tools\\publish-prepared-main.mjs",\r\n}\r\nfunction Start-ServiceStack { original }\r\n';
 const addition='      "tools\\publication-readiness.mjs",\r\n';
 const after=before.replace('      "tools\\publish-prepared-main.mjs",\r\n',m=>m+addition);
 assert.equal(compareReadinessDjangoCopyOnly(before,after),true);
 assert.equal(compareReadinessDjangoCopyOnly('\uFEFF'+before,after.replaceAll('\r\n','\n')),true);
 for(const bad of [before,after+addition,after.replace('original','changed'),after.replace('publication-readiness','other-helper'),addition+before]){
  assert.equal(compareReadinessDjangoCopyOnly(before,bad),false);
 }
 assert.equal(compareReadinessDjangoCopyOnly(after,after),false);
});

test('readiness stability maintenance guard accepts the exact pair and rejects unknown names or bytes',()=>{
 const value={name:'django-local-service.ps1',installedSha:readinessCopyControllerPair.installedSha,expected:readinessCopyControllerPair.candidateSha,candidateSha:readinessCopyControllerPair.candidateSha};
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration(value));
 for(const changed of [{name:'worker-local-service.ps1'},{name:'unknown.ps1'},{installedSha:'e'.repeat(64)},{candidateSha:'e'.repeat(64)},{expected:'e'.repeat(64)}]){
  assert.throws(()=>assertMaintenanceControllerGeneration({...value,...changed}),/不一致/);
 }
 assert.equal(piNativeCandidateControllerSha256['django-local-service.ps1'].includes(value.candidateSha),false,'new copy-only pair must not enter the generic historical candidate table');
});

test('readiness stability maintenance qualification permits only the fixed pair and guard branch',async()=>{
 const base=process.env.TERUISI_COMPATIBILITY_BASE??'e7aaf6c16939770d0941994873747fe301ef0b93';
 const before=execFileSync('git',['show',base+':tools/manual-maintenance-continuation.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 const after=await fs.readFile('tools/manual-maintenance-continuation.mjs','utf8');
 assert.equal(compareReadinessMaintenancePairOnly(before,after),true);
 for(const bad of [before,after.replace('expected===candidateSha','true'),after.replace(readinessCopyControllerPair.installedSha,'e'.repeat(64)),after.replace("name==='django-local-service.ps1'","name==='worker-local-service.ps1'"),after+'\n// unrelated change']){
  assert.equal(compareReadinessMaintenancePairOnly(before,bad),false);
 }
});

test('readiness stability controller pair matches actual raw frozen and candidate bytes',async()=>{
 const base=process.env.TERUISI_COMPATIBILITY_BASE??'e7aaf6c16939770d0941994873747fe301ef0b93';
 const before=execFileSync('git',['show',base+':tools/django-local-service.ps1'],{windowsHide:true,maxBuffer:8*1024*1024});
 const after=await fs.readFile('tools/django-local-service.ps1');
 const rawSha=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(rawSha(before),readinessCopyControllerPair.installedSha);
 assert.equal(rawSha(after),readinessCopyControllerPair.candidateSha);
 assert.equal(compareReadinessDjangoCopyOnly(before.toString('utf8'),after.toString('utf8')),true);
 assert.equal(after.length-before.length,42);
 assert.notEqual(rawSha(Buffer.from(after.toString('utf8').replaceAll('\r\n','\n'))),readinessCopyControllerPair.candidateSha);
});

test('actual normalized Windows environment retains its system path without inherited secrets',()=>{
 const env=candidateTestEnvironment({gitExe:'C:/Git/git.exe',shell5:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',shell7:'C:/PS/pwsh.exe',pythonExe:'C:/Python/python.exe',directory:'C:/private'});
 assert.equal(typeof env.SYSTEMROOT,'string');assert.ok(env.PATH.includes(path.join(env.SYSTEMROOT,'System32')));
 assert.equal(env.DATABASE_URL,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.TERUISI_DJANGO_SERVICE_LIBRARY_ONLY,undefined);
});

test('compatibility selection covers release controls and refuses unreviewed adapters',()=>{
 const p=candidateCompatibilityProfile([{path:'tools/worker-local-release.mjs'},{path:'tools/django-local-service.ps1'},{path:'tools/publish-main.mjs'},{path:'docs/report.md'}]);
 assert.equal(p.worker,true);assert.equal(p.django,true);assert.equal(p.publication,true);assert.deepEqual(p.unsupported,[]);
 assert.deepEqual(candidateCompatibilityProfile([{path:'tools/new-controller.ps1'}]).unsupported,['tools/new-controller.ps1']);
 assert.deepEqual(candidateCompatibilityProfile([{path:'tools/publish-unreviewed-new-controller.mjs'}]).unsupported,['tools/publish-unreviewed-new-controller.mjs']);
 assert.deepEqual(candidateCompatibilityProfile([{before:'tools/unknown.ps1',path:'docs/old.md'}]).unsupported,['tools/unknown.ps1']);
 assert.equal(p.nativeColdStartPerformed,false);
});
test('weekly release lease profile is finite and does not admit lifecycle changes',()=>{
 const p=candidateCompatibilityProfile([{path:'tools/django-workflow-service.ps1'},{path:'tools/publish-prepared-main.mjs'},{path:'tools/verify-release-candidate.mjs'}]);
 assert.equal(p.releaseContentionOnly,true);assert.equal(p.weeklyReleaseLeaseOnly,true);assert.deepEqual(p.unsupported,[]);
 const extended=candidateCompatibilityProfile([{path:'tools/django-workflow-service.ps1'},{path:'tools/publish-prepared-main.mjs'},{path:'tools/django-local-service.ps1'}]);
 assert.equal(extended.weeklyReleaseLeaseOnly,false);
});
test('production and junction paths are refused before any candidate execution',async t=>{
 for(const p of ['D:/运营管理系统','D:/运营管理系统/tmp/check','D:/teruisi-runtime/private-looking','D:/运营管理系统-sales-django-release'])await assert.rejects(assertPrivateCandidateLocation(p),/生产根/);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-location-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'actual'));await fs.symlink(path.join(root,'actual'),path.join(root,'linked'),'junction');
 await assert.rejects(assertPrivateCandidateLocation(path.join(root,'linked','child')),/重解析点/);
});
test('only digest helper changes are exempt from native cold-start evidence',()=>{
 const a={functions:[{name:'Start-ServiceStack',text:'start()'},{name:'Get-FileSha256',text:'old()'}],other:['fixed params','dispatch']};
 const b=structuredClone(a);b.functions[1].text='new()';b.functions.push({name:'Get-ExistingFileSha256',text:'read()'});
 assert.equal(compareFunctionOnlyChange(a,b),true);
 b.functions[0].text='different-start()';assert.equal(compareFunctionOnlyChange(a,b),false);
 b.functions[0].text='start()';b.other[1]='changed dispatch';assert.equal(compareFunctionOnlyChange(a,b),false);
 b.other[1]='dispatch';b.other.push('new side effect');assert.equal(compareFunctionOnlyChange(a,b),false);
});
test('a Django-only exact gate timing exemption is detected independently of Python proof changes',async()=>{
 const projection=raw=>{const start=raw.indexOf('function Invoke-DjangoMigrations('),end=raw.indexOf('\nfunction ',start+10);return raw.slice(start,end).trimEnd();};
 const before=projection(execFileSync('git',['show','7ca85e40:tools/django-local-service.ps1'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}).replaceAll('\r\n','\n'));
 const after=projection((await fs.readFile('tools/django-local-service.ps1','utf8')).replaceAll('\r\n','\n'));
 const a={functions:[{name:'Invoke-DjangoMigrations',text:before}],other:[]},b={functions:[{name:'Invoke-DjangoMigrations',text:after}],other:[]};
 assert.equal(candidateCompatibilityProfile([{path:'tools/django-local-service.ps1'}]).schemaProof,false);
 assert.equal(usesGateTimingExemption(a,b),true);assert.equal(compareFunctionOnlyChange(a,b),true);
 b.functions[0].text=after.replace('"migrate", "--noinput"','"different-action", "--noinput"');
 assert.equal(usesGateTimingExemption(a,b),false);assert.equal(compareFunctionOnlyChange(a,b),false);
});
test('cannot verify dirty candidates or production checkout',async()=>{
 await assert.rejects(verifyReleaseCandidate({sourceRoot:'D:/运营管理系统',base:'HEAD'}),/生产根/);
});
test('a verifier cannot issue evidence for a different source checkout',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foreign-candidate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await assert.rejects(verifyReleaseCandidate({sourceRoot:root,base:'HEAD'}),/不能使用其他工作树/);
});

// Q14 (2026-10-25): DingTalk screenshot ACL tolerance narrow configuration.
import {compareDingTalkScreenshotAclChange,windowsPowerShellEnvironment,functionsOfExact} from '../tools/verify-release-candidate.mjs';
import {dingtalkScreenshotAclQualification as dtq} from '../tools/manual-maintenance-continuation.mjs';
import {createHash} from 'node:crypto';
const dtSha=value=>createHash('sha256').update(value).digest('hex');
const dtBlob=(commit,file)=>execFileSync('git',['show',commit+':'+file],{windowsHide:true,maxBuffer:8*1024*1024});
async function dingtalkFunctions(t){
 // Reviewed bytes: origin/main 525ad36b and candidate 33043e9d (or the merged working tree).
 const work=await fs.readFile('tools/django-ai.ps1');
 const baseBytes=dtBlob('525ad36b','tools/django-ai.ps1'),candidateBytes=dtSha(work)===dtq.candidateAiSha256?work:dtBlob('33043e9d','tools/django-ai.ps1');
 assert.equal(dtSha(baseBytes),dtq.installedAiSha256);assert.equal(dtSha(candidateBytes),dtq.candidateAiSha256);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dingtalk-ast-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const before=path.join(directory,'before.ps1'),after=path.join(directory,'after.ps1');
 await fs.writeFile(before,baseBytes);await fs.writeFile(after,candidateBytes);
 return {before:await functionsOfExact(before,'pwsh.exe',process.env),after:await functionsOfExact(after,'pwsh.exe',process.env)};
}
test('Q14: dingtalk screenshot ACL profile is finite: django-ai.ps1 plus the two qualification carriers only',()=>{
 const only=candidateCompatibilityProfile([{path:'tools/django-ai.ps1'},{path:'tests/dingtalk-screenshot-acl.test.ps1'},{path:'docs/规范/安全与AI工具.md'}]);
 assert.equal(only.dingtalkScreenshotAclOnly,true);assert.equal(only.piExitObservation,false);assert.deepEqual(only.unsupported,[]);
 assert.equal(only.publication,false);assert.equal(only.django,false);assert.equal(only.worker,false);
 const carriers=candidateCompatibilityProfile([{path:'tools/django-ai.ps1'},{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]);
 assert.equal(carriers.dingtalkScreenshotAclOnly,true);assert.equal(carriers.piExitObservation,false);assert.deepEqual(carriers.unsupported,[]);
 // any other tool file, or no django-ai.ps1 at all, keeps the original behaviour
 for(const extra of ['tools/django-local-service.ps1','tools/worker-local-release.mjs','tools/publish-main.mjs','tools/manual-maintenance-start.ps1']){
  const wide=candidateCompatibilityProfile([{path:'tools/django-ai.ps1'},{path:extra}]);
  assert.equal(wide.dingtalkScreenshotAclOnly,false,extra);assert.equal(wide.piExitObservation,true,extra);
 }
 assert.equal(candidateCompatibilityProfile([{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]).dingtalkScreenshotAclOnly,false);
 assert.equal(candidateCompatibilityProfile([{path:'docs/report.md'}]).dingtalkScreenshotAclOnly,false);
 assert.equal(candidateCompatibilityProfile([{before:'tools/django-ai.ps1',path:'tools/renamed-ai.ps1'}]).dingtalkScreenshotAclOnly,false);
});
test('Q14: the actual reviewed base and candidate django-ai.ps1 pass the syntax-tree comparison',async t=>{
 const {before,after}=await dingtalkFunctions(t);
 assert.equal(compareDingTalkScreenshotAclChange(before,after),true);
 const names=after.functions.map(f=>f.name);
 assert.ok(names.includes('Test-AppContainerReadOnlyAce')&&names.indexOf('Test-AppContainerReadOnlyAce')===names.indexOf('Assert-DingTalkScreenshotProfile')+1);
 assert.equal(after.functions.length,before.functions.length+1);
});
test('Q14: syntax-tree comparison refuses any change beyond the two pinned functions',async t=>{
 const {before,after}=await dingtalkFunctions(t);
 const clone=()=>structuredClone(after);
 const edit=(name,suffix)=>{const next=clone();next.functions.find(f=>f.name===name).text+=suffix;return next;};
 // one more function changed (including the reviewed Pi stop protocol)
 for(const name of ['Stop-PiRuntime','Wait-PiWorkerExit','Start-DingTalkWorkers'])assert.equal(compareDingTalkScreenshotAclChange(before,edit(name,'\n# x')),false,name);
 // the two pinned functions changed by a single character
 assert.equal(compareDingTalkScreenshotAclChange(before,edit('Assert-DingTalkScreenshotProfile',' ')),false);
 assert.equal(compareDingTalkScreenshotAclChange(before,edit('Test-AppContainerReadOnlyAce',' ')),false);
 // top-level statements / parameter block
 let next=clone();next.other[next.other.length-1]+=' ; Invoke-Extra';assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.other.push('Invoke-NewSideEffect');assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.other[0]+=' ';assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 // helper missing, renamed, duplicated, extra function, wrong order, dropped function
 next=clone();next.functions=next.functions.filter(f=>f.name!=='Test-AppContainerReadOnlyAce');assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.functions.find(f=>f.name==='Test-AppContainerReadOnlyAce').name='Test-AppContainerReadOnlyAce2';assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.functions.push({name:'Test-AppContainerReadOnlyAce',text:next.functions.find(f=>f.name==='Test-AppContainerReadOnlyAce').text});assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.functions.push({name:'Invoke-Extra',text:'function Invoke-Extra {}'});assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.functions.reverse();assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 next=clone();next.functions=next.functions.filter(f=>f.name!=='Stop-PiRuntime');assert.equal(compareDingTalkScreenshotAclChange(before,next),false);
 // identical files (no change) and the reverse direction are not the qualified change
 assert.equal(compareDingTalkScreenshotAclChange(before,before),false);
 assert.equal(compareDingTalkScreenshotAclChange(after,before),false);
 // a base that was already modified cannot be qualified against the pinned old text
 const tamperedBase=structuredClone(before);tamperedBase.functions.find(f=>f.name==='Assert-DingTalkScreenshotProfile').text+=' ';
 assert.equal(compareDingTalkScreenshotAclChange(tamperedBase,after),false);
 // line endings alone are not a change
 const crlf=clone();for(const f of crlf.functions)f.text=f.text.replaceAll('\n','\r\n');for(let i=0;i<crlf.other.length;i++)crlf.other[i]=crlf.other[i].replaceAll('\n','\r\n');
 assert.equal(compareDingTalkScreenshotAclChange(before,crlf),true);
});
test('Q14: a one-digit error in any pinned function hash refuses the comparison',async t=>{
 const {before,after}=await dingtalkFunctions(t);
 const flip=value=>value.slice(0,-1)+(value.endsWith('0')?'1':'0');
 for(const key of ['assertProfileBeforeSha256','assertProfileAfterSha256','appContainerAceSha256'])
  assert.equal(compareDingTalkScreenshotAclChange(before,after,{...dtq,[key]:flip(dtq[key])}),false,key);
 assert.equal(compareDingTalkScreenshotAclChange(before,after,dtq),true);
 assert.equal(compareDingTalkScreenshotAclChange({functions:[],other:[]},{functions:[],other:[]}),false);
 assert.equal(compareDingTalkScreenshotAclChange(undefined,after),false);
});
test('Q14: Windows PowerShell 5.1 children never inherit the PowerShell 7 module path',()=>{
 const environment=candidateTestEnvironment({gitExe:'C:/Git/git.exe',shell5:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',shell7:'C:/PS/pwsh.exe',pythonExe:'C:/Python/python.exe',directory:'C:/private'});
 assert.ok(environment.PSModulePath.includes('PS'));
 const legacy=windowsPowerShellEnvironment({...environment,PSMODULEPATH:'X'});
 assert.equal(Object.keys(legacy).some(key=>key.toLowerCase()==='psmodulepath'),false);
 assert.equal(legacy.PATH,environment.PATH);assert.equal(legacy.PSModuleAnalysisCachePath,environment.PSModuleAnalysisCachePath);
 assert.ok(environment.PSModulePath,'the PowerShell 7 environment itself is not modified');
});

// A 项 (2026-10-25): descendant-creation-guard narrow qualification.
import {compareDescendantCreationGuardChange,descendantCreationGuardQualification as dcq} from '../tools/verify-release-candidate.mjs';
async function descendantGuardFunctions(t){
 // Reviewed bytes: origin/main 525ad36b and candidate 2ef3f663 (or the merged working tree).
 const work=await fs.readFile('tools/django-local-service.ps1');
 const baseBytes=dtBlob('525ad36b','tools/django-local-service.ps1'),candidateBytes=dtSha(work)===dcq.fileAfterSha256?work:dtBlob('2ef3f663','tools/django-local-service.ps1');
 assert.equal(dtSha(baseBytes),dcq.fileBeforeSha256);assert.equal(dtSha(candidateBytes),dcq.fileAfterSha256);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'descendant-guard-ast-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const before=path.join(directory,'before.ps1'),after=path.join(directory,'after.ps1');
 await fs.writeFile(before,baseBytes);await fs.writeFile(after,candidateBytes);
 return {before:await functionsOfExact(before,'pwsh.exe',process.env),after:await functionsOfExact(after,'pwsh.exe',process.env)};
}
test('A 项: descendant creation guard profile is finite: django-local-service.ps1 plus the two qualification carriers only',()=>{
 const only=candidateCompatibilityProfile([{path:'tools/django-local-service.ps1'},{path:'tests/django-lifecycle-tree-reuse.test.ps1'},{path:'docs/规范/验证与发布.md'}]);
 assert.equal(only.descendantCreationGuardOnly,true);assert.deepEqual(only.unsupported,[]);
 const carriers=candidateCompatibilityProfile([{path:'tools/django-local-service.ps1'},{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]);
 assert.equal(carriers.descendantCreationGuardOnly,true);assert.deepEqual(carriers.unsupported,[]);
 // any other tool file alongside it, or no django-local-service.ps1 at all, keeps the original behaviour
 for(const extra of ['tools/django-ai.ps1','tools/worker-local-release.mjs','tools/publish-main.mjs','tools/manual-maintenance-start.ps1']){
  const wide=candidateCompatibilityProfile([{path:'tools/django-local-service.ps1'},{path:extra}]);
  assert.equal(wide.descendantCreationGuardOnly,false,extra);
 }
 assert.equal(candidateCompatibilityProfile([{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]).descendantCreationGuardOnly,false);
 assert.equal(candidateCompatibilityProfile([{path:'docs/report.md'}]).descendantCreationGuardOnly,false);
 assert.equal(candidateCompatibilityProfile([{before:'tools/django-local-service.ps1',path:'tools/renamed-django.ps1'}]).descendantCreationGuardOnly,false);
});
test('A 项: the actual reviewed base and candidate django-local-service.ps1 pass the syntax-tree comparison',async t=>{
 const {before,after}=await descendantGuardFunctions(t);
 assert.equal(compareDescendantCreationGuardChange(before,after),true);
 assert.equal(after.functions.length,before.functions.length,'A 项不新增函数，只新增两行守卫');
 assert.deepEqual(after.functions.map(f=>f.name),before.functions.map(f=>f.name));
});
test('A 项: syntax-tree comparison refuses any change beyond the one pinned function',async t=>{
 const {before,after}=await descendantGuardFunctions(t);
 const clone=()=>structuredClone(after);
 const edit=(name,suffix)=>{const next=clone();next.functions.find(f=>f.name===name).text+=suffix;return next;};
 // one more function changed (including the reviewed stop protocol)
 for(const name of ['Stop-VerifiedProcessTree','Get-ProcessSnapshot','Assert-ApplicationProcessesStopped'])
  if(after.functions.some(f=>f.name===name))assert.equal(compareDescendantCreationGuardChange(before,edit(name,'\n# x')),false,name);
 // the one pinned function changed by a single character beyond the registered pair
 assert.equal(compareDescendantCreationGuardChange(before,edit('Get-VerifiedProcessDescendants',' ')),false);
 // top-level statements / parameter block
 let next=clone();next.other[next.other.length-1]+=' ; Invoke-Extra';assert.equal(compareDescendantCreationGuardChange(before,next),false);
 next=clone();next.other.push('Invoke-NewSideEffect');assert.equal(compareDescendantCreationGuardChange(before,next),false);
 next=clone();next.other[0]+=' ';assert.equal(compareDescendantCreationGuardChange(before,next),false);
 // the guard moved to a different function (function count unchanged, but it is not the registered one)
 next=clone();
 {
  const guardedText=next.functions.find(f=>f.name==='Get-VerifiedProcessDescendants').text;
  const normalized=guardedText.replaceAll('\r\n','\n');
  const marker='      if (-not $child.CreationDate -or -not $parentSnapshot.CreationDate) { continue }\n      if ([datetime]$child.CreationDate -lt [datetime]$parentSnapshot.CreationDate) { continue }\n';
  assert.ok(normalized.includes(marker),'测试用例未能在实际候选文本中定位守卫行，字节已变化需重新核对');
  const otherName=next.functions.find(f=>f.name!=='Get-VerifiedProcessDescendants').name;
  next.functions=next.functions.map(f=>{
   if(f.name==='Get-VerifiedProcessDescendants')return {...f,text:normalized.replace(marker,'')};
   if(f.name===otherName)return {...f,text:f.text.replaceAll('\r\n','\n')+'\n'+marker};
   return f;
  });
 }
 assert.equal(compareDescendantCreationGuardChange(before,next),false);
 // renamed, duplicated, extra function, wrong order, dropped function (function count must stay equal)
 next=clone();next.functions.find(f=>f.name==='Get-VerifiedProcessDescendants').name='Get-VerifiedProcessDescendants2';assert.equal(compareDescendantCreationGuardChange(before,next),false);
 next=clone();next.functions.push({name:'Invoke-Extra',text:'function Invoke-Extra {}'});assert.equal(compareDescendantCreationGuardChange(before,next),false);
 next=clone();next.functions.reverse();assert.equal(compareDescendantCreationGuardChange(before,next),false);
 next=clone();next.functions=next.functions.filter(f=>f.name!=='Get-VerifiedProcessDescendants');assert.equal(compareDescendantCreationGuardChange(before,next),false);
 // identical files (no change) and the reverse direction are not the qualified change
 assert.equal(compareDescendantCreationGuardChange(before,before),false);
 assert.equal(compareDescendantCreationGuardChange(after,before),false);
 // a base that was already modified cannot be qualified against the pinned old text
 const tamperedBase=structuredClone(before);tamperedBase.functions.find(f=>f.name==='Get-VerifiedProcessDescendants').text+=' ';
 assert.equal(compareDescendantCreationGuardChange(tamperedBase,after),false);
 // line endings alone are not a change (source text is already CRLF; flip it to bare LF instead of double-converting)
 const crlf=clone();for(const f of crlf.functions)f.text=f.text.replaceAll('\r\n','\n');for(let i=0;i<crlf.other.length;i++)crlf.other[i]=crlf.other[i].replaceAll('\r\n','\n');
 assert.equal(compareDescendantCreationGuardChange(before,crlf),true);
});
test('A 项: a one-digit error in any pinned function hash refuses the comparison',async t=>{
 const {before,after}=await descendantGuardFunctions(t);
 const flip=value=>value.slice(0,-1)+(value.endsWith('0')?'1':'0');
 for(const key of ['beforeSha256','afterSha256'])
  assert.equal(compareDescendantCreationGuardChange(before,after,{...dcq,[key]:flip(dcq[key])}),false,key);
 assert.equal(compareDescendantCreationGuardChange(before,after,dcq),true);
 assert.equal(compareDescendantCreationGuardChange({functions:[],other:[]},{functions:[],other:[]}),false);
 assert.equal(compareDescendantCreationGuardChange(undefined,after),false);
});
test('A 项: the registered whole-file hashes match the maintenance-admission qualification exactly',async()=>{
 const {aDescendantCreationGuardDjangoScriptSha256,piNativeCandidateDjangoScriptSha256}=await import('../tools/manual-maintenance-continuation.mjs');
 assert.equal(dcq.fileBeforeSha256,piNativeCandidateDjangoScriptSha256,'验证器资格必须绑定维护前准入已登记的基线哈希');
 assert.equal(dcq.fileAfterSha256,aDescendantCreationGuardDjangoScriptSha256,'验证器资格必须绑定维护前准入已登记的候选哈希');
});

// B 项 (2026-10-25): worker -Json failure-cause narrow qualification.
import {compareWorkerJsonFailureCauseChange,workerJsonFailureCauseQualification as wjq} from '../tools/verify-release-candidate.mjs';
async function workerJsonFunctions(t){
 // Reviewed bytes: origin/main 4dccd188 and candidate ee961e5f (or the merged working tree).
 const work=await fs.readFile('tools/worker-local-service.ps1');
 const baseBytes=dtBlob('4dccd188','tools/worker-local-service.ps1'),candidateBytes=dtSha(work)===wjq.fileAfterSha256?work:dtBlob('ee961e5f','tools/worker-local-service.ps1');
 assert.equal(dtSha(baseBytes),wjq.fileBeforeSha256);assert.equal(dtSha(candidateBytes),wjq.fileAfterSha256);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'worker-json-cause-ast-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const before=path.join(directory,'before.ps1'),after=path.join(directory,'after.ps1');
 await fs.writeFile(before,baseBytes);await fs.writeFile(after,candidateBytes);
 return {before:await functionsOfExact(before,'pwsh.exe',process.env),after:await functionsOfExact(after,'pwsh.exe',process.env)};
}
test('B 项: worker json failure cause profile is finite: worker-local-service.ps1 plus the two qualification carriers only',()=>{
 const only=candidateCompatibilityProfile([{path:'tools/worker-local-service.ps1'},{path:'tests/worker-local-service.test.ps1'},{path:'docs/规范/验证与发布.md'}]);
 assert.equal(only.workerJsonFailureCauseOnly,true);assert.deepEqual(only.unsupported,[]);
 assert.equal(only.worker,false,'worker-local-service.ps1 不匹配 worker-local-release 的 worker profile');
 assert.equal(only.django,false);assert.equal(only.descendantCreationGuardOnly,false);assert.equal(only.dingtalkScreenshotAclOnly,false);
 const bare=candidateCompatibilityProfile([{path:'tools/worker-local-service.ps1'}]);
 assert.equal(bare.workerJsonFailureCauseOnly,true);assert.deepEqual(bare.unsupported,[]);
 const carriers=candidateCompatibilityProfile([{path:'tools/worker-local-service.ps1'},{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]);
 assert.equal(carriers.workerJsonFailureCauseOnly,true);assert.deepEqual(carriers.unsupported,[]);
 // Conditional admission: any other tool file alongside it drops the flag AND the
 // lifecycle controller falls back to `unsupported`, so the gate fails closed.
 for(const extra of ['tools/django-local-service.ps1','tools/django-ai.ps1','tools/publish-main.mjs','tools/worker-local-release.mjs','tools/manual-maintenance-start.ps1']){
  const wide=candidateCompatibilityProfile([{path:'tools/worker-local-service.ps1'},{path:extra}]);
  assert.equal(wide.workerJsonFailureCauseOnly,false,extra);
  assert.ok(wide.unsupported.includes('tools/worker-local-service.ps1'),extra+'：未命中窄资格时启动引擎必须保持失败关闭');
 }
 assert.equal(candidateCompatibilityProfile([{path:'tools/verify-release-candidate.mjs'},{path:'tools/manual-maintenance-continuation.mjs'}]).workerJsonFailureCauseOnly,false);
 assert.equal(candidateCompatibilityProfile([{path:'docs/report.md'}]).workerJsonFailureCauseOnly,false);
 const renamed=candidateCompatibilityProfile([{before:'tools/worker-local-service.ps1',path:'tools/renamed-worker.ps1'}]);
 assert.equal(renamed.workerJsonFailureCauseOnly,false);assert.ok(renamed.unsupported.length>0);
});
test('B 项: the actual reviewed base and candidate worker-local-service.ps1 pass the syntax-tree comparison',async t=>{
 const {before,after}=await workerJsonFunctions(t);
 assert.equal(compareWorkerJsonFailureCauseChange(before,after),true);
 assert.equal(before.functions.length,81,'B 项基线函数数量');
 assert.equal(after.functions.length,81,'B 项不新增、不删除函数');
 assert.deepEqual(after.functions.map(f=>f.name),before.functions.map(f=>f.name));
 assert.equal(before.other.length,43);assert.equal(after.other.length,43);
 // The comparator walks functions by index, so it does not depend on names
 // being unique; today they happen to be, and the name-order assertion above
 // keeps the indices aligned.
 const names=before.functions.map(f=>f.name);
 assert.equal(new Set(names).size,names.length,'当前 81 个函数名互不重复');
});
test('B 项: syntax-tree comparison refuses any change beyond the one pinned top-level statement',async t=>{
 const {before,after}=await workerJsonFunctions(t);
 const clone=()=>structuredClone(after);
 const edit=(name,suffix)=>{const next=clone();next.functions.find(f=>f.name===name).text+=suffix;return next;};
 // any function changed, including the reviewed stop/start protocol
 for(const name of ['Stop-ExactWorkerSnapshot','Invoke-WorkerSystemStop','Invoke-WorkerSystemStart','Start-VerifiedWorkerSupervisor','Assert-WorkerMaintenanceInactive','Write-Result'])
  if(after.functions.some(f=>f.name===name))assert.equal(compareWorkerJsonFailureCauseChange(before,edit(name,'\n# x')),false,name);
 // another top-level statement changed as well (two differing elements)
 let next=clone();next.other[0]+=' ';assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 next=clone();next.other[1]+=' ; Invoke-Extra';assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 // the pinned top-level statement changed by one more character
 next=clone();next.other[next.other.length-1]+=' ';assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 // other length changes
 next=clone();next.other.push('Invoke-NewSideEffect');assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 next=clone();next.other.pop();assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 // function count / order changes
 next=clone();next.functions.push({name:'Invoke-Extra',text:'function Invoke-Extra {}'});assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 next=clone();next.functions=next.functions.filter(f=>f.name!=='Write-Result');assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 next=clone();next.functions.reverse();assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 next=clone();next.functions[0]={...next.functions[0],name:next.functions[0].name+'2'};assert.equal(compareWorkerJsonFailureCauseChange(before,next),false);
 // identical files (no change) and the reverse direction are not the qualified change
 assert.equal(compareWorkerJsonFailureCauseChange(before,before),false);
 assert.equal(compareWorkerJsonFailureCauseChange(after,after),false);
 assert.equal(compareWorkerJsonFailureCauseChange(after,before),false);
 // a base that was already modified cannot be qualified against the pinned old text
 const tamperedBase=structuredClone(before);tamperedBase.other[tamperedBase.other.length-1]+=' ';
 assert.equal(compareWorkerJsonFailureCauseChange(tamperedBase,after),false);
 // line endings alone are not a change (source text is already CRLF; flip it to bare LF)
 const lf=clone();for(const f of lf.functions)f.text=f.text.replaceAll('\r\n','\n');for(let i=0;i<lf.other.length;i++)lf.other[i]=lf.other[i].replaceAll('\r\n','\n');
 assert.equal(compareWorkerJsonFailureCauseChange(before,lf),true);
});
test('B 项: a one-digit error in either pinned statement hash refuses the comparison',async t=>{
 const {before,after}=await workerJsonFunctions(t);
 const flip=value=>value.slice(0,-1)+(value.endsWith('0')?'1':'0');
 for(const key of ['otherBeforeSha256','otherAfterSha256'])
  assert.equal(compareWorkerJsonFailureCauseChange(before,after,{...wjq,[key]:flip(wjq[key])}),false,key);
 assert.equal(compareWorkerJsonFailureCauseChange(before,after,wjq),true);
 assert.equal(compareWorkerJsonFailureCauseChange({functions:[],other:[]},{functions:[],other:[]}),false);
 assert.equal(compareWorkerJsonFailureCauseChange(undefined,after),false);
 assert.equal(compareWorkerJsonFailureCauseChange(before,undefined),false);
});
test('B 项: the registered whole-file hashes match the maintenance-admission qualification exactly',async()=>{
 const {bWorkerJsonFailureCauseScriptSha256,piNativeCandidateControllerSha256}=await import('../tools/manual-maintenance-continuation.mjs');
 assert.equal(wjq.fileAfterSha256,bWorkerJsonFailureCauseScriptSha256,'验证器资格必须绑定维护前准入已登记的候选哈希');
 assert.equal(wjq.fileBeforeSha256,piNativeCandidateControllerSha256['worker-local-service.ps1'][0],'验证器资格必须绑定维护前准入已登记的基线哈希');
 assert.ok(piNativeCandidateControllerSha256['worker-local-service.ps1'].includes(bWorkerJsonFailureCauseScriptSha256),'候选哈希必须已在代际清单内');
});
test('C 项: the producer qualification list is admitted only with its own carriers; anything else fails closed',()=>{
 const qualification='tools/preparation-producer-qualification.mjs',rotation='tools/worker-local-release-rotation.mjs',verifier='tools/verify-release-candidate.mjs';
 // The S16 shape: the closures list, the rotation file whose bytes it registers,
 // and this verifier (where the narrow qualification lives). docs/ and tests/
 // never reach `paths`, so they do not widen the flag.
 const s16=candidateCompatibilityProfile([{path:rotation},{path:qualification},{path:verifier},{path:'tests/worker-preparation-timing.test.mjs'},{path:'docs/规范/历史记录/发布限定资格-20261022.md'}]);
 assert.equal(s16.preparationProducerQualifyOnly,true);assert.deepEqual(s16.unsupported,[]);
 assert.equal(s16.preparationQueue,true);assert.equal(s16.worker,true);
 // Re-registering the list alone is the legal minimum and stays admissible.
 for(const changes of [[{path:qualification}],[{path:qualification},{path:rotation}],[{path:qualification},{path:verifier}]]){
  const p=candidateCompatibilityProfile(changes);
  assert.equal(p.preparationProducerQualifyOnly,true,JSON.stringify(changes));assert.deepEqual(p.unsupported,[]);
 }
 // Any other tool travelling with it loses the flag AND leaves the list unsupported.
 for(const extra of ['tools/django-local-service.ps1','tools/publish-main.mjs','tools/worker-local-service.ps1','tools/manual-maintenance-start.ps1']){
  const wide=candidateCompatibilityProfile([{path:qualification},{path:extra}]);
  assert.equal(wide.preparationProducerQualifyOnly,false,extra);
  assert.ok(wide.unsupported.includes(qualification),extra);
 }
 // Without the list there is nothing to admit, and a rename is not the same file.
 assert.equal(candidateCompatibilityProfile([{path:rotation},{path:verifier}]).preparationProducerQualifyOnly,false);
 const renamed=candidateCompatibilityProfile([{before:qualification,path:'tools/renamed.mjs'}]);
 assert.equal(renamed.preparationProducerQualifyOnly,false);
 assert.ok(renamed.unsupported.includes(qualification));assert.ok(renamed.unsupported.includes('tools/renamed.mjs'));
});
test('C 项第三步修复: the publication tail is admitted only with its own registered carrier; anything else fails closed',()=>{
 const tail='tools/publish-main-tail.mjs',parser='tools/publish-latest-main.mjs',verifier='tools/verify-release-candidate.mjs';
 // The real shape of this change: the landing point plus this verifier, where
 // the qualification lives. The parser is reused byte for byte and so never
 // enters the diff — which is why the tightening requires the verifier and not
 // the parser. tests/ and docs/ never reach `paths`, so they cannot widen it.
 const actual=candidateCompatibilityProfile([{path:tail},{path:verifier},{path:'tests/publish-latest-main.test.mjs'},{path:'docs/规范/历史记录/发布限定资格-20261022.md'}]);
 assert.equal(actual.applyTimingReceiptOnly,true);assert.deepEqual(actual.unsupported,[]);
 assert.equal(actual.publication,true);
 // The parser stays out of the diff, so the preparation-queue trigger is off and
 // optimization-boundaries does not run for this candidate. Pinned so a later
 // reader does not read the absent check as a missed one.
 assert.equal(actual.preparationQueue,false);assert.equal(actual.worker,false);assert.equal(actual.django,false);
 // Should the parser ever need to travel with the tail, the flag still holds.
 const withParser=candidateCompatibilityProfile([{path:tail},{path:parser},{path:verifier}]);
 assert.equal(withParser.applyTimingReceiptOnly,true);assert.deepEqual(withParser.unsupported,[]);
 assert.equal(withParser.preparationQueue,true);
 // The tail alone is NOT admissible: moving this landing point must always leave
 // a registered trace in the verifier.
 const alone=candidateCompatibilityProfile([{path:tail}]);
 assert.equal(alone.applyTimingReceiptOnly,false);assert.deepEqual(alone.unsupported,[tail]);
 // Any outsider loses the flag AND leaves the tail unsupported.
 for(const extra of ['tools/worker-local-release-rotation.mjs','tools/publish-prepared-main.mjs','tools/publish-main.mjs','tools/worker-local-service.ps1','tools/preparation-producer-qualification.mjs']){
  const wide=candidateCompatibilityProfile([{path:tail},{path:verifier},{path:extra}]);
  assert.equal(wide.applyTimingReceiptOnly,false,extra);
  assert.ok(wide.unsupported.includes(tail),extra);
 }
 // Without the tail there is nothing to admit, and a rename is not the same file.
 assert.equal(candidateCompatibilityProfile([{path:verifier}]).applyTimingReceiptOnly,false);
 const renamed=candidateCompatibilityProfile([{before:tail,path:'tools/renamed-tail.mjs'},{path:verifier}]);
 assert.equal(renamed.applyTimingReceiptOnly,false);
 assert.ok(renamed.unsupported.includes(tail));assert.ok(renamed.unsupported.includes('tools/renamed-tail.mjs'));
});
test('C 项第三步修复: applyTimingReceiptPaths is an independent reading of the flag, not a copy of it',()=>{
 // The project has had a gate fail silently behind a single unverified number.
 // This flag's criterion is indirect, so the diagnostic field must be redundant
 // with the boolean and the two must be cross-checkable in REPORT.json.
 const tail='tools/publish-main-tail.mjs',parser='tools/publish-latest-main.mjs',verifier='tools/verify-release-candidate.mjs';
 const hit=candidateCompatibilityProfile([{path:tail},{path:verifier}]);
 assert.equal(hit.applyTimingReceiptOnly,true);
 assert.deepEqual(hit.applyTimingReceiptPaths,[tail,verifier],'flag 为 true 时，参与判定的文件集合必须恰好是这两项');
 const three=candidateCompatibilityProfile([{path:tail},{path:parser},{path:verifier}]);
 assert.deepEqual(three.applyTimingReceiptPaths,[tail,parser,verifier]);
 // flag false: the set must not claim the tail took part in a passing decision.
 const alone=candidateCompatibilityProfile([{path:tail}]);
 assert.equal(alone.applyTimingReceiptOnly,false);
 assert.deepEqual(alone.applyTimingReceiptPaths,[tail]);
 assert.ok(alone.unsupported.includes(tail),'集合含 tail 而 flag 为 false 时，tail 必须仍在 unsupported 里');
 const none=candidateCompatibilityProfile([{path:'tools/worker-local-service.ps1'}]);
 assert.equal(none.applyTimingReceiptOnly,false);
 assert.deepEqual(none.applyTimingReceiptPaths,[]);
 // Outsiders never enter the diagnostic set, so it cannot be inflated into
 // looking like a legal combination.
 const wide=candidateCompatibilityProfile([{path:tail},{path:verifier},{path:'tools/worker-local-release-rotation.mjs'}]);
 assert.equal(wide.applyTimingReceiptOnly,false);
 assert.deepEqual(wide.applyTimingReceiptPaths,[tail,verifier],'集合只报成员，判定失败的原因要靠 unsupported 看');
 assert.ok(wide.unsupported.includes(tail));
});
test('C 项第三步修复: the new flag does not drift the four existing narrow flags',()=>{
 // It only ever calls supported.add, so every other qualification must read
 // exactly as before. Pinned because a widened `supported` set is the kind of
 // change that passes every test about its own feature.
 const verifier='tools/verify-release-candidate.mjs',continuation='tools/manual-maintenance-continuation.mjs';
 const cases=[
  ['preparationProducerQualifyOnly','tools/preparation-producer-qualification.mjs',[{path:'tools/preparation-producer-qualification.mjs'},{path:'tools/worker-local-release-rotation.mjs'},{path:verifier}]],
  ['workerJsonFailureCauseOnly','tools/worker-local-service.ps1',[{path:'tools/worker-local-service.ps1'},{path:verifier},{path:continuation}]],
  ['descendantCreationGuardOnly',null,[{path:'tools/django-local-service.ps1'},{path:verifier},{path:continuation}]],
  ['dingtalkScreenshotAclOnly',null,[{path:'tools/django-ai.ps1'},{path:verifier},{path:continuation}]],
 ];
 for(const [flag,,changes] of cases){
  const p=candidateCompatibilityProfile(changes);
  assert.equal(p[flag],true,flag);
  assert.deepEqual(p.unsupported,[],flag);
  // None of them is the new flag, and none drags the tail in.
  assert.equal(p.applyTimingReceiptOnly,false,flag);
  assert.ok(!p.applyTimingReceiptPaths.includes('tools/publish-main-tail.mjs'),flag);
 }
 // piMainResumeOnly is the one other door to the tail: it lists the tail among
 // piResumeFiles, so that combination admits it independently of the new flag.
 // Both only add to `supported`, so they cannot interfere — registered here so a
 // later reader does not mistake it for the new flag leaking.
 const resume=candidateCompatibilityProfile([{path:'tools/publish-main-resume.mjs'},{path:'tools/pi_agent_upgrade_status.py'}]);
 assert.equal(resume.piMainResumeOnly,true);assert.deepEqual(resume.unsupported,[]);
 assert.equal(resume.applyTimingReceiptOnly,false,'resume 通道不借用新 flag');
});
