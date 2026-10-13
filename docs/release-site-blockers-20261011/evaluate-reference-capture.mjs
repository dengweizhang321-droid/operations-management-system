import {readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const evidence='E:/codex-artifacts/release-site-blockers-20261011';
const output=path.resolve(process.argv.at(-1));
assert.equal(output,path.resolve(evidence+'/ADMIN_REFERENCE_DIAGNOSTIC_V1.json'));
const guardRaw=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs'),code=guardRaw.toString();
const hash=v=>createHash('sha256').update(v).digest('hex');assert.equal(hash(guardRaw),'eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd');
const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;assert.ok(size<=8*1024*1024);chunks.push(chunk);}
const capture=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
assert.ok(Array.isArray(capture.processes)&&capture.processes.length<=4096&&Array.isArray(capture.tasks)&&capture.tasks.length<=4096);
const target=path.resolve('D:/teruisi-runtime/django-sales/app.previous').toLowerCase(),start=code.indexOf('  const isReference='),end=code.indexOf('  let scanned=',start);assert.ok(start>0&&end>start);
const {inspectProcessReference,inspectReferences}=vm.runInNewContext(code.slice(start,end)+';({inspectProcessReference,inspectReferences})',{path,target,realpath,Error,Number,Set});
const unknown=[],references=[];
const selectedCwd={...capture.selectedCwd,CurrentDirectory:undefined};
if(capture.selectedCwd?.readable===true){try{assert.equal(capture.selectedCwd.processId,47936);assert.equal(capture.selectedCwd.identityStable,true);const actor=capture.processes.find(p=>p.ProcessId===47936);assert.ok(actor&&actor.identityStable===true);assert.ok(typeof actor.cimCreationUtc==='string'&&actor.cimCreationUtc.length>0);assert.equal(capture.selectedCwd.cimCreationUtc,actor.cimCreationUtc);assert.match(capture.selectedCwd.CurrentDirectory,/^[A-Za-z]:[\\/]/);assert.ok(!/[\r\n\0]/.test(capture.selectedCwd.CurrentDirectory));selectedCwd.refersToPrevious=await inspectReferences(capture.selectedCwd.CurrentDirectory);selectedCwd.directorySha256=hash(capture.selectedCwd.CurrentDirectory);}catch{selectedCwd.failure='physical-directory-or-identity-unresolved';}}
for(const p of capture.processes){let r;if(!p.identityStable)r={kind:'process-unknown',processId:p.ProcessId,reason:'process-changed-during-capture'};else try{r=await inspectProcessReference(p);}catch{r={kind:'process-unknown',processId:p.ProcessId,reason:'physical-path-unresolved'};}if(r)(r.kind==='process-unknown'?unknown:references).push({...r,name:p.Name,openError:p.openError,imageError:p.imageError,commandStatusFirst:p.commandStatusFirst,commandStatus:p.commandStatus,nativeCreationFileTime:p.nativeCreationFileTime,cimCreationUtc:p.cimCreationUtc});}
for(const t of capture.tasks)for(const a of t.actions){try{if(await inspectReferences(a.Execute)||await inspectReferences(a.Arguments,{commandLine:true})||await inspectReferences(a.WorkingDirectory)){references.push({kind:'scheduled-task',identitySha256:hash(t.identity)});break;}}catch{unknown.push({kind:'scheduled-task-unknown',identitySha256:hash(t.identity)});break;}}
const record={version:'teruisi-admin-readonly-reference-diagnostic-v1',at:new Date().toISOString(),status:unknown.length||references.length||selectedCwd.readable!==true||selectedCwd.failure||selectedCwd.refersToPrevious===true?'blocked':'diagnostic-no-reference-found',captureSummary:capture.summary,selectedCwd,originalGuardSha256:hash(guardRaw),unknown,references,rawCommandsNotPersisted:true,productionActions:0,scope:'Diagnostic only; no batch execution, no mutation, no automatic production admission. Only PID47936 cwd supplement; all handles/other cwd/encoded and relative scripts remain outside frozen predicate.'};
await writeFile(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:record.status,unknown:unknown.length,references:references.length,productionActions:0}));
