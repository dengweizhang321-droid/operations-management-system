// Read existing disk pages only; no server connection, SQL, extension or write
// into PGDATA. Private copies are candidate evidence, never an assumed snapshot.
import assert from 'node:assert/strict';import {readFile,lstat,open} from 'node:fs/promises';import path from 'node:path';import {createHash,createHmac} from 'node:crypto';
import {relationMap,heapTuples,catalogIdentity,catalogRelation,decodeScopedRow} from './heap-layout.mjs';
import {pgRowJson,tableRoot} from './copy-witness.mjs';
const out=path.resolve(process.argv[2]),base='D:/teruisi-runtime/django-sales/postgres-data';
assert.equal(path.dirname(out),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));assert.match(path.basename(out),/^AB-source-witness-20261010-[a-z0-9-]+$/);
assert.equal((await readFile(path.join(base,'PG_VERSION'),'utf8')).trim(),'17');
const sha=b=>createHash('sha256').update(b).digest('hex'),key=await readFile(path.join(out,'private','fingerprint-key.bin')),tag=s=>createHmac('sha256',key).update(String(s)).digest('hex');assert.equal(key.length,32);
const startedAt=new Date().toISOString(),sources=[];
async function stableRead(filename){
  assert.ok(path.resolve(filename).startsWith(path.resolve(base)+path.sep));let cursor=path.parse(path.resolve(filename)).root;
  for(const part of path.resolve(filename).slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink());}
  const before=await lstat(filename,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size<=32n*1024n*1024n);
  const bytes=await readFile(filename),second=await readFile(filename),after=await lstat(filename,{bigint:true});assert.equal(sha(bytes),sha(second),'Physical source changed');for(const n of ['ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[n],after[n]);sources.push({path:filename,bytes:bytes.length,sha256:sha(bytes),stableDoubleRead:true});return bytes;
}
async function save(name,value,raw=false){const h=await open(path.join(out,name),'wx');try{await h.writeFile(raw?value:JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}
try{
  const map=await stableRead(path.join(base,'global','pg_filenode.map')),databaseFile=relationMap(map,1262),databaseRows=heapTuples(await stableRead(path.join(base,'global',String(databaseFile))));
  const ids=new Set(databaseRows.map(catalogIdentity).filter(r=>r.name==='teruisi_sales').map(r=>r.oid));assert.equal(ids.size,1);const oid=[...ids][0];
  const db=path.join(base,'base',String(oid)),localMap=await stableRead(path.join(db,'pg_filenode.map')),classFile=relationMap(localMap,1259),classBytes=await stableRead(path.join(db,String(classFile)));
  const expected=['workflow_tasks','workflow_data_revisions'],relations=heapTuples(classBytes).map(catalogRelation).filter(r=>r.namespace===2200&&expected.includes(r.name));
  const witness=JSON.parse(await readFile(path.join(out,'POST_SNAPSHOT_WITNESS.json'))),pre=JSON.parse(await readFile('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/pre-backup-manifest.json'));
  const summary={version:'teruisi-readonly-heap-candidate-capture-v1',startedAt,databaseOid:oid,serverConnected:false,productionSQLExecuted:false,productionFilesModified:false,privateRawCopies:true,candidateVisibilityAssumed:false,beforePayloadRecovered:false,fullComparisonClosed:false,sources,relations:{}};
  for(const name of expected){
    const candidates=relations.filter(r=>r.name===name),filenames=new Set(candidates.map(r=>r.file));assert.equal(filenames.size,1);const relation=candidates[0];assert.ok(relation.kind==='r'&&relation.file>0&&relation.tablespace===0);const columns=witness.tables[name].physicalColumns;assert.equal(relation.natts,columns.length);
    const bytes=await stableRead(path.join(db,String(relation.file)));await save('private/'+name+'-heap.bin',bytes,true);
    const rows=[],failures=[];for(const t of heapTuples(bytes)){
      try{const row=decodeScopedRow(t,columns),identity=row.id??row.domain;assert.equal(typeof identity,'string');
        const unsupported=Object.entries(row).filter(([,v])=>v&&typeof v==='object').map(([k])=>k);let root=null;if(!unsupported.length)root=tableRoot([createHash('sha256').update(pgRowJson(columns,columns.map(c=>row[c]))).digest()]);
        rows.push({block:t.block,line:t.line,offset:t.offset,bytes:t.length,xmin:t.xmin,xmax:t.xmax,idHmac:tag(identity),version:row.version===undefined?undefined:Number(row.version),revision:row.revision===undefined?undefined:Number(row.revision),unsupported,oneRowRoot:root,controlMatchesPreRoot:name==='workflow_data_revisions'&&root===pre.profileEvidence.tables[name].sha256});
      }catch{failures.push({block:t.block,line:t.line,decoderRejected:true});}
    }
    summary.relations[name]={file:relation.file,bytes:bytes.length,normalCandidates:rows,decodeFailures:failures,preTargetRows:pre.profileEvidence.tables[name].rows,preTargetSha256:pre.profileEvidence.tables[name].sha256};
  }
  summary.finishedAt=new Date().toISOString();await save('PHYSICAL_CANDIDATE_CAPTURE.json',summary);console.log(JSON.stringify({status:'readonly-private-candidates-captured',databaseOid:oid,relations:Object.fromEntries(Object.entries(summary.relations).map(([n,v])=>[n,{normalCandidates:v.normalCandidates.length,decodeFailures:v.decodeFailures.length,controlMatches:v.normalCandidates.filter(r=>r.controlMatchesPreRoot).length}])),beforePayloadRecovered:false,fullComparisonClosed:false}));
}catch(error){await save('PHYSICAL_CAPTURE_FAILED.json',{startedAt,at:new Date().toISOString(),errorType:error.name,messageSha256:sha(Buffer.from(error.message)),sources,productionFilesModified:false,beforePayloadRecovered:false,fullComparisonClosed:false});console.error('Readonly candidate capture rejected; no raw data logged');process.exitCode=1;}
