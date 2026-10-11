import assert from 'node:assert/strict';
import path from 'node:path';
import {readdir,lstat,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {safeHealthEvidence} from './legacy/release-readonly-retry.mjs';
import {assertHealthyContract} from './health-contract.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function safeNativeWindow(v){return v&&Number.isSafeInteger(v.startedAtMs)&&Number.isSafeInteger(v.returnedAtMs)&&v.startedAtMs>=0&&v.startedAtMs<=v.returnedAtMs?{startedAtMs:v.startedAtMs,returnedAtMs:v.returnedAtMs}:null;}
export function isoUtc(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(value)||!Number.isFinite(Date.parse(value)))return null;return new Date(value).toISOString();}
export function safeProducerTrace(v){
  if(!v||v.version!=='teruisi-health-producer-trace-v1')return null;
  const keys=['version','scopeSha256','producerSha256','authorityRawSha256','processId','at','functionReturned','observedState','healthEvidence','rawBodyPersisted','rawReasonPersisted'];if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k))||v.rawBodyPersisted!==false||v.rawReasonPersisted!==false)return null;
  if(v.healthEvidence!==null){const h=v.healthEvidence;if(!h||Object.keys(h).some(k=>!['version','checkedAt','probes'].includes(k))||!h.probes||Object.keys(h.probes).some(k=>!['live','helper','ready'].includes(k)))return null;const fields=['called','requested','statusCode','parsedObject','okMatches','markerMatches','passed','degradedMatches','beforeDeadline','timeoutMs','effectiveTimeoutMs','elapsedMs','errorKind'];for(const p of Object.values(h.probes)){if(p!==null&&(!p||Object.keys(p).some(k=>!fields.includes(k))))return null;}}
  const hashes=['scopeSha256','producerSha256','authorityRawSha256'];if(hashes.some(k=>!/^[a-f0-9]{64}$/.test(v[k]??'')))return null;
  if(!Number.isSafeInteger(v.processId)||v.processId<=0||typeof v.functionReturned!=='boolean'||!isoUtc(v.at))return null;
  return{version:v.version,...Object.fromEntries(hashes.map(k=>[k,v[k]])),processId:v.processId,at:isoUtc(v.at),functionReturned:v.functionReturned,observedState:v.functionReturned&&['Running','BackendDegraded','Unresponsive'].includes(v.observedState)?v.observedState:null,healthEvidence:safeHealthEvidence(v.healthEvidence),rawBodyPersisted:false,rawReasonPersisted:false};
}
export function safeProducerReferences(value){return Array.isArray(value)?value.flatMap(v=>{const record=safeProducerTrace(v.record??v);return record&&/^[a-f0-9]{64}$/.test(v.sha256??'')?[{sha256:v.sha256,record}]:[];}):[];}
async function safeRead(filename){filename=path.resolve(filename);let cursor=path.parse(filename).root;for(const p of filename.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,p);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink());if(cursor!==filename)assert.ok(s.isDirectory());}assert.equal(path.resolve(await realpath(filename)).toLowerCase(),filename.toLowerCase());const a=await lstat(filename,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n&&a.size<65536n);const raw=await readFile(filename),b=await lstat(filename,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(a[k],b[k]);return raw;}
export async function readProducerEvidence({root,scopeSha256,producerSha256,authorityRawSha256,processIds,since,until=Date.now()+5000}){
  const dir=path.join(root,'production','health-probe-evidence'),out=[];let names;try{const st=await lstat(dir);assert.ok(st.isDirectory()&&!st.isSymbolicLink());names=await readdir(dir);}catch(e){if(e.code==='ENOENT')return out;throw e;}
  for(const n of names){assert.match(n,/^\d+-[a-f0-9]{32}\.json$/);const raw=await safeRead(path.join(dir,n)),v=safeProducerTrace(JSON.parse(raw));assert.ok(v,'Invalid producer trace');const at=Date.parse(v.at);if(at<since||at>until)continue;if(!processIds.includes(v.processId))continue;assert.equal(v.scopeSha256,scopeSha256);assert.equal(v.producerSha256,producerSha256);assert.equal(v.authorityRawSha256,authorityRawSha256);out.push({sha256:digest(raw),record:v});}
  return out.sort((a,b)=>Date.parse(a.record.at)-Date.parse(b.record.at));
}
export function assertProducerSuccess(refs,{scopeSha256,producerSha256,authorityRawSha256,processId,healthEvidence,since,until,nativeElapsedMs}){
  const matching=safeProducerReferences(refs).filter(v=>v.record.processId===processId);assert.equal(matching.length,1,'Exactly one producer health record required');const v=matching[0].record;
  assert.equal(v.scopeSha256,scopeSha256);assert.equal(v.producerSha256,producerSha256);assert.equal(v.authorityRawSha256,authorityRawSha256);assert.ok(Date.parse(v.at)>=since&&Date.parse(v.at)<=until);assert.equal(v.functionReturned,true);assert.equal(v.observedState,'Running');assertHealthyContract(v.healthEvidence);assert.ok(Date.parse(v.healthEvidence.checkedAt)>=since&&Date.parse(v.healthEvidence.checkedAt)<=Date.parse(v.at));const span=Date.parse(v.at)-Date.parse(v.healthEvidence.checkedAt),total=Object.values(v.healthEvidence.probes).reduce((n,p)=>n+p.elapsedMs,0);assert.ok(total<=span+5,'Measured serial phases exceed observed health interval');assert.ok(Number.isFinite(nativeElapsedMs)&&nativeElapsedMs>=0&&total<=nativeElapsedMs+5&&span<=nativeElapsedMs+5,'Health observation exceeds actual native process interval');assert.deepEqual(v.healthEvidence,safeHealthEvidence(healthEvidence));return matching[0];
}
