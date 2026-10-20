import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {candidateCompatibilityProfile} from '../tools/verify-release-candidate.mjs';
const base=process.env.TERUISI_COMPATIBILITY_BASE??'8e1411cc';
const before=file=>execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}).replaceAll('\r\n','\n');
test('mutex diagnostics leave original ownership, shared deadline and release code identical',async()=>{
 const file='tools/manual-maintenance-lock.psm1',text=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n'),original=before(file);
 // On the original contention base the diagnostics are the reviewed addition.
 // Once a later base already contains them, this task must leave the file exact.
 if(original.includes('# LOCK_DIAGNOSTICS_BEGIN')){assert.equal(text,original);return;}
 const region=/^    # LOCK_DIAGNOSTICS_BEGIN\n[\s\S]*?^    # LOCK_DIAGNOSTICS_END\n/m;
 assert.equal((text.match(/# LOCK_DIAGNOSTICS_BEGIN/g)??[]).length,1);
 const core=text.replace(region,'').replace(/^[ \t]*Write-MaintenanceLockDiagnostic [^\n]*\n/gm,'').replace("[int] $WaitMilliseconds = 120000,\n\n        # Optional presentation sink; never consumed by lifecycle admission.\n        [string] $DiagnosticPath = ''","[int] $WaitMilliseconds = 120000");
 assert.equal(core,original);
 assert.match(text,/\[Console\]::Error.WriteLine/);assert.doesNotMatch(text,/owner\s*=/i);
});
test('maintenance entry only adds the diagnostic sink to the original dual-lock call',async()=>{
 const file='tools/manual-maintenance-start.ps1',next=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n'),original=before(file);
 const addition=' -DiagnosticPath (Get-MaintenanceDiagnosticPath)';
 if(original.includes('# DIAGNOSTIC_PATH_BEGIN')){assert.equal(next,original);return;}
 assert.equal(next.split(addition).length,2);assert.equal(next.replace(/^# DIAGNOSTIC_PATH_BEGIN\n[\s\S]*?^# DIAGNOSTIC_PATH_END\n/m,'').replace(addition,''),original);
});
test('all Start/Stop and weekly business code stays byte-identical',async()=>{
 for(const file of ['tools/django-local-service.ps1','tools/worker-local-service.ps1','backend/workflow/management/commands/new_product_weekly_report.py'])assert.equal((await fs.readFile(file,'utf8')).replaceAll('\r\n','\n'),before(file));
});
test('contention qualifier is finite and never admits an unknown lifecycle change',()=>{
 const changes=['tools/django-workflow-service.ps1','tools/manual-maintenance-lock.psm1','tools/publish-main-progress.mjs','tools/frozen-main-source.mjs','tools/publish-prepared-main.mjs'].map(path=>({status:'M',path}));
 assert.equal(candidateCompatibilityProfile(changes).releaseContentionOnly,true);
 const extended=candidateCompatibilityProfile([...changes,{status:'M',path:'tools/django-local-service.ps1'}]);assert.equal(extended.releaseContentionOnly,false);assert.ok(extended.unsupported.includes('tools/django-workflow-service.ps1'));
});
test('schema refresh preserves the exact approved migration and its policy',async()=>{
 const file='config/main-schema-releases/ai-0086.json',old=JSON.parse(before(file)),next=JSON.parse(await fs.readFile(file,'utf8'));
 for(const key of ['validation','validationSha256','codeSha256']){delete old[key];delete next[key];}
 assert.deepEqual(next,old);
});
