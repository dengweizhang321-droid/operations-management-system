// Independent pure browser-context fixtures. No real browser, URL or service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { reviewedDecision, eligibleCancellation, installReviewedUiAudit } from './ui-audit.mjs';
import { sha } from './validators.mjs';
const originalModule='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/source-snapshot/tools/release-acceptance-ui.mjs';
const {requestPolicy}=await import(pathToFileURL(originalModule));
const bytes=Buffer.from('independent-icon-byte-fixture');
const config={origin:'http://127.0.0.1:3000',resources:{'/favicon.svg':sha(bytes)},readPaths:['/api/search'],requiredResources:[],originalModule};
const classify=requestPolicy(config),request=(url,method='GET',type='fetch',error='net::ERR_ABORTED')=>({url:()=>url,method:()=>method,resourceType:()=>type,failure:()=>({errorText:error})});
const iconUrl='https://127.0.0.1:3000/favicon.svg?v=xiaote-20260922';
function contextFixture() {
  const listeners=new Map();let routeHandler;let iconChecks=0;
  return {on:(name,handler)=>listeners.set(name,handler),route:async(_pattern,handler)=>routeHandler=handler,
    request:{get:async(url)=>{assert.equal(url,config.origin+'/favicon.svg');iconChecks++;return {status:()=>200,body:async()=>bytes};}},
    async emitRequest(r){listeners.get('request')?.(r);let result;await routeHandler({request:()=>r,abort:async()=>result='abort',continue:async()=>result='continue'});return result;},
    emitResponse(r,status=200){listeners.get('response')?.({request:()=>r,status:()=>status,body:async()=>bytes});},
    emitFailure:r=>listeners.get('requestfailed')?.(r),get iconChecks(){return iconChecks;}};
}
async function readyWindow(audit,context) {
  audit.beginSearchCancellation();const r=request(config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH');await context.emitRequest(r);context.emitResponse(r);
  audit.completeSearchCancellation({inputEmpty:true,guideVisible:true,busyCount:0});
}
test('independent UI icon exception binds exact version/origin/type and always aborts',()=>{
  assert.equal(reviewedDecision(classify,config,{url:iconUrl,method:'GET',resourceType:'other'}).kind,'blocked-nonbusiness-icon');
  for(const [url,method,type] of [[iconUrl.replace('20260922','20260923'),'GET','other'],[iconUrl+'&extra=true','GET','other'],[iconUrl.replace('127.0.0.1','elsewhere.invalid'),'GET','other'],[iconUrl,'POST','other'],[iconUrl,'GET','script']]) {
    const d=reviewedDecision(classify,config,{url,method,resourceType:type});assert.equal(d.action,'abort');assert.notEqual(d.kind,'blocked-nonbusiness-icon');
  }
});
test('independent UI synthetic cancellation requires original time/window/error/path',()=>{
  const window={origin:config.origin,startedAt:1000,completed:false},record={createdAt:1001,url:config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH',method:'GET',decision:{action:'continue'}};
  assert.equal(eligibleCancellation(record,window,'net::ERR_ABORTED',1002),true);
  for(const [r,w,error,now] of [[{...record,createdAt:999},window,'net::ERR_ABORTED',1002],[record,{...window,completed:true},'net::ERR_ABORTED',1002],[record,window,'net::ERR_FAILED',1002],[record,window,'net::ERR_ABORTED',61001],[{...record,url:config.origin+'/api/search?q=real-query'},window,'net::ERR_ABORTED',1002],[{...record,url:record.url+'&q=OTHER'},window,'net::ERR_ABORTED',1002],[{...record,url:record.url.replace('/api/search','/api/products')},window,'net::ERR_ABORTED',1002]])assert.equal(eligibleCancellation(r,w,error,now),false);
});
test('independent UI delayed abort permits only an older declared request within five seconds',()=>{
  const window={origin:config.origin,startedAt:1000,completed:true,completedAt:2000},record={createdAt:1500,url:config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH-X',method:'GET',decision:{action:'continue'}};
  assert.equal(eligibleCancellation(record,window,'net::ERR_ABORTED',2100),true);
  assert.equal(eligibleCancellation(record,window,'net::ERR_ABORTED',7001),false);
  assert.equal(eligibleCancellation({...record,createdAt:2001},window,'net::ERR_ABORTED',2100),false);
  assert.equal(eligibleCancellation(record,window,'net::ERR_FAILED',2100),false);
});
test('independent UI blocked icon needs independent normal HTTP bytes',async()=>{
  const context=contextFixture(),audit=await installReviewedUiAudit(context,config);await readyWindow(audit,context);
  assert.equal(await context.emitRequest(request(iconUrl,'GET','other')),'abort');
  const result=await audit.finish();assert.equal(result.status,'passed');assert.equal(context.iconChecks,1);assert.equal(result.blockedIcons,1);assert.equal(result.resourceEvidence[0].sha256,sha(bytes));
});
test('independent UI late pre-window success cannot prove cancellation recovery',async()=>{
  const now=Date.now;let clock=1000;Date.now=()=>clock;
  try {const context=contextFixture(),audit=await installReviewedUiAudit(context,config),old=request(config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH');
    await context.emitRequest(old);clock=2000;audit.beginSearchCancellation();context.emitResponse(old);
    assert.throws(()=>audit.completeSearchCancellation({inputEmpty:true,guideVisible:true,busyCount:0}));
    assert.equal((await audit.finish()).status,'failed');
  }finally {Date.now=now;}
});
test('independent UI network failure never becomes an expected synthetic abort',async()=>{
  const context=contextFixture(),audit=await installReviewedUiAudit(context,config);audit.beginSearchCancellation();
  const failed=request(config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH','GET','fetch','net::ERR_FAILED');await context.emitRequest(failed);context.emitFailure(failed);
  const good=request(config.origin+'/api/search?q=SYNTHETIC-NO-PRODUCTION-MATCH-X');await context.emitRequest(good);context.emitResponse(good);audit.completeSearchCancellation({inputEmpty:true,guideVisible:true,busyCount:0});
  const result=await audit.finish();assert.equal(result.status,'failed');assert.ok(result.failures.some(x=>x.errorCode==='net::ERR_FAILED'));
});
test('independent UI actual POST attempt fails even when aborted with no production write',async()=>{
  const context=contextFixture(),audit=await installReviewedUiAudit(context,config);await readyWindow(audit,context);
  assert.equal(await context.emitRequest(request(config.origin+'/api/search','POST')),'abort');const result=await audit.finish();assert.equal(result.status,'failed');assert.equal(result.attemptedBusinessWrites,1);
});
