import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
const windows=process.platform==='win32';
for(const [file,minimum]of [['watchdog-recovery-outbox.test.ps1',22],['watchdog-install.test.ps1',18]] as const){
 test(file+' covers previously missing lifecycle paths',{skip:!windows},()=>{
  const r=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-File','tests/'+file],{encoding:'utf8',windowsHide:true,timeout:25000});
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);const receipt=JSON.parse(r.stdout.trim());assert.ok(receipt.passed>=minimum);assert.equal(receipt.productionTouched,false);assert.equal(receipt.actualMessagesSent,false);
 });
}
test('four independent health probes overlap within the unchanged common budget',{skip:!windows,timeout:30000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'watchdog-parallel-'));const runner=path.join(directory,'fixture.ps1');const source=path.resolve('tools/operations-system-watchdog.ps1');
 await writeFile(runner,'\ufeff'+String.raw`param($Source,$Url)
$ErrorActionPreference='Stop'
. $Source -FunctionsOnly
$kinds=@('homepage','live','ready','helper');$urls=@{};foreach($k in $kinds){$urls[$k]=$Url+'/'+$k}
$clock=[Diagnostics.Stopwatch]::StartNew();$serial=@{};foreach($k in $kinds){$serial[$k]=Test-WatchHttp $urls[$k] $k};$serialMs=$clock.ElapsedMilliseconds
$clock.Restart();$parallel=Get-WatchHttpProbes $urls;$parallelMs=$clock.ElapsedMilliseconds
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS='1';$expired=Get-WatchHttpProbes $urls
@{serial=$serial;parallel=$parallel;expired=$expired;serialMs=$serialMs;parallelMs=$parallelMs}|ConvertTo-Json -Depth 8 -Compress
`);
 let inFlight=0,maxInFlight=0;const calls:string[]=[];
 const server=createServer((req,res)=>{const name=req.url!.slice(1);calls.push(name);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);assert.equal(req.headers['x-teruisi-local-health'],'1');setTimeout(()=>{res.writeHead(name==='helper'?503:200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,status:name}));inFlight--;},350);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;assert.ok(![3000,5791,5432,8001,8002].includes(port));
 try{
  const child=spawn('pwsh.exe',['-NoProfile','-NonInteractive','-File',runner,'-Source',source,'-Url',`http://127.0.0.1:${port}`],{windowsHide:true});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);const timer=setTimeout(()=>child.kill(),20000);
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});clearTimeout(timer);assert.equal(code,0,err);const value=JSON.parse(out);
  for(const name of ['homepage','live','ready','helper']){assert.equal(value.parallel[name].ok,value.serial[name].ok,name);assert.equal(value.parallel[name].status,value.serial[name].status,name);assert.equal(value.expired[name].ok,false);}
  assert.equal(calls.length,8);assert.equal(maxInFlight,4);assert.ok(value.parallelMs<value.serialMs*.8,JSON.stringify({serialMs:value.serialMs,parallelMs:value.parallelMs}));
  if(process.env.WATCHDOG_TEST_EVIDENCE_DIRECTORY){await writeFile(path.join(process.env.WATCHDOG_TEST_EVIDENCE_DIRECTORY,'http-paired-benchmark.json'),JSON.stringify({fixture:true,productionServicesTouched:false,delayPerProbeMs:350,serialMs:value.serialMs,parallelMs:value.parallelMs,maxInFlight,checksPreserved:4,expiredRequests:0},null,2));}
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await unlink(runner);await rmdir(directory)}
});
