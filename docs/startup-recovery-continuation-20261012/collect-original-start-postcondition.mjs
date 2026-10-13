import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {runReadOnlyProcess} from '../../tools/release-readonly-retry.mjs';
const own=path.dirname(fileURLToPath(import.meta.url));
export async function collectOriginalStartPostcondition({outputRoot}) {
 assert.equal(path.resolve(outputRoot),path.resolve('E:/codex-artifacts/startup-recovery-continuation-20261012/original-start-postcondition-v1'));
 const source=path.join(own,'Collect-OriginalStartPostcondition.ps1'),quote=s=>"'"+s.replaceAll("'","''")+"'";
 const code="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$global:LASTEXITCODE=0;& "+quote(source)+" -OutputRoot "+quote(outputRoot)+";$invocationSucceeded=$?;if($global:LASTEXITCODE -ne 0){exit $global:LASTEXITCODE};if(-not $invocationSucceeded){exit 1};exit 0";
 const env={...process.env};for(const k of Object.keys(env))if(k.toUpperCase()==='PSMODULEPATH')delete env[k];env.PSModulePath=path.win32.normalize('C:/Windows/System32/WindowsPowerShell/v1.0/Modules');
 const result=await runReadOnlyProcess('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{timeoutMs:240000,maxOutputBytes:2097152,cwd:own,env});
 const value=JSON.parse(result.stdout);assert.equal(value.version,'original-start-postcondition-capture-v1');assert.equal(value.role.administrator,true);assert.equal(value.role.sid,'S-1-5-21-815909789-107973518-1379257801-1001');return {...value,captureProcessEvidence:result.processEvidence};
}
