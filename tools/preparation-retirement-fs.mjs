/** Bounded, journaled R1b object operations. No process retirement or deletion. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {canonical,sha,durableCreate,readQueueObject} from './main-prebuild-queue.mjs';
const execute=promisify(execFile);
export const retirementFsVersion='teruisi-preparation-retirement-objects-v1';
const hex=/^[a-f0-9]{64}$/;
export function retirementPath(value){assert.ok(typeof value==='string'&&path.isAbsolute(value),'Absolute retirement object required');return path.resolve(value);}
export function isRetirementChild(root,target){const relative=path.relative(retirementPath(root),retirementPath(target));return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
export async function retirementEntity(file){
 try{const s=await fs.lstat(file,{bigint:true});assert.ok(!s.isSymbolicLink(),'Retirement object is a link');assert.equal((await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Redirected retirement object');return {type:s.isDirectory()?'directory':s.isFile()?'file':'unsupported',dev:String(s.dev),ino:String(s.ino),size:String(s.size),nlink:String(s.nlink)};}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function hashRetirementFile(file){
 return hashRetirementFileWithBuffer(file);
}
// The buffer is private to a single in-flight inventory slot, never caller supplied.
async function hashRetirementFileWithBuffer(file,reusableBuffer){
 const before=await retirementEntity(file);assert.equal(before?.type,'file','Retirement file absent');const h=await fs.open(file,'r');
 try{const a=await h.stat({bigint:true});assert.equal(String(a.dev),before.dev);assert.equal(String(a.ino),before.ino);const hash=createHash('sha256'),buffer=reusableBuffer??Buffer.alloc(512*1024);let offset=0;for(;;){const r=await h.read(buffer,0,buffer.length,offset);if(!r.bytesRead)break;hash.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;assert.ok(offset<=4*1024*1024*1024,'Retirement file byte bound');}const b=await h.stat({bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k],'Retirement file changed');assert.deepEqual(await retirementEntity(file),before,'Retirement file replaced');return {size:offset,sha256:hash.digest('hex'),dev:before.dev,ino:before.ino,nlink:before.nlink,mtimeNs:String(a.mtimeNs),ctimeNs:String(a.ctimeNs)};}
 finally{await h.close();}
}
/** This inventories bytes, not effect ownership. Links need a separate qualified role. */
export async function inventoryRetirementTree(root,{maxFiles=250000,maxBytes=32*1024**3,allowedHardlinks=[],allowedJunctions=[]}={}){
 root=retirementPath(root);const files=[],directories=[],junctions=[],buffers=[];let bytes=0,pending=[],failure;
 // Four slots per inventory, including nested directories. Drain before recursion
 // and directory CAS so buffers cannot alias and no work survives a rejection.
 async function drain(){await Promise.all(pending);pending=[];if(failure)throw failure;}
 function schedule(file,relative){
  assert.ok(files.length<maxFiles,'Retirement file bound');
  const index=files.length,slot=pending.length;files.push(null);
  buffers[slot]??=Buffer.alloc(512*1024);
  const work=hashRetirementFileWithBuffer(file,buffers[slot]).then(item=>{
   if(item.nlink!=='1')assert.ok(allowedHardlinks.some(x=>x.path===relative&&x.dev===item.dev&&x.ino===item.ino),'Unqualified multi-link retirement file');
   bytes+=item.size;assert.ok(bytes<=maxBytes,'Retirement tree byte bound');
   files[index]={path:relative,...item};
  }).catch(error=>{failure??=error;});
  pending.push(work);
 }
 async function walk(dir){const entity=await retirementEntity(dir);assert.equal(entity?.type,'directory');assert.ok(directories.length<maxFiles,'Retirement directory bound');const names=(await fs.readdir(dir)).sort();assert.ok(names.length<=maxFiles,'Retirement child bound');directories.push(path.relative(root,dir).replaceAll('\\','/'));
  for(const name of names){
   if(failure)throw failure;
   const file=path.join(dir,name),relative=path.relative(root,file).replaceAll('\\','/'),link=allowedJunctions.find(x=>x.path===relative);
   if(link){const stat=await fs.lstat(file,{bigint:true});assert.ok(stat.isSymbolicLink(),'Declared dependency junction changed type');assert.equal(String(stat.dev),link.dev);assert.equal(String(stat.ino),link.ino);assert.equal(await fs.readlink(file),link.linkText);junctions.push({...link});continue;}
   const s=await retirementEntity(file);assert.ok(s,'Retirement member disappeared');
   if(failure)throw failure;
   if(s.type==='directory'){await drain();await walk(file);}
   else{assert.equal(s.type,'file');schedule(file,relative);if(pending.length===4)await drain();}
  }
  await drain();
  assert.deepEqual((await fs.readdir(dir)).sort(),names,'Retirement directory changed');assert.deepEqual(await retirementEntity(dir),entity,'Retirement directory identity changed');
 }
 try{await walk(root);}catch(error){failure??=error;await Promise.all(pending);throw failure;}
 assert.equal(junctions.length,allowedJunctions.length,'Declared dependency junction absent');return {version:retirementFsVersion,directories,files,junctions,bytes,treeSha256:sha(Buffer.from(canonical({directories,junctions,files:files.map(({path,size,sha256})=>({path,size,sha256}))})))};
}
export async function retirementGit(cwd,args,git={}){cwd=retirementPath(cwd);const env={...process.env};for(const key of Object.keys(env))if(/^GIT_/i.test(key))delete env[key];env.GIT_OPTIONAL_LOCKS='0';let executable=git.executable;if(executable){assert.ok(path.isAbsolute(executable));assert.match(git.sha256??'',hex);assert.equal((await hashRetirementFile(executable)).sha256,git.sha256,'Git executable changed');}else{assert.ok(isRetirementChild(os.tmpdir(),cwd),'Pinned absolute Git executable required outside private temporary fixtures');executable='git';}const result=await execute(executable,['-c','core.longpaths=true','-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,env});return result.stdout.trimEnd();}
export function parseRetirementWorktrees(text){
 const records=[];let current;
 for(const line of text.split(/\r?\n/)){if(!line){current=null;continue;}const space=line.indexOf(' '),key=space<0?line:line.slice(0,space),value=space<0?'':line.slice(space+1);if(key==='worktree'){current={path:retirementPath(value)};records.push(current);}else{assert.ok(current,'Worktree projection invalid');assert.equal(Object.hasOwn(current,key),false,'Duplicate worktree field');current[key]=value;}}
 return records;
}
export async function readRetirementWorktrees(repository,git){return parseRetirementWorktrees(await retirementGit(repository,['worktree','list','--porcelain'],git));}
async function gitAdministrativePreimage(repository,worktree,git){
 const gitDir=await retirementGit(worktree,['rev-parse','--absolute-git-dir'],git),common=await retirementGit(repository,['rev-parse','--path-format=absolute','--git-common-dir'],git);assert.ok(isRetirementChild(path.join(common,'worktrees'),gitDir),'Not a linked Git worktree');
 const files={};for(const file of [path.join(worktree,'.git'),path.join(gitDir,'gitdir'),path.join(gitDir,'commondir'),path.join(gitDir,'HEAD'),path.join(gitDir,'locked')]){const entity=await retirementEntity(file);if(!entity){files[file]=null;continue;}assert.equal(entity.type,'file');const raw=await fs.readFile(file);assert.ok(raw.length<=16384,'Git administrative byte bound');files[file]={sha256:sha(raw),base64:raw.toString('base64')};}return {gitDir,commonGitDir:common,files};
}
/** Uses Git relocation for registered worktrees, never raw-renames around locks. */
export async function relocateRetirementObject({repository,source,destination,expected,kind,registration,protection,actionDirectory,intentSha256,git}){
 source=retirementPath(source);destination=retirementPath(destination);actionDirectory=retirementPath(actionDirectory);assert.match(intentSha256,hex);assert.ok(!isRetirementChild(source,destination)&&!isRetirementChild(destination,source)&&source.toLowerCase()!==destination.toLowerCase());
 assert.ok(expected&&['file','directory'].includes(expected.type));const actionKey=sha(Buffer.from(canonical({source,destination,kind}))),intentFile=path.join(actionDirectory,actionKey+'.intent.json'),resultFile=path.join(actionDirectory,actionKey+'.result.json');
 await fs.mkdir(actionDirectory,{recursive:true});let action;
 try{action=(await readQueueObject(intentFile)).value;assert.equal(action.intentSha256,intentSha256);assert.equal(action.source,source);assert.equal(action.destination,destination);assert.equal(action.kind,kind);assert.deepEqual(action.expected,expected);assert.deepEqual(action.registration,registration??null);assert.deepEqual(action.protection,protection??null);}
 catch(error){if(error.code!=='ENOENT')throw error;action={version:retirementFsVersion,intentSha256,source,destination,kind,expected,at:new Date().toISOString(),registration:registration??null,protection:protection??null,gitPreimage:null};if(kind==='git-worktree'){assert.ok(protection&&protection.authority==='owned-retirement-source-v1'&&protection.attachmentManaged===false,'Source relocation ownership/attachment protection unresolved');const current=(await readRetirementWorktrees(repository,git)).find(x=>x.path.toLowerCase()===source.toLowerCase());assert.deepEqual(current,registration,'Worktree registration changed');assert.match(current.HEAD,/^[a-f0-9]{40}$/);assert.equal(await retirementGit(source,['status','--porcelain','--untracked-files=all'],git),'','Source worktree is not clean');action.gitPreimage=await gitAdministrativePreimage(repository,source,git);}await durableCreate(intentFile,action);}
 let original=await retirementEntity(source),archived=await retirementEntity(destination);
 if(original&&archived)throw Error('Retirement move unknown: both original and archive exist');
 if(!original&&!archived)throw Error('Retirement move unknown: original and archive absent');
 if(archived){assert.equal(archived.type,expected.type);for(const key of ['dev','ino'])assert.equal(archived[key],expected[key],'Archive object identity differs');if(kind==='git-worktree'){const record=(await readRetirementWorktrees(repository,git)).find(x=>x.path.toLowerCase()===destination.toLowerCase());assert.equal(record?.HEAD,registration.HEAD);assert.equal(record?.branch??null,registration.branch??null);const reason='Retired preparation source; intent '+intentSha256;if(Object.hasOwn(record,'locked'))assert.equal(record.locked,reason,'Archive worktree protected by another lock');else await retirementGit(repository,['worktree','lock','--reason',reason,destination],git);}let result={version:retirementFsVersion,intentSha256,actionSha256:sha(Buffer.from(canonical(action))),source,destination,postimage:archived,reconciled:true,at:new Date().toISOString()};try{await durableCreate(resultFile,result);}catch(error){if(error.code!=='EEXIST')throw error;const saved=(await readQueueObject(resultFile)).value;assert.equal(saved.intentSha256,intentSha256);assert.deepEqual(saved.postimage,archived);result=saved;}return result;}
 for(const key of ['type','dev','ino'])assert.equal(original[key],expected[key],'Retirement original identity changed');assert.equal(archived,null);
 if(kind==='git-worktree'){
  assert.deepEqual((await readRetirementWorktrees(repository,git)).find(x=>x.path.toLowerCase()===source.toLowerCase()),registration,'Worktree changed before relocate');
  if(Object.hasOwn(registration,'locked'))await retirementGit(repository,['worktree','unlock',source],git);
  try{await retirementGit(repository,['worktree','move',source,destination],git);}
  catch(error){const remains=(await readRetirementWorktrees(repository,git)).find(x=>x.path.toLowerCase()===source.toLowerCase());if(remains&&Object.hasOwn(registration,'locked')&&!Object.hasOwn(remains,'locked'))await retirementGit(repository,['worktree','lock',...(registration.locked?['--reason',registration.locked]:[]),source],git);throw error;}
  await retirementGit(repository,['worktree','lock','--reason','Retired preparation source; intent '+intentSha256,destination],git);
 }else{assert.ok(kind==='file'||kind==='directory','Unknown retirement move kind');await fs.rename(source,destination);}
 assert.equal(await retirementEntity(source),null,'Old retirement address reappeared');archived=await retirementEntity(destination);for(const key of ['type','dev','ino'])assert.equal(archived[key],expected[key]);
 const result={version:retirementFsVersion,intentSha256,actionSha256:sha(Buffer.from(canonical(action))),source,destination,postimage:archived,reconciled:false,at:new Date().toISOString()};await durableCreate(resultFile,result);return result;
}
