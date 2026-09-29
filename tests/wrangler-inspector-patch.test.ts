import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Miniflare} from 'miniflare';
import {originalInspectorForTesting,patchWranglerInspector,patchedInspectorSha256,installWranglerInspectorPatch} from '../tools/install-wrangler-inspector-patch.mjs';

const original=originalInspectorForTesting(await readFile(new URL('../node_modules/wrangler/wrangler-dist/InspectorProxyWorker.js',import.meta.url),'utf8'));
const patched=patchWranglerInspector(original);
async function instance(source=patched){
 const inspectorModule=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const controller:string[]=[];
 const proxy=new inspectorModule.InspectorProxyWorker({}, {PROXY_CONTROLLER:{fetch:async()=>new Response(null,{status:204})}});
 proxy.websockets.proxyController={send:(value:string)=>controller.push(value)};
 proxy.proxyData={proxyLogsToController:true};
 return {proxy,controller};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('inspector adapter pins exact original and output bytes, is idempotent and rejects tampering',()=>{
 assert.equal(createHash('sha256').update(patched).digest('hex'),patchedInspectorSha256);
 assert.equal(patchWranglerInspector(patched),patched);
 assert.equal(originalInspectorForTesting(patched),original);
 assert.throws(()=>patchWranglerInspector(original+'\n'),/unknown dependency/);
 assert.throws(()=>patchWranglerInspector(patched+'\n'),/unknown dependency/);
});

test('original backlog grows; candidate retains FIFO recent messages within count and character bounds',async()=>{
 const old=await instance(original),fixed=await instance();
 for(let i=0;i<2000;i++){
  const data=JSON.stringify({method:'Network.dataReceived',params:{requestId:String(i),data:'x'.repeat(2048)}});
  old.proxy.handleRuntimeIncomingMessage({data});fixed.proxy.handleRuntimeIncomingMessage({data});
 }
 assert.equal(old.proxy.runtimeMessageBuffer.length,2000);
 assert.equal(fixed.proxy.runtimeMessageBuffer.length,256);
 assert.ok(fixed.proxy.runtimeMessageBufferChars<=1048576);
 assert.equal(fixed.proxy.runtimeMessageBuffer[0].params.requestId,'1744');
 const sent:string[]=[];fixed.proxy.websockets.devtools={send:(s:string)=>sent.push(s)};fixed.proxy.tryDrainRuntimeMessageBuffer();
 assert.equal(sent.length,256);assert.equal(JSON.parse(sent[0]).params.requestId,'1744');
 assert.equal(fixed.proxy.runtimeMessageBufferChars,0);assert.deepEqual(fixed.proxy.runtimeMessageBufferSizes,[]);
 await tick();
});

test('large headless messages are not retained; exception and console controller delivery remain intact',async()=>{
 const {proxy,controller}=await instance();
 for(let i=0;i<50;i++)proxy.handleRuntimeIncomingMessage({data:JSON.stringify({method:'Network.dataReceived',params:{data:'x'.repeat(100000)}})});
 assert.ok(proxy.runtimeMessageBuffer.length<=10);assert.ok(proxy.runtimeMessageBufferChars<=1048576);
 const count=proxy.runtimeMessageBuffer.length;
 proxy.handleRuntimeIncomingMessage({data:JSON.stringify({method:'Runtime.exceptionThrown',params:{message:'x'.repeat(1100000)}})});
 assert.equal(proxy.runtimeMessageBuffer.length,count);assert.equal(controller.length,1);
 proxy.handleRuntimeIncomingMessage({data:JSON.stringify({method:'Runtime.consoleAPICalled',params:{type:'error'}})});
 assert.equal(controller.length,2);await tick();
});

test('Network tracking only opens with DevTools; runtime reconnect while attached still enables debugging',async()=>{
 const {proxy}=await instance();const sent:{method:string}[]=[];
 const runtime={send:(s:string)=>sent.push(JSON.parse(s))};proxy.websockets.runtime=runtime;
 proxy.handleRuntimeWebSocketOpen(runtime);clearInterval(proxy.runtimeKeepAliveInterval);await tick();
 assert.deepEqual(sent.map(s=>s.method),['Runtime.enable']);
 sent.length=0;proxy.websockets.devtools={send(){}};proxy.handleRuntimeWebSocketOpen(runtime);clearInterval(proxy.runtimeKeepAliveInterval);await tick();
 assert.deepEqual(sent.map(s=>s.method),['Runtime.enable','Debugger.enable','Network.enable']);
});

test('DevTools handshake keeps the original Host and Origin rejection rules',async()=>{
 const {proxy}=await instance();
 const hostileHost=await proxy.handleDevToolsWebSocketUpgradeRequest(new Request('http://localhost/ws',{headers:{Host:'invalid.example',Origin:'http://localhost',Upgrade:'websocket'}}));
 assert.equal(hostileHost.status,401);
 const hostileOrigin=await proxy.handleDevToolsWebSocketUpgradeRequest(new Request('http://localhost/ws',{headers:{Host:'localhost',Origin:'https://invalid.example',Upgrade:'websocket'}}));
 assert.equal(hostileOrigin.status,401);assert.equal(proxy.websockets.devtools,undefined);
});

test('installation refuses unknown versions/bytes and repeats without rewriting',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wrangler-inspector-patch-'));
 try{
  const pkg=path.join(root,'node_modules/wrangler');await mkdir(path.join(pkg,'wrangler-dist'),{recursive:true});
  await writeFile(path.join(root,'package.json'),'{}');await writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'wrangler',version:'4.92.0'}));
  const entry=path.join(pkg,'wrangler-dist/InspectorProxyWorker.js');await writeFile(entry,original);
  assert.equal((await installWranglerInspectorPatch(root)).status,'patched');
  assert.equal((await installWranglerInspectorPatch(root)).status,'already_patched');
  await writeFile(entry,original+'\n');await assert.rejects(installWranglerInspectorPatch(root),/unknown dependency/);
  assert.equal(await readFile(entry,'utf8'),original+'\n');
  await writeFile(entry,original);await writeFile(path.join(pkg,'package.json'),' {"version":"4.93.0"}');
  await assert.rejects(installWranglerInspectorPatch(root),/locked 4.92.0/);assert.equal(await readFile(entry,'utf8'),original);
 }finally{assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()),'wrangler-inspector-patch-')));await rm(root,{recursive:true,force:true});}
});

test('real workerd DevTools attach/detach preserves replay and disables network after disconnect',{timeout:30000},async()=>{
 const mf=new Miniflare({host:'127.0.0.1',port:0,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cache:false,unsafeEphemeralDurableObjects:true,
  modules:[{type:'ESModule',path:'entry.js',contents:`import {InspectorProxyWorker} from './proxy.js';
   export class ProbeProxy extends InspectorProxyWorker {commands=[];async fetch(req){
    const p=new URL(req.url).pathname;
    if(p==='/init'||p==='/reconnect'){this.websockets.runtime??={send:s=>this.commands.push(JSON.parse(s))};this.handleRuntimeWebSocketOpen(this.websockets.runtime);clearInterval(this.runtimeKeepAliveInterval);return new Response('ok');}
    if(p==='/state')return Response.json({commands:this.commands,attached:!!this.websockets.devtools,buffered:this.runtimeMessageBuffer.length});
    if(p==='/seed'){this.handleRuntimeIncomingMessage({data:JSON.stringify({method:'Runtime.consoleAPICalled',params:{type:'log',args:[]}})});return new Response('ok');}
    return super.fetch(req);
   }}
   export default {fetch(req,env){return env.DURABLE_OBJECT.get(env.DURABLE_OBJECT.idFromName('')).fetch(req)}};`},
   {type:'ESModule',path:'proxy.js',contents:patched}],durableObjects:{DURABLE_OBJECT:{className:'ProbeProxy',unsafePreventEviction:true}},
   bindings:{WRANGLER_VERSION:'4.92.0',PROXY_CONTROLLER_AUTH_SECRET:'isolated-auth'},serviceBindings:{PROXY_CONTROLLER:async(request:Request)=>{await request.arrayBuffer();return new Response(null,{status:204});}}});
 let stage='init';try{
  const get=async(p:string)=>(await mf.dispatchFetch('http://localhost'+p)).json();
  await(await mf.dispatchFetch('http://localhost/init')).text();
  await(await mf.dispatchFetch('http://localhost/seed')).text();
  stage='attach';const response=await mf.dispatchFetch('http://localhost/ws',{headers:{Upgrade:'websocket',Origin:'http://localhost',Host:'localhost'}});
  assert.equal(response.status,101);const socket=response.webSocket!;socket.accept();
  let clientError=false;socket.addEventListener('error',()=>{clientError=true;});
  assert.equal((await get('/state')).attached,true);assert.equal((await get('/state')).buffered,0);
  stage='reconnect';await(await mf.dispatchFetch('http://localhost/reconnect')).text();
  assert.ok((await get('/state')).commands.some((c:{method:string})=>c.method==='Network.enable'));
  stage='detach';socket.close(1000,'test done');let state;
  for(let i=0;i<50;i++){state=await get('/state');if(!state.attached)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(state.attached,false);assert.ok(state.commands.some((c:{method:string})=>c.method==='Network.disable'));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(clientError,false);
 }catch(error){throw new Error(`${stage}: ${(error as Error).message}`);}finally{try{await mf.dispose();}catch(error){throw new Error(`dispose after ${stage}: ${(error as Error).message}`);}}
});
