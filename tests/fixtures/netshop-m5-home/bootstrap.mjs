/** M5-only synthetic transport. Actual Home owns all navigation/history.
 * Native captures stay immutable; only bounded list presentation may project.
 * No F directory carrier is fabricated and no detail golden is invented. */
import { validatePanoramaQuery, decodeStorePanorama } from "@/app/netshop/panorama/contract";
import { decodeProductInsights, validateProductQuery } from "@/app/netshop/products/contract";
import { decodePromotionInsightsForQuery, validatePromotionQuery } from "@/lib/netshop/promotion-insights-contract";

const canonical = value => JSON.stringify(value);
function queryFor(body) {
  const c=body.context, scope=c.requestedScope, t=body.tableScope;
  const q=new URLSearchParams({dimension:scope.dimension,periodKind:scope.periodKind,startDate:c.periods.current.startDate,endDate:c.periods.current.endDate});
  scope.platforms.forEach(p=>q.append("platform",p));scope.shopKeys.forEach(s=>q.append("outlet",s));
  for(const [k,v]of Object.entries(t))q.set(k,String(v));return q;
}
function owner(body){return body.context.sourceRevisions.find(r=>r.domain==="netshop"&&r.kind==="owning_revision")?.revision;}
function sameShared(spec,body){
  const s=body.context.requestedScope,w=body.context.periods.current;
  return canonical(spec.platforms)===canonical(s.platforms)&&canonical(spec.shops.map(x=>x.platform+"\u001f"+x.shopName))===canonical(s.shopKeys)
    &&spec.dimension===s.dimension&&spec.kind===s.periodKind&&spec.window.startDate===w.startDate&&spec.window.endDate===w.endDate;
}
function invariant(body){
  const p=body.sources.products.data;
  return canonical({context:body.context,joinedSourceRevisions:body.joinedSourceRevisions,sectionToken:body.sectionToken,sections:body.sections,
    sources:Object.fromEntries(Object.entries(body.sources).map(([key,value])=>[key,key!=="products"?value:{...value,data:{...p,tableScope:null,sections:{...p.sections,items:null,pagination:null}}}]))});
}
function listProjection(p,q) {
  const spec=validateProductQuery(q);const next=structuredClone(p),all=p.sections.items;
  if(spec.tableScope.sort!==p.tableScope.sort || spec.tableScope.category!==p.tableScope.category)throw Error("Pending: no immutable captured sort/category response");
  const term=spec.tableScope.q.toLowerCase();
  const filtered=all.filter(r=>!term||canonical([r.identity,r.title,r.merchantCode]).toLowerCase().includes(term));
  // A complete captured list alone permits this view. Never synthesize a later hidden page.
  if(p.sections.pagination.total!==all.length)throw Error("Pending: captured product list is incomplete for projection");
  const offset=(spec.tableScope.page-1)*spec.tableScope.pageSize,items=filtered.slice(offset,offset+spec.tableScope.pageSize);
  next.tableScope={...next.tableScope,...spec.tableScope};
  next.sections.items=items;next.sections.pagination={page:spec.tableScope.page,pageSize:spec.tableScope.pageSize,total:filtered.length,returned:items.length,hasMore:offset+items.length<filtered.length,truncated:false};
  return next;
}
export function installM5Transport(records) {
  const captures=records.map(r=>({...r,body:JSON.parse(r.raw)}));
  for(const r of captures){r.query=queryFor(r.body).toString();r.revision=owner(r.body);decodeStorePanorama(r.body,new URLSearchParams(r.query),r.revision);}
  const previous=JSON.parse(sessionStorage.getItem("m5-telemetry")||"null");
  window.__m5={calls:previous?.calls||[],projections:previous?.projections||[],pendingReads:previous?.pendingReads||[],unknownReads:previous?.unknownReads||[],writes:previous?.writes||[],models:previous?.models||[],external:previous?.external||[],faults:previous?.faults||[],captures:captures.map(({name,sha256,query,revision})=>({name,sha256,query,revision}))};
  window.__m5Control={error:null,pending:null,defer:null};
  window.__m5Cases=captures.map(r=>({name:r.name,query:r.query,body:r.body,revision:r.revision}));
  const remember=()=>sessionStorage.setItem("m5-telemetry",JSON.stringify(window.__m5));
  const pending=(info,reason)=>{window.__m5.pendingReads.push({...info,reason});remember();return Response.json({code:"synthetic_source_pending",error:reason},{status:503});};
  const failure=status=>new Response(status===503?JSON.stringify({code:"service_unavailable",error:"M5 injected source failure"}):"<html>Synthetic authority proxy failure</html>",{status,headers:{"content-type":status===503?"application/json":"text/html","cache-control":"no-store"}});
  const originalFetch=window.fetch;
  window.__m5NativeFetchWasReplaced=typeof originalFetch==="function";
  window.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init.method||(input instanceof Request?input.method:"GET")).toUpperCase();
    const info={path:url.pathname,query:[...url.searchParams],method,signalInitiallyAborted:!!init.signal?.aborted,probe:!!window.__m5Control.probe};
    window.__m5.calls.push(info);remember();
    if(url.origin!==location.origin){window.__m5.external.push(info);remember();return Response.json({code:"synthetic_external_blocked"},{status:503});}
    if(method!=="GET"){window.__m5.writes.push(info);if(/\/api\/ai\/|interpret/.test(url.pathname))window.__m5.models.push(info);remember();return Response.json({code:"synthetic_write_blocked"},{status:405});}
    if(init.signal?.aborted)throw new DOMException("Aborted","AbortError");
    const who=sessionStorage.getItem("m5-user")||"A";
    if(url.pathname==="/api/auth/me")return Response.json({user:{email:who==="A"?"panorama@example.test":"m5-other@example.test",displayName:"Synthetic "+who,role:"viewer",roleLabel:"只读",scopeRestricted:who!=="A"}});
    if(["/api/ai/models","/api/ai/channels"].includes(url.pathname))return Response.json({items:[]});
    if(url.pathname==="/api/ai/conversations")return Response.json({items:[],models:[],pagination:{page:1,pageSize:30,total:0,returned:0,hasMore:false,truncated:false}});
    if(url.pathname==="/api/ai/chat")return Response.json({items:[],pagination:{pageSize:30,total:0,returned:0,hasMore:false,truncated:false,nextBefore:null}});
    if(who!=="A"&&url.pathname.startsWith("/api/netshop/"))return failure(403);
    const isPanorama=url.pathname==="/api/netshop/store-panorama";
    if(isPanorama&&window.__m5Control.defer){
      const requested=window.__m5Control.defer;window.__m5Control.defer=null;
      const capture=captures.find(r=>r.name===(sessionStorage.getItem("m5-case")||captures[0].name));
      const record={...info,status:requested.status||200,releasedAfterAbort:false};window.__m5.faults.push(record);
      return new Promise(resolve=>{window.__m5Control.pending={signal:init.signal,release(){record.releasedAfterAbort=!!init.signal?.aborted;remember();resolve(requested.status?failure(requested.status):new Response(capture.raw,{headers:{"content-type":"application/json","X-Netshop-Data-Revision":capture.revision}}));}};remember();});
    }
    if(isPanorama&&window.__m5Control.error){window.__m5.faults.push({...info,status:window.__m5Control.error});remember();return failure(window.__m5Control.error);}
    if(url.pathname==="/api/netshop/insights-context")return pending(info,"No committed original no-outlet F directory capture; full carrier is never rewritten");
    if(["/api/netshop/store-panorama","/api/netshop/product-insights","/api/netshop/promotion-insights"].includes(url.pathname)){
      const record=captures.find(r=>r.name===(sessionStorage.getItem("m5-case")||captures[0].name));
      try{
        const spec=isPanorama?validatePanoramaQuery(url.searchParams):url.pathname.endsWith("product-insights")?validateProductQuery(url.searchParams):validatePromotionQuery(url.searchParams);
        const shared=isPanorama?spec.shared:spec.shared||spec.context;
        // Promotion uses its own SKU carrier; it is not the product SPU carrier.
        const sourceBody=isPanorama?record.body:url.pathname.endsWith("product-insights")?record.body.sources.products.data:record.body.sources.promotion.data;
        if(!sourceBody || !sameShared(shared,sourceBody))return pending(info,"No original capture for this exact identity/date/dimension; no response scope retargeting");
        if(isPanorama){
          if(spec.tableScope.grain!==record.body.tableScope.grain)return pending(info,"No captured grain; no browser business reaggregation");
          if(url.searchParams.has("sectionToken")&&url.searchParams.get("sectionToken")!==record.body.sectionToken)return failure(409);
          if(canonical(spec.tableScope)===canonical(record.body.tableScope)){window.__m5.projections.push({...info,fixture:record.name,kind:"unchanged complete captured owning response",sourceSHA256:record.sha256});remember();return new Response(record.raw,{headers:{"content-type":"application/json","X-Netshop-Data-Revision":record.revision}});}
          const body=structuredClone(record.body);body.tableScope={...spec.tableScope};
          const pq=new URLSearchParams(url.searchParams);pq.delete("section");pq.delete("grain");pq.set("category","");pq.set("sort","payment_desc");pq.delete("sectionToken");
          body.sources.products.data=listProjection(body.sources.products.data,pq);
          if(invariant(body)!==invariant(record.body))throw Error("Fixture projection changed a business carrier");
          decodeStorePanorama(body,url.searchParams,record.revision);
          window.__m5.projections.push({...info,fixture:record.name,kind:"S/P list presentation only; native summary/series/dates/operands/coverage/tokens unchanged",sourceSHA256:record.sha256,invariantEqual:true});remember();
          return Response.json(body,{headers:{"X-Netshop-Data-Revision":record.revision}});
        }
        if(url.pathname.endsWith("product-insights")){
          const body=listProjection(sourceBody,url.searchParams);decodeProductInsights(body,url.searchParams,record.revision);
          window.__m5.projections.push({...info,fixture:record.name,kind:"unchanged native nested P values; list presentation projection, not independent HTTP",sourceSHA256:record.sha256});remember();
          return Response.json(body,{headers:{"X-Netshop-Data-Revision":record.revision}});
        }
        const body=structuredClone(sourceBody);
        decodePromotionInsightsForQuery(body,url.searchParams,owner(body));
        window.__m5.projections.push({...info,fixture:record.name,kind:"unchanged nested owning A envelope; no SPU/SKU bridge and not independent HTTP",sourceSHA256:record.sha256});remember();
        return Response.json(body,{headers:{"X-Netshop-Data-Revision":owner(body)}});
      }catch(error){return pending(info,error.message);}
    }
    if(["/api/netshop/product-insights/detail","/api/netshop/promotion-insights/detail"].includes(url.pathname))return pending(info,"No immutable detail golden; detail source pending, no fake performance row");
    if(["/api/sales/summary","/api/netshop/store-overview","/api/netshop/product-performance","/api/netshop/promotion-performance/items","/api/netshop/promotion-performance/overview","/api/netshop/promotion-diagnostic","/api/netshop/products"].includes(url.pathname))return pending(info,"Legacy/O/source golden pending: route/error preservation only; prior M1/M4 acceptance inherited");
    window.__m5.unknownReads.push(info);remember();return Response.json({code:"synthetic_unknown_get_blocked"},{status:503});
  };
}
