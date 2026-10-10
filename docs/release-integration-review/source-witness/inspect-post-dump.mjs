// Offline PostgreSQL archive -> authenticated, redacted six-table witnesses.
// --file=- is mandatory; this program never supplies --dbname or runs SQL.
import assert from 'node:assert/strict';
import {readFile,lstat,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {CopyWitness,schemas} from './copy-witness.mjs';
const out=path.resolve(process.argv[2]),keyPath=path.resolve(process.argv[3]);
const base='E:/codex-artifacts/release-integration-review-20261010';
assert.equal(path.dirname(out),path.resolve(base));assert.match(path.basename(out),/^AB-source-witness-20261010-[a-z0-9-]+$/);
assert.equal(keyPath,path.join(out,'private','fingerprint-key.bin'));
const root=path.resolve(base,'AB-v2-555729fd8f1dedc2'),directory='E:/运营管理系统业务数据/daily-20261010T093506Z-8a5a7107b3f6';
const exe='D:/teruisi-runtime/django-sales/postgresql-17.11/bin/pg_restore.exe',dump=path.join(directory,'teruisi-sales.dump');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const selfPath=fileURLToPath(import.meta.url),parserPath=fileURLToPath(new URL('./copy-witness.mjs',import.meta.url));
const startupSelfSha=sha(await readFile(selfPath)),startupParserSha=sha(await readFile(parserPath));
async function safeFile(filename){
  filename=path.resolve(filename);let cursor=path.parse(filename).root;
  for(const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink());if(cursor!==filename)assert.ok(s.isDirectory());}
  const info=await lstat(filename,{bigint:true});assert.ok(info.isFile()&&info.nlink===1n);return info;
}
async function save(name,obj){const h=await open(path.join(out,name),'wx');try{await h.writeFile(JSON.stringify(obj,null,2)+'\n');await h.sync();}finally{await h.close();}}
const startedAt=new Date().toISOString(),deadline=Date.now()+10*60*1000;
const beforeRaw=await readFile(path.join(root,'pre-backup-manifest.json')),afterRaw=await readFile(path.join(root,'post-backup-manifest.json'));
assert.equal(sha(beforeRaw),'aa5f8b30c910223d726e573560fba32933701f4b28831bfcf42cb54e5d7509df');assert.equal(sha(afterRaw),'4cc95143e5feffbd801388cb5de8dd59e269f099ce193afbdc4cfaba310e0f88');
const before=JSON.parse(beforeRaw),after=JSON.parse(afterRaw),contractRaw=await readFile(path.join(root,'candidate-handoff.json'));
assert.equal(sha(contractRaw),'a2ec59b6119a6f6382953c9f2c620345a3fdaaf1a3367773e7c6200ddd3f6e13');
const validatorPath=path.join(root,'validators.mjs');await safeFile(validatorPath);assert.equal(sha(await readFile(validatorPath)),'7ada759aa35fabc1cf12ba22e51d4b517b2c7dae5c83315feb485188c33b3f2e');
const {assertFullManifest}=await import(pathToFileURL(validatorPath));assertFullManifest(before,JSON.parse(contractRaw).profileContract);assertFullManifest(after,JSON.parse(contractRaw).profileContract);
await safeFile(exe);assert.equal(sha(await readFile(exe)),after.software.pgRestoreSha256);
const beforeStat=await safeFile(dump),dumpHasher=createHash('sha256');for await(const bytes of createReadStream(dump)){dumpHasher.update(bytes);assert.ok(Date.now()<deadline);}
assert.equal(dumpHasher.digest('hex'),after.dump.sha256);const key=await readFile(keyPath);await safeFile(keyPath);assert.equal(key.length,32);
const parser=new CopyWitness({before:before.profileEvidence.tables,after:after.profileEvidence.tables,cutoff:before.createdAt,key});
const args=['--file=-','--data-only','--no-owner','--no-privileges','--strict-names',...Object.keys(schemas).map(name=>'--table='+name),dump];
const env={...process.env};for(const name of Object.keys(env))if(/^PG/i.test(name))delete env[name];
const child=spawn(exe,args,{cwd:out,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
const childEnd=new Promise(resolve=>{child.once('error',error=>resolve({code:null,signal:null,errorCode:error.code??'SPAWN_ERROR'}));child.once('close',(code,signal)=>resolve({code,signal}));});
const stderrHasher=createHash('sha256'),stdoutHasher=createHash('sha256');let stderrBytes=0,stdoutBytes=0;
child.stderr.on('data',b=>{stderrBytes+=b.length;stderrHasher.update(b);if(stderrBytes>65536)child.kill();});
const timer=setTimeout(()=>{child.kill();child.stdout.destroy();},Math.max(1,deadline-Date.now()));
const decoder=new TextDecoder('utf-8',{fatal:true});let carry='';
try{
  for await(const bytes of child.stdout){assert.ok(Date.now()<deadline);stdoutBytes+=bytes.length;assert.ok(stdoutBytes<=512*1024*1024,'COPY output limit');stdoutHasher.update(bytes);carry+=decoder.decode(bytes,{stream:true});let i;
    while((i=carry.indexOf('\n'))>=0){const line=carry.slice(0,i);carry=carry.slice(i+1);parser.line(line.endsWith('\r')?line.slice(0,-1):line);}
    assert.ok(Buffer.byteLength(carry)<=4*1024*1024,'COPY pending line limit');
  }
  carry+=decoder.decode();assert.equal(carry,'','COPY must end with newline');
  const exit=await childEnd;assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.equal(stderrBytes,0);
  const lastStat=await safeFile(dump);for(const name of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(lastStat[name],beforeStat[name],'Dump changed');
  assert.equal(sha(await readFile(selfPath)),startupSelfSha);assert.equal(sha(await readFile(parserPath)),startupParserSha);
  const result=parser.finish();
  result.source={startedAt,finishedAt:new Date().toISOString(),durationMs:Date.now()-Date.parse(startedAt),snapshotCreatedAt:after.createdAt,snapshotCompletedAt:after.completedAt,beforeManifestSha256:sha(beforeRaw),afterManifestSha256:sha(afterRaw),dumpSha256:after.dump.sha256,dumpBytes:String(lastStat.size),pgRestoreSha256:after.software.pgRestoreSha256,executable:exe,args,mode:'offline SQL generation into in-memory COPY parser; no connection/server/SQL execution',stdoutBytes,stdoutSha256:stdoutHasher.digest('hex'),stderrBytes,stderrSha256:stderrHasher.digest('hex'),extractionProcessId:child.pid,exitCode:exit.code,codeSha256:startupSelfSha,parserSha256:startupParserSha,privacyKeyId:sha(key)};
  await save('POST_SNAPSHOT_WITNESS.json',result);console.log(JSON.stringify({status:'offline-witness-created',tables:Object.keys(result.tables).length,profileMatched:true,fullComparisonClosed:false,newRows:Object.fromEntries(Object.entries(result.tables).map(([n,v])=>[n,v.newRows.length])),modifiedRows:Object.fromEntries(Object.entries(result.tables).map(([n,v])=>[n,v.modifiedRows.length]))}));
}catch(error){child.kill();child.stdout.destroy();await childEnd;await save('EXTRACTION_FAILED.json',{startedAt,at:new Date().toISOString(),stage:'bounded offline extraction',table:parser.checkingName??parser.active?.name??null,errorType:error.name,errorCode:error.code??null,messageSha256:sha(Buffer.from(error.message)),actualHash:typeof error.actual==='string'&&/^[a-f0-9]{64}$/.test(error.actual)?error.actual:null,expectedHash:typeof error.expected==='string'&&/^[a-f0-9]{64}$/.test(error.expected)?error.expected:null,sourceLocation:error.stack?.split('\n').find(s=>/^\s+at .*?(copy-witness|inspect-post-dump)\.mjs:\d+:\d+/.test(s))?.trim()??null,stdoutBytes,stderrBytes,productionSQLExecuted:false,fullComparisonClosed:false});console.error('Offline witness extraction rejected; no raw data logged');process.exitCode=1;}finally{clearTimeout(timer);}
