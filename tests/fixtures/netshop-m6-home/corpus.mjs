/** Pure file/Git evidence loader; no API/build/browser/services. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
export const sha256=raw=>createHash("sha256").update(raw).digest("hex");
export async function readM6Corpus(manifestPath){
 const absolute=resolve(manifestPath),root=dirname(absolute),raw=await readFile(absolute),manifest=JSON.parse(raw);
 assert.equal(manifest.schemaVersion,"netshop-m6-home-corpus-v1");assert.equal(manifest.syntheticOnly,true);
 assert.ok(Array.isArray(manifest.records)&&manifest.records.length>0&&manifest.records.length<=100);
 if(manifest.metadata){const data=await readFile(resolve(root,manifest.metadata.path));assert.equal(sha256(data),manifest.metadata.sha256);}
 const records=[];
 for(const r of manifest.records){
  assert.match(r.name,/^[a-zA-Z0-9-]+$/);assert.equal(typeof r.query,"string");
  if((r.status||200)===200)assert.match(r.owningRevision,/^(0|[1-9][0-9]*):[a-f0-9]{12}$/);
  if(r.metadata){const metaBytes=await readFile(resolve(root,r.metadata));assert.equal(sha256(metaBytes),r.metadataSha256);const m=JSON.parse(metaBytes);assert.equal(m.query,r.query);assert.equal(m.responseSha256,r.sha256);assert.equal(m.responseUtf8Bytes,r.bytes);assert.equal(m.status,r.status);assert.equal(m.responseHeaders["X-Netshop-Data-Revision"]||null,r.owningRevision||null);}
  if(r.requestFile){const req=await readFile(resolve(root,r.requestFile));assert.equal(sha256(req),r.requestSha256);assert.equal(JSON.parse(req).query,r.query);}
  assert.ok(Number.isSafeInteger(r.bytes)&&r.bytes>0);assert.match(r.sha256,/^[a-f0-9]{64}$/);
  const path=resolve(root,r.file),bytes=await readFile(path);assert.equal(bytes.length,r.bytes);assert.equal(sha256(bytes),r.sha256);
  const wrapper=JSON.parse(bytes),body=r.caseIndex===undefined?wrapper:wrapper.cases[r.caseIndex].response;
  assert.ok(body&&typeof body==="object");
  if(r.caseIndex!==undefined){assert.equal(wrapper.cases[r.caseIndex].request.query,r.query);assert.equal(wrapper.cases[r.caseIndex].request.headerRevision,r.owningRevision);}
  records.push({...r,path,raw:r.caseIndex===undefined?bytes.toString("utf8"):JSON.stringify(body),body,
   rawMeaning:r.caseIndex===undefined?"original standalone capture bytes":"JSON projection from byte-verified committed wrapper, not original standalone HTTP bytes"});
 }
 return{manifestPath:absolute,manifestSHA256:sha256(raw),manifest,records};
}
