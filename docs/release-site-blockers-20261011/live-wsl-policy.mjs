import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const epoch=Object.freeze({bootId:'4a67b065-2648-48ef-8821-72f272ceb41d',pid1Start:'122',osrelease:'6.18.33.2-microsoft-standard-WSL2'});
const mounts=Object.freeze({
 'mnt:[4026532219]':'e9e99aac5a773010f013e3cf2aa4dca895d064092617606b3267a012f356f188',
 'mnt:[4026532222]':'41902b8e2cf713bc967b3f644cc8f9a8b09a47f32a438eb57a29acc771879ee2',
 'mnt:[4026532224]':'c96dff9c35deba377ff3bf61838235f0239f4c3f7036482ef5d8ea1d8c38c97c',
 'mnt:[4026532225]':'60f46d9a2900b58e4fc84e0ca114b6d2edc09fad085d4c4fa1b63ea47f2783f1',
 'mnt:[4026532288]':'1b2ac6d15ff3f578a426c01c1cdd501a9256297090af8410c4d38b922bbb3df9',
 'mnt:[4026532230]':'79c1d0e33fffdbbd56182db9f6e1f031cbe97f882f322b73123b37dfef714057',
 'mnt:[4026532296]':'00a5c46107c834ab9c9cc90704a4a25e13593e6cb8a5d158e66d3955b4210cc5',
 'mnt:[4026532297]':'aaffa6b12395e736e7df967534404abad683bcde4cee816c44a0427c3b8b389e',
 'mnt:[4026532299]':'9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd'
});
export function validateKnownMountPair(identity,mountSha256){assert.ok(Object.hasOwn(mounts,identity),'Unknown mount namespace');assert.equal(mountSha256,mounts[identity],'Mount contents changed or unsupported');}
function ids(v){assert.ok(Array.isArray(v)&&v.length<=512);assert.ok(v.every(p=>Number.isSafeInteger(p)&&p>0));assert.equal(new Set(v).size,v.length);return [...v].sort((a,b)=>a-b);}
function string(v){assert.equal(typeof v,'string');assert.ok(v.length<=1048576);assert.ok(!v.includes('\0'));return v;}
// Evidence projection only: intentionally independent of acceptance validation,
// so a ninth/unknown namespace is recorded before its unchanged gate rejects it.
export function summarizeGuestShape(capture){
 const list=v=>Array.isArray(v)?v:[],number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 const text=(v,re)=>typeof v==='string'&&v.length<=128&&re.test(v)?v:null;
 const nsId=v=>text(v,/^mnt:\[\d+\]$/),digits=v=>text(v,/^[0-9]+$/);
 const epochSummary=v=>({bootId:text(v?.bootId,/^[0-9a-f-]{36}$/i),pid1Start:digits(v?.pid1Start),osrelease:text(v?.osrelease,/^[A-Za-z0-9._+-]+$/),btime:digits(v?.btime)});
 const processes=list(capture?.processes),namespaces=list(capture?.namespaces),errors=list(capture?.errors);
 return {version:'teruisi-redacted-guest-shape-v1',processRecordCount:processes.length,namespaceCount:namespaces.length,
  inventoryBeforeCount:Array.isArray(capture?.pidInventoryBefore)?capture.pidInventoryBefore.length:null,
  inventoryAfterCount:Array.isArray(capture?.pidInventoryAfter)?capture.pidInventoryAfter.length:null,
  selfPid:number(capture?.selfPid),selfIncludedInInventory:list(capture?.pidInventoryBefore).includes(capture?.selfPid),
  before:epochSummary(capture?.before),after:epochSummary(capture?.after),
  namespaces:namespaces.slice(0,512).map(ns=>{const members=processes.filter(p=>p.namespaceBefore===ns?.identity);return {identity:nsId(ns?.identity),mountSha256:typeof ns?.mountinfo==='string'?hash(ns.mountinfo):null,mountBytes:typeof ns?.mountinfo==='string'?Buffer.byteLength(ns.mountinfo):null,processCount:members.length,
   representatives:members.slice(0,16).map(p=>({pid:number(p.pid),startBefore:digits(p.startBefore),startAfter:digits(p.startAfter),flagsBefore:number(p.flagsBefore),flagsAfter:number(p.flagsAfter),namespaceAfter:nsId(p.namespaceAfter),mountSha256Before:text(p.mountSha256Before,/^[a-f0-9]{64}$/),mountSha256After:text(p.mountSha256After,/^[a-f0-9]{64}$/)}))};}),
  errors:errors.slice(0,512).map(e=>({pid:number(e?.pid),error:text(e?.error,/^[A-Za-z]+Error$/),errno:number(e?.errno)})),
  errorCount:errors.length,summaryTruncated:namespaces.length>512||errors.length>512,
  rawArgvCwdFdPersisted:false};
}
function epochIdentity(sample){
 assert.ok(sample&&typeof sample==='object'&&!Array.isArray(sample));
 assert.deepEqual(Object.keys(sample).sort(),['bootId','btime','osrelease','pid1Start']);
 // /proc/stat btime is wall-clock-derived Unix seconds, not a boot identity.
 // Keep both observations as diagnostics; never use a time tolerance to accept
 // changed boot_id/PID1/native Windows births.
 assert.equal(typeof sample.btime,'string');assert.match(sample.btime,/^[1-9][0-9]{0,18}$/,'Invalid btime diagnostic');
 return {bootId:sample.bootId,pid1Start:sample.pid1Start,osrelease:sample.osrelease};
}
export function validateLiveGuestShape(capture){
 assert.equal(capture?.version,'teruisi-live-wsl-metadata-v1');assert.deepEqual(capture.errors,[]);
 assert.deepEqual(epochIdentity(capture.before),epoch,'Unsupported guest epoch');assert.deepEqual(epochIdentity(capture.after),epoch,'Guest epoch changed');
 const btimeDiagnostic={before:capture.before.btime,after:capture.after.btime,changed:capture.before.btime!==capture.after.btime};
 assert.ok(Number.isSafeInteger(capture.selfPid)&&capture.selfPid>0);assert.ok(!capture.pidInventoryBefore.includes(capture.selfPid));
 assert.deepEqual(ids(capture.pidInventoryBefore),ids(capture.pidInventoryAfter),'Process membership changed');
 assert.ok(Array.isArray(capture.processes));assert.deepEqual(ids(capture.processes.map(p=>p.pid)),ids(capture.pidInventoryBefore),'Missing process evidence');
 assert.ok(Array.isArray(capture.namespaces));assert.equal(new Set(capture.namespaces.map(n=>n.identity)).size,capture.namespaces.length);
 const presentNamespaces=capture.namespaces.map(n=>n.identity).sort();
 assert.ok(presentNamespaces.length>0&&presentNamespaces.length<=Object.keys(mounts).length,'Empty or oversized namespace set');
 assert.ok(presentNamespaces.every(n=>Object.hasOwn(mounts,n)),'Unknown mount namespace');
 assert.deepEqual(presentNamespaces,[...new Set(capture.processes.map(p=>p.namespaceBefore))].sort(),'Namespace evidence must exactly cover all captured processes');
 for(const ns of capture.namespaces)validateKnownMountPair(ns.identity,hash(string(ns.mountinfo)));
 const paths=[];
 for(const p of capture.processes){
  assert.match(p.startBefore,/^\d+$/);assert.equal(p.startBefore,p.startAfter);assert.equal(p.namespaceBefore,p.namespaceAfter);assert.ok(Object.hasOwn(mounts,p.namespaceBefore));
  assert.ok(Number.isSafeInteger(p.flagsBefore)&&p.flagsBefore>=0&&p.flagsBefore<=0xffffffff);assert.equal(p.flagsBefore,p.flagsAfter,'Process flags changed');
  const kernelThread=!!(p.flagsBefore&0x00200000);
  assert.equal(p.mountSha256Before,mounts[p.namespaceBefore]);assert.equal(p.mountSha256After,p.mountSha256Before);
  assert.deepEqual(p.linksBefore,p.linksAfter);assert.deepEqual(Object.keys(p.linksBefore).sort(),['cwd','exe','root']);
  assert.deepEqual(p.argvBefore,p.argvAfter);assert.ok(Array.isArray(p.argvBefore)&&p.argvBefore.length<=4096);
  if(kernelThread){assert.ok(p.argvBefore.every(v=>v===''),'Unexpected kernel command metadata');assert.equal(p.linksBefore.exe,null);}
  else{assert.ok(p.argvBefore.length>0&&p.argvBefore.some(v=>typeof v==='string'&&v.trim().length>0),'Nonkernel argv is missing');assert.ok(typeof p.linksBefore.exe==='string'&&p.linksBefore.exe.startsWith('/')&&p.linksBefore.exe.length>1,'Nonkernel executable is missing');}
  assert.deepEqual(p.fdsBefore,p.fdsAfter);assert.ok(p.fdsBefore&&typeof p.fdsBefore==='object'&&!Array.isArray(p.fdsBefore));assert.ok(Object.keys(p.fdsBefore).length<=4096);
  for(const [kind,value] of Object.entries(p.linksBefore)){if(kernelThread&&value===null)continue;paths.push({pid:p.pid,kind,value:string(value)});}
  for(const [fd,value] of Object.entries(p.fdsBefore)){assert.match(fd,/^\d+$/);string(value);if(/^mnt:\[\d+\]$/.test(value))assert.ok(presentNamespaces.includes(value),'Mount namespace fd lacks current process namespace evidence');paths.push({pid:p.pid,kind:'fd',value});}
  for(const value of p.argvBefore)paths.push({pid:p.pid,kind:'argv',value:string(value)});
 }
 // This release supports only a nonempty subset of the exact inspected
 // namespaces with no Windows drive mounts. Owned StopPandas may remove a
 // namespace before capture; every remaining process must still be covered.
 // It does not attempt general mount/bind/namespace translation.
 // Windows-style metadata must still pass the original physical reference
 // predicate; this function never labels a complete guest or VM "safe".
 return {kind:'guest-shape-verified-requires-reference-check-and-hcs-association',epoch:{...epoch},btimeDiagnostic,paths,processCount:capture.processes.length};
}

// inspectReferences must be the original pinned guard predicate, supplied only
// by the trusted wrapper (not by batch data or a caller-selected command).
export async function checkGuestMetadataReferences(guest,inspectReferences){
 assert.equal(guest.kind,'guest-shape-verified-requires-reference-check-and-hcs-association');
 assert.equal(typeof inspectReferences,'function');const references=[];
 for(const entry of guest.paths){
  const value=string(entry.value);
  if(/(?:[A-Za-z]:[\\/]|\/mnt\/[a-z](?:\/|$)|\\\\)/i.test(value))assert.ok(!/[\r\n]/.test(value),'Ambiguous Windows-related metadata');
  // Windows absolute arguments, including a full single argument with spaces,
  // use both the original full-path and bounded command-token interpretation.
  if(await inspectReferences(value)||await inspectReferences(value,{commandLine:true})){references.push({pid:entry.pid,kind:entry.kind,sha256:hash(value)});continue;}
  assert.ok(!value.includes('\\\\'),'Unsupported UNC or device-path metadata');
  if(/\/mnt\/[a-z](?:\/|$)/i.test(value)){
   // This is conservative handling of conventional drive-path text. No drive
   // mount exists in the pinned namespaces; arbitrary namespace remapping is
   // intentionally unsupported instead of guessed.
   const match=/^(?:--[A-Za-z0-9_-]+=)?\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(value);
   assert.ok(match,'Unsupported embedded host-drive argument');
   const candidate=match[1].toUpperCase()+':\\'+(match[2]??'').replaceAll('/','\\');
   if(await inspectReferences(candidate))references.push({pid:entry.pid,kind:entry.kind,sha256:hash(value)});
  }
 }
 return {kind:'guest-references-checked-requires-hcs-association',references,epoch:guest.epoch,btimeDiagnostic:guest.btimeDiagnostic,processCount:guest.processCount};
}
