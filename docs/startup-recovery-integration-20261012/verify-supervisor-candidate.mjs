import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {hash,readStable} from './recovery-context.mjs';
const e='E:/codex-artifacts/startup-recovery-integration-20261012',packet=JSON.parse(fs.readFileSync(e+'/NATIVE_WATCHDOG_CANDIDATE_V2.json'));const dir=packet.outputDirectory;
for(const [name,digest]of Object.entries(packet.files))readStable(path.join(dir,name),digest);
const results=[];
for(const host of ['powershell.exe','pwsh.exe']){
 const source=`$ErrorActionPreference='Stop';$files=[IO.Directory]::GetFiles('${dir.replaceAll("'","''")}','*.ps1');foreach($p in $files){$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$e);if($e.Count){throw ($e|Out-String)}};@{status='parsed';count=$files.Count}|ConvertTo-Json -Compress`;
 const env={...process.env};if(host==='powershell.exe'){for(const k of Object.keys(env))if(k.toUpperCase()==='PSMODULEPATH')delete env[k];env.PSModulePath=path.win32.normalize('C:/Windows/System32/WindowsPowerShell/v1.0/Modules');}
 const parsed=spawnSync(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{encoding:'utf8',env,windowsHide:true,timeout:20000});assert.equal(parsed.status,0,parsed.stderr);assert.equal(JSON.parse(parsed.stdout).count,6);results.push({host,kind:'actual-six-script-parse',exitCode:0});
 const reject=spawnSync(host,['-NoProfile','-NonInteractive','-File',path.join(dir,'watchdog-status-backend.ps1'),'-Action','AggregateStatus','-DiagnosticTarget','Supervisor'],{encoding:'utf8',env,windowsHide:true,timeout:20000});assert.notEqual(reject.status,0);assert(reject.stderr.includes('readonly_worker_status_only'));results.push({host,kind:'actual-supervisor-non-status-rejected-before-binding-load',exitCode:reject.status,stdoutSha256:hash(reject.stdout),stderrSha256:hash(reject.stderr)});
}
for(const [name,digest]of Object.entries(packet.files))readStable(path.join(dir,name),digest);
const result={version:'actual-supervisor-candidate-validation-v2',bundleId:packet.bundleId,files:9,results,productionActions:0,receiptWrites:0,actualStatusExecuted:false};fs.writeFileSync(e+'/ACTUAL_SUPERVISOR_CANDIDATE_VALIDATION_V2.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
