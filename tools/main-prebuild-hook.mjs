/** Local Git trigger. It queues preparation only; never deploys a release. */
import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {publisherEnvironment} from './publish-latest-main.mjs';

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
function spawnPreparation(configFile){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(path.dirname(self),'publish-latest-main.mjs'),'--config',configFile,'--prepare-only','--no-pause'],{cwd:path.dirname(configFile),env:publisherEnvironment(),windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>code===0&&!signal?resolve():reject(Error('自动打包未完成，退出码：'+(code??signal))));
 });
}
async function main(){
 const [mode,configFile,action]=process.argv.slice(2);
 if(!configFile)throw Error('Missing publisher config');
 const config=JSON.parse(await fs.readFile(configFile,'utf8'));
 const directory=path.join(config.stateDirectory,'prebuild-queue');await fs.mkdir(directory,{recursive:true});
 if(mode==='event'){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const events=mainRefEvents(action,input);if(!events.length)return;
  for(const target of events)await fs.writeFile(path.join(directory,randomUUID()+'.pending.json'),JSON.stringify({target,at:new Date().toISOString()}),{flag:'wx'});
  const output=path.join(directory,'runner-'+randomUUID()+'.log'),fd=openSync(output,'wx');
  try{
   const child=spawn(process.execPath,[self,'run',configFile],{cwd:config.stateDirectory,detached:true,windowsHide:true,env:publisherEnvironment(),stdio:['ignore',fd,fd]});
   child.once('error',error=>console.error('自动准备未启动：'+error.message));child.unref();
  }finally{closeSync(fd);}
 }else if(mode==='run'){
  await drainPrebuildQueue(directory,()=>spawnPreparation(configFile));
 }else throw Error('Unknown hook mode');
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(self))main().catch(error=>{console.error(error.message);process.exitCode=1;});
