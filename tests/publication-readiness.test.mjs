import test from 'node:test';
import assert from 'node:assert/strict';
import {probePublicationReadiness,assertPublicationReady,waitForPublicationReady,publicationDeadline,fetchPublicationReadyResponse,readyRequestTimeoutMs} from '../tools/publication-readiness.mjs';
const good=()=>Response.json({ok:true,status:'ready',backend:'django-postgresql',unavailableServices:[]});
const bad=(checks=[])=>Response.json({ok:false,status:'degraded',unavailableServices:['bi.reader'],serviceChecks:checks},{status:503});

test('single ready observation remains one request and validates successful body',async()=>{
 let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:3000/_teruisi/local/health/ready');assert.equal(options.redirect,'manual');assert.equal(options.headers['x-teruisi-local-health'],'1');return good();};
 assert.equal((await assertPublicationReady({fetchImpl})).ok,true);assert.equal(calls,1);assert.equal(readyRequestTimeoutMs,20_000);
 for(const body of [{ok:false,status:'ready'},{ok:true,status:'starting'},{ok:true,status:'ready',unavailableServices:['bi.reader']}]){
  assert.equal((await probePublicationReadiness({fetchImpl:async()=>Response.json(body)})).reason,'invalid_response');
 }
});
test('unknown 503 is observable and a single check never silently starts waiting',async()=>{
 let calls=0;
 await assert.rejects(assertPublicationReady({fetchImpl:async()=>{calls++;return bad();}}),e=>e.readiness.retryable&&e.readiness.unavailableServices[0]==='bi.reader');
 assert.equal(calls,1);
});
test('only bounded safe fields survive diagnostics, and known config failure is terminal',async()=>{
 const result=await probePublicationReadiness({fetchImpl:async()=>bad([{service:'bi.reader',state:'not_ready',reason:'missing_configuration',queueMs:3,requestMs:4,httpStatus:503,url:'SECRET_URL',exception:'SECRET_SQL'},
  {service:'SECRET_URL',reason:'SECRET_SQL'},{service:['bi.reader'],reason:'missing_configuration'}])});
 assert.equal(result.reason,'known_probe_failure');assert.equal(result.retryable,false);assert.equal(result.serviceChecks.length,1);
 assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});
test('HTTP authentication, not found and redirects are terminal without following',async()=>{
 for(const status of [301,302,401,403,404,500]){
  const result=await probePublicationReadiness({fetchImpl:async()=>new Response('untrusted body',{status})});
  assert.equal(result.retryable,false);assert.equal(result.httpStatus,status);assert.doesNotMatch(JSON.stringify(result),/untrusted/);
 }
});
test('malformed, non-JSON, oversized and invalid UTF-8 bodies fail closed',async()=>{
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('{',{headers:{'content-type':'application/json'}}),
  Response.json({padding:'x'.repeat(17000)}),new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})]){
  const result=await probePublicationReadiness({fetchImpl:async()=>response});assert.equal(result.ok,false);assert.equal(result.retryable,false);
 }
});
test('one timer includes response body and does not await hung cancellation',async()=>{
 let cancelled=0;
 const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
 const started=performance.now();const result=await probePublicationReadiness({fetchImpl:async()=>response,timeoutMs:15});
 assert.equal(result.reason,'request_timeout');assert.ok(performance.now()-started<1000);assert.equal(cancelled,1);
});
test('late headers cannot leave a response unconsumed after timeout',async()=>{
 let resolveFetch,cancelled=0;const result=await probePublicationReadiness({fetchImpl:()=>new Promise(resolve=>{resolveFetch=resolve;}),timeoutMs:10});
 assert.equal(result.reason,'request_timeout');
 resolveFetch(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
});
test('zero budget and cancelled parent perform zero requests',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 assert.equal((await probePublicationReadiness({fetchImpl:async()=>{calls++;return good();},signal:controller.signal})).reason,'cancelled');
 assert.equal((await probePublicationReadiness({fetchImpl:async()=>{calls++;return good();},timeoutMs:0})).reason,'deadline_exhausted');assert.equal(calls,0);
});
test('transient transport is retriable but arbitrary exceptions are not exposed',async()=>{
 const transient=await probePublicationReadiness({fetchImpl:async()=>{throw new TypeError('SECRET',{cause:{code:'ECONNREFUSED'}});}});
 assert.equal(transient.retryable,true);assert.equal(transient.reason,'transport_unavailable');assert.doesNotMatch(JSON.stringify(transient),/SECRET/);
 const unknown=await probePublicationReadiness({fetchImpl:async()=>{throw Error('SECRET');}});assert.equal(unknown.retryable,false);
 const shaped=await probePublicationReadiness({fetchImpl:async()=>{throw {ok:false,reason:'SECRET',url:'SECRET'};}});
 assert.equal(shaped.reason,'transport_error');assert.doesNotMatch(JSON.stringify(shaped),/SECRET/);
});
test('503 then ready waits only after a completed request and ends at first success',async()=>{
 let clock=0,calls=0,active=0,maxActive=0;const seen=[],sleeps=[];
 const result=await waitForPublicationReady({now:()=>clock,wallNow:()=>1000,budgetMs:120000,delayMs:5000,
  fetchImpl:async()=>{maxActive=Math.max(maxActive,++active);calls++;clock+=100;active--;return calls===1?bad():good();},
  sleep:async ms=>{assert.equal(active,0);sleeps.push(ms);clock+=ms;},onObservation:async value=>seen.push(value)});
 assert.equal(result.ok,true);assert.equal(calls,2);assert.equal(maxActive,1);assert.deepEqual(sleeps,[5000]);assert.equal(clock,5200);assert.equal(seen[0].reason,'not_ready_unknown');
});
test('persistent 503 consumes one local budget rather than resetting on retries',async()=>{
 let clock=0,calls=0;
 await assert.rejects(waitForPublicationReady({now:()=>clock,wallNow:()=>1000,budgetMs:1000,delayMs:200,
  fetchImpl:async()=>{calls++;clock+=10;return bad();},sleep:async ms=>{clock+=ms;}}),e=>e.readiness.reason==='deadline_exhausted');
 assert.equal(clock,1000);assert.equal(calls,5);
});
test('shorter parent caps the entire wait and an expired parent is zero effect',async()=>{
 let clock=0,calls=0;
 await assert.rejects(waitForPublicationReady({deadlineUnixMs:1300,wallNow:()=>1000,now:()=>clock,fetchImpl:async()=>{calls++;clock+=10;return bad();},sleep:async ms=>{clock+=ms;}}),e=>e.readiness.reason==='deadline_exhausted');
 assert.equal(clock,300);assert.equal(calls,1);
 await assert.rejects(waitForPublicationReady({deadlineUnixMs:999,wallNow:()=>1000,fetchImpl:async()=>{calls++;return good();}}),e=>e.readiness.reason==='deadline_exhausted');assert.equal(calls,1);
});
test('terminal known failure does not spend the retry budget',async()=>{
 let sleeps=0;
 await assert.rejects(waitForPublicationReady({fetchImpl:async()=>bad([{service:'bi.reader',state:'not_ready',reason:'identity_mismatch'}]),sleep:async()=>{sleeps++;}}),e=>e.readiness.reason==='known_probe_failure');assert.equal(sleeps,0);
});
test('deadline parsing rejects malformed external values',()=>{
 for(const value of ['',0,-1,Infinity,'not-a-number','1e12'])assert.throws(()=>publicationDeadline(value),/invalid_publication_deadline/);
 assert.equal(publicationDeadline('1793700000000'),1793700000000);
});

test('parent cancellation during observation prevents successful completion',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(waitForPublicationReady({signal:controller.signal,fetchImpl:async()=>{calls++;return good();},
  onObservation:async()=>controller.abort()}),e=>e.readiness.reason==='cancelled'&&e.readiness.ok===false);
 assert.equal(calls,1);
});

test('single observations reject expired inherited deadlines before any request',async t=>{
 const prior=process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS;let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return good();});
 process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(Date.now()-1);
 try{
  assert.equal((await probePublicationReadiness()).reason,'deadline_exhausted');
  assert.throws(()=>fetchPublicationReadyResponse(),e=>e.readiness.reason==='deadline_exhausted');
  const {runMainStatusCli}=await import('../tools/publish-main-status.mjs');
  await assert.rejects(runMainStatusCli(['--config','never-read.json','--attempt','never-read']),/publication_deadline_exhausted_before_status/);
  assert.equal(calls,0);
 }finally{if(prior===undefined)delete process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS;else process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=prior;}
});

test('explicit later deadlines cannot extend inherited deadlines',()=>{
 assert.equal(publicationDeadline(2000,'1000'),1000);
 assert.equal(publicationDeadline(1000,'2000'),1000);
});

test('slow or hung diagnostic observers cannot turn completed ready into failure',async t=>{
 let clock=0,timer;
 t.after(()=>clearTimeout(timer));
 const result=await waitForPublicationReady({budgetMs:20,now:()=>clock,fetchImpl:async()=>good(),
  onObservation:()=>new Promise(resolve=>{timer=setTimeout(()=>{clock=80;resolve();},80);})});
 assert.equal(result.ok,true);assert.equal(result.totalElapsedMs,0);
 clearTimeout(timer);
 assert.equal((await waitForPublicationReady({fetchImpl:async()=>good(),onObservation:()=>new Promise(()=>{})})).ok,true);
 assert.equal((await waitForPublicationReady({fetchImpl:async()=>good(),onObservation:()=>{throw Error('diagnostic failed');}})).ok,true);
});
