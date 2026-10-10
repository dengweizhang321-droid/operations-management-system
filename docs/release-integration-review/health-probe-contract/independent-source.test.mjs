// Non-author synthetic/ephemeral-loopback review. Never loads ControlMain.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {readFile,writeFile,mkdtemp,readdir,unlink,rmdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const source=path.join(repo,'tools/operations-system-control.ps1');
const runner=String.raw`param([string]$Source,[string]$DeadlineSource,[string]$Base,[string]$Mode='normal',[int]$Budget=10000,[string]$BodyFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Net.Http
function Load([string]$File,[string[]]$Names) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'private fixture parse failed'}
  foreach($name in $Names){
    $nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
    if($nodes.Count -ne 1){throw 'private fixture AST identity failed'}
    . ([ScriptBlock]::Create($nodes[0].Extent.Text))
    Set-Item ('function:script:'+ $name) (Get-Item ('function:'+ $name)).ScriptBlock
  }
}
Load $DeadlineSource @('Get-ProcessDeadline','Get-ProcessRemaining')
Load $Source @('Get-BoundedText','Invoke-SystemHealthProbe','ConvertFrom-SystemHealthContent','Get-SystemProbeSummary','Get-SystemHealthState')
$LivenessUrl=$Base+'/live';$HelperHealthUrl=$Base+'/helper';$ReadinessUrl=$Base+'/ready'
$script:lastHealthCheckAt=$null;$script:lastHealthState='Unresponsive';$script:lastHealthEvidence=$null
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$Budget)
if($Mode -eq 'summary') {
  $payload=ConvertFrom-SystemHealthContent -Probe ([pscustomobject]@{Content=(Get-Content -LiteralPath $BodyFile -Raw)})
  $probe=[pscustomobject]@{BeforeDeadline=$true;StatusCode=503;Requested=$true;ErrorKind='none';EffectiveTimeoutMs=5000;ElapsedMs=1}
  $summary=Get-SystemProbeSummary -Probe $probe -Payload $payload -Kind ready -TimeoutMs 5000
  [pscustomobject]@{fixture=$true;processId=$PID;summary=$summary}|ConvertTo-Json -Depth 9 -Compress
  exit 0
}
if($Mode -eq 'late-summary') {
  $script:originalSummary=(Get-Item function:Get-SystemProbeSummary).ScriptBlock
  function Get-SystemProbeSummary {
    param([object]$Probe,[object]$Payload,[string]$Kind,[int]$TimeoutMs)
    $out=& $script:originalSummary @PSBoundParameters
    if($Kind -eq 'ready' -and $Probe){Start-Sleep -Milliseconds ($Budget+50)}
    return $out
  }
}
$clock=[Diagnostics.Stopwatch]::StartNew();$state=$null;$caught=$false
try {$state=Get-SystemHealthState -Refresh} catch {$caught=$true}
$first=$script:lastHealthEvidence
$second=$null;$third=$null;$cacheState=$null;$freshState=$null
if($Mode -eq 'cache') {
  $cacheState=Get-SystemHealthState
  $second=$script:lastHealthEvidence
  Start-Sleep -Milliseconds 20
  $freshState=Get-SystemHealthState -Refresh
  $third=$script:lastHealthEvidence
}
[pscustomobject]@{fixture=$true;processId=$PID;state=$state;caught=$caught;lastHealthState=$script:lastHealthState;elapsedMs=$clock.Elapsed.TotalMilliseconds;healthEvidence=$first;cacheState=$cacheState;cacheEvidence=$second;freshState=$freshState;freshEvidence=$third}|ConvertTo-Json -Depth 12 -Compress
`;
let temp;
test.before(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'teruisi-independent-health-'));await writeFile(path.join(temp,'runner.ps1'),'\ufeff'+runner);});
test.after(async()=>{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.match(path.basename(temp),/^teruisi-independent-health-/);for(const n of await readdir(temp)){assert.ok(n==='runner.ps1'||/^body-\d+\.json$/.test(n));await unlink(path.join(temp,n));}await rmdir(temp);});
let bodyCounter=0;
async function run({mode='normal',budget=10000,reply=()=>({}),body}={}){
  const requests=[];let readyCount=0;
  const server=http.createServer((req,res)=>{
    const name=req.url.slice(1);assert.ok(['live','helper','ready'].includes(name));assert.equal(req.headers['x-teruisi-local-health'],'1');
    requests.push({name,at:Date.now(),port:req.socket.localPort});if(name==='ready')readyCount++;
    const def={status:200,body:name==='helper'?{ok:true}:{ok:true,status:name},delay:0};
    const v={...def,...reply(name,readyCount)};
    const send=()=>{if(res.destroyed)return;res.writeHead(v.status,{'content-type':'application/json'});if(v.chunked){res.write('{"ok":true,');setTimeout(()=>{if(!res.destroyed)res.end('"status":"ready"}');},v.delay);}else res.end(JSON.stringify(v.body));};
    if(v.delay&&!v.chunked)setTimeout(send,v.delay);else send();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;assert.ok(![3000,5791,5432,4080].includes(port));
  let bodyPath='';if(body!==undefined){bodyPath=path.join(temp,'body-'+(++bodyCounter)+'.json');await writeFile(bodyPath,JSON.stringify(body));}
  const args=['-NoProfile','-NonInteractive','-File',path.join(temp,'runner.ps1'),'-Source',source,'-DeadlineSource',path.join(repo,'tools/process-deadline.ps1'),'-Base','http://127.0.0.1:'+port,'-Mode',mode,'-Budget',String(budget)];if(bodyPath)args.push('-BodyFile',bodyPath);
  const env={SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PSModulePath:'C:/Windows/System32/WindowsPowerShell/v1.0/Modules'};
  const child=spawn(ps,args,{cwd:temp,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));const guard=setTimeout(()=>child.kill(),15000);
  try{
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    assert.equal(exit.code,0,Buffer.concat(err).toString('utf8'));assert.equal(exit.signal,null);
    const value=JSON.parse(Buffer.concat(out).toString('utf8').trim());assert.equal(value.fixture,true);assert.equal(value.processId,child.pid);
    assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH');assert.ok(requests.every(r=>r.port===port));
    console.log(JSON.stringify({privateFixture:true,mode,pid:child.pid,exitCode:exit.code,ownPidAbsent:true,requestCount:requests.length,elapsedMs:value.elapsedMs??null,state:value.state??null}));
    return {value,requests};
  }finally{clearTimeout(guard);server.closeIdleConnections();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
for(const field of ['status','code'])test('degraded '+field+' array cannot satisfy exact scalar contract',async()=>{
  const body={ok:false,status:'degraded',code:'django_unavailable'};body[field]=[body[field]];
  const {value,requests}=await run({mode:'summary',body});assert.equal(value.summary.degradedMatches,false);assert.equal(requests.length,0);
});
test('degraded is case sensitive while exact degraded scalar remains recognized',async()=>{
  const bad=await run({mode:'summary',body:{ok:false,status:'Degraded',code:'django_unavailable'}});assert.equal(bad.value.summary.degradedMatches,false);
  const good=await run({mode:'summary',body:{ok:false,status:'degraded',code:'django_unavailable'}});assert.equal(good.value.summary.degradedMatches,true);
});
test('complete HTTP body arriving after old 3s but before ready 5s is observed before success',async()=>{
  const {value}=await run({reply:name=>name==='ready'?{chunked:true,delay:3300}:{}});assert.equal(value.state,'Running');assert.equal(value.healthEvidence.probes.ready.passed,true);assert.ok(value.healthEvidence.probes.ready.elapsedMs>=3200);assert.equal(value.healthEvidence.probes.ready.timeoutMs,5000);
});
test('live and helper consume inherited budget rather than renewing ready deadline',async()=>{
  const {value}=await run({budget:1100,reply:name=>({delay:name==='live'?400:name==='helper'?350:800})});assert.equal(value.caught,true);assert.equal(value.state,null);assert.equal(value.lastHealthState,'Unresponsive');assert.equal(value.healthEvidence.probes.live.passed,true);assert.equal(value.healthEvidence.probes.helper.passed,true);assert.equal(value.healthEvidence.probes.ready.passed,false);assert.equal(value.healthEvidence.probes.ready.errorKind,'deadline');assert.ok(value.healthEvidence.probes.ready.effectiveTimeoutMs<500);assert.ok(value.elapsedMs<1800);
});
test('health cache keeps the same state and trace without inventing fresh checkedAt',async()=>{
  const {value,requests}=await run({mode:'cache',reply:(name,count)=>name==='ready'&&count>1?{body:{ok:true,status:'wrong'}}:{}});assert.equal(value.state,'Running');assert.equal(value.cacheState,'Running');assert.deepEqual(value.cacheEvidence,value.healthEvidence);assert.equal(value.freshState,'Unresponsive');assert.notEqual(value.freshEvidence.checkedAt,value.healthEvidence.checkedAt);assert.equal(requests.length,6);
});
test('post-response summary crossing inherited deadline cannot return late Running',async()=>{
  const {value}=await run({mode:'late-summary',budget:1000});assert.ok(value.elapsedMs>=1000);assert.equal(value.caught,true);assert.equal(value.state,null);assert.equal(value.lastHealthState,'Unresponsive');assert.equal(value.healthEvidence.probes.ready.passed,true);
});
const text=await readFile(path.join(repo,'tools/release-readonly-retry.mjs'),'utf8');
const names=['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
const block=text.slice(text.indexOf('function sanitizeReadinessFailure('),text.indexOf('export async function retryReadOnlyObservation(')).replaceAll('export function ','function ');
const projection=new Function('readinessComponents',block+'\nreturn {safeHealthEvidence,safeReadinessFailure,sanitizeReadinessFailure};')(names);
const trace=()=>({version:1,checkedAt:'2026-10-11T00:00:00.7654321Z',probes:{live:{called:true,requested:true,statusCode:200,parsedObject:true,okMatches:true,markerMatches:true,passed:true,degradedMatches:false,beforeDeadline:true,timeoutMs:3000,effectiveTimeoutMs:2500,elapsedMs:14,errorKind:'none'},helper:null,ready:{called:true,requested:true,statusCode:503,parsedObject:true,okMatches:false,markerMatches:false,passed:false,degradedMatches:true,beforeDeadline:true,timeoutMs:5000,effectiveTimeoutMs:1000,elapsedMs:200,errorKind:'backend-degraded'}}});
test('bounded native probe failure facts survive all projection repetitions',()=>{const out=projection.safeHealthEvidence(trace());assert.deepEqual(projection.safeHealthEvidence(out),out);assert.equal(out.probes.ready.errorKind,'backend-degraded');assert.equal(out.probes.helper,null);assert.equal(out.checkedAt,'2026-10-11T00:00:00.765Z');});
test('every unrecognized/private field is absent and invalid scalar types stay null',()=>{const v=trace();v.probes.extra={private:'PRIVATE_MARKER'};Object.assign(v.probes.live,{called:'true',statusCode:'200',passed:['true'],url:'PRIVATE_MARKER',raw:'PRIVATE_MARKER',errorKind:'PRIVATE_MARKER',elapsedMs:-1,effectiveTimeoutMs:10001});v.checkedAt='PRIVATE_MARKER';const out=projection.safeHealthEvidence(v);assert.ok(!JSON.stringify(out).includes('PRIVATE_MARKER'));for(const name of ['called','statusCode','passed','elapsedMs','effectiveTimeoutMs'])assert.equal(out.probes.live[name],null);assert.equal(out.probes.live.errorKind,'unrecognized');assert.equal(out.checkedAt,null);assert.deepEqual(Object.keys(out.probes),['live','helper','ready']);});
test('readiness error idempotence retains one known trace and no old fabricated trace',()=>{const status={state:'Unresponsive',backendState:'Ready',workerState:'exact_release',releaseId:'fixture',components:Object.fromEntries(names.map(n=>[n,true])),healthEvidence:trace(),reason:'PRIVATE_MARKER'};const out=projection.safeReadinessFailure(status,'fixture');assert.deepEqual(projection.sanitizeReadinessFailure(out),out);assert.ok(!JSON.stringify(out).includes('PRIVATE_MARKER'));const old=projection.safeReadinessFailure({components:{}},'fixture');assert.ok(!Object.hasOwn(old,'healthEvidence'));});
