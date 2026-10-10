import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile } from 'node:fs/promises';
import { runProcess } from '../tools/worker-local-release.mjs';
import { runReadOnlyProcess, retryReadOnlyObservation } from '../tools/release-readonly-retry.mjs';

const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const quote=value=>`'${value.replaceAll("'","''")}'`;
function fixtureScript({hold=false,record}={}) {
  const descendantArgs=`-e "process.stdout.write('D_CHILD_READY');setTimeout(()=>{},2200)"`;
  return `$p=New-Object Diagnostics.Process;$p.StartInfo.FileName=${quote(process.execPath)};$p.StartInfo.Arguments=${quote(descendantArgs)};$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;[void]$p.Start();Write-Output ('D_PARENT_READY '+$p.Id);${record?`[IO.File]::WriteAllText(${quote(record)},[string]$p.Id);`:''}${hold?'Start-Sleep -Seconds 10':''}`;
}
const args=script=>['-NoProfile','-NonInteractive','-Command',script];
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

test('D independent: calibrated inherited EOF does not postpone mutation completion', {skip:process.platform!=='win32'},async t=>{
  const script=fixtureScript();
  const calibrated=await new Promise((resolve,reject)=>{
    const start=performance.now(),child=spawn(shell,args(script),{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let exitMs,output='';
    child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.resume();child.once('error',reject);
    child.once('exit',()=>{exitMs=performance.now()-start;});
    child.once('close',code=>resolve({code,exitMs,eofMs:performance.now()-start,output}));
  });
  assert.equal(calibrated.code,0);assert.match(calibrated.output,/D_PARENT_READY/);
  assert.ok(calibrated.eofMs-calibrated.exitMs>1400,'the native fixture must establish real EOF inheritance');
  t.diagnostic(JSON.stringify({calibration:calibrated}));
  const result=await runProcess(shell,args(script),{timeoutMs:1600,outputProtocol:'direct-exit-files',cleanup:'preserve'});
  assert.equal(result.processEvidence.exitCode,0);assert.equal(result.processEvidence.code,'completed');
  const pid=Number(/D_PARENT_READY (\d+)/.exec(result.stdout)?.[1]);
  assert.ok(pid>0);assert.equal(alive(pid),true);
  t.diagnostic(JSON.stringify({result:result.processEvidence,descendantAliveAtDirectCompletion:true}));
  // The descendant is this fixture's bounded child and expires itself.
  await new Promise(resolve=>setTimeout(resolve,2400));assert.equal(alive(pid),false);
});

test('D independent: read-only timeout ends only the probe and preserves its bounded service-like descendant', {skip:process.platform!=='win32'},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-d-process-')),record=path.join(root,'child.pid');
  let failure;
  try {await runReadOnlyProcess(shell,args(fixtureScript({hold:true,record})),{timeoutMs:1100});}
  catch(error){failure=error;}
  assert.equal(failure?.code,'STATUS_TIMEOUT');
  assert.equal(failure.processEvidence.cleanup,'direct');
  assert.equal(failure.processEvidence.outputProtocol,'direct-exit-files');
  assert.equal(alive(failure.processEvidence.processId),false);
  const descendant=Number(await readFile(record,'utf8'));
  assert.ok(descendant>0);assert.equal(alive(descendant),true);
  t.diagnostic(JSON.stringify({failure:failure.processEvidence,descendantAliveAfterProbeTimeout:true}));
  await new Promise(resolve=>setTimeout(resolve,2400));assert.equal(alive(descendant),false);
});

test('D independent: retry attempt persistence cannot turn an exhausted common deadline into success',async()=>{
  let clock=0,calls=0,recorded=0;
  await assert.rejects(retryReadOnlyObservation({stage:'d-integrated-closeout',totalTimeoutMs:1000,now:()=>clock,
    query:async()=>{calls++;clock=900;return {releaseId:'synthetic'};},
    onAttempt:async()=>{recorded++;clock=1001;}}),error=>error.code==='DEADLINE_EXCEEDED');
  assert.equal(calls,1);assert.equal(recorded,1);
});
