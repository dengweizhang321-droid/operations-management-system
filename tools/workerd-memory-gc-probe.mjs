// Small diagnostic experiment, not a fix or an acceptance benchmark.
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {transform} from 'esbuild';
import {Miniflare} from 'miniflare';
import {connectMemoryInspector} from './workerd-memory-inspector.mjs';
const source=execFileSync('git',['show','e00d4a82:lib/ai/bounded-fetch.ts'],{encoding:'utf8'});
const compiled=await transform(source,{loader:'ts',format:'esm'});
process.env.TERUISI_WORKERD_HEAP_MB='3072';
const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,compatibilityDate:'2026-05-15',modules:[
  {type:'ESModule',path:'entry.js',contents:`import {fetchBoundedJson} from './bounded.js';
    const fixture=JSON.stringify(Array.from({length:4096},(_,id)=>({id,padding:'x'.repeat(220)})));
    export default {async fetch(){const r=await fetchBoundedJson({url:'http://fixture.invalid',init:{},timeoutMs:30000,maxBytes:1048576,fetcher:async()=>new Response(fixture)});return Response.json({rows:r.data.length});}};`},
  {type:'ESModule',path:'bounded.js',contents:compiled.code},
]});
let inspector;
const started=Date.now();
try {
  inspector=await connectMemoryInspector(mf);
  const baseline=await inspector.usage();
  for(let i=0;i<32;i++) {
    const r=await (await mf.dispatchFetch('http://fixture.invalid')).json();
    if(r.rows!==4096)throw new Error('fixture mismatch');
  }
  const afterLoad=await inspector.usage();
  const collectionAcknowledgement=await inspector.requestUserCollection();
  const afterCollectionRequest=await inspector.usage();
  const result={baselineRef:'e00d4a82',requests:32,fixtureRows:4096,syntheticFetcher:true,production:false,
    acceptance:false,elapsedSeconds:(Date.now()-started)/1000,collectionAcknowledgement,baseline,afterLoad,afterCollectionRequest};
  await mkdir(new URL('../tmp/workerd-memory/',import.meta.url),{recursive:true});
  await writeFile(new URL('../tmp/workerd-memory/gc-probe.json',import.meta.url),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result));
}finally {inspector?.close();await mf.dispose();}
