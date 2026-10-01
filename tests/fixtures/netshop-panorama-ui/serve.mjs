import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat, mkdir, writeFile } from 'node:fs/promises';
const directory=dirname(fileURLToPath(import.meta.url));
const evidence=resolve(process.argv[2]??'');
const expected=resolve('E:/codex-artifacts/netshop-panorama-M5-20261001/');
if(!evidence.startsWith(expected+'\\') || !evidence.includes('ui-vite-')) throw new Error('Pass a new exclusive panorama ui-vite evidence directory');
await mkdir(evidence,{recursive:false});
const server=await createServer({configFile:resolve(directory,'vite.config.ts')});
let timer;
try {
  await server.listen();
  await writeFile(resolve(evidence,'ready.json'),JSON.stringify({port:3162,pid:process.pid,root:directory,privateFixtureOnly:true}),{flag:'wx'});
  process.stdout.write('Panorama isolated UI: http://127.0.0.1:3162/\n');
  await new Promise(resolveDone=>{timer=setInterval(async()=>{try{await stat(resolve(evidence,'stop.request'));resolveDone();}catch{/* Own marker not yet requested. */}},250);setTimeout(resolveDone,900_000).unref();});
}finally{clearInterval(timer);await server.close();await writeFile(resolve(evidence,'stopped.json'),JSON.stringify({normalStop:true,pid:process.pid}),{flag:'wx'});}
