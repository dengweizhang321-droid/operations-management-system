import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {comparePiExitObservationChange} from '../tools/verify-release-candidate.mjs';

test('Pi qualification freezes all routing and allows only the exact reviewed exit observer',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-exit-boundary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const old=path.join(root,'before.ps1'),current=path.resolve('tools/django-ai.ps1');
 const base=process.env.TERUISI_COMPATIBILITY_BASE??'4b733d1aed4bdc619adccb37debd61d57f1ce6fb';
 await fs.writeFile(old,execFileSync('git',['show',base+':tools/django-ai.ps1'],{windowsHide:true}));
 const parse=file=>{
  const code=`$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($env:TERUISI_TEST_AST,[ref]$null,[ref]$e);if($e.Count){throw 'parse'};[pscustomobject]@{functions=@($a.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{[pscustomobject]@{name=$_.Name;text=$_.Extent.Text}});other=@([string]$a.ParamBlock.Extent.Text)+@($a.EndBlock.Statements|Where-Object{$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{$_.Extent.Text})}|ConvertTo-Json -Depth 5 -Compress`;
  return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{env:{...process.env,TERUISI_TEST_AST:file},encoding:'utf8',windowsHide:true}));
 };
 const before=parse(old),after=parse(current);assert.equal(comparePiExitObservationChange(before,after),true);
 for(const name of ['Start-PiRuntime','Stop-PiRuntime','Wait-PiWorkerExit','Invoke-PiLifecycle']){
  const mutated=structuredClone(after);mutated.functions.find(f=>f.name===name).text+='\nthrow "outside qualification"';
  assert.equal(comparePiExitObservationChange(before,mutated),false,name);
 }
 const mutated=structuredClone(after);mutated.other.push('new dispatch');assert.equal(comparePiExitObservationChange(before,mutated),false);
});
