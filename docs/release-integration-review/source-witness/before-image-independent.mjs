// Reads only already-captured private evidence. No spawn, server, SQL, key/raw output.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {heapTuples,decodeScopedRow} from './heap-layout.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
let stage='private-input-validation';
try {
  const root=path.resolve(process.argv[2]);
  assert.equal(path.dirname(root),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
  assert.equal(path.basename(root),'AB-source-witness-20261010-1139-final');
  const priv=path.join(root,'private'),sources=[];
  const read=async name=>{const bytes=await readFile(path.join(root,name));sources.push({relativePath:name,bytes:bytes.length,sha256:digest(bytes)});return bytes;};
  const json=async name=>JSON.parse(await read(name));
  const key=await readFile(path.join(priv,'fingerprint-key.bin'));assert.equal(key.length,32);
  const mac=value=>createHmac('sha256',key).update(String(value)).digest('hex');
  const b=JSON.parse(await readFile('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/pre-backup-manifest.json'));
  const a=JSON.parse(await readFile('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/post-backup-manifest.json'));
  const claimed=await json('BEFORE_RECONSTRUCTION-wal.json'),witness=await json('POST_SNAPSHOT_WITNESS.json'),physical=await json('PHYSICAL_CANDIDATE_CAPTURE.json'),wal=await json('WAL_PAGE_CANDIDATES.json');
  const old=await json('private/reconstructed-workflow-tasks-before-wal.json'),oldControl=await json('private/reconstructed-workflow-revision-before-wal.json'),transition=await json('private/transition-input-private.json');
  assert.ok(Array.isArray(old)&&old.length===90&&Array.isArray(transition.rows.workflow_tasks)&&transition.rows.workflow_tasks.length===90);
  const after=transition.rows.workflow_tasks,afterControl=transition.rows.workflow_data_revisions;
  assert.ok(Array.isArray(afterControl)&&afterControl.length===1);
  // Independent PostgreSQL row_to_json renderer for these text/int8/timestamptz rows.
  function ts(value){const m=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?([+-])(\d\d)(?::(\d\d))?$/.exec(value);assert.ok(m);const base=m[1]+'T'+m[2],local=Date.parse(base+'Z');assert.ok(Number.isFinite(local)&&new Date(local).toISOString().slice(0,19)===base);const zone=Number(m[5])*60+Number(m[6]??0);assert.ok(Number(m[5])<=15&&Number(m[6]??0)<=59);const utc=new Date(local-(m[4]==='+'?1:-1)*zone*60000).toISOString().replace(/\.000Z$/,'');const fraction=(m[3]??'').replace(/0+$/,'');return utc+(fraction?'.'+fraction:'')+'+00:00';}
  function token(name,value){if(value===null)return 'null';assert.equal(typeof value,'string');if(name==='version'||name==='revision'){assert.match(value,/^(0|[1-9]\d*)$/);assert.ok(BigInt(value)<=9223372036854775807n);return value;}if(['created_at','updated_at','deleted_at'].includes(name))return JSON.stringify(ts(value));return JSON.stringify(value);}
  function rowHash(columns,row){assert.equal(Object.keys(row).length,columns.length);for(const n of columns)assert.ok(Object.hasOwn(row,n));return createHash('sha256').update('{'+columns.map(n=>JSON.stringify(n)+':'+token(n,row[n])).join(',')+'}').digest();}
  function rootOf(rows,columns){const hashes=rows.map(r=>rowHash(columns,r)).sort(Buffer.compare),h=createHash('sha256');for(const value of hashes)h.update(value);return h.digest('hex');}
  const taskColumns=witness.tables.workflow_tasks.physicalColumns,controlColumns=witness.tables.workflow_data_revisions.physicalColumns;
  stage='four-complete-roots';
  assert.equal(rootOf(old,taskColumns),b.profileEvidence.tables.workflow_tasks.sha256);
  assert.equal(rootOf([oldControl],controlColumns),b.profileEvidence.tables.workflow_data_revisions.sha256);
  assert.equal(rootOf(after,taskColumns),a.profileEvidence.tables.workflow_tasks.sha256);
  assert.equal(rootOf(afterControl,controlColumns),a.profileEvidence.tables.workflow_data_revisions.sha256);
  const oldMap=new Map(old.map(r=>[r.id,r])),newMap=new Map(after.map(r=>[r.id,r]));assert.equal(oldMap.size,90);assert.equal(newMap.size,90);assert.deepEqual([...oldMap.keys()].sort(),[...newMap.keys()].sort());
  const target=new Set(claimed.taskCandidateCounts.map(r=>r.idHmac));assert.equal(target.size,3);
  const changes=[],unchanged=[];
  for(const r of old){const next=newMap.get(r.id),columns=taskColumns.filter(c=>token(c,r[c])!==token(c,next[c]));if(columns.length){assert.ok(target.has(mac(r.id)));changes.push({idHmac:mac(r.id),beforeVersion:Number(r.version),afterVersion:Number(next.version),changedColumns:columns,oldRow:r});}else unchanged.push(r);}
  assert.equal(changes.length,3);assert.equal(unchanged.length,87);
  const heap=await read('private/workflow_tasks-heap.bin'),controlHeap=await read('private/workflow_data_revisions-heap.bin');
  assert.ok(physical.sources.some(s=>s.sha256===digest(heap)&&s.bytes===heap.length));assert.ok(physical.sources.some(s=>s.sha256===digest(controlHeap)&&s.bytes===controlHeap.length));
  assert.equal(wal.exitCode,0);assert.equal(wal.stderrBytes,0);assert.equal(wal.serverConnected,false);assert.equal(wal.productionFilesModified,false);assert.equal(wal.images.length,3);
  const walCopy=await read('private/wal-evidence-20261010-resumed/000000010000002A0000000C');assert.equal(digest(walCopy),wal.sourceSha256);assert.equal(walCopy.length,16777216);
  const maxLsn=[1,3].map(block=>({hi:heap.readUInt32LE(block*8192),lo:heap.readUInt32LE(block*8192+4)})).sort((x,y)=>x.hi-y.hi||x.lo-y.lo).at(-1);assert.equal(wal.endLsn.toLowerCase(),maxLsn.hi.toString(16)+'/'+maxLsn.lo.toString(16));
  const images=new Map();for(const image of wal.images){const page=await read('private/wal-evidence-20261010-resumed/images/'+image.name);assert.equal(digest(page),image.sha256);assert.equal(page.length,8192);images.set(image.name,page);}
  stage='three-fpi-source-rows';
  const sourceRows=[];
  for(const entry of claimed.rows.workflow_tasks){assert.equal(entry.source.normalItem,true);const page=images.get(entry.source.walImage);assert.ok(page);const tuple=heapTuples(page).find(t=>t.line===entry.source.line&&t.offset===entry.source.offset);assert.ok(tuple);const decoded=decodeScopedRow(tuple,taskColumns),expected=oldMap.get(decoded.id);assert.ok(expected&&target.has(mac(decoded.id)));const borrowed=[];
    for(const c of taskColumns){if(decoded[c]&&typeof decoded[c]==='object'){assert.ok(entry.borrowedPostFields.includes(c));assert.equal(token(c,newMap.get(decoded.id)[c]),token(c,expected[c]));decoded[c]=newMap.get(decoded.id)[c];borrowed.push(c);}assert.equal(token(c,decoded[c]),token(c,expected[c]));}
    assert.deepEqual(borrowed,entry.borrowedPostFields);assert.equal(Number(expected.version),2);assert.equal(mac(expected.id),entry.fields.idHmac);for(const c of ['title','work_content','mutation_token','updated_by'])assert.equal(mac(expected[c]),entry.fields[c+'Hmac']);
    sourceRows.push({idHmac:mac(expected.id),sourceImage:entry.source.walImage,line:entry.source.line,offset:entry.source.offset,decodedColumns:taskColumns.length,borrowedPostFields:borrowed,beforeVersion:2,fieldHmacChecksPassed:true});
  }
  assert.equal(new Set(sourceRows.map(r=>r.idHmac)).size,3);
  const controlEntry=claimed.rows.workflow_data_revisions[0],controlTuple=heapTuples(controlHeap).find(t=>t.block===controlEntry.source.block&&t.line===controlEntry.source.line&&t.offset===controlEntry.source.offset);assert.ok(controlTuple);const control=decodeScopedRow(controlTuple,controlColumns);assert.equal(rootOf([control],controlColumns),b.profileEvidence.tables.workflow_data_revisions.sha256);assert.equal(Number(control.revision),360);
  stage='candidate-census-unique-global-pre-root';
  const candidates=new Map(changes.map(c=>[c.oldRow.id,new Map()]));
  for(const page of images.values())for(const tuple of heapTuples(page)){try{const r=decodeScopedRow(tuple,taskColumns);if(!candidates.has(r.id)||Object.values(r).some(v=>v&&typeof v==='object'))continue;if(BigInt(r.version)<1n||BigInt(r.version)>=BigInt(newMap.get(r.id).version))continue;candidates.get(r.id).set(rowHash(taskColumns,r).toString('hex'),r);}catch{}}
  const choices=[...candidates].map(([id,values])=>({id,rows:[...values.values()]}));assert.ok(choices.every(c=>c.rows.length>0&&c.rows.length<=32));let combinations=0,matches=0;
  const search=(i,pick)=>{if(i<choices.length){for(const r of choices[i].rows)search(i+1,[...pick,r]);return;}assert.ok(++combinations<=4096);const replacements=new Map(pick.map(r=>[r.id,r]));if(rootOf(after.map(r=>replacements.get(r.id)??r),taskColumns)===b.profileEvidence.tables.workflow_tasks.sha256)matches++;};search(0,[]);assert.equal(matches,1);
  stage='real-memory-negative-fingerprints';const clone=rows=>rows.map(r=>({...r}));
  const altered=clone(old);altered[0].title+=' synthetic-negative';assert.notEqual(rootOf(altered,taskColumns),b.profileEvidence.tables.workflow_tasks.sha256);
  const overwrite=clone(old),changedId=changes[0].oldRow.id,idx=overwrite.findIndex(r=>r.id===changedId);overwrite[idx].mutation_token=newMap.get(changedId).mutation_token;assert.notEqual(rootOf(overwrite,taskColumns),b.profileEvidence.tables.workflow_tasks.sha256);
  const other=clone(old),otherIdx=other.findIndex(r=>!target.has(mac(r.id)));other[otherIdx].updated_by+=' synthetic-negative';assert.notEqual(rootOf(other,taskColumns),b.profileEvidence.tables.workflow_tasks.sha256);
  assert.notEqual(rootOf([{...oldControl,updated_at:afterControl[0].updated_at}],controlColumns),b.profileEvidence.tables.workflow_data_revisions.sha256);
  const report={version:'teruisi-before-image-independent-real-v1',reviewedAt:new Date().toISOString(),status:'private-pre-and-post-full-roots-and-source-fields-verified',preTasksRoot:b.profileEvidence.tables.workflow_tasks.sha256,preControlRoot:b.profileEvidence.tables.workflow_data_revisions.sha256,postTasksRoot:a.profileEvidence.tables.workflow_tasks.sha256,postControlRoot:a.profileEvidence.tables.workflow_data_revisions.sha256,beforeTasks:90,afterTasks:90,controlRows:1,unchangedTasks:87,changedTasks:changes.map(({oldRow,...safe})=>safe),sourceRows,controlOldRevision:360,completePreRootMatches:true,completePostRootMatches:true,uniqueMatchingDataset:true,combinations,matches,candidateCounts:choices.map(c=>({idHmac:mac(c.id),count:c.rows.length})),negativeChecks:{alteredBeforeFieldRejected:true,borrowingDifferentAfterTokenRejected:true,modifyingOneOfOther87Rejected:true,afterRevisionTimestampCannotReplaceBefore:true},privateKeyConsumedInMemoryOnly:true,keyMaterialOrRawBusinessRowsWritten:false,newProductionCapture:false,newSQLOrServerConnection:false,originalPreRecoveryPackageRevived:false,originalStrictOperationPassed:false,historicalAuthorizationEstablished:false,sources};
  const text=JSON.stringify(report,null,2)+'\n';assert.ok(!text.includes(key.toString('hex'))&&!text.includes(key.toString('base64')));
  await writeFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'BEFORE_IMAGE_INDEPENDENT_REAL.json'),text,{flag:'wx'});
  console.log(JSON.stringify({status:report.status,completePreRootMatches:true,completePostRootMatches:true,unchangedTasks:87,changedTasks:3,controlOldRevision:360,combinations,matches,sourceBorrowedFields:sourceRows.map(r=>r.borrowedPostFields),reportSha256:digest(Buffer.from(text))}));
}catch(error){console.error(JSON.stringify({status:'independent-private-verification-rejected',stage,errorType:error.name,messageSha256:digest(Buffer.from(String(error.message)))}));process.exitCode=1;}
