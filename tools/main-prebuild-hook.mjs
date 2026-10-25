/** Local Git trigger. It queues preparation only; never deploys a release. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {preparationControlBinding,startPreparationConsumer,drainLatestMainQueue} from './publish-latest-main.mjs';
import {submitPreparation} from './main-prebuild-queue.mjs';
import {controlExecution} from './main-control-dispatch.mjs';
import {assertRetirementPreparedRefs,retirementPreparedTargets} from './preparation-retirement-ref.mjs';

const self=fileURLToPath(import.meta.url);
export function mainRefEvents(action,input){
 if(action!=='committed')return [];
 return input.trim().split(/\r?\n/).map(line=>line.split(' ')).filter(([old,next,ref])=>ref==='refs/remotes/origin/main'&&/^[a-f0-9]{40}$/.test(next)&&!/^0+$/.test(next)&&next!==old).map(([,next])=>next);
}
export async function drainPrebuildQueue(directory,prepare,{afterUnlock=async()=>{}}={}){
 const pipe='\\\\.\\pipe\\TERUISI.MainPrebuild.'+createHash('sha256').update(path.resolve(directory).toLowerCase()).digest('hex');
 const acquire=()=>new Promise((resolve,reject)=>{
  const server=createServer(socket=>socket.destroy());
  server.once('error',error=>error.code==='EADDRINUSE'?resolve(null):reject(error));
  server.listen(pipe,()=>resolve(()=>new Promise((done,fail)=>server.close(error=>error?fail(error):done()))));
 });
 const names=async()=>(await fs.readdir(directory)).filter(name=>/^[a-f0-9-]+\.pending\.json$/.test(name)).sort();
 const ticketSha=async name=>createHash('sha256').update(await fs.readFile(path.join(directory,name))).digest('hex');
 const pending=async()=>{
  const result=[];
  for(const name of await names()){
   let completed;
   try{completed=JSON.parse(await fs.readFile(path.join(directory,name.replace('.pending.','.result.')),'utf8'));}
   catch(error){if(error.code!=='ENOENT')throw error;result.push(name);continue;}
   if(completed.ticketSha256!==await ticketSha(name)||!['failed','prepared'].includes(completed.status))throw Error('Queue terminal result does not bind its original ticket');
   await fs.unlink(path.join(directory,name));
  }
  return result;
 };
 let handled=0;
 for(;;){
  const unlock=await acquire();if(!unlock)return {status:'queued',handled};
  try{
   for(;;){
    const batch=await pending();if(!batch.length)break;
    // The publisher fetches/fixes the actual latest main, coalescing this batch.
    // A preparation failure is recorded once. It is never retried by the queue.
    let error=null;
    try{await prepare();}catch(failure){error=String(failure.message);}
    for(const name of batch){
     const final=path.join(directory,name.replace('.pending.','.result.')),temporary=final+'.'+randomUUID()+'.tmp';
     await fs.writeFile(temporary,JSON.stringify({ticketSha256:await ticketSha(name),at:new Date().toISOString(),status:error?'failed':'prepared',error}),{flag:'wx'});
     await fs.rename(temporary,final);
     await fs.unlink(path.join(directory,name));handled++;
    }
   }
  }finally{
   await unlock();
  }
  await afterUnlock();
  // Outside the lock inspect names only; terminal reconciliation is serialized.
  if(!(await names()).length)return {status:'drained',handled};
 }
}
async function main(){
 const [mode,configFile,action]=process.argv.slice(2);
 if(!configFile)throw Error('Missing publisher config');
 let input='',events=[];
 if(mode==='event'){
  if(!['prepared','committed'].includes(action))return;
  for await(const chunk of process.stdin){input+=chunk; if(Buffer.byteLength(input)>1024*1024)throw Error('Reference transaction exceeds bound');}
  if(action==='prepared'){if(!retirementPreparedTargets(input).length)return;const config=JSON.parse(await fs.readFile(configFile,'utf8'));await assertRetirementPreparedRefs(config,input);return;}
  events=mainRefEvents(action,input);if(!events.length)return;
 }
 const config=JSON.parse(await fs.readFile(configFile,'utf8'));
 let binding;
 try{binding=await preparationControlBinding(configFile);}
 catch(error){
  const deferred=path.join(config.stateDirectory,'upgrade-deferred');await fs.mkdir(deferred,{recursive:true});
  await fs.writeFile(path.join(deferred,randomUUID()+'.json'),JSON.stringify({version:'teruisi-main-upgrade-deferred-v2',mode,action:action??null,events,input,at:new Date().toISOString(),error:String(error.message)}),{flag:'wx'});
  throw error;
 }
 await controlExecution(binding,self,'hook-'+mode);
 const directory=path.join(config.stateDirectory,'prebuild-queue-v2');
 if(mode==='event'){
  for(const target of events)await submitPreparation(directory,{origin:'hook',observedTarget:target,configSha256:binding.state.configSha256,bundleSha256:binding.state.bundleSha256});
  await startPreparationConsumer(configFile,config);
 }else if(mode==='run'){
  await drainLatestMainQueue(configFile,{binding});
 }else throw Error('Unknown hook mode');
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(self))main().catch(error=>{console.error(error.message);process.exitCode=1;});
