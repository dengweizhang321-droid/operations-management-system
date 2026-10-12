// Copied from frozen 69898b1b fresh entry bootstrap. Added export and original rotation API only.
// Explicit first-adoption entry. Only built-ins execute before the pinned package is verified.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,realpath} from 'node:fs/promises';
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749';
const expectedManifest='6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',expectedPlan='0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881';
const self='E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs',mode='fresh-no-reuse-v1',workerRuntimeRoot=path.resolve('D:/teruisi-runtime/teruisi-worker-sales');
const moduleNames=['release-batch.mjs','release-batch-admission.mjs','release-impact.mjs','release-no-data-observation.mjs','release-preparation-evidence.mjs','release-admission-timing.mjs','release-daily-backup.mjs','release-readonly-retry.mjs','worker-local-release.mjs','worker-local-release-rotation.mjs','d1-retirement-proof.mjs','collect-d1-retirement-proof.mjs'];
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
const digestPattern=/^[a-f0-9]{64}$/;
async function physical(target) {
  const absolute=path.resolve(target);let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);assert.equal((await lstat(cursor)).isSymbolicLink(),false,'Redirected bootstrap path');}
  assert.equal(path.resolve(await realpath(absolute)).toLowerCase(),absolute.toLowerCase(),'Bootstrap physical path changed');
}
async function checkedFile(target,{collect=false,treeDigest,relative}={}) {
  await physical(target);const before=await lstat(target,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n,'Bootstrap requires a single-link regular file');
  if(collect)assert.ok(before.size<=16n*1024n*1024n,'Bootstrap JSON/code input too large');
  if(treeDigest){const name=Buffer.from(relative,'utf8'),n=Buffer.alloc(4),size=Buffer.alloc(8);n.writeUInt32BE(name.length);size.writeBigUInt64BE(before.size);treeDigest.update(n).update(name).update(size);}
  const digest=createHash('sha256'),chunks=[];let length=0n;
  for await(const chunk of createReadStream(target)){length+=BigInt(chunk.length);digest.update(chunk);treeDigest?.update(chunk);if(collect)chunks.push(chunk);}
  await physical(target);const after=await lstat(target,{bigint:true});assert.equal(length,before.size);
  for(const key of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'Bootstrap file changed');
  return {sha256:digest.digest('hex'),raw:collect?Buffer.concat(chunks):null};
}
function relativePath(value) {assert.ok(typeof value==='string'&&!path.posix.isAbsolute(value)&&!/[\\:\x00-\x1f]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Invalid bootstrap member');return value;}
async function completeTree(root) {
  const fields=['dev','ino','nlink','size','mtimeNs','ctimeNs'];
  const enumerate=async()=>{
    const files=[],identities=Object.create(null);
    const record=(key,info)=>{identities[key]=Object.fromEntries(fields.map(k=>[k,String(info[k])]))};
    async function walk(dir,prefix='') {
      await physical(dir);const directory=await lstat(dir,{bigint:true});assert.ok(directory.isDirectory());record(prefix||'/',directory);
      for(const item of await readdir(dir,{withFileTypes:true})) {
        const rel=relativePath(prefix+item.name),full=path.join(dir,item.name),info=await lstat(full,{bigint:true});assert.equal(info.isSymbolicLink(),false);
        if(info.isDirectory())await walk(full,rel+'/');else {assert.ok(info.isFile()&&info.nlink===1n);record(rel,info);files.push(rel);}
      }
    }
    await walk(root);return {files:files.sort(),identities};
  };
  const before=await enumerate(),digest=createHash('sha256');
  for(const relative of before.files)await checkedFile(path.join(root,...relative.split('/')),{treeDigest:digest,relative});
  assert.deepEqual(await enumerate(),before,'Bootstrap tree membership or physical identity changed');
  return {algorithm:'sha256-ordinal-path-length-content-v1',fileCount:before.files.length,sha256:digest.digest('hex')};
}
export async function bootstrapReconciliation(specPath,approved) {
  assert.match(approved,digestPattern);const raw=(await checkedFile(specPath,{collect:true})).raw,spec=JSON.parse(raw),batch=spec.batch,collector=spec.collector;
  const {batchSha256,...core}=batch;assert.equal(hash(core),approved);assert.equal(batchSha256,approved);assert.equal(batch.version,'teruisi-release-batch-v4');
  assert.equal(batch.binding.artifactSha256,expectedManifest);assert.equal(batch.binding.workerPlanSha256,expectedPlan);assert.equal(hash(batch.tests),batch.binding.testsSha256);
  assert.equal(path.resolve(spec.journalRoot),path.join(workerRuntimeRoot,'state','release-batches'));
  assert.equal(hash(collector),batch.collectorSha256);assert.equal(collector.transport,'in-process-content-evidence-v1');assert.equal(collector.executable,process.execPath);
  assert.equal(collector.args.length,4);assert.equal(collector.args[0],path.join(candidate,'tools','release-batch-admission.mjs'));assert.equal(collector.args[1],'collect');assert.equal(path.resolve(collector.args[2]),path.resolve(specPath));assert.ok(path.isAbsolute(collector.args[3]));
  if(collector.cwd)assert.equal(path.resolve(collector.cwd),process.cwd());
  assert.ok(Array.isArray(batch.tests.evidence));const entries=batch.tests.evidence.filter(e=>e.kind==='first-adoption-execution');assert.equal(entries.length,1);const entry=entries[0];
  assert.deepEqual(Object.keys(entry).sort(),['kind','mode','path','sha256']);assert.equal(entry.mode,mode);assert.ok(path.isAbsolute(entry.path));assert.equal(path.resolve(entry.path),path.resolve(self));
  const expectedFiles=[...moduleNames.map(n=>path.join(candidate,'tools',n)),path.join(candidate,'node_modules/typescript/lib/typescript.js'),path.join(candidate,'node_modules/typescript/package.json'),process.execPath,collector.args[3]];
  assert.equal(new Set(collector.files.map(f=>f.path)).size,collector.files.length);assert.deepEqual(collector.files.map(f=>f.path).sort(),expectedFiles.sort());
  for(const f of collector.files)assert.match(f.sha256,digestPattern);
  const testsPin=collector.files.find(f=>f.path===collector.args[3]);
  const verifyInputs=async()=>{assert.equal((await checkedFile(self)).sha256,entry.sha256,'Approved entrypoint bytes changed');assert.equal((await checkedFile(specPath)).sha256,hash(raw),'Approved spec bytes changed');assert.equal((await checkedFile(testsPin.path)).sha256,testsPin.sha256,'Tests evidence bytes changed');};
  const verifyPins=async()=>{await verifyInputs();for(const f of collector.files)assert.equal((await checkedFile(f.path)).sha256,f.sha256,'Collector bytes changed');};
  await verifyPins();assert.equal(hash(JSON.parse((await checkedFile(testsPin.path,{collect:true})).raw)),batch.binding.testsSha256);
  const manifestBytes=await checkedFile(path.join(candidate,'deployment-manifest.json'),{collect:true});assert.equal(manifestBytes.sha256,expectedManifest);const manifest=JSON.parse(manifestBytes.raw);
  const keys=new Map();for(const key of manifest.artifacts.keyFiles){relativePath(key.relativePath);assert.ok(!keys.has(key.relativePath));keys.set(key.relativePath,key.sha256);assert.equal((await checkedFile(path.join(candidate,...key.relativePath.split('/')))).sha256,key.sha256,'Candidate key file changed');}
  for(const name of moduleNames)assert.equal(keys.get('tools/'+name),collector.files.find(f=>f.path===path.join(candidate,'tools',name)).sha256,'Import closure is outside manifest');
  assert.deepEqual(await completeTree(path.join(candidate,'node_modules')),manifest.build.nodeModulesTree,'Candidate dependency tree changed');
  const pkg=JSON.parse((await checkedFile(path.join(candidate,'node_modules/typescript/package.json'),{collect:true})).raw);assert.equal(pkg.main,'./lib/typescript.js');assert.equal(pkg.type,undefined);assert.equal(pkg.exports,undefined);assert.equal(pkg.imports,undefined);
  await verifyPins();
  const moduleAt=name=>pathToFileURL(path.join(candidate,'tools',name)).href;
  const batchApi=await import(moduleAt('release-batch.mjs')),admission=await import(moduleAt('release-batch-admission.mjs')),worker=await import(moduleAt('worker-local-release.mjs'));
  return {spec,verifyInputs,verifyPins,api:{...batchApi,...await import(moduleAt('worker-local-release-rotation.mjs')),collectBatchAdmission:admission.collectBatchAdmission,processDeadline:worker.processDeadline}};
}
