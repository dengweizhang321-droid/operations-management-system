import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {candidateCompatibilityProfile,comparePiResumeInventoryOnly,piResumePackageEntries,comparePiUpgradeObservationOnly} from '../tools/verify-release-candidate.mjs';

test('resume profile is finite and does not accept arbitrary runtime or maintenance changes',()=>{
 const files=['tools/publish-main-resume.mjs','tools/pi_agent_upgrade_status.py','tools/django-ai.ps1','tools/django-local-service.ps1','tools/worker-local-release.mjs'];
 const value=candidateCompatibilityProfile(files.map(p=>({path:p})));assert.equal(value.piMainResumeOnly,true);assert.deepEqual(value.unsupported,[]);assert.equal(value.piExitObservation,false);
 const wider=candidateCompatibilityProfile([...files,'tools/manual-maintenance-lock.psm1'].map(p=>({path:p})));assert.equal(wider.piMainResumeOnly,false);assert.ok(wider.unsupported.includes('tools/publish-main-resume.mjs'));
 assert.ok(candidateCompatibilityProfile([{path:'tools/pi_agent_upgrade_status.py'}]).unsupported.length);
});
test('only the exact six package inventory additions qualify; lifecycle and missing member changes fail',()=>{
 const before={other:['fixed'],functions:[{name:'Prepare-Application',text:'prepare\n'},{name:'Start-ServiceStack',text:'original-start'}]};
 const after=structuredClone(before);after.functions[0].text=piResumePackageEntries.map(name=>'      "tools\\'+name+'",\n').join('')+after.functions[0].text;
 assert.equal(comparePiResumeInventoryOnly(before,after),true);
 after.functions[1].text='changed-start';assert.equal(comparePiResumeInventoryOnly(before,after),false);after.functions[1].text='original-start';
 after.functions[0].text=after.functions[0].text.replace('      "tools\\publish-main-step.mjs",\n','');assert.equal(comparePiResumeInventoryOnly(before,after),false);
});
test('new getter is pinned; arbitrary additions cannot masquerade as the read-only observation adapter',()=>{
 const before={other:['fixed'],functions:[]},after={other:['fixed'],functions:[{name:'Get-PiUpgradeStatus',text:'function Get-PiUpgradeStatus { Start-Service }'}]};assert.equal(comparePiUpgradeObservationOnly(before,after),false);
});
test('installed publisher direct import closure is present in explicit PrepareApp inventory',async()=>{
 const text=await fs.readFile('tools/django-local-service.ps1','utf8'),inventory=new Set([...text.matchAll(/"(tools\\[^"\r\n]+)"/g)].map(m=>m[1].replaceAll('\\','/')));
 const queue=['tools/publish-prepared-main.mjs'],seen=new Set();
 while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);assert.ok(inventory.has(file),'Missing installed module: '+file);
  const source=await fs.readFile(file,'utf8');for(const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[2]));if(target.endsWith('.mjs'))queue.push(target);}
 }
 assert.ok(seen.has('tools/main-prebuild-task.mjs'));assert.ok(inventory.has('tools/pi_agent_upgrade_status.py'));
});
