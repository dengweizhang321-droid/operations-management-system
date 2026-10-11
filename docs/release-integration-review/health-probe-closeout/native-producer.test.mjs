// Real private PS5 leaves. Functions are extracted verbatim from the derived
// source; main/aggregate/worker/lifecycle/SQL code is never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,readdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {safeProducerTrace,readProducerEvidence,assertProducerSuccess} from './producer-evidence.mjs';
import {assertHealthyContract} from './health-contract.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),adopted='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9',source=await readFile(new URL('./readonly-control.ps1',import.meta.url),'utf8'),producerSource=await readFile(new URL('./producer-functions.ps1',import.meta.url),'utf8');
const{runProcess}=await import(pathToFileURL(path.join(adopted,'tools/worker-local-release.mjs')));
function fn(name){const start=source.indexOf(`function ${name} {`);assert.ok(start>=0);const next=source.indexOf('\nfunction ',start+1);return source.slice(start,next<0?source.length:next).trimEnd();}
const healthFunctions=['Invoke-SystemHealthProbe','ConvertFrom-SystemHealthContent','Get-SystemProbeSummary','Get-SourceSystemHealthState'].map(fn).join('\n\n');
const deadlineSource=await readFile(path.join(adopted,'tools/process-deadline.ps1'),'utf8');
async function removePrivate(root){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('teruisi-health-producer-'));for(const part of ['production/health-probe-evidence','production']){const dir=path.join(root,part);let names;try{names=await readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}for(const n of names){if(part.endsWith('health-probe-evidence'))await unlink(path.join(dir,n));}await rmdir(dir);}for(const n of await readdir(root))await unlink(path.join(root,n));await rmdir(root);}
async function leaf(mode){
  const root=await mkdtemp(path.join(os.tmpdir(),'teruisi-health-producer-')),requests=[];let server;
  try{
    server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});assert.equal(req.method,'GET');const kind=req.url.slice(1);const body=kind==='helper'?{ok:true}:{ok:true,status:kind==='live'?'live':'ready'};setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));},kind==='ready'?3500:0);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
    const start=Date.now(),budget=mode==='late'?22000:12000,deadline=start+budget,scopeSha256='a'.repeat(64),producerSha256=sha(source),authorityRawSha256='b'.repeat(64),quote=s=>"'"+s.replaceAll("'","''")+"'";
    const override=mode==='late'?`$originalGetRemaining=(Get-Command Get-ProcessRemaining).ScriptBlock
function Get-ProcessRemaining {param([long]$Deadline) if($script:lastHealthEvidence){throw 'DEADLINE_EXCEEDED'};return (& $originalGetRemaining $Deadline)}`:'';
    const script=path.join(root,'fixture.ps1'),payload=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
Add-Type -AssemblyName System.Net.Http
${deadlineSource}
${healthFunctions}
${producerSource}
$script:ReadonlyProbeContext=[pscustomobject]@{root=${quote(root)};scopeSha256='${scopeSha256}';producerSha256='${producerSha256}';authorityRawSha256='${authorityRawSha256}'}
$script:lastHealthCheckAt=$null;$script:lastHealthEvidence=$null;$script:lastHealthState='Unresponsive'
$LivenessUrl='http://127.0.0.1:${port}/live';$HelperHealthUrl='http://127.0.0.1:${port}/helper';$ReadinessUrl='http://127.0.0.1:${port}/ready'
${override}
try{$state=Get-SystemHealthState -Refresh;@{state=$state;healthEvidence=$script:lastHealthEvidence;pid=$PID}|ConvertTo-Json -Compress -Depth 12;exit 0}
catch{@{state='StatusError';reason='PRIVATE_FIXTURE_SENTINEL';healthEvidence=$script:lastHealthEvidence;pid=$PID}|ConvertTo-Json -Compress -Depth 12;exit 7}
`;
    await writeFile(script,'\ufeff'+payload);const env={SystemRoot:process.env.SystemRoot,windir:process.env.windir,COMSPEC:process.env.COMSPEC,TEMP:root,TMP:root,PATH:path.join(process.env.SystemRoot,'System32'),PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules'),TERUISI_PROCESS_DEADLINE_UNIX_MS:String(deadline)};
    let result,error;try{result=await runProcess('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',script],{cwd:root,env,timeoutMs:budget,deadlineUnixMs:deadline,outputProtocol:'direct-exit-files',cleanup:'direct',label:'isolated producer leaf'});}catch(e){error=e;}
    const p=result?.processEvidence??error?.processEvidence;assert.ok(p);assert.ok(p.processId>0);try{process.kill(p.processId,0);assert.fail('Private PS child still running');}catch(e){assert.equal(e.code,'ESRCH');}
    const refs=await readProducerEvidence({root,scopeSha256,producerSha256,authorityRawSha256,processIds:[p.processId],since:start-5});assert.equal(refs.length,1);const v=refs[0].record;assert.equal(v.processId,p.processId);assert.deepEqual(safeProducerTrace(v),v);assert.equal(requests.length,3);assert.ok(requests.every(r=>['/live','/helper','/ready'].includes(r.path)));
    if(mode==='late'){assert.ok(error);assert.equal(p.exitCode,7);assert.equal(Object.hasOwn(error,'stdout'),false);assert.equal(v.functionReturned,false);assert.equal(v.observedState,null);assert.ok(v.healthEvidence);assert.ok(p.stdoutBytes>0);assert.match(p.stdoutSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(v).includes('PRIVATE_FIXTURE_SENTINEL'),false);}
    else{assert.equal(error,undefined);assert.equal(p.exitCode,0);const body=JSON.parse(result.stdout);assert.equal(body.state,'Running');assertHealthyContract(body.healthEvidence);assertProducerSuccess(refs,{scopeSha256,producerSha256,authorityRawSha256,processId:p.processId,healthEvidence:body.healthEvidence,since:start-5,until:Date.now()+5,nativeElapsedMs:p.elapsedMs});assert.ok(v.healthEvidence.probes.ready.elapsedMs>=3400);assert.ok(v.healthEvidence.probes.ready.elapsedMs<=5000);}
    console.log(JSON.stringify({privateFixture:true,mode,pid:p.processId,exitCode:p.exitCode,elapsedMs:p.elapsedMs,childExitIndependentlyObserved:true,networkRequests:requests.length,formalNetworkRequests:0,functionReturned:v.functionReturned,readyElapsedMs:v.healthEvidence?.probes.ready.elapsedMs,traceRawSha256:refs[0].sha256,failedStdoutParsed:false}));
  }finally{if(server)await new Promise(r=>server.close(r));await removePrivate(root);}
}
test('actual PS5 3.5s ready response yields strict measured producer proof with own exited PID',()=>leaf('healthy'));
test('actual PS5 nonzero after health final deadline still yields bounded producer trace; lost stdout is not parsed',()=>leaf('late'));
