// Real central registry/HMAC/consumer chain; no public identity substitute.
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out='D:/codex-artifacts/ai-isolated-functional-20261108';
const bindings={TERUISI_DJANGO_INTERNAL_SECRET:process.env.TERUISI_DJANGO_INTERNAL_SECRET,
  TERUISI_LOCAL_DIRECT_ACCESS:'false',TERUISI_RUNTIME_ENV:'development',TERUISI_DJANGO_ERP_MODE:'django'};
if (!bindings.TERUISI_DJANGO_INTERNAL_SECRET || bindings.TERUISI_DJANGO_INTERNAL_SECRET.length<32) throw Error('private key missing');
for (const domain of ['AI','SALES','FINANCE','NETSHOP','MARKET','PRODUCTS','INVENTORY','WORKFLOW','CUSTOMER_SERVICE','BI','ERP','ACCESS_CONTROL']) {
  for (const role of ['READER','WRITER']) bindings[`TERUISI_DJANGO_${domain}_${role}_BASE_URL`]=`http://127.0.0.1:${role==='READER'?28444:28447}`;
}
const entry=`import {handleAiEdge} from './lib/ai/django-edge.ts';
export default {async fetch(request){
 const p=new URL(request.url).pathname;
 if(p==='/api/ai/internal/edge')return handleAiEdge(request);
 return new Response('No public login substitute',{status:404});
}};`;
const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',external:['cloudflare:workers'],define:{'process.env.NODE_ENV':'"production"'}});
writeFileSync(path.join(out,'edge-bundle.js'),built.outputFiles[0].text,{flag:'wx'});
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-03-01',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:28445,bindings,cf:false,
 outboundService:async request=>{
   const u=new URL(request.url);
   if(!['http://127.0.0.1:28444','http://127.0.0.1:28447'].includes(u.origin)) {
     appendFileSync(path.join(out,'edge-egress.jsonl'),JSON.stringify({allowed:false,origin:u.origin,path:u.pathname})+'\n');
     return new Response('Unlisted isolated destination',{status:502});
   }
   const response=await fetch(request.url,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',signal:AbortSignal.timeout(40000)});
   appendFileSync(path.join(out,'edge-egress.jsonl'),JSON.stringify({allowed:true,path:u.pathname,status:response.status})+'\n');
   return response;
 }});
await mf.ready;
console.log('Private real central edge ready on 28445');
process.on('SIGTERM',async()=>{await mf.dispose();process.exit(0);});
process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
