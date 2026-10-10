import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,unlink,rmdir,readdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
const repo=fileURLToPath(new URL('../',import.meta.url));
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const runner=String.raw`param([string]$SourceFile,[string]$DeadlineFile,[string]$BaseUrl,[int]$BudgetMs=30000,[switch]$CheckExpiredCache)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Net.Http
function Load-Definitions([string]$File,[string[]]$Names) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'fixture source parse error'}
  foreach($name in $Names){
    $found=@($ast.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name},$true))
    if($found.Count -ne 1){throw 'fixture definition mismatch'}
    . ([ScriptBlock]::Create($found[0].Extent.Text))
    Set-Item ('function:script:'+ $name) (Get-Item ('function:'+ $name)).ScriptBlock
  }
}
Load-Definitions $DeadlineFile @('Get-ProcessDeadline','Get-ProcessRemaining')
Load-Definitions $SourceFile @('Get-BoundedText','Invoke-SystemHealthProbe','ConvertFrom-SystemHealthContent','Get-SystemHealthState')
if((Get-Content -LiteralPath $SourceFile -Raw).Contains('function Get-SystemProbeSummary')) {Load-Definitions $SourceFile @('Get-SystemProbeSummary')}
$LivenessUrl=$BaseUrl+'/live';$HelperHealthUrl=$BaseUrl+'/helper';$ReadinessUrl=$BaseUrl+'/ready'
$script:lastHealthCheckAt=$null;$script:lastHealthState='Unresponsive';$script:lastHealthEvidence=$null
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$BudgetMs)
$clock=[Diagnostics.Stopwatch]::StartNew();$state=$null;$caught=$false;$failureCode=$null
try{$state=Get-SystemHealthState -Refresh}catch{$caught=$true;if($_.Exception.Message -eq 'process_deadline_exhausted'){$failureCode='process_deadline_exhausted'}else{throw}}
$cacheRejected=$null
if($CheckExpiredCache){$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-1);$cacheRejected=$false;try{[void](Get-SystemHealthState)}catch{$cacheRejected=$_.Exception.Message -eq 'process_deadline_exhausted'}}
[pscustomobject]@{fixture=$true;state=$state;caught=$caught;failureCode=$failureCode;elapsedMs=$clock.Elapsed.TotalMilliseconds;healthEvidence=$script:lastHealthEvidence;cacheExpiredRejected=$cacheRejected;processId=$PID}|ConvertTo-Json -Depth 10 -Compress
`;
let directory;
test.before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'teruisi-health-probe-fixture-'));
  await writeFile(path.join(directory,'runner.ps1'),'\ufeff'+runner);
  await writeFile(path.join(directory,'baseline-control.ps1'),execFileSync('git',['show','3ea0271dc6ba711a5484e27eb9bd2bd33ddfa84f:tools/operations-system-control.ps1'],{cwd:repo,maxBuffer:200000}));
});
test.after(async()=>{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('teruisi-health-probe-fixture-'));
  for(const name of await readdir(directory)){assert.ok(['runner.ps1','baseline-control.ps1'].includes(name));await unlink(path.join(directory,name));}
  await rmdir(directory);
});
async function fixture({baseline=false,changes={},budgetMs=30000,checkExpiredCache=false}={}){
  const requests=[],defaults={live:{status:200,body:{ok:true,status:'live'}},helper:{status:200,body:{ok:true}},ready:{status:200,body:{ok:true,status:'ready'}}};
  const server=http.createServer((req,res)=>{
    const name=req.url.slice(1);assert.ok(Object.hasOwn(defaults,name));assert.equal(req.headers['x-teruisi-local-health'],'1');
    requests.push({name,port:req.socket.localPort,host:req.socket.localAddress});const v={...defaults[name],...changes[name]};
    const send=()=>{if(res.destroyed)return;res.writeHead(v.status,{'content-type':'application/json'});res.end(typeof v.body==='string'?v.body:JSON.stringify(v.body));};
    if(v.delay)setTimeout(send,v.delay);else send();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;assert.ok(![3000,5791,5432,4080].includes(port));
  const source=baseline?path.join(directory,'baseline-control.ps1'):path.join(repo,'tools/operations-system-control.ps1');
  const args=['-NoProfile','-NonInteractive','-File',path.join(directory,'runner.ps1'),'-SourceFile',source,'-DeadlineFile',path.join(repo,'tools/process-deadline.ps1'),'-BaseUrl',`http://127.0.0.1:${port}`,'-BudgetMs',String(budgetMs)];
  if(checkExpiredCache)args.push('-CheckExpiredCache');
  const child=spawn(ps,args,{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}});
  const chunks=[],errors=[];child.stdout.on('data',x=>chunks.push(x));child.stderr.on('data',x=>errors.push(x));
  const timer=setTimeout(()=>child.kill(),18000);
  try{
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.equal(code,0,Buffer.concat(errors).toString('utf8'));
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8').trim());assert.equal(value.fixture,true);assert.equal(value.processId,child.pid);
    assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH');
    assert.ok(requests.every(r=>r.port===port&&r.host==='127.0.0.1'));
    return{value,requests};
  }finally{clearTimeout(timer);server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
}
test('same 3.5s ready response fails original 3s gate and passes bounded 5s gate',async()=>{
  const old=await fixture({baseline:true,changes:{ready:{delay:3500}}});assert.equal(old.value.state,'Unresponsive');
  const current=await fixture({changes:{ready:{delay:3500}}});assert.equal(current.value.state,'Running');
  const p=current.value.healthEvidence.probes;assert.equal(p.ready.timeoutMs,5000);assert.equal(p.live.timeoutMs,3000);assert.equal(p.helper.timeoutMs,3000);assert.ok(p.ready.elapsedMs>=3400);assert.equal(p.ready.passed,true);
});
for(const [name,changes,expected]of[
  ['helper HTTP500',{helper:{status:500}},'Unresponsive'],
  ['live missing marker',{live:{body:{ok:true}}},'Unresponsive'],
  ['live JSON array',{live:{body:[{ok:true,status:'live'}]}},'Unresponsive'],
  ['helper string boolean',{helper:{body:{ok:'true'}}},'Unresponsive'],
  ['helper invalid JSON',{helper:{body:'{"PRIVATE_REASON"'}},'Unresponsive'],
  ['ready wrong marker',{ready:{body:{ok:true,status:'live'}}},'Unresponsive'],
  ['ready exact Django degraded',{ready:{status:503,body:{ok:false,status:'degraded',code:'django_unavailable'}}},'BackendDegraded'],
  ['ready other503',{ready:{status:503,body:{ok:false,status:'degraded',code:'PRIVATE_REASON'}}},'Unresponsive'],
  ['ready degraded array marker',{ready:{status:503,body:{ok:false,status:['degraded'],code:'django_unavailable'}}},'Unresponsive'],
  ['ready degraded array code',{ready:{status:503,body:{ok:false,status:'degraded',code:['django_unavailable']}}},'Unresponsive'],
  ['ready degraded wrong case',{ready:{status:503,body:{ok:false,status:'Degraded',code:'django_unavailable'}}},'Unresponsive'],
  ['live timeout',{live:{delay:4000}},'Unresponsive'],
  ['ready beyond5000',{ready:{delay:6000}},'Unresponsive']
])test(name+' preserves strict rejection and bounded probe evidence',async()=>{
  const {value,requests}=await fixture({changes});assert.equal(value.state,expected);assert.equal(value.healthEvidence.version,1);
  assert.equal(JSON.stringify(value.healthEvidence).includes('PRIVATE_REASON'),false);
  if(changes.live||changes.helper){assert.equal(value.healthEvidence.probes.ready.called,false);assert.ok(!requests.some(r=>r.name==='ready'));}
});
test('inherited remaining deadline bounds all probes without renewal',async()=>{
  const {value}=await fixture({budgetMs:700,changes:{ready:{delay:3500}}});assert.equal(value.state,null);assert.equal(value.caught,true);assert.equal(value.failureCode,'process_deadline_exhausted');assert.ok(value.elapsedMs<2500);
  assert.equal(value.healthEvidence.probes.ready.beforeDeadline,false);assert.equal(value.healthEvidence.probes.ready.errorKind,'deadline');assert.ok(value.healthEvidence.probes.ready.effectiveTimeoutMs<=700);
});
test('already expired deadline issues no fixture network request',async()=>{
  const {value,requests}=await fixture({budgetMs:-1});assert.equal(value.state,null);assert.equal(value.caught,true);assert.equal(value.failureCode,'process_deadline_exhausted');assert.equal(requests.length,0);assert.equal(value.healthEvidence.probes.live.errorKind,'deadline');
});
test('a healthy cached value cannot survive an expired inherited deadline',async()=>{
  const {value,requests}=await fixture({checkExpiredCache:true});assert.equal(value.state,'Running');assert.equal(value.cacheExpiredRejected,true);assert.equal(requests.length,3);
});
