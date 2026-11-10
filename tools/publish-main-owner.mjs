/** Read-only identity/retirement observation; no PID termination or cleanup. */
import assert from 'node:assert/strict';
import {taskPowerShell} from './main-prebuild-task.mjs';
const census=String.raw`
function Hash-Text([string]$s){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Expanded([string]$s){for($round=0;$round -lt 3;$round++){$extra='';foreach($m in [regex]::Matches($s,'[A-Za-z0-9+/]{80,}={0,2}')){try{$b=[Convert]::FromBase64String($m.Value);$extra+=[Text.Encoding]::Unicode.GetString($b)+[Text.Encoding]::UTF8.GetString($b)}catch{}};$s+=$extra};$s.Replace('\','/').ToLowerInvariant()}
$rows=@(foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
 if($p.ProcessId -eq $PID){continue}
 $interesting=([string]$p.Name -imatch '^(powershell|pwsh|python|pythonw|node|wsl)(\.exe)?$')
 $missing=$interesting -and (-not $p.CreationDate -or -not $p.ExecutablePath -or -not $p.CommandLine)
 $related=$false
 if($interesting -and -not $missing -and $p.ProcessId -ne $v.selfPid){$text=Expanded ([string]$p.CommandLine);foreach($needle in @($v.needles)){if($needle -and $text.Contains(([string]$needle).Replace('\','/').ToLowerInvariant())){$related=$true}}}
 if($p.ProcessId -eq $v.subjectPid -or $p.ProcessId -in @($v.actorPids) -or $related -or $missing){
  [pscustomobject]@{processId=[int]$p.ProcessId;creationDate=$(if($p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{$null});sessionId=[int]$p.SessionId;commandLineSha256=$(if($p.CommandLine){Hash-Text ([string]$p.CommandLine)}else{$null});executablePathSha256=$(if($p.ExecutablePath){Hash-Text ([string]$p.ExecutablePath)}else{$null});related=$related;identityUnreadable=$missing}
 }
});ConvertTo-Json -InputObject @($rows) -Depth 3 -Compress`;

export async function capturePublicationOwner(){
 const rows=await taskPowerShell(census,{subjectPid:process.pid,selfPid:process.pid,actorPids:[],needles:[]});
 const row=rows.find(r=>r.processId===process.pid);
 assert.ok(row&&!row.identityUnreadable&&row.creationDate&&row.commandLineSha256&&row.executablePathSha256,'发布owner身份不可核验');
 return {processId:row.processId,creationDate:row.creationDate,sessionId:row.sessionId,commandLineSha256:row.commandLineSha256,executablePathSha256:row.executablePathSha256};
}
export function verifyPublisherRetired(owner,rows,actorPids=[]){
 assert.ok(owner&&Number.isSafeInteger(owner.processId)&&owner.creationDate&&owner.commandLineSha256&&owner.executablePathSha256,'原发布缺少可核验owner；历史操作不进入通用续接');
 for(const row of rows){
  assert.equal(row.identityUnreadable,false,'控制进程身份不可读，保留未知');
  if(row.processId===owner.processId)assert.notEqual(row.creationDate,owner.creationDate,'原publisher仍在运行');
  assert.equal(row.related,false,'原操作仍有控制进程运行');
  assert.ok(!actorPids.includes(row.processId),'原结果未知的直接子进程PID仍存在');
 }
 return true;
}
export async function assertPublicationRetired({owner,actorPids,source,attempt,prepared}){
 // Only identifiers that actually exist on this preparation are searched
 // for in still-running command lines: a no-Pi resume has no
 // piRunnerUpgrade, and an absent needle must not be turned into the
 // literal string "undefined" (which could coincidentally match something
 // unrelated in a live command line) or silently become an empty needle
 // (which Expanded()/.Contains('') would make match everything).
 const needles=[source,attempt,prepared.djangoPackage.id,prepared.piRunnerUpgrade?.registeredPlanSha256].filter(Boolean);
 const rows=await taskPowerShell(census,{subjectPid:owner.processId,selfPid:process.pid,actorPids,needles});
 return verifyPublisherRetired(owner,rows,actorPids);
}
