import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { observeDisplay, validateNoDataObservation, validateNaturalNoDataObservation } from '../tools/release-no-data-observation.mjs';
import { readinessComponents } from '../tools/release-readonly-retry.mjs';

const css=Buffer.from('.brand-copy small { font-size: 12px; }');
const observation={action:'display',resources:['/assets/style.css'],assertions:[{selector:'.brand-copy small',property:'fontSize',equals:'12px'}]};
async function scenario({script='',responseCss=css,expectedCss=css,expectedSize='12px',redirect=false}={}) {
  let dataCalls=0,websocketUpgrades=0;
  const server=createServer((req,res)=>{
    if(req.url==='/assets/style.css'){if(redirect){res.writeHead(302,{location:'/api/write-via-redirect'});res.end();}else{res.setHeader('content-type','text/css');res.end(responseCss);}}
    else if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<link rel="stylesheet" href="/assets/style.css"><div class="brand-copy"><small>Operations</small></div><script>${script}</script>`);}
    else {dataCalls++;res.end('{}');}
  });
  server.on('upgrade',(_request,socket)=>{websocketUpgrades++;socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await observeDisplay({observation:{...observation,assertions:[{...observation.assertions[0],equals:expectedSize}]},origin:`http://127.0.0.1:${server.address().port}`,readResource:async()=>expectedCss,chromium});
    assert.equal(dataCalls,0);return result;
  } finally {await new Promise(resolve=>server.close(resolve));assert.equal(dataCalls,0,'Blocked endpoints must never reach the HTTP server');assert.equal(websocketUpgrades,0,'WebSocket handshakes must never reach the server');}
}
test('real browser consumes exact candidate CSS and asserts computed size',async()=>{assert.equal((await scenario()).assertions,1);});
test('browser forbids a hidden writing GET even though HTTP method says read',async()=>{
  const result=await scenario({script:'fetch("/api/read-that-writes").catch(()=>{})'});assert.ok(result.blockedRequests.some(r=>r.path==='/api/read-that-writes'));
});
test('browser fails on any attempted write before target style assertion',async()=>{
  await assert.rejects(scenario({script:'fetch("/api/write",{method:"POST"}).catch(()=>{})'}),/attempted a write/);
});
test('browser refuses WebSocket writes without forwarding even the handshake',async()=>{
  await assert.rejects(scenario({script:'const writer=new WebSocket(location.origin.replace("http:","ws:")+"/socket-writer");writer.onopen=()=>writer.send("write");'}),error=>{
    assert.match(error.message,/attempted a write/);
    assert.ok(error.observationEvidence.blockedRequests.some(request=>request.method==='WEBSOCKET'&&request.path==='/socket-writer'));
    return true;
  });
});
test('browser rejects altered resource bytes and wrong candidate style',async()=>{
  await assert.rejects(scenario({expectedCss:Buffer.from('.brand-copy small { font-size: 99px; }')}));
  await assert.rejects(scenario({expectedSize:'99px'}));
});
test('browser refuses resource redirects without contacting redirected GET target',async()=>{await assert.rejects(scenario({redirect:true}));});
test('unknown observation callbacks/properties and forged resource routes reject before browser launch',()=>{
  for(const mutate of [o=>o.resources=['/api/read'],o=>o.assertions[0].property='onclick',o=>o.evaluate='write()',o=>o.assertions[0].javascript='fetch("/write")']) {
    const value=structuredClone(observation);mutate(value);assert.throws(()=>validateNoDataObservation({kind:'no-data-observation',mutating:false,phase:'acceptance',covers:['behavior','resources','task-specific'],observation:value}));
  }
});
test('natural watchdog preserves full original AI/component/probe/fence contract',()=>{
  const expected={after:Date.now()-2000,releaseId:'exact-candidate',fence:'a'.repeat(64)};
  const value={at:new Date(Date.now()-1000).toISOString(),releaseId:expected.releaseId,admission:{mode:'running',fence:expected.fence},healthy:true,probeError:false,system:'Running',backend:'Ready',worker:'exact_release',supervisor:'running',supervisorHealth:'healthy',components:Object.fromEntries(readinessComponents.map(k=>[k,true])),probes:Object.fromEntries(['homepage','live','ready','helper'].map(k=>[k,{ok:true}])),business:{status:'healthy'},workerPid:123,supervisorPid:124};
  validateNaturalNoDataObservation(value,expected);
  for(const mutate of [v=>delete v.components.ai,v=>v.components.ai=false,v=>v.admission.fence='b'.repeat(64),v=>v.probes.ready.ok=false,v=>v.at=new Date(expected.after).toISOString(),v=>v.business.status='degraded']){const v=structuredClone(value);mutate(v);assert.throws(()=>validateNaturalNoDataObservation(v,expected));}
});
