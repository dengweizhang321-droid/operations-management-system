import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateLiveGuestShape,checkGuestMetadataReferences,validateKnownMountPair} from './live-wsl-policy.mjs';
import path from 'node:path';
import vm from 'node:vm';
const observation=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUEST_FIRST_OBSERVATION.json'));
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(){const namespaces=structuredClone(observation.namespaces);const processes=namespaces.map((n,i)=>({pid:1000+i,startBefore:'123',startAfter:'123',flagsBefore:0,flagsAfter:0,namespaceBefore:n.identity,namespaceAfter:n.identity,mountSha256Before:sha(n.mountinfo),mountSha256After:sha(n.mountinfo),linksBefore:{cwd:'/',exe:'/usr/bin/service',root:'/'},linksAfter:{cwd:'/',exe:'/usr/bin/service',root:'/'},argvBefore:['/usr/bin/service'],argvAfter:['/usr/bin/service'],fdsBefore:{0:'/dev/null'},fdsAfter:{0:'/dev/null'}}));return {version:'teruisi-live-wsl-metadata-v1',before:structuredClone(observation.epochBefore),after:structuredClone(observation.epochAfter),selfPid:999,processes,pidInventoryBefore:processes.map(p=>p.pid),pidInventoryAfter:processes.map(p=>p.pid),namespaces,errors:[]};}
test('actual inspected mount bytes with synthetic stable actors verifies guest shape only',()=>{const result=validateLiveGuestShape(fixture());assert.equal(result.kind,'guest-shape-verified-requires-reference-check-and-hcs-association');assert.equal(result.processCount,8);assert.ok(result.paths.length>0);});
test('exact independently observed ninth namespace/raw-SHA pair is recognized',()=>{validateKnownMountPair('mnt:[4026532299]','9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd');});
test('same ninth namespace with changed raw bytes remains rejected',()=>{assert.throws(()=>validateKnownMountPair('mnt:[4026532299]',sha('changed mountinfo bytes')));});
test('any unreviewed tenth/new namespace cannot borrow a reviewed digest',()=>{assert.throws(()=>validateKnownMountPair('mnt:[4026532300]','9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd'));});
test('owned service namespace already gone before capture may be absent as a closed subset',()=>{const c=fixture();const removed=c.processes.pop();c.namespaces=c.namespaces.filter(n=>n.identity!==removed.namespaceBefore);c.pidInventoryBefore=c.pidInventoryBefore.filter(pid=>pid!==removed.pid);c.pidInventoryAfter=[...c.pidInventoryBefore];assert.equal(validateLiveGuestShape(c).processCount,7);});
test('missing namespace evidence for a still-captured actor remains rejected',()=>{const c=fixture();c.namespaces.pop();assert.throws(()=>validateLiveGuestShape(c),/Namespace evidence must exactly cover/);});
test('empty namespace/process inventory cannot pass as an empty subset',()=>{const c=fixture();c.processes=[];c.pidInventoryBefore=[];c.pidInventoryAfter=[];c.namespaces=[];assert.throws(()=>validateLiveGuestShape(c));});
test('held mount namespace fd with no process evidence remains blocked',()=>{const c=fixture(),gone=c.processes.pop();c.namespaces=c.namespaces.filter(n=>n.identity!==gone.namespaceBefore);c.pidInventoryBefore=c.pidInventoryBefore.filter(pid=>pid!==gone.pid);c.pidInventoryAfter=[...c.pidInventoryBefore];c.processes[0].fdsBefore[1]=c.processes[0].fdsAfter[1]=gone.namespaceBefore;assert.throws(()=>validateLiveGuestShape(c),/namespace fd lacks/);});
test('held namespace already covered by present actors keeps full mount proof',()=>{const c=fixture();c.processes[0].fdsBefore[1]=c.processes[0].fdsAfter[1]=c.processes[1].namespaceBefore;assert.equal(validateLiveGuestShape(c).processCount,8);});
const negatives=[
 ['guest restarted',c=>{c.after.bootId='00000000-0000-0000-0000-000000000000';}],
 ['same distro with a different boot identity',c=>{c.before.bootId='00000000-0000-0000-0000-000000000000';c.after.bootId=c.before.bootId;}],
 ['PID1 changed',c=>{c.after.pid1Start='123';}],
 ['unknown Linux kernel',c=>{c.before.osrelease='linux';}],
 ['permission error',c=>{c.errors.push({pid:1,errno:13});}],
 ['process arrived',c=>{c.pidInventoryAfter.push(9000);}],
 ['omitted process',c=>{c.processes.pop();}],
 ['duplicated PID',c=>{c.processes[1].pid=c.processes[0].pid;}],
 ['new namespace',c=>{c.namespaces.push({identity:'mnt:[999]',mountinfo:'other'});}],
 ['omitted namespace',c=>{c.namespaces.pop();}],
 ['mount bytes and caller digest both changed',c=>{c.namespaces[0].mountinfo+='999 82 0:99 / /mnt/d rw - 9p D:\\ rw,aname=drvfs;path=D:\\\n';const h=sha(c.namespaces[0].mountinfo);c.processes[0].mountSha256Before=h;c.processes[0].mountSha256After=h;}],
 ['process switched namespace',c=>{c.processes[0].namespaceAfter=c.processes[1].namespaceBefore;}],
 ['native PID reused',c=>{c.processes[0].startAfter='124';}],
 ['cwd changed',c=>{c.processes[0].linksAfter.cwd='/tmp';}],
 ['argv changed',c=>{c.processes[0].argvAfter.push('new');}],
 ['file descriptor changed',c=>{c.processes[0].fdsAfter[0]='/mnt/d/file';}],
 ['missing cwd evidence',c=>{delete c.processes[0].linksBefore.cwd;delete c.processes[0].linksAfter.cwd;}],
 ['null inside path',c=>{c.processes[0].linksBefore.cwd='/\0bad';c.processes[0].linksAfter.cwd='/\0bad';}],
 ['self used to omit another actor',c=>{c.selfPid=c.processes[0].pid;}]
];
for(const [name,change] of negatives)test(name,()=>{const c=fixture();change(c);assert.throws(()=>validateLiveGuestShape(c));});
test('nonkernel empty argv is rejected',()=>{const c=fixture();c.processes[0].argvBefore=[''];c.processes[0].argvAfter=[''];assert.throws(()=>validateLiveGuestShape(c));});
test('nonkernel missing executable is rejected',()=>{const c=fixture();c.processes[0].linksBefore.exe=null;c.processes[0].linksAfter.exe=null;assert.throws(()=>validateLiveGuestShape(c));});
test('missing stat flags cannot assert kernel status',()=>{const c=fixture();delete c.processes[0].flagsBefore;assert.throws(()=>validateLiveGuestShape(c));});
test('stat flags changed during capture',()=>{const c=fixture();c.processes[0].flagsAfter=0x00200000;assert.throws(()=>validateLiveGuestShape(c));});
test('explicit PF_KTHREAD allows empty argv and absent executable without dropping other references',()=>{const c=fixture(),p=c.processes[0];p.flagsBefore=p.flagsAfter=0x00200000;p.argvBefore=p.argvAfter=[''];p.linksBefore.exe=p.linksAfter.exe=null;p.linksBefore.cwd=p.linksAfter.cwd='/mnt/d/teruisi-runtime/django-sales/app.previous';const v=validateLiveGuestShape(c);assert.ok(v.paths.some(e=>e.value===p.linksBefore.cwd));});
test('actual observed one-second btime difference from the old snapshot is diagnostic only',()=>{const c=fixture();c.before.btime=c.after.btime='1791621407';const v=validateLiveGuestShape(c);assert.equal(Object.hasOwn(v.epoch,'btime'),false);assert.deepEqual(v.btimeDiagnostic,{before:'1791621407',after:'1791621407',changed:false});});
test('btime may differ between observations without changing boot identity',()=>{const c=fixture();c.before.btime='1791621408';c.after.btime='1791621407';assert.deepEqual(validateLiveGuestShape(c).btimeDiagnostic,{before:'1791621408',after:'1791621407',changed:true});});
for(const value of [null,1791621407,'','0','-1','1e9','x'])test('malformed btime diagnostic still rejected: '+String(value),()=>{const c=fixture();c.after.btime=value;assert.throws(()=>validateLiveGuestShape(c));});
for(const [name,change] of [['boot-id',c=>{c.after.bootId='different';}],['PID1',c=>{c.after.pid1Start='123';}],['namespace',c=>{c.processes[0].namespaceAfter='mnt:[999]';}]])test('btime drift cannot mask '+name+' change',()=>{const c=fixture();c.after.btime='1791621407';change(c);assert.throws(()=>validateLiveGuestShape(c));});
const guard=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs','utf8');
assert.equal(sha(guard),'eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd');
const target='d:\\teruisi-runtime\\django-sales\\app.previous';
const from=guard.indexOf('  const isReference='),to=guard.indexOf('  // A missing command line',from);
const predicate=vm.runInNewContext(guard.slice(from,to)+';inspectReferences',{path,target,Error,realpath:async p=>p.toLowerCase().startsWith('c:\\linked previous')?target+p.slice('c:\\linked previous'.length):p});
function guest(value){const v=validateLiveGuestShape(fixture());v.paths.push({pid:1000,kind:'argv',value});return v;}
test('original pinned predicate catches direct Windows reference',async()=>{assert.equal((await checkGuestMetadataReferences(guest(target+'\\x'),predicate)).references.length,1);});
test('conventional Linux drive text reaches Windows physical predicate',async()=>{assert.equal((await checkGuestMetadataReferences(guest('/mnt/d/teruisi-runtime/django-sales/app.previous/x'),predicate)).references.length,1);});
test('cross-drive alias with spaces reaches original physical predicate',async()=>{assert.equal((await checkGuestMetadataReferences(guest('C:\\linked previous\\x'),predicate)).references.length,1);});
test('UNC alias unsupported, not silent nonreference',async()=>{await assert.rejects(checkGuestMetadataReferences(guest('\\\\localhost\\d$\\other'),predicate));});
test('unknown embedded Linux drive mapping rejected',async()=>{await assert.rejects(checkGuestMetadataReferences(guest('run /mnt/d/alias/file'),predicate));});
test('Windows path newline cannot be skipped',async()=>{await assert.rejects(checkGuestMetadataReferences(guest('C:\\safe\n'),predicate));});
test('even clear guest references do not supply missing HCS association',async()=>{const v=await checkGuestMetadataReferences(guest('/usr/bin/service'),predicate);assert.deepEqual(v.references,[]);assert.equal(v.kind,'guest-references-checked-requires-hcs-association');});
