import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidateCompatibilityProfile,assertPrivateCandidateLocation,compareFunctionOnlyChange,verifyReleaseCandidate,candidateTestEnvironment} from '../tools/verify-release-candidate.mjs';

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
test('cannot verify dirty candidates or production checkout',async()=>{
 await assert.rejects(verifyReleaseCandidate({sourceRoot:'D:/运营管理系统',base:'HEAD'}),/生产根/);
});
test('a verifier cannot issue evidence for a different source checkout',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foreign-candidate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await assert.rejects(verifyReleaseCandidate({sourceRoot:root,base:'HEAD'}),/不能使用其他工作树/);
});
