/** C original-query-only transport; actual Home remains the only history owner. */
import { validateComparisonQuery, decodeComparisonInsights } from "@/app/netshop/comparison/contract";
import { installM5Transport } from "@/tests/fixtures/netshop-m5-home/bootstrap.mjs";
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;
const identity=query=>JSON.stringify(ordered(validateComparisonQuery(new URLSearchParams(query))));
export async function installM6Transport(records,linked=[]){
 if(linked.length)installM5Transport(linked.map(r=>({...r,originalQuery:r.query})));
 const original=window.fetch,cs=records.filter(r=>r.kind==="comparison");
 for(const r of cs){r.key=identity(r.query);await decodeComparisonInsights(JSON.parse(r.raw),new URLSearchParams(r.query),r.owningRevision);}
 window.__m6={calls:[],served:[],pending:[],writes:[],models:[],external:[],unknown:[],faults:[],cases:cs.map(r=>({name:r.name,phase:r.phase,seed:r.seed,query:r.query,revision:r.owningRevision,rawMeaning:r.rawMeaning,sha256:r.sha256}))};
 window.__m6Cases=cs.map(r=>({name:r.name,query:r.query,body:JSON.parse(r.raw),phase:r.phase,finalAcceptance:r.finalAcceptance}));
 window.__m6Control={error:null,defer:null,pending:null,probe:false};
 const fail=(status,message)=>new Response([401,403,409].includes(status)?"<html>无权或版本失效</html>":JSON.stringify({code:"synthetic_source_pending",error:message||"当前范围尚无已核对来源，请重新读取。"}),{status,headers:{"content-type":[401,403,409].includes(status)?"text/html":"application/json","cache-control":"no-store"}});
 const pending=(call,reason)=>{window.__m6.pending.push({...call,reason});return fail(503);};
 window.fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init.method||(input instanceof Request?input.method:"GET")).toUpperCase();
  const call={path:url.pathname,query:[...url.searchParams],method,probe:window.__m6Control.probe};window.__m6.calls.push(call);
  if(url.origin!==location.origin){window.__m6.external.push(call);return fail(503);}
  if(method!=="GET"){window.__m6.writes.push(call);if(/\/api\/ai\/|interpret/.test(url.pathname))window.__m6.models.push(call);return fail(405);}
  if(url.pathname==="/api/auth/me")return Response.json({user:{email:"comparison@example.test",displayName:"合成只读账号",role:"viewer",roleLabel:"只读",scopeRestricted:sessionStorage.getItem("m6-user")==="B"}});
  if(url.pathname==="/api/netshop/comparison-insights"){
   if(sessionStorage.getItem("m6-user")==="B")return fail(403);
   if(window.__m6Control.error){window.__m6.faults.push({...call,status:window.__m6Control.error});return fail(window.__m6Control.error);}
   let key;try{key=identity(url.searchParams);}catch(error){window.__m6.unknown.push({...call,reason:error.message});return fail(400);}
   const record=cs.find(r=>r.key===key);
   if(!record)return pending(call,"No original complete comparison capture for this exact full query; old body must clear");
   const reply=()=>new Response(record.raw,{headers:{"content-type":"application/json","X-Netshop-Data-Revision":record.owningRevision,"cache-control":"no-store"}});
   if(window.__m6Control.defer){
    const fault=window.__m6Control.defer;window.__m6Control.defer=null;const entry={...call,status:fault.status||200,releasedAfterAbort:false};window.__m6.faults.push(entry);
    return new Promise(resolve=>{window.__m6Control.pending={signal:init.signal,release(){entry.releasedAfterAbort=!!init.signal?.aborted;resolve(fault.status?fail(fault.status):reply());}};});
   }
   await decodeComparisonInsights(JSON.parse(record.raw),url.searchParams,record.owningRevision);
   window.__m6.served.push({...call,fixture:record.name,sha256:record.sha256,phase:record.phase,rawMeaning:record.rawMeaning,completeOriginalQuery:true,noBodyProjection:true});return reply();
  }
  if(url.pathname.startsWith("/api/netshop/")&&linked.length){
   const selected=cs.find(r=>r.name===sessionStorage.getItem("m6-case"));
   if(!selected?.seed||!linked.some(r=>r.seed===selected.seed))return pending(call,"No same-seed exact topic/detail/directory corpus; never bridge by shop name alone");
   return original(input,init);
  }
  if(["/api/ai/models","/api/ai/channels"].includes(url.pathname))return Response.json({items:[]});
  if(url.pathname==="/api/ai/conversations")return Response.json({items:[],models:[],pagination:{page:1,pageSize:30,total:0,returned:0,hasMore:false,truncated:false}});
  if(url.pathname==="/api/ai/chat")return Response.json({items:[],pagination:{pageSize:30,total:0,returned:0,hasMore:false,truncated:false,nextBefore:null}});
  if(["/api/netshop/store-panorama","/api/netshop/insights-context","/api/netshop/product-insights","/api/netshop/product-insights/detail","/api/netshop/promotion-insights","/api/netshop/promotion-insights/detail","/api/netshop/store-overview","/api/sales/summary","/api/netshop/product-performance","/api/netshop/promotion-performance/overview","/api/netshop/promotion-performance/items","/api/netshop/products","/api/netshop/promotion-diagnostic"].includes(url.pathname))return pending(call,"Explicit source/old-view pending; no fake donor body");
  window.__m6.unknown.push(call);return fail(503);
 };
}
