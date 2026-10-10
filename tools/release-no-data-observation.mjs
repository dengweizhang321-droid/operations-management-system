// Fixed v3 observation vocabulary. No shell commands, caller JS, cookies,
// arbitrary GET endpoints, browser clicks, background jobs or data writers.
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash, safeRead, safeFileDigest, requireHash, canonical } from './release-impact.mjs';
import { readinessComponents as components } from './release-readonly-retry.mjs';

export const observationBrowserPath='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const observationLibraryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../node_modules/playwright-core');

const resourcePath=value=>typeof value==='string' && /^\/assets\/[A-Za-z0-9_.-]+\.(css|js|png|woff2?)$/.test(value);
function exactKeys(value,keys) { assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),'Unknown observation input'); }
export function validateNoDataObservation(op) {
  assert.ok(Object.keys(op).every(key=>['id','phase','kind','mutating','observation','covers'].includes(key)),'Unknown observation operation input');
  assert.equal(op.kind,'no-data-observation');assert.equal(op.mutating,false);
  assert.ok(['acceptance','closeout'].includes(op.phase));assert.equal(op.command,undefined);
  const value=op.observation;assert.ok(value);
  if(value.action==='display') {
    exactKeys(value,['action','resources','assertions']);
    assert.ok(Array.isArray(value.resources)&&value.resources.length>0&&value.resources.length<=200);
    assert.equal(new Set(value.resources).size,value.resources.length);
    for(const resource of value.resources)assert.ok(resourcePath(resource),'Only candidate static assets are allowed');
    assert.ok(value.resources.some(p=>p.endsWith('.css')));
    assert.ok(Array.isArray(value.assertions)&&value.assertions.length>0&&value.assertions.length<=30);
    for(const check of value.assertions) {
      exactKeys(check,check.text===undefined?['selector','property','equals']:['selector','text']);
      assert.match(check.selector,/^[a-zA-Z0-9 ._#>:-]{1,200}$/);
      if(check.text!==undefined)assert.ok(typeof check.text==='string'&&check.text.length<2000);
      else {assert.ok(['gap','padding','margin','color','backgroundColor','fontSize','lineHeight','width','height'].includes(check.property));assert.ok(typeof check.equals==='string'&&check.equals.length<100);}
    }
    assert.deepEqual([...(op.covers??[])].sort(),['behavior','resources','task-specific']);
  } else {
    exactKeys(value,['action']);
    assert.ok(['permissions','natural-watchdog'].includes(value.action));
    assert.deepEqual(op.covers,[value.action==='permissions'?'permissions':'natural-watchdog']);
  }
}

// Explicit dependency seam for isolated real browsers/tests; production does
// not accept an origin, browser executable, request implementation or context
// from the sealed request. Assertions can only inspect DOM/style, never run JS.
export async function observeDisplay({observation,origin,readResource,chromium}) {
  validateNoDataObservation({kind:'no-data-observation',mutating:false,phase:'acceptance',observation,covers:['behavior','resources','task-specific']});
  const expected=new Map();
  for(const uri of observation.resources)expected.set(uri,await readResource(uri));
  const browser=await chromium.launch({executablePath:observationBrowserPath,headless:true});
  const prohibited=[],mismatched=[],verified=new Set();
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    // HTTP routing does not cover WebSocket handshakes or subsequent frames.
    // Never connect this intercepted socket to a server, even on loopback.
    await context.routeWebSocket('**/*',socket=>{
      prohibited.push({method:'WEBSOCKET',path:new URL(socket.url()).pathname});
      socket.close();
    });
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'||url.origin!==origin||url.search||url.hash||!(expected.has(url.pathname)||url.pathname==='/')) {
        prohibited.push({method:request.method(),path:url.pathname});await route.abort('blockedbyclient');return;
      }
      try {
        const response=await route.fetch({maxRedirects:0,timeout:20_000}),raw=await response.body();
        if(response.status()!==200 || (expected.has(url.pathname)&&hash(raw)!==hash(expected.get(url.pathname)))) {
          mismatched.push(url.pathname);await route.abort('blockedbyclient');return;
        }
        if(expected.has(url.pathname))verified.add(url.pathname);
        await route.fulfill({response,body:raw});
      } catch {mismatched.push(url.pathname);await route.abort('blockedbyclient').catch(()=>{});}
    });
    const page=await context.newPage();
    await page.goto(origin+'/',{waitUntil:'load',timeout:30_000});
    for(const check of observation.assertions) {
      const target=page.locator(check.selector);await target.waitFor({state:'visible',timeout:15_000});assert.equal(await target.count(),1);
      if(check.text!==undefined)assert.equal(await target.innerText(),check.text);
      else assert.equal(await target.evaluate((element,property)=>getComputedStyle(element)[property],check.property),check.equals);
    }
    assert.deepEqual(mismatched,[],'Candidate asset response differs from immutable bytes');
    // Expected framework requests can be blocked, but a non-GET attempt is
    // never hidden by a later successful DOM check.
    assert.equal(prohibited.some(r=>r.method!=='GET'),false,'Page attempted a write');
    for(const uri of expected.keys())assert.ok(verified.has(uri),'Required resource was not consumed by the page');
    return {resources:[...verified],assertions:observation.assertions.length,blockedRequests:prohibited,networkWrites:0};
  } catch(error) {error.observationEvidence={blockedRequests:prohibited,mismatchedResources:mismatched,verifiedResources:[...verified]};throw error;}
  finally {await browser.close();}
}

export function validateNaturalNoDataObservation(value,{after,releaseId,fence}) {
  requireHash(fence,'Natural watchdog fence');
  assert.ok(Number.isFinite(Date.parse(value.at))&&Date.parse(value.at)>after&&Date.parse(value.at)<=Date.now());
  assert.equal(value.releaseId,releaseId);assert.equal(value.admission?.mode,'running');assert.equal(value.admission.fence,fence);
  for(const [key,expected] of Object.entries({healthy:true,probeError:false,system:'Running',backend:'Ready',worker:'exact_release',supervisor:'running',supervisorHealth:'healthy'}))assert.equal(value[key],expected);
  for(const name of components)assert.equal(value.components?.[name],true);
  exactKeys(value.components,components);
  exactKeys(value.probes,['homepage','live','ready','helper']);
  for(const name of ['homepage','live','ready','helper'])assert.equal(value.probes?.[name]?.ok,true);
  assert.notEqual(value.business?.status,'degraded');
  for(const key of ['workerPid','supervisorPid'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>0);
}

export async function runNoDataObservation(op,{batch,state}) {
  const {writeOnce}=await import('./release-batch.mjs');
  const root=path.join(state.dir,'observations',`${op.id}-${randomUUID()}`);
  await writeOnce(path.join(root,'started.json'),{batchSha256:batch.batchSha256,operationId:op.id,at:new Date().toISOString()});
  try {
    const value=await performNoDataObservation(op,{batch,evidenceRoot:root});
    const result={...value,at:new Date().toISOString()};
    await writeOnce(path.join(root,'result.json'),result);
    return {status:'passed',receiptSha256:hash(result),outputs:{observationDirectory:root,observationSha256:hash(result)}};
  } catch(error) {
    const failure={status:'failed',at:new Date().toISOString(),code:'no-data-observation-failed',details:error.observationEvidence??null};
    await writeOnce(path.join(root,'failure.json'),failure);
    error.processEvidence={code:'no-data-observation-failed',stage:op.observation.action};throw error;
  }
}
async function performNoDataObservation(op,{batch,evidenceRoot}) {
  validateNoDataObservation(op);
  const {workerRuntimeRoot,hashTree}=await import('./worker-local-release.mjs');
  const planRaw=await safeRead(path.join(workerRuntimeRoot,'state','worker-release-rotation-plans',batch.binding.workerPlanSha256+'.json'));
  assert.equal(hash(planRaw),batch.binding.workerPlanSha256);const plan=JSON.parse(planRaw);
  const root=path.join(workerRuntimeRoot,'releases',plan.candidate.releaseId);
  assert.equal(hash(await safeRead(path.join(root,'deployment-manifest.json'))),batch.binding.artifactSha256);
  let result;
  if(op.observation.action==='display') {
    assert.equal(await safeFileDigest(observationBrowserPath),batch.binding.observationBrowserSha256,'Browser executable changed');
    assert.equal((await hashTree(observationLibraryRoot)).sha256,batch.binding.observationLibrarySha256,'Browser library changed');
    const {chromium}=await import('playwright-core');
    result=await observeDisplay({observation:op.observation,origin:'http://127.0.0.1:3000',chromium,
      readResource:uri=>safeRead(path.join(root,'dist','client',...uri.slice(1).split('/')))});
  } else if(op.observation.action==='permissions') {
    const observations=[];
    for(const [port,uri] of [[8071,'/api/customer-service/conversations'],[8101,'/api/access-control/users']]) {
      const response=await fetch(`http://127.0.0.1:${port}${uri}`,{redirect:'manual',signal:AbortSignal.timeout(20_000)});
      assert.equal(response.status,401);const body=await response.json();assert.equal(body.code??body.error?.code,'authentication_required');
      observations.push({port,path:uri,status:401});
    }
    result={observations};
  } else {
    const desired='D:\\teruisi-runtime\\django-sales\\run\\django-supervisor-desired-state.json';
    const after=Date.now(),fence=hash(await safeRead(desired)),seen=new Set(),observations=[];
    const expected={after,releaseId:plan.candidate.releaseId,fence};let previous=null;
    while(Date.now()-after<300_000&&observations.length<2) {
      const raw=await safeRead('D:\\teruisi-runtime\\operations-watchdog\\latest.json'),digest=hash(raw);
      if(!seen.has(digest)) {
        seen.add(digest);
        const {writeOnce}=await import('./release-batch.mjs');
        await writeOnce(path.join(evidenceRoot,`natural-${seen.size}.json`),{sha256:digest,seenAt:new Date().toISOString(),raw:raw.toString('utf8')});
        const value=JSON.parse(raw),at=Date.parse(value.at);
        assert.ok(Number.isFinite(at));
        if(at<=after)assert.equal(seen.size,1,'Unexpected stale natural observation');
        else {
          validateNaturalNoDataObservation(value,expected);
          const identity={workerPid:value.workerPid,supervisorPid:value.supervisorPid};
          if(previous){assert.ok(at>previous.at);assert.deepEqual(identity,previous.identity);}
          previous={at,identity};observations.push({sha256:digest,at:value.at,identity});
        }
      }
      if(observations.length<2)await new Promise(resolve=>setTimeout(resolve,5_000));
    }
    assert.equal(observations.length,2);assert.equal(hash(await safeRead(desired)),fence);result={observations};
  }
  requireHash(batch.binding.djangoCandidateSha256,'Django identity');
  assert.equal(hash(await safeRead('D:\\teruisi-runtime\\django-sales\\app\\deployment.json')),batch.binding.djangoCandidateSha256);
  return {status:'passed',receiptSha256:hash(canonical(result)),observation:result};
}
