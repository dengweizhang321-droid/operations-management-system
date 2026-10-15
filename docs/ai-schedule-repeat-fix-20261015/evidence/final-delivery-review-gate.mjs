import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const keys=(v,k)=>assert.deepEqual(Object.keys(v).sort(),k.sort());
async function readSignal(file,earliest){
 let a;try{a=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 assert(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1&&a.size<=16384,'Invalid signal file');
 assert(a.mtimeMs>=earliest&&a.mtimeMs<=Date.now()+1000,'Signal timestamp outside this wait');
 const raw=await fs.readFile(file),b=await fs.lstat(file);
 assert(b.isFile()&&!b.isSymbolicLink()&&b.nlink===1&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs,'Signal changed during read');
 const value=JSON.parse(raw.toString('utf8'));
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.equal(raw.toString('utf8'),JSON.stringify(value)+'\n','Noncanonical or duplicate-key signal');
 return {value,sha256:hash(raw)};
}
export async function waitForExecution({out,tuple,startedAt,deadline,intervalMs=2000}){
 const real=await fs.realpath(out);assert.equal(real.toLowerCase(),path.resolve(out).toLowerCase(),'Signal directory is redirected');
 const expected={version:'ai-schedule-execution-review-v1',status:'passed',requestSha256:tuple.requestSha256,readySha256:tuple.readySha256,sourceCommit:tuple.sourceCommit,workerManifestSha256:tuple.workerManifestSha256,djangoManifestSha256:tuple.djangoManifestSha256,driverSha256:tuple.driverSha256};
 while(Date.now()<deadline){
  assert.equal(hash(await fs.readFile(path.join(out,'publication-request.json'))),tuple.requestSha256,'Request changed during review');
  assert.equal(hash(await fs.readFile(path.join(out,'PREPARATION_READY.json'))),tuple.readySha256,'READY changed during review');
  const review=await readSignal(path.join(out,'execution-review.json'),startedAt);
  if(review){keys(review.value,Object.keys(expected));assert.deepEqual(review.value,expected,'Review rejected or tuple mismatch');}
  const execute=await readSignal(path.join(out,'EXECUTE.json'),startedAt);
  if(execute){
   assert(review,'Execution signal without review');
   keys(execute.value,['version','requestSha256','reviewSha256']);
   assert.deepEqual(execute.value,{version:'ai-schedule-execute-v1',requestSha256:tuple.requestSha256,reviewSha256:review.sha256},'Execution signal mismatch');
   assert(Date.now()<deadline,'Review wait expired');return {reviewSha256:review.sha256,executeSha256:execute.sha256};
  }
  await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,Math.max(1,deadline-Date.now()))));
 }
 throw new Error('prepared-not-published: execution review wait expired');
}
