// Bounded diagnostic evidence. Native response bodies and reason text never persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat,realpath,readFile,mkdir,open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hash,digest,canonical,safeProcess} from './protocol.mjs';
export const components=['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
export function safeReadiness(v){
  if(!v||v.version!==1)return null;
  const allow=(x,values)=>values.includes(x)?x:'unrecognized',count=x=>Number.isSafeInteger(x)&&x>=0&&x<=2000000?x:null;
  return{version:1,state:allow(v.state,['Running','BackendUnavailable','BackendDegraded','Unresponsive','StatusError','WorkerStopped','Stopped','Starting','StaleReceipt','PortInUse','Maintenance']),backendState:allow(v.backendState,['Ready','NotReady','Error']),workerState:allow(v.workerState,['exact_release','starting_exact_release','stale_or_invalid_receipt','foreign_or_ambiguous','status_error','stopped']),releaseMatchesExpected:v.releaseMatchesExpected===true,componentObject:v.componentObject===true,componentCount:count(v.componentCount),unexpectedComponentCount:count(v.unexpectedComponentCount),missingComponents:components.filter(n=>Array.isArray(v.missingComponents)&&v.missingComponents.includes(n)),components:Object.fromEntries(components.map(n=>[n,v.components&&Object.hasOwn(v.components,n)&&typeof v.components[n]==='boolean'?v.components[n]:null]))};
}
async function safePath(filename){filename=path.resolve(filename);let cursor=path.parse(filename).root;for(const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink());if(cursor!==filename)assert.ok(s.isDirectory());}assert.equal(path.resolve(await realpath(filename)).toLowerCase(),filename.toLowerCase());return filename;}
async function safeRead(filename){await safePath(filename);const a=await lstat(filename,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n&&a.size<20000000n);const raw=await readFile(filename),b=await lstat(filename,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(a[k],b[k]);return raw;}
async function directory(filename){await safePath(path.dirname(filename));try{await mkdir(filename);}catch(e){if(e.code!=='EEXIST')throw e;}await safePath(filename);assert.ok((await lstat(filename)).isDirectory());}
export function diagnosticRecord(result,projection,parseSucceeded,stage,scopeSha256,at=new Date().toISOString()){
  assert.ok(['admission-status','final-readiness-status'].includes(stage));assert.match(scopeSha256,/^[a-f0-9]{64}$/);assert.equal(typeof parseSucceeded,'boolean');
  const p=safeProcess(result?.processEvidence);assert.ok(p);assert.equal(p.exitCode,0);assert.equal(p.code,'completed');assert.equal(p.signal,null);assert.equal(p.outputProtocol,'direct-exit-files');assert.equal(p.cleanup,'direct');assert.equal(p.treeCleanupPending,false);assert.equal(p.timeoutType,null);assert.ok(Number.isSafeInteger(p.processId)&&p.processId>0);assert.ok(Number.isSafeInteger(p.stdoutBytes)&&p.stdoutBytes>=0);assert.match(p.stdoutSha256??'',/^[a-f0-9]{64}$/);assert.match(p.stderrSha256??'',/^[a-f0-9]{64}$/);
  assert.equal(typeof result.stdout,'string');assert.equal(Buffer.byteLength(result.stdout,'utf8'),p.stdoutBytes);assert.equal(digest(result.stdout),p.stdoutSha256);
  const readiness=safeReadiness(projection);assert.equal(parseSucceeded,readiness!==null);
  return{version:'teruisi-readiness-native-evidence-v1',scopeSha256,stage,at,parseSucceeded,readiness,processEvidence:p,actualStdoutSha256:p.stdoutSha256,actualStdoutBytes:p.stdoutBytes,rawStdoutPersisted:false,rawReasonPersisted:false,phase:'native-response-captured-before-assertions',assertionOutcome:'not-yet-evaluated'};
}
// Fixture factory supplies a private temporary directory; the production entry
// below derives its directory only from its own sealed authority, never env.
export function makeStatusWriter({root,scopeSha256,writeOnce,now=()=>new Date().toISOString()}){
  root=path.resolve(root);assert.match(scopeSha256,/^[a-f0-9]{64}$/);
  return async(result,projection,parseSucceeded,stage)=>{
    try{
      const record=diagnosticRecord(result,projection,parseSucceeded,stage,scopeSha256,now()),filename=path.join(root,`${process.pid}-${randomUUID()}.json`);
      if(writeOnce)await writeOnce(filename,record);
      else{await safePath(root);const h=await open(filename,'wx');try{await h.writeFile(canonical(record)+'\n');await h.sync();}finally{await h.close();}}
      return{path:filename,sha256:digest(canonical(record)+'\n'),record};
    }catch(error){error.processEvidence??=result?.processEvidence;throw error;}
  };
}
export async function captureStatusResponse(result,projection,parseSucceeded,stage){
  try{
    const self=fileURLToPath(import.meta.url),root=path.dirname(self);
    assert.equal(path.dirname(root),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));assert.match(path.basename(root),/^AB-final-readiness-202610(?:10|11)-[a-z0-9-]+$/);
    const scope=JSON.parse(await safeRead(path.join(root,'readiness-scope.json'))),{scopeSha256,...core}=scope;assert.equal(hash(core),scopeSha256);assert.equal(path.resolve(scope.outputRoot),root);assert.equal(scope.statusEvidenceSha256,digest(await safeRead(self)));assert.equal(path.resolve(scope.statusEvidencePath),self);
    await directory(path.join(root,'production'));const target=path.join(root,'production','status-evidence');await directory(target);
    return await makeStatusWriter({root:target,scopeSha256})(result,projection,parseSucceeded,stage);
  }catch(error){error.processEvidence??=result?.processEvidence;throw error;}
}
