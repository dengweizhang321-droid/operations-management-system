import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidateCompatibilityProfile,assertPrivateCandidateLocation,compareFunctionOnlyChange,verifyReleaseCandidate,candidateTestEnvironment,usesGateTimingExemption} from '../tools/verify-release-candidate.mjs';
import {execFileSync} from 'node:child_process';

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
