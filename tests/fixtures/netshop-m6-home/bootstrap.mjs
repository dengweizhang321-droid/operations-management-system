/** Original signed corpus only. No network fallthrough or business DTO rewrite. */
import { validateComparisonQuery, decodeComparisonInsights } from "@/app/netshop/comparison/contract";
import { validateProductQuery,decodeProductInsights,decodeProductDetail } from "@/app/netshop/products/contract";
import { validatePromotionQuery,decodePromotionInsightsForQuery,decodePromotionDetailForQuery } from "@/lib/netshop/promotion-insights-contract";
import { bindShopPresentationHistory } from "@/app/shell/shop-presentation-history";
import { parseShellLocation,serializeShellLocation } from "@/app/shell/navigation-contract";
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;
const key=(query,kind)=>JSON.stringify(ordered(kind==="comparison"?validateComparisonQuery(new URLSearchParams(query)):kind.startsWith("product")?validateProductQuery(new URLSearchParams(query),kind==="product-detail"):validatePromotionQuery(new URLSearchParams(query),kind==="promotion-detail")));
async function decode(record,query){
 const body=JSON.parse(record.raw),q=new URLSearchParams(query);
 if(record.kind==="comparison")return decodeComparisonInsights(body,q,record.owningRevision);
 if(record.kind==="products")return decodeProductInsights(body,q,record.owningRevision);
 if(record.kind==="product-detail")return decodeProductDetail(body,q,record.owningRevision);
 if(record.kind==="promotion")return decodePromotionInsightsForQuery(body,q,record.owningRevision);
 return decodePromotionDetailForQuery(body,q,record.owningRevision);
}
export async function installM6Transport(comparison,linked=[]){
 const initialAccount=sessionStorage.getItem("m6-user")||"A";
 // Original Home accepts stored presentation hints only in an account-bound
 // history entry. This is fixture UI state, never source/authentication proof.
 if(initialAccount==="A")history.replaceState(bindShopPresentationHistory(history.state,location.href,JSON.stringify(["comparison-signed@example.test","viewer",false])),"",location.href);
 const records=[...comparison,...linked],positive=records.filter(r=>(r.status||200)===200),faults=records.filter(r=>r.status&&r.status!==200);
 for(const record of positive){record.key=key(record.query,record.kind);await decode(record,record.query);}
 window.__m6={calls:[],served:[],pending:[],writes:[],models:[],external:[],unknown:[],faults:[],cases:positive.map(r=>({name:r.name,phase:r.phase,seed:r.seed,query:r.query,revision:r.owningRevision,rawMeaning:r.rawMeaning,sha256:r.sha256}))};
 window.__m6Cases=positive.filter(r=>r.kind==="comparison").map(r=>({name:r.name,query:r.query,body:JSON.parse(r.raw),phase:r.phase,seed:r.seed,finalAcceptance:r.finalAcceptance}));
 window.__m6Control={error:null,defer:null,pending:null,probe:false};
 window.__m6RestorePresentation=url=>{const canonical=serializeShellLocation(parseShellLocation(url),url);history.replaceState(bindShopPresentationHistory(history.state,canonical,JSON.stringify(["comparison-signed@example.test","viewer",false])),"",canonical);dispatchEvent(new PopStateEvent("popstate"));};
 const fail=status=>{const original=faults.find(r=>r.status===status);return original?new Response(original.raw,{status,headers:original.headers}):Response.json({code:"synthetic_source_pending",error:"当前范围尚无已核对来源，请重新读取。"}, {status});};
 const pending=(call,reason)=>{window.__m6.pending.push({...call,reason});return fail(503);};
 window.fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init.method||(input instanceof Request?input.method:"GET")).toUpperCase(),call={path:url.pathname,query:[...url.searchParams],method,probe:window.__m6Control.probe};
  window.__m6.calls.push(call);
  if(url.origin!==location.origin){window.__m6.external.push(call);return fail(503);}
  if(method!=="GET"){window.__m6.writes.push(call);if(/\/api\/ai\/|interpret/.test(url.pathname))window.__m6.models.push(call);return fail(405);}
  const who=sessionStorage.getItem("m6-user")||"A";
  if(url.pathname==="/api/auth/me")return Response.json({user:{email:who==="A"?"comparison-signed@example.test":"other-signed@example.test",displayName:"合成只读账号",role:"viewer",roleLabel:"只读",scopeRestricted:who==="B"}});
  if(["/api/ai/models","/api/ai/channels"].includes(url.pathname))return Response.json({items:[]});
  if(url.pathname==="/api/ai/conversations")return Response.json({items:[],models:[],pagination:{page:1,pageSize:30,total:0,returned:0,hasMore:false,truncated:false}});
  if(url.pathname==="/api/ai/chat")return Response.json({items:[],pagination:{pageSize:30,total:0,returned:0,hasMore:false,truncated:false,nextBefore:null}});
  const kind={"/api/netshop/comparison-insights":"comparison","/api/netshop/product-insights":"products","/api/netshop/product-insights/detail":"product-detail","/api/netshop/promotion-insights":"promotion","/api/netshop/promotion-insights/detail":"promotion-detail"}[url.pathname];
  if(kind){
   if(who==="B")return fail(403);
   if(kind==="comparison"&&window.__m6Control.error){window.__m6.faults.push({...call,status:window.__m6Control.error});return fail(window.__m6Control.error);}
   let identity;try{identity=key(url.searchParams,kind);}catch(error){window.__m6.unknown.push({...call,reason:error.message});return fail(400);}
   const record=positive.find(r=>r.kind===kind&&r.key===identity);
   if(!record)return pending(call,"No original exact full query/identity; no context or table retargeting");
   const current=positive.find(r=>r.name===sessionStorage.getItem("m6-case"));
   if(kind!=="comparison"&&current&&record.seed!==current.seed)return pending(call,"Different run/seed direct source cannot be combined");
   const reply=()=>new Response(record.raw,{headers:record.headers||{"content-type":"application/json","X-Netshop-Data-Revision":record.owningRevision,"cache-control":"no-store"}});
   if(kind==="comparison"&&window.__m6Control.defer){const fault=window.__m6Control.defer;window.__m6Control.defer=null;const entry={...call,status:fault.status||200,releasedAfterAbort:false};window.__m6.faults.push(entry);
    return new Promise(resolve=>{window.__m6Control.pending={signal:init.signal,release(){entry.releasedAfterAbort=!!init.signal?.aborted;resolve(fault.status?fail(fault.status):reply());}};});}
   try{await decode(record,url.searchParams);}catch(error){return pending(call,error.message);}
   window.__m6.served.push({...call,fixture:record.name,sha256:record.sha256,phase:record.phase,rawMeaning:record.rawMeaning,completeOriginalQuery:true,noBodyProjection:true});return reply();
  }
  if(["/api/netshop/store-panorama","/api/netshop/insights-context","/api/netshop/store-overview","/api/sales/summary","/api/netshop/product-performance","/api/netshop/promotion-performance/overview","/api/netshop/promotion-performance/items","/api/netshop/products","/api/netshop/promotion-diagnostic"].includes(url.pathname))return pending(call,"Explicit source/old-view pending; entry preservation only");
  window.__m6.unknown.push(call);return fail(503);
 };
}
