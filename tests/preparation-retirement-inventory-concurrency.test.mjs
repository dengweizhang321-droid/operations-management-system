import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {canonical,sha} from '../tools/main-prebuild-queue.mjs';
import {inventoryRetirementTree,hashRetirementFile,retirementFsVersion} from '../tools/preparation-retirement-fs.mjs';
import {snapshotRetirementObject,assertRetirementSnapshotUnchanged} from '../tools/preparation-retirement-archive.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Private fixture deadline exceeded')),4000);})]);}finally{clearTimeout(timer);}}
async function fixture(t,n=12){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'s05d-inventory-slots-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(let i=0;i<n;i++)await fs.writeFile(path.join(root,'file'+String(i).padStart(2,'0')),Buffer.alloc(i===0?600000:i+1,65+i));
 return root;
}

test('four inventory slots overlap reads, reuse private buffers and preserve serial evidence order',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'a'));await fs.writeFile(path.join(root,'a','leaf'),'nested');await fs.writeFile(path.join(root,'a.txt'),'sibling');
 const expectedFiles=[];for(const name of ['a/leaf','a.txt',...Array.from({length:12},(_,i)=>'file'+String(i).padStart(2,'0'))])expectedFiles.push({path:name,...await hashRetirementFile(path.join(root,name))});
 const directories=['','a'],junctions=[],bytes=expectedFiles.reduce((n,row)=>n+row.size,0);
 const expected={version:retirementFsVersion,directories,files:expectedFiles,junctions,bytes,treeSha256:sha(Buffer.from(canonical({directories,junctions,files:expectedFiles.map(({path,size,sha256})=>({path,size,sha256}))})))};
 const original=fs.open,buffers=new Set(),busyBuffers=new Set();let active=0,peak=0;
 fs.open=async(...args)=>{
  const h=await original(...args);active++;peak=Math.max(peak,active);const read=h.read.bind(h),close=h.close.bind(h);
  h.read=async(buffer,...rest)=>{assert.equal(busyBuffers.has(buffer),false,'Concurrent readers shared a mutable buffer');buffers.add(buffer);busyBuffers.add(buffer);try{await new Promise(r=>setTimeout(r,3));return await read(buffer,...rest);}finally{busyBuffers.delete(buffer);}};
  h.close=async()=>{try{return await close()}finally{active--;}};
  return h;
 };
 try{assert.deepEqual(await inventoryRetirementTree(root),expected);assert.equal(peak,4);assert.equal(active,0);assert.equal(buffers.size,4);}
 finally{fs.open=original;}
});

test('a failed concurrent read drains all owned handles before rejection and dispatches no next batch',async t=>{
 const root=await fixture(t,8),original=fs.open,four=deferred(),others=deferred(),failed=deferred();let opens=0,closes=0,settled=false,operation;
 fs.open=async(...args)=>{
  const h=await original(...args),ordinal=opens++;if(opens===4)four.resolve();
  const read=h.read.bind(h),close=h.close.bind(h);let first=true;
  h.read=async(...a)=>{if(first){first=false;if(ordinal===0){await four.promise;failed.resolve();throw Error('Injected fixture read failure');}await others.promise;}return read(...a);};
  h.close=async()=>{try{return await close()}finally{closes++;}};return h;
 };
 try{
  operation=inventoryRetirementTree(root).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await bounded(failed.promise);await new Promise(r=>setTimeout(r,20));
  assert.equal(settled,false,'A rejection escaped while owned reads were pending');assert.equal(opens,4);
  others.resolve();const result=await bounded(operation);assert.match(result.error?.message??'',/Injected fixture read failure/);assert.equal(opens,4);assert.equal(closes,4);
 }finally{four.resolve();others.resolve();if(operation)await operation;fs.open=original;}
});

test('parallel inventory retains byte/file limits, hardlink qualification and final snapshot CAS',async t=>{
 const root=await fixture(t,8);
 await assert.rejects(inventoryRetirementTree(root,{maxFiles:3}),/bound/);
 await assert.rejects(inventoryRetirementTree(root,{maxBytes:2}),/byte bound/);
 const external=path.join(root,'linked');await fs.link(path.join(root,'file01'),external);
 await assert.rejects(inventoryRetirementTree(root),/multi-link/);await fs.unlink(external);
 const snapshot=await snapshotRetirementObject({kind:'directory',role:'git-source'},root,{});
 await assertRetirementSnapshotUnchanged(root,snapshot);
 await fs.appendFile(path.join(root,'file07'),'changed');
 await assert.rejects(assertRetirementSnapshotUnchanged(root,snapshot),/changed after complete hash/);
});

test('parallel inventory still rejects a mutation during its full-byte read',async t=>{
 const root=await fixture(t,8),original=fs.open;let changed=false;
 fs.open=async(...args)=>{
  const h=await original(...args),read=h.read.bind(h);
  if(path.basename(args[0])==='file00')h.read=async(...a)=>{const result=await read(...a);if(!changed){changed=true;await fs.appendFile(args[0],'changed');}return result;};
  return h;
 };
 try{await assert.rejects(inventoryRetirementTree(root),/Retirement file changed/);assert.equal(changed,true);}
 finally{fs.open=original;}
});
