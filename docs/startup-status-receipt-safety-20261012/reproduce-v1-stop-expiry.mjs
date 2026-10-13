// Deliberately runs only mocked V1 control flow against the newer expiry tests.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root='E:/codex-artifacts/startup-status-receipt-safety-20261012';
const old=fs.readFileSync(path.join(root,'EXACT_STOP_V1_SOURCE/startup-exact-instance-stop.ps1'),'utf8');
const start=old.indexOf('function Invoke-ExactInstanceStop(');assert(start>=0);
const fn=old.slice(start);let fixture=fs.readFileSync('tests/startup-exact-stop-mocked.ps1','utf8');
fixture=fixture.replace('. $Source',()=>`. $Source\nInvoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(fn).toString('base64')}'))) `);
const script=path.join(root,'EXACT_STOP_V1_EXPIRY_REPRO.ps1');fs.writeFileSync(script,'\ufeff'+fixture,{flag:'wx'});
const results=[];
for(const shell of ['powershell.exe','pwsh.exe']){
 const evidence=path.join(root,'v1-expiry-'+shell);fs.mkdirSync(evidence);
 const env={...process.env,TERUISI_PROCESS_DEADLINE_UNIX_MS:String(Date.now()+30000)};if(shell==='powershell.exe'){for(const k of Object.keys(env))if(k.toUpperCase()==='PSMODULEPATH')delete env[k];env.PSModulePath=path.win32.normalize('C:/Windows/System32/WindowsPowerShell/v1.0/Modules')}
 const r=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script,'-Source',path.resolve('tools/startup-exact-instance-stop.ps1'),'-EvidenceDirectory',evidence],{encoding:'utf8',windowsHide:true,timeout:15000,env});
 fs.writeFileSync(evidence+'/stdout.log',r.stdout??'',{flag:'wx'});fs.writeFileSync(evidence+'/stderr.log',r.stderr??'',{flag:'wx'});
 const events=fs.readFileSync(evidence+'/expiry-during-census.jsonl','utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
 const simulatedStops=events.filter(x=>x.stage==='exit-confirmed').length;assert.notEqual(r.status,0);assert(simulatedStops>0);
 results.push({shell,expectedStops:0,actualSimulatedStops:simulatedStops,fixtureExitCode:r.status,productionStops:0,allProcessOperationsMocked:true});
}
fs.writeFileSync(path.join(root,'EXACT_STOP_V1_EXPIRY_REPRO_RESULT.json'),JSON.stringify({results,oldSourceUnchanged:true},null,2)+'\n',{flag:'wx'});console.log(results);
