/** Content-addressed bounded evidence. Does not change the queue's 1 MiB reader. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha,canonical} from './main-prebuild-queue.mjs';
import {safeDirectory,stableBytes} from './preparation-resolution.mjs';
export const retirementEvidenceVersion='teruisi-retirement-evidence-chunks-v1';
const chunkBytes=512*1024,maxBytes=128*1024*1024,maxChunks=maxBytes/chunkBytes,hex=/^[a-f0-9]{64}$/;
export async function putRetirementEvidence(directory,value){
 const raw=Buffer.from(canonical(value));assert.ok(raw.length<=maxBytes,'Retirement evidence byte bound');await safeDirectory(directory);const chunks=[];
 for(let start=0;start<raw.length;start+=chunkBytes){const chunk=raw.subarray(start,start+chunkBytes),digest=sha(chunk),file=path.join(directory,digest+'.bin');let h;try{h=await fs.open(file,'wx');await h.writeFile(chunk);await h.sync();}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await stableBytes(file),chunk,'Content-addressed retirement evidence differs');}finally{await h?.close();}chunks.push(digest);}
 return {version:retirementEvidenceVersion,sha256:sha(raw),size:raw.length,chunks};
}
export async function readRetirementEvidence(directory,reference){
 assert.deepEqual(Object.keys(reference??{}).sort(),['version','sha256','size','chunks'].sort());assert.equal(reference.version,retirementEvidenceVersion);assert.match(reference.sha256??'',hex);assert.ok(Number.isSafeInteger(reference.size)&&reference.size>0&&reference.size<=maxBytes);assert.ok(Array.isArray(reference.chunks)&&reference.chunks.length===Math.ceil(reference.size/chunkBytes)&&reference.chunks.length<=maxChunks);await safeDirectory(directory);const chunks=[];
 for(const [index,digest] of reference.chunks.entries()){assert.match(digest??'',hex);const raw=await stableBytes(path.join(directory,digest+'.bin'));assert.equal(sha(raw),digest);assert.equal(raw.length,Math.min(chunkBytes,reference.size-index*chunkBytes));chunks.push(raw);}
 const raw=Buffer.concat(chunks);assert.equal(raw.length,reference.size);assert.equal(sha(raw),reference.sha256);const value=JSON.parse(raw);assert.equal(raw.toString('utf8'),canonical(value),'Noncanonical retirement evidence');return value;
}
export function retirementEvidenceDirectory(run){return path.join(run,'objects');}
