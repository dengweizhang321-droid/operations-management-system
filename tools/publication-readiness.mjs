/** Read-only ready observations. Only the native publication tail opts into waiting. */
import {performance} from 'node:perf_hooks';

export const readyRequestTimeoutMs=20_000;
export const readyTailBudgetMs=120_000;
export const readyRetryDelayMs=5_000;
const maxBytes=16*1024;
const url='http://127.0.0.1:3000/_teruisi/local/health/ready';
const serviceName=/^(?:(?:sales|finance|netshop|market|products|inventory|workflow|customer_service|erp_reference|access_control|ai)\.(?:reader|writer)|bi\.reader)$/;
const reasons=new Set(['none','not_checked','round_budget','cancelled','missing_configuration','invalid_endpoint','request_timeout','transport_error','redirect','response_too_large','http_status','invalid_response','identity_mismatch','not_ready_unknown']);
const terminalReasons=new Set(['missing_configuration','invalid_endpoint','redirect','response_too_large','invalid_response','identity_mismatch']);
const transientCodes=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const duration=n=>Number.isFinite(n)?Math.max(0,Math.min(1_000_000,Math.round(n))):0;

export function publicationDeadline(value,inherited=process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS){
 const parse=input=>{
  if(input===undefined)return undefined;
  const parsed=typeof input==='number'?input:typeof input==='string'&&/^[0-9]+$/.test(input)?Number(input):NaN;
  if(!Number.isSafeInteger(parsed)||parsed<=0)throw Error('invalid_publication_deadline');
  return parsed;
 };
 const limits=[parse(value),parse(inherited)].filter(v=>v!==undefined);
 return limits.length?Math.min(...limits):undefined;
}
export function publicationRequestTimeout(deadlineUnixMs,{timeoutMs=readyRequestTimeoutMs,wallNow=Date.now}={}){
 const parent=publicationDeadline(deadlineUnixMs);
 return Math.min(timeoutMs,parent===undefined?Infinity:parent-wallNow());
}
export function fetchPublicationReadyResponse({deadlineUnixMs}={}){
 const timeout=publicationRequestTimeout(deadlineUnixMs);
 if(timeout<=0)throw new PublicationReadinessError({ok:false,reason:'deadline_exhausted',retryable:false});
 return fetch(url,{headers:{'x-teruisi-local-health':'1'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(Math.ceil(timeout))});
}
function diagnostics(body){
 const unavailableServices=Array.isArray(body.unavailableServices)?[...new Set(body.unavailableServices.filter(v=>typeof v==='string'&&serviceName.test(v)))].slice(0,23):[];
 const serviceChecks=Array.isArray(body.serviceChecks)?body.serviceChecks.filter(v=>v&&typeof v==='object'&&typeof v.service==='string'&&serviceName.test(v.service)).slice(0,23).map(v=>({
  service:v.service,state:['ready','not_ready','incomplete'].includes(v.state)?v.state:'incomplete',
  reason:reasons.has(v.reason)?v.reason:'not_ready_unknown',queueMs:duration(v.queueMs),requestMs:duration(v.requestMs),
  ...(Number.isInteger(v.httpStatus)&&v.httpStatus>=100&&v.httpStatus<=599?{httpStatus:v.httpStatus}:{}),
 })):[];
 return {unavailableServices,serviceChecks};
}
function cancelBody(response,reader){
 try{
  if(reader){void Promise.resolve(reader.cancel()).catch(()=>{});reader.releaseLock();}
  else if(response?.body&&!response.body.locked)void Promise.resolve(response.body.cancel()).catch(()=>{});
 }catch{/* Cancellation cannot extend the deadline or replace the observation. */}
}
export class PublicationReadinessError extends Error{
 constructor(observation){
  super(`服务尚未就绪：${observation.reason}${observation.httpStatus?` HTTP ${observation.httpStatus}`:''}${observation.unavailableServices?.length?`；${observation.unavailableServices.join(', ')}`:''}`);
  this.name='PublicationReadinessError';this.readiness=observation;
 }
}

export async function probePublicationReadiness({fetchImpl=fetch,timeoutMs=readyRequestTimeoutMs,signal,deadlineUnixMs,wallNow=Date.now,now=()=>performance.now()}={}){
 timeoutMs=publicationRequestTimeout(deadlineUnixMs,{timeoutMs,wallNow});
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)return {ok:false,reason:'deadline_exhausted',retryable:false,elapsedMs:0,unavailableServices:[],serviceChecks:[]};
 if(signal?.aborted)return {ok:false,reason:'cancelled',retryable:false,elapsedMs:0,unavailableServices:[],serviceChecks:[]};
 const started=now(),controller=new AbortController();let timer,response,reader,timeout=false,cancelled=false;
 const failure=(reason,retryable=false,extra={})=>({ok:false,reason,retryable,...extra});
 let rejectAbort;
 const stopped=new Promise((_,reject)=>{rejectAbort=reject;});
 const abort=()=>{cancelled=true;controller.abort();rejectAbort(failure('cancelled'));};
 signal?.addEventListener('abort',abort,{once:true});
 const operation=(async()=>{
  if(signal?.aborted){abort();return await stopped;}
  response=await fetchImpl(url,{headers:{'x-teruisi-local-health':'1'},redirect:'manual',cache:'no-store',signal:controller.signal});
  if(controller.signal.aborted){cancelBody(response);return await stopped;}
  const status=response.status;
  if(!Number.isInteger(status)||status<100||status>599)return failure('invalid_response');
  if(status>=300&&status<400)return failure('redirect',false,{httpStatus:status});
  if(status!==200&&status!==503)return failure('http_status',false,{httpStatus:status});
  if(!response.headers?.get('content-type')?.toLowerCase().startsWith('application/json'))return failure('invalid_response',false,{httpStatus:status});
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes)return failure('response_too_large',false,{httpStatus:status});
  if(!response.body?.getReader)return failure('invalid_response',false,{httpStatus:status});
  reader=response.body.getReader();const chunks=[];let size=0;
  for(;;){
   const chunk=await reader.read();
   if(controller.signal.aborted)return await stopped;
   if(chunk.done)break;
   if(chunk.value){size+=chunk.value.byteLength;if(size>maxBytes)return failure('response_too_large',false,{httpStatus:status});chunks.push(chunk.value);}
  }
  reader.releaseLock();reader=null;
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return failure('invalid_response',false,{httpStatus:status});}
  if(!body||Array.isArray(body)||typeof body!=='object')return failure('invalid_response',false,{httpStatus:status});
  const detail=diagnostics(body);
  if(status===200){
   if(body.ok!==true||body.status!=='ready'||(Array.isArray(body.unavailableServices)&&body.unavailableServices.length!==0))return failure('invalid_response',false,{httpStatus:status,...detail});
   return {ok:true,reason:'ready',retryable:false,httpStatus:status,...detail};
  }
  if(body.ok!==false||body.status!=='degraded'||!Array.isArray(body.unavailableServices))return failure('invalid_response',false,{httpStatus:status});
  const terminal=detail.serviceChecks.some(v=>terminalReasons.has(v.reason)||(v.reason==='http_status'&&v.httpStatus>=400&&v.httpStatus<500));
  return failure(terminal?'known_probe_failure':'not_ready_unknown',!terminal,{httpStatus:status,...detail});
 })();
 // Attach the rejection handler before any async response can fail.
 const observed=operation.catch(error=>{
  if(cancelled)return failure('cancelled');
  if(timeout)return failure('request_timeout',true);
  const code=error?.cause?.code??error?.code;
  return failure(transientCodes.has(code)?'transport_unavailable':'transport_error',transientCodes.has(code));
 });
 try{
  timer=setTimeout(()=>{timeout=true;controller.abort();rejectAbort(failure('request_timeout',true));},Math.max(1,Math.ceil(timeoutMs)));
  const value=await Promise.race([observed,stopped]);
  if(now()-started>=timeoutMs)return {...failure('request_timeout',true),elapsedMs:duration(now()-started),unavailableServices:[],serviceChecks:[]};
  return {unavailableServices:[],serviceChecks:[],...value,elapsedMs:duration(now()-started)};
 }catch{
  return {unavailableServices:[],serviceChecks:[],...failure(cancelled?'cancelled':timeout?'request_timeout':'transport_error',!cancelled&&timeout),elapsedMs:duration(now()-started)};
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();cancelBody(response,reader);
 }
}

export async function assertPublicationReady(options){
 const result=await probePublicationReadiness(options);if(!result.ok)throw new PublicationReadinessError(result);return result;
}
function pause(ms,signal){
 return new Promise((resolve,reject)=>{
  let timer;const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new PublicationReadinessError({ok:false,reason:'cancelled',retryable:false}));};
  if(signal?.aborted)return abort();
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
 });
}
export async function waitForPublicationReady({fetchImpl=fetch,signal,deadlineUnixMs,budgetMs=readyTailBudgetMs,delayMs=readyRetryDelayMs,
 now=()=>performance.now(),wallNow=Date.now,sleep=pause,onObservation=async()=>{}}={}){
 if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>readyTailBudgetMs||!Number.isFinite(delayMs)||delayMs<=0)throw Error('invalid_ready_wait_budget');
 const parent=publicationDeadline(deadlineUnixMs),started=now();
 const durationMs=Math.min(budgetMs,parent===undefined?Infinity:parent-wallNow()),until=started+durationMs;
 let attempts=0,last;
 for(;;){
  const remaining=until-now();
  if(signal?.aborted)throw new PublicationReadinessError({ok:false,reason:'cancelled',retryable:false,attempts,totalElapsedMs:duration(now()-started)});
  if(remaining<=0)throw new PublicationReadinessError({...last,ok:false,reason:'deadline_exhausted',retryable:false,attempts,totalElapsedMs:duration(now()-started)});
  const result=await probePublicationReadiness({fetchImpl,signal,now,wallNow,deadlineUnixMs:parent,timeoutMs:Math.min(readyRequestTimeoutMs,remaining)});
  const completedAt=now();last={...result,attempts:++attempts,totalElapsedMs:duration(completedAt-started)};
  // Diagnostics are best effort; a slow or broken logger cannot turn an
  // already valid ready response into a deadline failure or hold the gate open.
  try{void Promise.resolve(onObservation(last)).catch(()=>{});}catch{}
  if(signal?.aborted)throw new PublicationReadinessError({...last,ok:false,reason:'cancelled',retryable:false});
  if(completedAt>=until)throw new PublicationReadinessError({...last,ok:false,reason:'deadline_exhausted',retryable:false});
  if(result.ok)return last;
  if(!result.retryable)throw new PublicationReadinessError(last);
  await sleep(Math.min(delayMs,Math.max(0,until-now())),signal);
 }
}
