// Task D support adapter. Preserve original B decisions and assertions except
// the two explicitly witnessed readonly behaviours below. No business writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const syntheticQueries=['SYNTHETIC-NO-PRODUCTION-MATCH','SYNTHETIC-NO-PRODUCTION-MATCH-X'];
export function reviewedDecision(classify,config,request) {
  const decision=classify(request),url=new URL(request.url),base=new URL(config.origin);
  if(decision.action==='abort'&&request.method==='GET'&&url.protocol==='https:'&&url.hostname===base.hostname&&url.port===base.port
    &&url.pathname==='/favicon.svg'&&url.search==='?v=xiaote-20260922'&&!url.hash&&!url.username&&!url.password
    &&['other','image'].includes(request.resourceType)&&config.resources['/favicon.svg']) {
    return {action:'abort',kind:'blocked-nonbusiness-icon',witness:'actual-unchanged-SSR-exact-icon-version'};
  }
  return decision;
}
export function eligibleCancellation(record,window,errorText,now) {
  if(!record||!window||![record.createdAt,window.startedAt,now].every(Number.isFinite))return false;
  if(window.completed&&!Number.isFinite(window.completedAt))return false;
  if(!window||now>window.startedAt+60000||record.createdAt<window.startedAt||errorText!=='net::ERR_ABORTED')return false;
  if(window.completed&&(record.createdAt>window.completedAt||now>window.completedAt+5000))return false;
  const url=new URL(record.url);
  return record.method==='GET'&&record.decision.action==='continue'&&url.origin===window.origin&&url.pathname==='/api/search'
    &&url.searchParams.getAll('q').length===1&&syntheticQueries.includes(url.searchParams.get('q'));
}
export async function installReviewedUiAudit(context,config) {
  const {requestPolicy}=await import(pathToFileURL(config.originalModule)),classify=requestPolicy(config);
  const attempts=[],resourceEvidence=[],failures=[],cancellations=[],pending=new Set(),records=new WeakMap();let window=null;
  const decide=request=>reviewedDecision(classify,config,{url:request.url(),method:request.method(),resourceType:request.resourceType()});
  context.on('request',request=>records.set(request,{url:request.url(),method:request.method(),createdAt:Date.now(),decision:decide(request)}));
  await context.route('**/*',async route=>{const request=route.request(),decision=decide(request);attempts.push({method:request.method(),resourceType:request.resourceType(),...decision});
    if(decision.action==='abort')await route.abort();else await route.continue();});
  context.on('response',response=>{
    const request=response.request(),decision=decide(request);
    if(decision.kind==='reviewed-read') {
      if(response.status()!==200)failures.push({code:'REVIEWED_READ_HTTP_FAILURE',status:response.status()});
      const url=new URL(request.url());
      const record=records.get(request);
      if(window&&!window.completed&&record&&record.createdAt>=window.startedAt&&Date.now()<=window.startedAt+60000&&url.origin===config.origin&&url.pathname==='/api/search'&&url.searchParams.getAll('q').length===1&&syntheticQueries.includes(url.searchParams.get('q'))&&response.status()===200)window.successfulSyntheticReads++;
    }
    if(decision.kind!=='candidate-static')return;
    const task=(async()=>{const bytes=await response.body(),digest=sha(bytes);assert.equal(response.status(),200);assert.equal(digest,config.resources[decision.pathname]);
      resourceEvidence.push({pathname:decision.pathname,sha256:digest,bytes:bytes.length,status:200});})().catch(()=>failures.push({pathname:decision.pathname,code:'RESOURCE_MISMATCH_OR_UNAVAILABLE'})).finally(()=>pending.delete(task));pending.add(task);
  });
  context.on('requestfailed',request=>{
    const decision=decide(request);if(decision.action!=='continue')return;
    const record=records.get(request),errorText=request.failure()?.errorText??'unknown';
    if(record&&eligibleCancellation(record,window,errorText,Date.now())) {
      cancellations.push({pathname:'/api/search',errorCode:'net::ERR_ABORTED',createdDuringDeclaredInputReplacement:true,observedAt:new Date().toISOString()});
    }else failures.push({pathname:new URL(request.url()).pathname,code:'EXPECTED_REQUEST_FAILED',errorCode:errorText,createdDuringDeclaredWindow:Boolean(record&&window&&record.createdAt>=window.startedAt),windowCompleted:window?.completed??false});
  });
  return {
    beginSearchCancellation(){assert.equal(window,null);window={origin:config.origin,startedAt:Date.now(),completed:false,successfulSyntheticReads:0};},
    completeSearchCancellation(dom){assert.ok(window&&!window.completed);assert.deepEqual(dom,{inputEmpty:true,guideVisible:true,busyCount:0});assert.ok(window.successfulSyntheticReads>0);assert.ok(Date.now()<=window.startedAt+60000);window.completed=true;window.completedAt=Date.now();window.dom=dom;},
    async finish(){await Promise.all([...pending]);
      if(attempts.some(r=>r.kind==='blocked-nonbusiness-icon')&&!resourceEvidence.some(r=>r.pathname==='/favicon.svg')) {
        try {const response=await context.request.get(config.origin+'/favicon.svg',{maxRedirects:0,timeout:20000}),bytes=await response.body(),digest=sha(bytes);assert.equal(response.status(),200);assert.equal(digest,config.resources['/favicon.svg']);
          resourceEvidence.push({pathname:'/favicon.svg',sha256:digest,bytes:bytes.length,status:200,observation:'independent-normal-http-icon-check'});
        }catch{failures.push({pathname:'/favicon.svg',code:'HTTP_ICON_MISMATCH_OR_UNAVAILABLE'});}
      }
      if(!window?.completed)failures.push({code:'SEARCH_CANCELLATION_RECOVERY_WITNESS_MISSING'});
      const dangerous=attempts.filter(r=>r.action==='abort'&&r.kind!=='blocked-nonbusiness-icon');
      const missing=(config.requiredResources??Object.keys(config.resources)).filter(uri=>!resourceEvidence.some(r=>r.pathname===uri));
      return {status:dangerous.length||failures.length||missing.length?'failed':'passed',productionWrites:0,
        attemptedBusinessWrites:attempts.filter(r=>r.kind==='business-write').length,blockedIcons:attempts.filter(r=>r.kind==='blocked-nonbusiness-icon').length,
        attempts,resourceEvidence,dangerous,failures,missing,cancellations,searchRecovery:window?{completed:window.completed,successfulSyntheticReads:window.successfulSyntheticReads,dom:window.dom??null}:null};
    }
  };
}
