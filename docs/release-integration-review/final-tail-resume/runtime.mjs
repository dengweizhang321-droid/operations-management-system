import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,readdir,lstat,realpath,open,mkdir,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {digest,canonical,safeAttempt,journalRoot,comparisonId,originalHead,acceptedHead} from './protocol.mjs';
export const adopted='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9';
const ps5=path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),ps5Sha='7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5';
export async function safePath(filename){
  filename=path.resolve(filename);let cursor=path.parse(filename).root;
  for(const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink(),'Reparse path');if(cursor!==filename)assert.ok(s.isDirectory());}
  assert.equal(path.resolve(await realpath(filename)).toLowerCase(),filename.toLowerCase());return filename;
}
export async function readSafe(filename){await safePath(filename);const before=await lstat(filename,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n);const raw=await readFile(filename),after=await lstat(filename,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[k],after[k]);return raw;}
export async function nativeDigest(filename,expected,deadlineUnixMs=Infinity){
  await safePath(filename);const before=await lstat(filename,{bigint:true});assert.ok(before.isFile());assert.ok(before.nlink===1n||path.resolve(filename).toLowerCase()===ps5.toLowerCase()&&expected===ps5Sha,'Hardlink not the exact original system host');
  if(Date.now()>=deadlineUnixMs)throw Object.assign(new Error('File verification deadline'),{code:'DEADLINE_EXCEEDED'});
  const h=createHash('sha256'),stream=createReadStream(filename);let timer;
  if(Number.isFinite(deadlineUnixMs)){timer=setTimeout(()=>stream.destroy(Object.assign(new Error('File verification deadline'),{code:'DEADLINE_EXCEEDED'})),Math.max(1,deadlineUnixMs-Date.now()));timer.unref();}
  try{for await(const chunk of stream)h.update(chunk);}finally{clearTimeout(timer);stream.destroy();}
  const after=await lstat(filename,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[k],after[k]);if(Date.now()>=deadlineUnixMs)throw Object.assign(new Error('File verification deadline'),{code:'DEADLINE_EXCEEDED'});return h.digest('hex');
}
export async function createDirectory(target){target=path.resolve(target);let cursor=path.parse(target).root;for(const part of target.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{const s=await lstat(cursor);assert.ok(s.isDirectory()&&!s.isSymbolicLink());}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(cursor);const s=await lstat(cursor);assert.ok(s.isDirectory()&&!s.isSymbolicLink());}}return target;}
export async function writeDurable(filename,bytes){await safePath(path.dirname(filename));const h=await open(filename,'wx');try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
export async function snapshotJournal(spec,engine){
  await readSafe(path.join(spec.journalRoot,spec.batch.id,'000000.json'));
  const state=await engine.journalState(spec.journalRoot,spec.batch),files=[];for(let i=0;i<state.events.length;i++){const filename=path.join(state.dir,String(i).padStart(6,'0')+'.json'),raw=await readSafe(filename);assert.ok(raw.equals(Buffer.from(canonical(state.events[i])+'\n')));files.push({path:path.resolve(filename),sha256:digest(raw)});}return{state,files};
}
export async function observationRecords(batchId,since){
  const root=path.join(journalRoot,'_observations'),found=[];let names;
  try{await safePath(root);names=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return found;throw e;}
  for(const d of names){if(!d.name.startsWith(batchId+'-')||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(d.name.slice(batchId.length+1))||!d.isDirectory()||d.isSymbolicLink())continue;const dir=path.join(root,d.name);if((await lstat(dir)).mtimeMs<since)continue;
    for(const name of await readdir(dir)){if(!/^\d+\.json$/.test(name))continue;const filename=path.join(dir,name),info=await lstat(filename);assert.ok(info.isFile()&&info.size<=65536);const raw=await readSafe(filename),v=JSON.parse(raw),at=v.observation?.at;if(v.batchSha256!=='9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15'||typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(at)||!Number.isFinite(Date.parse(at))||Date.parse(at)<since||Date.parse(at)>Date.now()+5000)continue;found.push(safeAttempt({...v,sourcePath:filename,sourceSha256:digest(raw)}));}
  }return found.filter(Boolean).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
export async function makeRuntime({spec,scope,sourceScope,deadlineUnixMs}){
  // The caller/preparer checks every old/new file before this import boundary.
  const modules=await Promise.all([import(pathToFileURL(path.join(adopted,'tools/release-impact.mjs'))),import(pathToFileURL(path.join(adopted,'tools/release-batch.mjs'))),import(pathToFileURL(path.join(adopted,'tools/worker-local-release-rotation.mjs'))),import(pathToFileURL(path.join(adopted,'tools/worker-local-release.mjs'))),import(pathToFileURL(sourceScope.validatorPath)),import(pathToFileURL(sourceScope.apiPath))]);
  const [impact,engine,rotation,operator,validator,sourceApi]=modules;
  const pins=new Map(scope.files.map(f=>[path.resolve(f.path),f.sha256]));
  async function revalidateSource(old){
    const contract=JSON.parse(await readSafe(old.contractPath)).profileContract;
    return sourceApi.validateExactEvidence({preRaw:await readSafe(old.preManifestPath),postRaw:await readSafe(old.postManifestPath),inputRaw:await readSafe(old.inputPath),proofRaw:await readSafe(old.proofPath),witnessRaw:await readSafe(old.witnessPath),beforeReview:JSON.parse(await readSafe(old.beforeReviewPath)),transitionReview:JSON.parse(await readSafe(old.transitionReviewPath)),validateFullManifest:validator.assertFullManifest,contract});
  }
  async function collectCurrent(_,op,_lease,deadline){
    const since=Date.now();let processResult;
    try{
      processResult=await operator.runProcess(spec.collector.executable,[...spec.collector.args,'--phase',op.phase],{cwd:spec.collector.cwd,deadlineUnixMs:deadline,timeoutMs:Math.min(1200000,Math.max(1,deadline-Date.now())),outputProtocol:'direct-exit-files',cleanup:'preserve',label:'approved final-tail original readonly admission'});
      const value=JSON.parse(processResult.stdout.trim());value.observationAttempts=await observationRecords(spec.batch.id,since);return value;
    }catch(error){
      error.processEvidence??=processResult?.processEvidence;try{error.observationAttempts=await observationRecords(spec.batch.id,since);error.failureCode=error.observationAttempts.findLast(a=>a.status==='failed')?.error?.code??error.code;}catch(observationError){error.observationCaptureFailure={messageSha256:digest(String(observationError.message))};}throw error;
    }
  }
  async function readOnlyJournal(root,batch){await readSafe(path.join(root,batch.id,'000000.json'));return engine.journalState(root,batch);}
  async function releaseOwnership({activePath,expectedActive,expectedJournalHead,deadlineUnixMs:deadline}){
    const before=await lstat(await safePath(activePath),{bigint:true}),raw=await readSafe(activePath);assert.equal(canonical(JSON.parse(raw)),canonical(expectedActive));const state=await readOnlyJournal(spec.journalRoot,spec.batch);assert.equal(state.previous,expectedJournalHead);assert.equal(state.events.at(-1).completionProtocol,scope.version);assert.equal(state.latest.get(comparisonId).eventSha256,originalHead);assert.equal(state.latest.get(comparisonId).status,'unknown');assert.equal(state.events[88].eventSha256,acceptedHead);
    const after=await lstat(await safePath(activePath),{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[k],after[k]);assert.equal(digest(await readSafe(activePath)),digest(raw));assert.ok(Date.now()<deadline,'Common deadline before physical unlink');await unlink(activePath);try{await lstat(activePath);throw new Error('Ownership exists after unlink');}catch(e){assert.equal(e.code,'ENOENT');}assert.ok(Date.now()<deadline,'Common deadline after physical unlink');return{released:true};
  }
  async function runOriginal(op,context){assert.equal(Number(process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS),deadlineUnixMs,'Original supported inherited deadline missing');return engine.runApprovedOperation(op,context);}
  return {...impact,...engine,...rotation,deadlineUnixMs,journalState:readOnlyJournal,runApprovedOperation:runOriginal,safeRead:readSafe,safeFileDigest:(filename,deadline)=>nativeDigest(filename,pins.get(path.resolve(filename)),deadline),collectCurrent,revalidateSource,releaseOwnership};
}
export function allOldPins(spec,sourceScope){const map=new Map();for(const f of [...sourceScope.files,...spec.collector.files,...spec.batch.operations.slice(15).flatMap(o=>o.command?.files??[])]){const p=path.resolve(f.path);if(map.has(p))assert.equal(map.get(p).sha256,f.sha256);map.set(p,{path:p,sha256:f.sha256});}return map;}
