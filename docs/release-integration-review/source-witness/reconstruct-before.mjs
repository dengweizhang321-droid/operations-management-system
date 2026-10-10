// Hash-constrained reconstruction in private memory from authenticated post
// and read-only heap copies. Never writes PGDATA or alters old manifests/WAL.
import assert from 'node:assert/strict';import {readFile,open,lstat} from 'node:fs/promises';import {createHash,createHmac} from 'node:crypto';import {spawn} from 'node:child_process';import path from 'node:path';
import {CopyWitness,decodeCopy,pgRowJson,tableRoot,redactedRow} from './copy-witness.mjs';
import {heapTuples,tupleAt,decodeScopedRow,PAGE} from './heap-layout.mjs';
const out=path.resolve(process.argv[2]),privateRoot=path.join(out,'private');assert.equal(path.dirname(out),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));assert.match(path.basename(out),/^AB-source-witness-20261010-[a-z0-9-]+$/);
const useWal=process.argv[3]==='wal';assert.ok(process.argv[3]===undefined||useWal);const suffix=useWal?'-wal':'';
const key=await readFile(path.join(privateRoot,'fingerprint-key.bin')),tag=v=>createHmac('sha256',key).update(String(v)).digest('hex'),sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(key.length,32);
const root='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2',before=JSON.parse(await readFile(path.join(root,'pre-backup-manifest.json'))),afterRaw=await readFile(path.join(root,'post-backup-manifest.json'));assert.equal(sha(afterRaw),'4cc95143e5feffbd801388cb5de8dd59e269f099ce193afbdc4cfaba310e0f88');
const after=JSON.parse(afterRaw),publicWitness=JSON.parse(await readFile(path.join(out,'POST_SNAPSHOT_WITNESS.json'))),capture=JSON.parse(await readFile(path.join(out,'PHYSICAL_CANDIDATE_CAPTURE.json')));
const exe='D:/teruisi-runtime/django-sales/postgresql-17.11/bin/pg_restore.exe',dump='E:/运营管理系统业务数据/daily-20261010T093506Z-8a5a7107b3f6/teruisi-sales.dump';assert.equal(sha(await readFile(exe)),after.software.pgRestoreSha256);
const env={...process.env};for(const n of Object.keys(env))if(/^PG/i.test(n))delete env[n];const names=['workflow_tasks','workflow_data_revisions'];
const parser=new CopyWitness({before:before.profileEvidence.tables,after:after.profileEvidence.tables,cutoff:before.createdAt,key,maxRows:200}),rawRows={workflow_tasks:[],workflow_data_revisions:[]};
const child=spawn(exe,['--file=-','--data-only','--no-owner','--no-privileges','--strict-names',...names.map(n=>'--table='+n),dump],{env,cwd:out,stdio:['ignore','pipe','pipe'],windowsHide:true});const ended=new Promise(resolve=>{child.once('error',e=>resolve({code:null,error:e.code}));child.once('close',(code,signal)=>resolve({code,signal}));});let errors=0;child.stderr.on('data',b=>errors+=b.length);let carry='',bytes=0;const decoder=new TextDecoder('utf8',{fatal:true});
for await(const chunk of child.stdout){bytes+=chunk.length;assert.ok(bytes<=8*1024*1024);carry+=decoder.decode(chunk,{stream:true});let i;while((i=carry.indexOf('\n'))>=0){let line=carry.slice(0,i);carry=carry.slice(i+1);if(line.endsWith('\r'))line=line.slice(0,-1);if(parser.active&&line!=='\\.'){
  const name=parser.active.name;assert.ok(names.includes(name));const values=line.split('\t').map(decodeCopy);assert.equal(values.length,parser.active.columns.length);rawRows[name].push(Object.fromEntries(parser.active.columns.map((n,j)=>[n,values[j]])));
}parser.line(line);}}
carry+=decoder.decode();assert.equal(carry,'');const exit=await ended;assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.equal(errors,0);assert.equal(parser.active,null);assert.deepEqual(Object.keys(parser.tables).sort(),names.sort());
for(const n of names){assert.equal(tableRoot(parser.tables[n].hashes),after.profileEvidence.tables[n].sha256);assert.equal(rawRows[n].length,after.profileEvidence.tables[n].rows);}
const targetIds=new Set(publicWitness.tables.workflow_tasks.modifiedRows.map(r=>r.idHmac)),postById=new Map(rawRows.workflow_tasks.map(r=>[r.id,r]));assert.equal(targetIds.size,3);
const candidates={},results={workflow_data_revisions:[],workflow_tasks:[]};const rowDigest=(columns,row)=>createHash('sha256').update(pgRowJson(columns,columns.map(c=>row[c]))).digest();
for(const n of names){
  const columns=publicWitness.tables[n].physicalColumns,heapPath=path.join(privateRoot,n+'-heap.bin'),heap=await readFile(heapPath);assert.ok((await lstat(heapPath)).isFile());const source=capture.sources.find(s=>s.sha256===sha(heap)&&s.bytes===heap.length);assert.ok(source,'Heap does not match capture');
  const attempts=[],seen=new Set();const attempt=(t,where)=>{try{
    const row=decodeScopedRow(t,columns),id=row.id??row.domain;if(typeof id!=='string')return;
    if(n==='workflow_tasks'&&!targetIds.has(tag(id)))return;
    const borrowed=[];for(const [name,v]of Object.entries(row))if(v&&typeof v==='object'){const post=n==='workflow_tasks'?postById.get(id):rawRows[n][0];assert.ok(post&&typeof post[name]==='string');row[name]=post[name];borrowed.push(name);}
    const digest=rowDigest(columns,row),signature=tag(id)+':'+digest.toString('hex');if(seen.has(signature))return;seen.add(signature);
    if(n==='workflow_tasks'){assert.ok(Number(row.version)>=1&&Number(row.version)<Number(postById.get(id).version));assert.ok(['待开始','工作中','已完成'].includes(row.status));(candidates[id]??=[]).push({row,digest,where,borrowed});}
    else if(tableRoot([digest])===before.profileEvidence.tables[n].sha256)results[n].push({row,digest,where,borrowed});
  }catch{}};
  for(const t of heapTuples(heap))attempt(t,{block:t.block,line:t.line,offset:t.offset,normalItem:true});
  if(useWal&&n==='workflow_tasks'){
    const walRaw=await readFile(path.join(out,'WAL_PAGE_CANDIDATES.json')),wal=JSON.parse(walRaw);assert.equal(wal.exitCode,0);assert.equal(wal.stderrBytes,0);assert.equal(wal.serverConnected,false);assert.equal(wal.productionFilesModified,false);
    for(const image of wal.images){assert.match(image.name,/^00000001-[A-F0-9]{8}-[A-F0-9]{8}\.1663\.16386\.3853473\.\d+_main$/);const page=await readFile(path.join(privateRoot,'wal-evidence-20261010-resumed','images',image.name));assert.equal(sha(page),image.sha256);assert.equal(page.length,PAGE);for(const t of heapTuples(page))attempt(t,{walImage:image.name,walEvidenceSha256:sha(walRaw),line:t.line,offset:t.offset,normalItem:true});}
  }
  // Pruning can remove line pointers. Scan only known scoped identity markers;
  // tuple/header/type bounds and the independent complete pre root still apply.
  const markers=n==='workflow_tasks'?[...postById.keys()].filter(id=>targetIds.has(tag(id))):[before.evidence.workflowRevisions.workflow.sourceDigest];
  for(let block=0;block<heap.length/PAGE;block++){
    const page=heap.subarray(block*PAGE,(block+1)*PAGE);for(const marker of markers){let at=page.indexOf(Buffer.from(marker));while(at>=0){for(const offset of n==='workflow_tasks'?[at-1-24,at-1-32]:[at-49,at-57]){
      try{const t=tupleAt(page,offset,PAGE-offset);if(t.natts===columns.length)attempt(t,{block,offset,normalItem:false});}catch{}}
      at=page.indexOf(Buffer.from(marker),at+1);}}
  }
  attempts.push(...seen);results[n+'_candidateCount']=attempts.length;
}
const selectedIds=[...postById.keys()].filter(id=>targetIds.has(tag(id))),choices=selectedIds.map(id=>candidates[id]??[]);assert.ok(choices.every(a=>a.length<=32));let combinations=0,matched=null;
function search(index,chosen){if(index<choices.length){for(const v of choices[index])search(index+1,[...chosen,v]);return;}combinations++;assert.ok(combinations<=4096);const replacements=new Map(chosen.map(c=>[c.row.id,c.row]));const rows=rawRows.workflow_tasks.map(r=>replacements.get(r.id)??r),columns=publicWitness.tables.workflow_tasks.physicalColumns;const root=tableRoot(rows.map(r=>rowDigest(columns,r)));if(root===before.profileEvidence.tables.workflow_tasks.sha256){assert.equal(matched,null,'Ambiguous complete pre candidate');matched={rows,chosen,root};}}
search(0,[]);
const evidence={version:'teruisi-hash-constrained-before-reconstruction-v1',at:new Date().toISOString(),beforeManifestSha256:sha(await readFile(path.join(root,'pre-backup-manifest.json'))),afterManifestSha256:sha(afterRaw),sourceDumpSha256:after.dump.sha256,physicalCaptureSha256:sha(await readFile(path.join(out,'PHYSICAL_CANDIDATE_CAPTURE.json'))),SQLExecuted:false,productionFilesModified:false,privateRowsOnly:true,completeBeforeRootRequired:true,combinations,taskCandidateCounts:choices.map((a,i)=>({idHmac:tag(selectedIds[i]),count:a.length})),tasksBeforeRootMatched:!!matched,revisionBeforeRootMatched:results.workflow_data_revisions.length>0,fullComparisonClosed:false,rows:{}};
if(matched){evidence.rows.workflow_tasks=matched.chosen.map(c=>({fields:redactedRow(c.row,key),source:c.where,borrowedPostFields:c.borrowed}));const h=await open(path.join(privateRoot,'reconstructed-workflow-tasks-before'+suffix+'.json'),'wx');try{await h.writeFile(JSON.stringify(matched.rows));await h.sync();}finally{await h.close();}}
if(results.workflow_data_revisions.length){const c=results.workflow_data_revisions[0];evidence.rows.workflow_data_revisions=[{fields:redactedRow(c.row,key),source:c.where,borrowedPostFields:c.borrowed}];const h=await open(path.join(privateRoot,'reconstructed-workflow-revision-before'+suffix+'.json'),'wx');try{await h.writeFile(JSON.stringify(c.row));await h.sync();}finally{await h.close();}}
const h=await open(path.join(out,'BEFORE_RECONSTRUCTION'+suffix+'.json'),'wx');try{await h.writeFile(JSON.stringify(evidence,null,2)+'\n');await h.sync();}finally{await h.close();}
console.log(JSON.stringify({tasksBeforeRootMatched:evidence.tasksBeforeRootMatched,revisionBeforeRootMatched:evidence.revisionBeforeRootMatched,combinations,candidateCounts:evidence.taskCandidateCounts,fullComparisonClosed:false}));
