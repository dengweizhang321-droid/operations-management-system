import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`${shell}: receiver startup approval and singleton fail closed`, () => {
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("tests/dingtalk-startup-state.test.ps1"), "-Controller", path.resolve("tools/django-ai.ps1")],
    { encoding: "utf8", windowsHide: true, timeout: 15000,
      env: shell === "powershell.exe" ? { ...process.env, PSModulePath: path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/Modules") } : process.env });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /isolated state and process tests passed/);
  });
}

test("ordinary system startup invokes the receiver after readiness and guarded release startup preserves it", () => {
  const source = readFileSync("tools/worker-local-service.ps1", "utf8");
  const start = source.slice(source.indexOf("function Invoke-WorkerSystemStart"), source.indexOf("function Stop-WorkerOnly"));
  assert.equal((start.match(/Start-SystemDingTalkReceiver/g) || []).length, 2);
  assert.ok(start.indexOf("Ensure-DjangoSystemReady") < start.indexOf("Start-SystemDingTalkReceiver"));
  assert.match(start, /if \(\$status.State -eq "exact_release"\) \{[\s\S]*?if \(-not \$RequireReadyBackend\) \{ Start-SystemDingTalkReceiver \}/);
  assert.match(start, /\$startResult = Start-VerifiedWorkerSupervisor[^\r\n]+\s+if \(-not \$RequireReadyBackend\) \{ Start-SystemDingTalkReceiver \}\s+return \$startResult/);
  assert.match(source, /if \(\$Action -eq "Start"\) \{\s+\$startResult = if \(\$JoinedConcurrentLifecycle\) \{ Get-JoinedWorkerStartResult \$identity \} else \{ Invoke-WorkerSystemStart \$identity -RequireReadyBackend:\(\$BackendStartPolicy -eq "RequireReady"\) \}/);
  const joined = source.slice(source.indexOf("function Get-JoinedWorkerStartResult"), source.indexOf("function Invoke-WorkerSystemStart"));
  assert.doesNotMatch(joined, /Start-SystemDingTalkReceiver|Invoke-DjangoStartProcess|Ensure-DjangoSystemReady/);
  const ai = readFileSync("tools/django-ai.ps1", "utf8");
  assert.match(ai, /"AutoStartDingTalk" \{ Invoke-WithServiceMutex \{ Start-ConfiguredDingTalkReceiver \} \}/);
  assert.match(ai, /"StopDingTalk" \{ Invoke-WithServiceMutex \{ Set-DingTalkStartup \$false; Stop-OwnedProcess/);
  const stop = ai.slice(ai.indexOf("function Stop-AiStack"), ai.indexOf("function Read-DingTalkStartup"));
  assert.doesNotMatch(stop, /Set-DingTalkStartup/);
});

test("real startup function preserves receiver state during release and refuses unready backends", () => {
  const controller = path.resolve("tools/worker-local-service.ps1").replaceAll("'", "''");
  const script = `
. '${controller}' -FunctionsOnly -AllowTestRuntimeRoot
$script:trace=[Collections.Generic.List[string]]::new()
function Assert-WorkerMaintenanceInactive {}
function Write-WorkerStartupTiming {}
function Get-WorkerStatusInternal { @{State=$script:testState;Supervisor=@{ProcessId=42}} }
function Ensure-DjangoSystemReady {param([switch]$RequireReadyBackend);$script:trace.Add('ready');if($script:failReady){throw 'synthetic_not_ready'} }
function Invoke-ReleaseVerification {$script:trace.Add('verify');@{supervisorPrelaunchReceiptSha256=('a'*64)}}
function Start-VerifiedWorkerSupervisor {$script:trace.Add('start');@{status='started'}}
function Start-SystemDingTalkReceiver {$script:trace.Add('receiver')}
$identity=@{ReleaseId='synthetic';Sha256=('a'*64)}
$rows=@()
foreach($state in @('exact_release','stopped')){foreach($guarded in @($false,$true)){
  $script:testState=$state;$script:failReady=$false;$script:trace.Clear()
  [void](Invoke-WorkerSystemStart $identity -RequireReadyBackend:$guarded)
  $rows+=@{state=$state;guarded=$guarded;trace=@($script:trace.ToArray())}
}}
$script:testState='stopped';$script:failReady=$true;$script:trace.Clear();$rejected=$false
try{[void](Invoke-WorkerSystemStart $identity -RequireReadyBackend)}catch{if($_.Exception.Message -ne 'synthetic_not_ready'){throw};$rejected=$true}
@{rows=$rows;rejected=$rejected;failureTrace=@($script:trace.ToArray())}|ConvertTo-Json -Depth 6 -Compress
`;
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const evidence=JSON.parse(result.stdout.trim()) as {rows:Array<{state:string;guarded:boolean;trace:string[]}>;rejected:boolean;failureTrace:string[]};
  for(const row of evidence.rows){
    assert.deepEqual(row.trace,["ready",...(row.state==="stopped"?["verify","start"]:[]),...(!row.guarded?["receiver"]:[])]);
  }
  assert.equal(evidence.rejected,true);
  assert.deepEqual(evidence.failureTrace,["ready"]);
});

test("isolated startup never reaches the production receiver; installed controller failures remain visible", () => {
  const controller = path.resolve("tools/worker-local-service.ps1").replaceAll("'", "''");
  const script = `
. '${controller}' -FunctionsOnly -AllowTestRuntimeRoot
$script:calls=0
function Test-IsIsolatedTestRuntime { $true }
function Invoke-DjangoStartProcess { $script:calls++; throw 'Production dispatch' }
Start-SystemDingTalkReceiver
if($script:calls -ne 0){throw 'Isolation failed'}
function Test-IsIsolatedTestRuntime { $false }
function Test-Path { $true }
function Assert-NoReparsePath {}
function Invoke-WebRequest { @{StatusCode=200} }
function Invoke-DjangoStartProcess($Controller,$ControlAction) {
  if($ControlAction -cne 'AutoStartDingTalk' -or $Controller -notlike '*django-ai.ps1'){throw 'Wrong controller'}
  $script:calls++; return @{ExitCode=1}
}
$denied=$false
try { Start-SystemDingTalkReceiver } catch { $denied=$_.Exception.Message -match 'receiver startup failed' }
if(-not $denied -or $script:calls -ne 1){throw 'Failure hidden or repeated'}
Write-Output 'isolated and bounded'
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
