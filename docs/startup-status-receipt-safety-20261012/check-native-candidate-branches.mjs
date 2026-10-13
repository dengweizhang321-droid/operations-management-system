import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root='E:/codex-artifacts/startup-status-receipt-safety-20261012';
const packet=JSON.parse(fs.readFileSync(path.join(root,'NATIVE_WATCHDOG_CANDIDATE_V1.json')));
const directory=packet.outputDirectory;let checks=0;
for(const shell of ['powershell.exe','pwsh.exe']){
 for(const name of ['operations-system-watchdog.ps1','watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1']){
  const file=path.join(directory,name).replaceAll("'","''"),code=`$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);if($e.Count){throw 'Candidate syntax failed'};[Console]::Write('parsed')`;
  const r=spawnSync(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'parsed');checks++;
 }
 for(const [name,args,reason]of [
  ['watchdog-status-backend.ps1',['-Action','Start'],/ValidateSet|validation|验证/i],
  ['watchdog-status-backend.ps1',['-Action','AggregateStatus','-DiagnosticTarget','Worker'],/readonly_worker_status_only/],
  ['watchdog-status-control.ps1',['-Action','Status','-StopWorker'],/readonly_status_only/],
  ['watchdog-status-control.ps1',['-Action','Status','-Open'],/readonly_status_only/],
 ]){
  const r=spawnSync(shell,['-NoProfile','-NonInteractive','-File',path.join(directory,name),...args],{encoding:'utf8',windowsHide:true,timeout:10000});assert.notEqual(r.status,0);assert.match(r.stderr,reason);checks++;
 }
}
const result={version:'actual-generated-native-driver-branches-v1',candidateBundleId:packet.bundleId,checks,hosts:['PS5','PS7'],actualStatusInvocations:0,productionActions:0};
fs.writeFileSync(path.join(root,'NATIVE_CANDIDATE_BRANCH_RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(result);
