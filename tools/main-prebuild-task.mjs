/** Fixed, on-demand InteractiveToken/LUA preparation consumer. No arbitrary argv. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
export const taskHost='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const q=s=>"'"+s.replaceAll("'","''")+"'";
export async function taskPowerShell(code,payload={}){
 const script="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();[Console]::InputEncoding=[Text.UTF8Encoding]::new();$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;"+code;
 const pending=execute(taskHost,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{...process.env,PSModulePath:path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
 pending.child.stdin.end(JSON.stringify(payload));const result=await pending;return JSON.parse(result.stdout.trim());
}
const identityScript=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PreparationToken{[DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr t,int c,IntPtr b,int n,out int r);public static int Read(IntPtr t,int c){int n;GetTokenInformation(t,c,IntPtr.Zero,0,out n);IntPtr p=Marshal.AllocHGlobal(n);try{if(!GetTokenInformation(t,c,p,n,out n))throw new System.ComponentModel.Win32Exception();if(c==20)return Marshal.ReadInt32(p);IntPtr sid=Marshal.ReadIntPtr(p);int count=Marshal.ReadByte(sid,1);return Marshal.ReadInt32(sid,8+4*(count-1));}finally{Marshal.FreeHGlobal(p);}}}';$w=[Security.Principal.WindowsIdentity]::GetCurrent();$session=[Diagnostics.Process]::GetCurrentProcess().SessionId;$explorers=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe' AND SessionId=$session"|Where-Object{(Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid -ceq $w.User.Value});if($session -le 0 -or $explorers.Count -ne 1){throw 'Unique same-user interactive session required'};@{sid=$w.User.Value;sessionId=$session;elevated=([PreparationToken]::Read($w.Token,20) -ne 0);integrityRid=[PreparationToken]::Read($w.Token,25)}|ConvertTo-Json -Compress`;
export async function currentPreparationIdentity(){return taskPowerShell(identityScript);}
export function assertOrdinaryIdentity(identity,sid){assert.equal(identity.sid,sid,'Preparation user changed');assert.ok(Number.isSafeInteger(identity.sessionId)&&identity.sessionId>0);assert.equal(identity.elevated,false,'Preparation must run without elevation');assert.equal(identity.integrityRid,8192,'Preparation requires medium integrity');return identity;}
export async function makePreparationTask(configFile,config){
 const identity=await currentPreparationIdentity(),dispatcher=path.join(config.stateDirectory,'control/tools/publish-latest-main.mjs');
 assert.ok(config.publisherBaseEnvironment&&typeof config.publisherBaseEnvironment==='object','Bound preparation environment required');
 const frozen=Buffer.from(JSON.stringify(config.publisherBaseEnvironment)).toString('base64');
 const argv='"'+dispatcher+'" --config "'+configFile+'" --consume-preparation';
 assert.ok(![dispatcher,configFile,process.execPath,config.stateDirectory].some(v=>/["\r\n\0]/.test(v)),'Unsafe fixed action path');
 const script="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Environment]::SetEnvironmentVariable('PSModulePath',"+q(path.join(path.dirname(taskHost),'Modules').replaceAll('/','\\'))+",'Process');[Environment]::SetEnvironmentVariable('PSModuleAnalysisCachePath',$null,'Process');$fixed=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+frozen+"'))|ConvertFrom-Json;$log=[IO.Path]::Combine("+q(path.join(config.stateDirectory,'prebuild-queue-v2'))+",'runner-'+[Guid]::NewGuid().ToString()+'.log');$p=[Diagnostics.Process]::new();$p.StartInfo.FileName="+q(process.execPath)+";$p.StartInfo.Arguments="+q(argv)+";$p.StartInfo.WorkingDirectory="+q(config.stateDirectory)+";$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true;$p.StartInfo.EnvironmentVariables.Clear();$fixed.PSObject.Properties|ForEach-Object{$p.StartInfo.EnvironmentVariables[$_.Name]=[string]$_.Value};[void]$p.Start();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync();$p.WaitForExit();[IO.File]::WriteAllText($log,$stdout.Result+$stderr.Result,[Text.UTF8Encoding]::new());exit $p.ExitCode";
 return {version:'teruisi-main-preparation-task-v1',name:'TERUISI.MainPreparation.'+sha(path.resolve(config.stateDirectory).toLowerCase()).slice(0,24),sid:identity.sid,
  node:process.execPath,nodeSha256:sha(await fs.readFile(process.execPath)),hostSha256:sha(await fs.readFile(taskHost)),
  definition:{userId:identity.sid,logonType:3,runLevel:0,actions:1,triggers:0,type:0,path:taskHost.replaceAll('/','\\'),arguments:'-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64'),workingDirectory:config.stateDirectory.replaceAll('/','\\'),enabled:true,allowDemandStart:true,multipleInstances:0,executionTimeLimit:'PT0S',disallowStartIfOnBatteries:false,stopIfGoingOnBatteries:false,startWhenAvailable:false,runOnlyIfNetworkAvailable:false,hidden:true,allowHardTerminate:false,runOnlyIfIdle:false,wakeToRun:false,restartCount:0}};
}
const taskPrelude=`$s=New-Object -ComObject Schedule.Service;$s.Connect();$folder=$s.GetFolder('\\');`;
const projection=`function Projection($d){$sid=[string]$d.Principal.UserId;if($sid -notmatch '^S-1-'){$sid=[Security.Principal.NTAccount]::new($sid).Translate([Security.Principal.SecurityIdentifier]).Value};$a=$d.Actions.Item(1);@{userId=$sid;logonType=[int]$d.Principal.LogonType;runLevel=[int]$d.Principal.RunLevel;actions=[int]$d.Actions.Count;triggers=[int]$d.Triggers.Count;type=[int]$a.Type;path=[string]$a.Path;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;enabled=[bool]$d.Settings.Enabled;allowDemandStart=[bool]$d.Settings.AllowDemandStart;multipleInstances=[int]$d.Settings.MultipleInstances;executionTimeLimit=[string]$d.Settings.ExecutionTimeLimit;disallowStartIfOnBatteries=[bool]$d.Settings.DisallowStartIfOnBatteries;stopIfGoingOnBatteries=[bool]$d.Settings.StopIfGoingOnBatteries;startWhenAvailable=[bool]$d.Settings.StartWhenAvailable;runOnlyIfNetworkAvailable=[bool]$d.Settings.RunOnlyIfNetworkAvailable;hidden=[bool]$d.Settings.Hidden;allowHardTerminate=[bool]$d.Settings.AllowHardTerminate;runOnlyIfIdle=[bool]$d.Settings.RunOnlyIfIdle;wakeToRun=[bool]$d.Settings.WakeToRun;restartCount=[int]$d.Settings.RestartCount}};`;
export async function readPreparationTask(spec){return taskPowerShell(taskPrelude+projection+`try{$t=$folder.GetTask($v.name)}catch{if($_.Exception.HResult -eq -2147024894){'null';exit};throw};Projection $t.Definition|ConvertTo-Json -Compress`,spec);}
export async function assertPreparationTask(spec){
 assert.equal(spec.version,'teruisi-main-preparation-task-v1');assert.equal(sha(await fs.readFile(spec.node)),spec.nodeSha256,'Task Node changed');assert.equal(sha(await fs.readFile(taskHost)),spec.hostSha256,'Task host changed');
 assert.deepEqual(await readPreparationTask(spec),spec.definition,'Fixed preparation task changed');
}
export async function installPreparationTask(spec,oldSpec,{resume=false}={}){
 const actual=await readPreparationTask(spec);
 if(actual!==null){if(resume&&JSON.stringify(actual,Object.keys(actual).sort())===JSON.stringify(spec.definition,Object.keys(spec.definition).sort())){await assertPreparationTask(spec);return;}assert.ok(oldSpec,'Existing unowned preparation task');assert.deepEqual(actual,oldSpec.definition,'Preparation task predecessor changed');}
 else assert.ok(!oldSpec,'Preparation task predecessor missing');
 await taskPowerShell(taskPrelude+`$d=$s.NewTask(0);$d.Principal.UserId=$v.sid;$d.Principal.LogonType=3;$d.Principal.RunLevel=0;$d.Settings.Enabled=$true;$d.Settings.AllowDemandStart=$true;$d.Settings.MultipleInstances=0;$d.Settings.ExecutionTimeLimit='PT0S';$d.Settings.DisallowStartIfOnBatteries=$false;$d.Settings.StopIfGoingOnBatteries=$false;$d.Settings.StartWhenAvailable=$false;$d.Settings.RunOnlyIfNetworkAvailable=$false;$d.Settings.Hidden=$true;$d.Settings.AllowHardTerminate=$false;$d.Settings.RunOnlyIfIdle=$false;$d.Settings.WakeToRun=$false;$d.Settings.RestartCount=0;$a=$d.Actions.Create(0);$a.Path=$v.definition.path;$a.Arguments=$v.definition.arguments;$a.WorkingDirectory=$v.definition.workingDirectory;[void]$folder.RegisterTaskDefinition($v.name,$d,6,$v.sid,$null,3);'true'`,spec);
 await assertPreparationTask(spec);
}
export async function wakePreparationTask(binding){
 const spec=binding.state.preparationTask;assert.ok(spec,'Ordinary-user preparation task has not been adopted');await assertPreparationTask(spec);
 const identity=await currentPreparationIdentity();assert.equal(identity.sid,spec.sid,'Preparation caller user changed');
 await taskPowerShell(taskPrelude+`$t=$folder.GetTask($v.spec.name);[void]$t.RunEx($null,4,$v.sessionId,$v.spec.sid);'true'`,{spec,sessionId:identity.sessionId});
 return {status:'consumer-woken',sessionId:identity.sessionId,publicationPerformed:false};
}

export function decodedControlCommand(command){let result=command??'';for(let round=0;round<3;round++){const added=[];for(const match of result.matchAll(/[A-Za-z0-9+/]{80,}={0,2}/g)){try{const raw=Buffer.from(match[0],'base64');for(const encoding of ['utf16le','utf8']){const value=raw.toString(encoding);if(/[\\/:]/.test(value)&&value.length<1048576)added.push(value);}}catch{}}if(added.length)result+='\n'+added.join('\n');}return result.replaceAll('\\','/').replace(/\/{2,}/g,'/').toLowerCase().trimEnd();}
